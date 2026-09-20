// Node child-process bridge to nemotron/bridge.py. One-shot spawn per request:
// never blocks the 120 Hz sim loop, never crashes the server, and always
// degrades to an offline-safe fallback on timeout, spawn failure, or garbage
// output. The API key is never logged or echoed.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../shared/config.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BRIDGE = path.join(ROOT, CONFIG.nemotron.bridgeScript);

export function isLiveMode() {
  return process.env[CONFIG.nemotron.liveEnv] === '1' && Boolean(process.env.NVIDIA_API_KEY);
}

function fallbackClassification(reason) {
  return {
    op: 'classify',
    classification: { shot: 'drive', target_zone: 'deep_right', confidence: 0.0 },
    path: 'fallback',
    reason: `bridge_${reason}`,
  };
}

function runBridge(request, { timeoutMs, command = ['python3', BRIDGE] } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return resolve(null);
    }
    let stdout = '';
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, timeoutMs);
    child.on('error', () => finish(null));
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', () => {});
    child.on('close', () => {
      try {
        const last = stdout.trim().split('\n').pop();
        const response = JSON.parse(last);
        finish(response && response.op !== 'error' ? response : null);
      } catch {
        finish(null);
      }
    });
    child.stdin.on('error', () => {});
    try {
      child.stdin.write(JSON.stringify(request) + '\n');
      child.stdin.end();
    } catch {
      finish(null);
    }
  });
}

export async function classifySwing(swing, pose = {}, opts = {}) {
  const response = await runBridge(
    { op: 'classify', swing, pose },
    { timeoutMs: CONFIG.nemotron.classifierTimeoutMs, ...opts },
  );
  return response ?? fallbackClassification(opts.timeoutMs ? 'timeout' : 'unavailable');
}

export async function adjudicateRally(events, gameState, opts = {}) {
  return runBridge(
    { op: 'referee', events, game_state: gameState },
    { timeoutMs: CONFIG.nemotron.refereeTimeoutMs, ...opts },
  );
}

export async function chooseCommentary(context, eligible) {
  if (!isLiveMode()) return null;
  const response = await runBridge({ op: 'commentary', context, eligible }, { timeoutMs: 2500 });
  return response?.path === 'model' && eligible.includes(response.clip) ? response.clip : null;
}

// Node-side score safety: validate score and side_out before anything mutates.
// Returns the ruling when safe to apply, null when malformed.
export function validateRulingForApply(ruling, currentScore) {
  if (!ruling || typeof ruling !== 'object') return null;
  const { fault, player, rule, score, side_out } = ruling;
  if (typeof fault !== 'boolean') return null;
  if (!Array.isArray(score) || score.length !== 2
    || !score.every((n) => Number.isInteger(n) && n >= 0)) return null;
  if (typeof side_out !== 'boolean') return null;
  if (fault) {
    if (!['A', 'B'].includes(player)) return null;
    if (typeof rule !== 'string' || !rule) return null;
  } else {
    if (player !== null || rule !== 'none' || side_out !== false) return null;
    if (score[0] !== currentScore[0] || score[1] !== currentScore[1]) return null;
  }
  return ruling;
}
