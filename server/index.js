import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../shared/config.js';
import { parseMessage } from '../shared/protocol.js';
import { Simulation } from './physics.js';
import { adjudicateRally, classifySwing, validateRulingForApply } from './nemotron-bridge.js';

// Translate authoritative sim events into fixture-style referee events so the
// Nemotron referee judges the same shape it was evaluated on.
export function buildRallyEnvelope(sim) {
  const events = [];
  let lastHitter = null, serveLogged = false;
  for (const e of sim.events) {
    const t = Math.round(e.time * 1000);
    if (e.type === 'contact') {
      lastHitter = e.player;
      if (!serveLogged && e.player === 'A') {
        // Serve-motion predicates are assumed compliant, not sensed; documented caveat.
        events.push({ event: 'serve', player: 'A', method: 'volley', foot_legal: true,
          contact_above_waist: false, upward_motion: true, paddle_below_wrist: true, t });
        serveLogged = true;
      } else {
        events.push({ event: 'hit', player: e.player, id: `h${events.length}`, volley: false, t });
      }
    } else if (e.type === 'bounce') {
      events.push({ event: 'bounce', player: e.z < 0 ? 'B' : 'A',
        x: +e.x.toFixed(3), z: +e.z.toFixed(3), t });
    } else if (e.type === 'rally_end') {
      if (e.reason === 'two_bounces') {
        const lastBounce = [...events].reverse().find((x) => x.event === 'bounce');
        const loser = lastBounce ? lastBounce.player : (lastHitter === 'A' ? 'B' : 'A');
        events.push({ event: 'fault', player: loser, t });
      } else if (e.reason === 'out') {
        events.push({ event: 'fault', player: lastHitter || 'A', t });
      }
      // 'timeout' carries no fault: the referee replays the point, score untouched.
    }
  }
  return {
    events,
    game_state: {
      score: [...sim.score],
      serving_team: sim.servingTeam,
      server_number: 1,
      scoring_mode: 'singles',
    },
  };
}

// Human-readable timeline for the judges' evidence panel ("explain this call").
export function describeEvents(fixtureEvents) {
  return fixtureEvents.map((e) => {
    const t = e.t;
    if (e.event === 'serve') return { label: `Serve · Player ${e.player}`, t };
    if (e.event === 'bounce') return { label: `Bounce · ${e.player === 'B' ? 'far side' : 'your side'} (${e.x.toFixed(1)}, ${e.z.toFixed(1)})`, t };
    if (e.event === 'hit') return { label: `Return · Player ${e.player}`, t };
    if (e.event === 'fault') return { label: `Fault recorded · Player ${e.player}`, t };
    return { label: e.event, t };
  });
}

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
export async function createRelay({ insecure = false, port = CONFIG.network.port, host = insecure ? '127.0.0.1' : '0.0.0.0' } = {}) {
  const sim = new Simulation();
  let lastClassification = null; // most recent shot, for the evidence panel
  const sendToLaptops = (obj) => {
    const text = JSON.stringify(obj);
    for (const client of hub.clients) {
      if (client.role === 'laptop' && client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) client.send(text);
    }
  };
  const handler = async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'accelerometer=(self), gyroscope=(self)' };
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400, headers); return res.end('Invalid URL'); }
    if (pathname === '/health') {
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: true, simulation_hz: CONFIG.simulation.hz, broadcast_hz: CONFIG.simulation.broadcastHz }));
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); return res.end(); }
    if (pathname === '/') { res.writeHead(302, { ...headers, Location: '/client-laptop/' }); return res.end(); }
    // Serve only public browser assets. Never expose certs, keys, logs or source env files.
    if (!/^\/(client-laptop|client-phone|shared)\//.test(pathname) || pathname.split('/').some(p => p.startsWith('.')) || pathname.includes('\\')) {
      res.writeHead(404, headers); return res.end('Not found');
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(ROOT, pathname);
    if (!MIME[path.extname(file)] || !file.startsWith(ROOT)) { res.writeHead(404, headers); return res.end('Not found'); }
    try {
      const content = await fs.readFile(file);
      res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404, headers); res.end('Not found'); }
  };
  let server;
  if (insecure) server = http.createServer(handler);
  else {
    let key, cert;
    try {
      [key, cert] = await Promise.all([
        fs.readFile(process.env.TLS_KEY || path.join(ROOT, '.certs/key.pem')),
        fs.readFile(process.env.TLS_CERT || path.join(ROOT, '.certs/cert.pem')),
      ]);
    } catch { throw new Error('HTTPS certificates missing. Run npm run certs -- <LAN-IP> first. Use npm run dev for a localhost-only keyboard demo.'); }
    server = https.createServer({ key, cert }, handler);
  }
  const hub = new WebSocketServer({ noServer: true, maxPayload: CONFIG.network.maxPayloadBytes });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    let sameOrigin = false;
    try { const origin = new URL(req.headers.origin); sameOrigin = origin.host === req.headers.host && origin.protocol === (insecure ? 'http:' : 'https:'); } catch { /* Non-browser test clients may omit Origin. */ }
    if (url.pathname !== '/ws' || !['laptop', 'phone'].includes(url.searchParams.get('role')) || (req.headers.origin && !sameOrigin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    const role = url.searchParams.get('role');
    const requestedSeat = url.searchParams.get('seat');
    const used = new Set([...hub.clients]
      .filter(client => client.role === role && client.player)
      .map(client => client.player));
    const player = requestedSeat === 'A' || requestedSeat === 'B'
      ? (used.has(requestedSeat) ? null : requestedSeat)
      : ['A', 'B'].find(candidate => !used.has(candidate));
    if (!player) {
      socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    hub.handleUpgrade(req, socket, head, ws => {
      ws.role = role;
      ws.player = player;
      hub.emit('connection', ws);
    });
  });
  hub.on('connection', ws => {
    ws.isAlive = true; ws.lastSwing = -Infinity;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    const seat = ws.player || 'A';
    ws.send(JSON.stringify({ type: 'hello', player: seat, role: ws.role }));
    ws.send(JSON.stringify(sim.state(seat)));
    const opponentPose = sim.players[seat === 'A' ? 'B' : 'A'];
    if (opponentPose) ws.send(JSON.stringify({ ...opponentPose, type: 'pose' }));
    ws.on('message', (data, binary) => {
      if (binary) return;
      const msg = parseMessage(data);
      if (!msg) return;
      if (msg.type === 'swing') {
        const now = performance.now();
        if (now - ws.lastSwing < CONFIG.network.minSwingIntervalMs) return;
        ws.lastSwing = now;
        const seat = ws.player || 'A';
        const accepted = sim.swing(msg, seat);
        if (accepted) {
          // Physics launches immediately; classification runs async and must never
          // block the 120 Hz sim loop. The bridge always resolves (fallback included).
          const pose = sim.pose ? { wrist_h: sim.pose.wrist_h, phase: sim.phase } : {};
          classifySwing(msg, pose).then((result) => {
            const c = result.classification;
            lastClassification = { shot: c.shot, target_zone: c.target_zone, confidence: c.confidence };
            sendToLaptops({ t: Date.now(), type: 'classification', shot: c.shot,
              target_zone: c.target_zone, confidence: c.confidence, path: result.path });
          }).catch(() => {});
        }
        console.log(`[${ws.role} ${seat}] swing ${msg.peak_g.toFixed(2)}g pitch ${msg.pitch.toFixed(1)}° ${accepted ? 'CONTACT' : sim.phase === 'idle' ? 'no ball: press Spawn ball' : sim.phase === 'ready' ? 'outside hit window' : 'shot already in progress'}`);
      } else if (msg.type === 'spawn') {
        sim.spawn(ws.player || 'A');
      } else if (msg.type === 'pose' && ws.role === 'laptop') {
        const seat = ws.player || 'A';
        sim.setPose(msg, seat);
        const pose = JSON.stringify({ ...sim.players[seat], type: 'pose' });
        for (const client of hub.clients) {
          if (client === ws || client.role !== 'laptop' || client.readyState !== WebSocket.OPEN || client.bufferedAmount >= 65536) continue;
          client.send(pose);
        }
      }
    });
  });
  let previous = performance.now(), accumulator = 0;
  const step = 1 / CONFIG.simulation.hz;
  let prevPhase = sim.phase;
  let botScheduled = false, botTimer = null;
  const onRallyComplete = async () => {
    // Adjudication is async and never blocks the sim; a missing or malformed
    // ruling leaves the score untouched (offline-safe default).
    const envelope = buildRallyEnvelope(sim);
    const shotAtRallyEnd = lastClassification; // snapshot: a fast next swing must not rewrite this rally's evidence
    let response = null;
    try { response = await adjudicateRally(envelope.events, envelope.game_state); }
    catch (error) { console.warn('[nemotron] referee bridge failed:', error.message); }
    if (!response || !response.ruling) return;
    const ruling = validateRulingForApply(response.ruling, sim.score);
    if (!ruling) { console.warn('[nemotron] ruling rejected by score guard'); return; }
    sim.score = [...ruling.score];
    if (ruling.side_out) sim.servingTeam = sim.servingTeam === 'A' ? 'B' : 'A';
    sendToLaptops({ type: 'ruling', fault: ruling.fault, player: ruling.player,
      rule: ruling.rule, explanation: ruling.explanation, score: [...ruling.score], side_out: ruling.side_out });
    sendToLaptops({ t: Date.now(), type: 'ruling_evidence', rule: ruling.rule,
      provisional: response.provisional !== false, path: response.path || 'unknown',
      trigger_events: describeEvents(envelope.events), preceding_shot: shotAtRallyEnd });
  };
  const tick = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min((now - previous) / 1000, CONFIG.simulation.maxCatchupSeconds);
    previous = now;
    while (accumulator >= step) { sim.step(step); accumulator -= step; }
    if (sim.phase !== prevPhase) {
      if (sim.phase === 'rally') botScheduled = false;
      if (prevPhase === 'rally' && sim.phase === 'reset') {
        if (botTimer) { clearTimeout(botTimer); botTimer = null; }
        onRallyComplete();
      }
      prevPhase = sim.phase;
    }
    // Wall bot: return the first in-bounds far-side bounce after ~0.35 s.
    if (sim.phase === 'rally' && !botScheduled) {
      const landed = sim.events.some((e) => e.type === 'bounce' && e.in_bounds && e.z < 0);
      if (landed) {
        botScheduled = true;
        botTimer = setTimeout(() => { botTimer = null; sim.botReturn(); }, 350);
      }
    }
  }, 1000 / CONFIG.simulation.hz);
  const broadcast = setInterval(() => {
    for (const client of hub.clients) {
      if (client.readyState !== WebSocket.OPEN || client.bufferedAmount > 65536) continue;
      const state = JSON.stringify(sim.state(client.player || 'A'));
      client.send(state);
    }
  }, 1000 / CONFIG.simulation.broadcastHz);
  const heartbeat = setInterval(() => {
    for (const ws of hub.clients) { if (!ws.isAlive) ws.terminate(); else { ws.isAlive = false; ws.ping(); } }
  }, CONFIG.network.heartbeatMs);
  const close = async () => {
    for (const timer of [tick, broadcast, heartbeat]) clearInterval(timer);
    for (const ws of hub.clients) ws.terminate();
    await new Promise(resolve => hub.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
  };
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { await close(); throw error; }
  return { server, hub, sim, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const insecure = process.argv.includes('--http');
  const port = Number(process.env.PORT || CONFIG.network.port);
  try {
    const relay = await createRelay({ insecure, port });
    const scheme = insecure ? 'http' : 'https';
    console.log(`Pickleball M1 · authoritative ${CONFIG.simulation.hz}Hz / state ${CONFIG.simulation.broadcastHz}Hz`);
    console.log(`Laptop: ${scheme}://localhost:${port}/client-laptop/`);
    if (insecure) console.log('Keyboard-only localhost mode. Use npm start with mkcert certificates for phone + LAN.');
    else for (const list of Object.values(networkInterfaces())) for (const address of list || []) if (address.family === 'IPv4' && !address.internal) console.log(`Phone / LAN: ${scheme}://${address.address}:${port}/client-phone/`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await relay.close(); process.exit(0); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
