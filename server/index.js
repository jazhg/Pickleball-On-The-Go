import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../shared/config.js';
import { normalizeControllerPose, parseMessage } from '../shared/protocol.js';
import { parseAnalysis } from '../shared/shot-telemetry.js';
import { Simulation } from './physics.js';
import { classifySwing, coachRally, chooseCommentary, isLiveMode } from './nemotron-bridge.js';
import { RefereeVoiceGate } from '../shared/referee-clips.js';

// Translate authoritative sim events into fixture-style referee events so the
// Nemotron referee judges the same shape it was evaluated on.
export function buildRallyEnvelope(sim) {
  const events = [];
  let lastHitter = null, serveLogged = false;
  for (const e of sim.events) {
    const t = Math.round(e.time * 1000);
    if (e.type === 'contact') {
      lastHitter = e.player;
      if (!serveLogged) {
        // Serve-motion predicates are assumed compliant, not sensed; documented caveat.
        events.push({ event: 'serve', player: e.player, method: 'volley', foot_legal: true,
          contact_above_waist: false, upward_motion: true, paddle_below_wrist: true, t });
        serveLogged = true;
      } else {
        events.push({ event: 'hit', player: e.player, id: `h${events.length}`, volley: e.volley === true, t });
      }
    } else if (e.type === 'bounce') {
      events.push({ event: 'bounce', player: e.z < 0 ? 'B' : 'A',
        x: +e.x.toFixed(3), z: +e.z.toFixed(3), t });
    } else if (e.type === 'rally_end') {
      if (['A', 'B'].includes(e.player)) {
        events.push({ event: 'fault', player: e.player, t });
      } else if (e.reason === 'two_bounces') {
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
      score: [...(sim.rallyStart?.score || sim.score)],
      serving_team: sim.rallyStart?.servingTeam || sim.servingTeam,
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const lanAddresses = () => Object.values(networkInterfaces())
  .flatMap(addresses => addresses || [])
  .filter(address => address.family === 'IPv4' && !address.internal)
  .map(address => address.address);
export async function createRelay({ insecure = false, port = CONFIG.network.port, host = insecure ? '127.0.0.1' : '0.0.0.0' } = {}) {
  const sim = new Simulation();
  let multiplayer = false;
  let practiceEnabled = false, practicePlayer = 'A', nextPracticeFeedAt = Infinity;
  const connections = () => Object.fromEntries(['A', 'B'].map(player => [player,
    Object.fromEntries(['laptop', 'phone'].map(role => [role, [...hub.clients].some(client =>
      client.player === player && client.role === role && client.readyState === WebSocket.OPEN)]))]));
  const stateFor = player => ({ ...sim.state(player), multiplayer, connections: connections() });
  let lastClassification = null; // most recent shot, for the evidence panel
  let lastShot = null, nextShotId = 1;
  const sendToLaptops = (obj) => {
    const text = JSON.stringify(obj);
    for (const client of hub.clients) {
      if (client.role === 'laptop' && client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) client.send(text);
    }
  };
  const voiceGate = new RefereeVoiceGate();
  let voiceId = 0, commentaryPending = false, lastCommentaryRequest = -Infinity;
  function announce(clip, priority = 'official') {
    const now = Date.now();
    if (voiceGate.allow(clip, priority, now)) sendToLaptops({ type: 'referee_voice', id: ++voiceId, clip, priority, expires_at: now + 3500 });
  }
  async function considerCommentary(shot, player) {
    const now = Date.now();
    if (commentaryPending || now - lastCommentaryRequest < 15000 || now - voiceGate.last < 6000) return;
    const events = sim.events, contact = events.at(-1);
    const hits = events.filter(event => event.type === 'contact').length;
    if (hits < 3) return;
    const speed = shot.launch_speed_mps;
    const eligible = ['great_return'];
    if (speed >= 10 && shot.launch_angle_deg < 30) eligible.push('drive');
    if (Math.abs(sim.ball.vx) > Math.abs(sim.ball.vz) * 0.5) eligible.push('angle');
    if (hits >= 6) eligible.push('rally');
    if (Math.max(...sim.score) >= 8 && Math.abs(sim.score[0] - sim.score[1]) <= 1) eligible.push('close_game');
    commentaryPending = true; lastCommentaryRequest = now;
    try {
      const clip = await chooseCommentary({ player, hits, speed_mps: speed, angle_degrees: shot.launch_angle_deg, score: [...sim.score] }, eligible);
      // The next hit or a new point makes this particular moment obsolete.
      if (clip && sim.phase === 'rally' && sim.events === events && sim.events.findLast(e => e.type === 'contact') === contact) announce(clip, 'praise');
    } finally { commentaryPending = false; }
  }
  const handler = async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'accelerometer=(self), gyroscope=(self)' };
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400, headers); return res.end('Invalid URL'); }
    if (pathname === '/health') {
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.json'] });
      const scheme = insecure ? 'http' : 'https';
      const activePort = req.socket.localPort || port;
      const phone_urls = insecure ? [] : lanAddresses().map(address => `${scheme}://${address}:${activePort}/client-phone/`);
      return res.end(JSON.stringify({ ok: true, simulation_hz: CONFIG.simulation.hz, broadcast_hz: CONFIG.simulation.broadcastHz, phone_urls }));
    }
    if (pathname === '/api/spawn' && req.method === 'POST') {
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { /* Require a browser same-origin request. */ }
      if (!sameOrigin) { res.writeHead(405, headers); return res.end(); }
      sim.spawn(sim.servingTeam);
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: true }));
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
      if (path.extname(file) === '.mp3') {
        const audioHeaders = { ...headers, 'Content-Type': MIME['.mp3'], 'Accept-Ranges': 'bytes' };
        if (req.headers.range && req.method !== 'HEAD') {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          const start = match?.[1] ? Number(match[1]) : Math.max(0, content.length - Number(match?.[2]));
          const end = match?.[1] && match[2] ? Math.min(Number(match[2]), content.length - 1) : content.length - 1;
          if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= content.length) {
            res.writeHead(416, { ...audioHeaders, 'Content-Range': `bytes */${content.length}` }); return res.end();
          }
          res.writeHead(206, { ...audioHeaders, 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Content-Length': end - start + 1 });
          return res.end(content.subarray(start, end + 1));
        }
        res.writeHead(200, { ...audioHeaders, 'Content-Length': content.length });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
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
    } catch { throw new Error('HTTPS certificates missing. Run npm run certs -- <LAN-IP> first. Use npm run dev:http for a localhost-only keyboard demo.'); }
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
    // A human joining B ends solo practice for this session, including across
    // brief disconnects: the bot must never take over a human's return.
    if (ws.player === 'B') multiplayer = true;
    ws.isAlive = true; ws.lastSwing = -Infinity;
    ws.controllerTokens = CONFIG.network.controllerRateBurst;
    ws.controllerRefillAt = performance.now();
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    const seat = ws.player || 'A';
    if (ws.role === 'laptop' && !sim.players[seat]) {
      sim.setPose({ t: Date.now(), type: 'pose', court_x: CONFIG.player.x,
        court_y: CONFIG.player.homeDepth, torso_deg: 0, wrist_h: CONFIG.player.paddleHeight }, seat);
    }
    ws.send(JSON.stringify({ type: 'hello', player: seat, role: ws.role }));
    ws.send(JSON.stringify(stateFor(seat)));
    ws.send(JSON.stringify({ t: Date.now(), type: 'practice', enabled: practiceEnabled, player: practicePlayer }));
    if (ws.role === 'laptop' && lastShot) ws.send(JSON.stringify(lastShot));
    const opponentPose = sim.players[seat === 'A' ? 'B' : 'A'];
    if (opponentPose) ws.send(JSON.stringify({ ...opponentPose, type: 'pose' }));
    ws.on('message', (data, binary) => {
      if (binary) return;
      const analysisMessage = parseAnalysis(data);
      if (analysisMessage) {
        const pending = ws.pendingShot;
        if (!pending || pending.t !== analysisMessage.t || pending.analysis !== null) return;
        pending.analysis = analysisMessage.analysis;
        lastShot = pending;
        sendToLaptops(pending);
        return;
      }
      const msg = parseMessage(data);
      if (!msg) return;
      if (msg.type === 'controller_pose') {
        if (ws.role !== 'phone') return;
        const now = performance.now();
        const pose = normalizeControllerPose(msg);
        if (!pose) return;
        // Keep contact aim fresh even when visual updates exhaust the relay budget.
        ws.controllerPose = pose;
        ws.controllerPoseAt = now;
        sim.setController(pose, ws.player);
        ws.controllerTokens = Math.min(CONFIG.network.controllerRateBurst,
          ws.controllerTokens + (now - ws.controllerRefillAt) * CONFIG.network.controllerHz / 1000);
        ws.controllerRefillAt = now;
        if (ws.controllerTokens < 1) return;
        ws.controllerTokens -= 1;
        const text = JSON.stringify(pose);
        for (const client of hub.clients) {
          if (client.role !== 'laptop' || client.player !== ws.player || client.readyState !== WebSocket.OPEN || client.bufferedAmount >= 65536) continue;
          client.send(text);
        }
      } else if (msg.type === 'swing') {
        const now = performance.now();
        if (now - ws.lastSwing < CONFIG.network.minSwingIntervalMs) return;
        ws.lastSwing = now;
        const seat = ws.player || 'A';
        const phaseBefore = sim.phase;
        const aim = ws.role === 'phone' && now - ws.controllerPoseAt <= CONFIG.controller.poseTimeoutMs
          ? ws.controllerPose : null;
        const accepted = sim.swing(msg, seat, aim);
        const horizontal = accepted ? Math.hypot(sim.ball.vx, sim.ball.vz) : 0;
        const shot = {
          type: 'shot', id: nextShotId++, player: seat, t: msg.t, source: ws.role, accepted,
          reason: accepted ? 'contact' : phaseBefore === 'idle' ? 'no_ball' : phaseBefore === 'ready' ? 'missed' : 'busy',
          swing: msg,
          launch_speed_mps: accepted ? Math.hypot(sim.ball.vx, sim.ball.vy, sim.ball.vz) : null,
          launch_angle_deg: accepted ? Math.atan2(sim.ball.vy, horizontal) * 180 / Math.PI : null,
          analysis: null,
        };
        ws.pendingShot = shot;
        lastShot = shot;
        sendToLaptops(shot);
        if (accepted) {
          sendToLaptops({ type: 'racket_hit', t: Date.now() });
          considerCommentary(shot, seat).catch(() => {});
          // Physics launches immediately; classification runs async and must never
          // block the 120 Hz sim loop. The bridge always resolves (fallback included).
          const pose = { wrist_h: sim.players[seat]?.wrist_h ?? CONFIG.player.paddleHeight, phase: phaseBefore === 'ready' ? 'serve' : 'rally' };
          classifySwing(msg, pose).then((result) => {
            if (lastShot?.id !== shot.id) return;
            const c = result.classification;
            lastClassification = { shot: c.shot, target_zone: c.target_zone, confidence: c.confidence };
            sendToLaptops({ t: Date.now(), type: 'classification', shot: c.shot,
              target_zone: c.target_zone, confidence: c.confidence, path: result.path, shot_id: shot.id, player: seat });
          }).catch(() => {});
        }
        console.log(`[${ws.role} ${seat}] swing ${msg.peak_g.toFixed(2)}g pitch ${msg.pitch.toFixed(1)}° ${accepted ? 'CONTACT' : sim.phase === 'idle' ? 'no ball: press Spawn ball' : sim.phase === 'ready' ? 'outside hit window' : 'shot already in progress'}`);
      } else if (msg.type === 'new_game' && ws.role === 'laptop' && sim.phase === 'game_over') {
        completedRally = null;
        sim.newGame();
        sim.spawn('A');
      } else if (msg.type === 'spawn') {
        const player = ws.player || 'A';
        if (sim.spawn(player)) announce(player === 'A' ? 'red_serves' : 'blue_serves');
      } else if (msg.type === 'practice' && ws.role === 'laptop') {
        practiceEnabled = msg.enabled;
        practicePlayer = ws.player || 'A';
        nextPracticeFeedAt = practiceEnabled ? performance.now() : Infinity;
        completedRally = null;
        sim.practiceFocus = msg.focus || null;
        sim.practice = practiceEnabled;
        sim.reset();
        if (!practiceEnabled && sim.winner) sim.phase = 'game_over';
        sendToLaptops({ t: Date.now(), type: 'practice', enabled: practiceEnabled, player: practicePlayer, ...(sim.practiceFocus ? { focus: sim.practiceFocus } : {}) });
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
  let botScheduled = false, botTimer = null, botContact = null;
  let coachPending = false;
  let completedRally = null;
  const onRallyComplete = async () => {
    const ruling = sim.lastResult;
    if (!ruling || completedRally === sim.events) return;
    completedRally = sim.events;
    const rallyEvents = sim.events;
    const rallyId = sim.rallyId;
    const envelope = buildRallyEnvelope(sim);
    const clip = ruling.side_out ? 'side_out' : (ruling.player === 'A' ? 'point_blue' : 'point_red');
    announce(clip);
    sendToLaptops(ruling);
    sendToLaptops({ t: Date.now(), type: 'ruling_evidence', rule: ruling.rule,
      provisional: true, path: 'game_engine', trigger_events: describeEvents(envelope.events), preceding_shot: lastClassification });
    if (coachPending) {
      sendToLaptops({ type: 'coach_status', text: 'New rally completed · previous coaching analysis still finishing.' });
      return;
    }
    coachPending = true;
    sendToLaptops({ type: 'coach_status', text: isLiveMode() ? 'Nemotron is selecting a training cue…' : 'Offline coaching · baseline decision' });
    try {
      const decision = await coachRally(rallyEvents, ruling);
      if (decision && completedRally === rallyEvents && !practiceEnabled) sendToLaptops({ type: 'coach_decision', rally_id: rallyId, ...decision });
      else if (!decision && completedRally === rallyEvents && !practiceEnabled) sendToLaptops({ type: 'coach_status', text: 'Coaching unavailable · scoring continues normally.' });
      else if (completedRally !== rallyEvents && !practiceEnabled) sendToLaptops({ type: 'coach_status', text: 'Older coaching result discarded · ready for the next rally.' });
    } finally { coachPending = false; }
  };
  let lastBounceSoundAt = -Infinity;
  const tick = setInterval(() => {
    const now = performance.now();
    if (practiceEnabled && now >= nextPracticeFeedAt) {
      sim.practiceFeed(practicePlayer);
      nextPracticeFeedAt = now + CONFIG.practice.feedIntervalMs;
    }
    accumulator += Math.min((now - previous) / 1000, CONFIG.simulation.maxCatchupSeconds);
    previous = now;
    while (accumulator >= step) {
      const eventCount = sim.events.length;
      sim.step(step); accumulator -= step;
      for (const event of sim.events.slice(eventCount)) {
        if (event.type === 'bounce' && event.impactSpeed >= 0.8 && now - lastBounceSoundAt >= 180) {
          lastBounceSoundAt = now;
          sendToLaptops({ type: 'ground_bounce', t: Date.now() });
        }
      }
    }
    if (sim.phase !== prevPhase) {
      if (sim.phase === 'rally') botScheduled = false;
      if (!practiceEnabled && sim.lastResult && completedRally !== sim.events) {
        if (botTimer) { clearTimeout(botTimer); botTimer = null; }
        onRallyComplete();
      }
      prevPhase = sim.phase;
    }
    // Swing faults may finish a rally between timer ticks.
    if (!practiceEnabled && sim.lastResult && completedRally !== sim.events) onRallyComplete();
    // Each new contact starts a new shot, even within the same rally.
    const contactIndex = sim.events.findLastIndex(e => e.type === 'contact');
    const contact = sim.events[contactIndex];
    if (contact !== botContact) {
      botContact = contact;
      botScheduled = false;
      if (botTimer) { clearTimeout(botTimer); botTimer = null; }
    }
    if (multiplayer && botTimer) {
      clearTimeout(botTimer);
      botTimer = null;
      botScheduled = true;
    }
    if (!practiceEnabled && !multiplayer && sim.phase === 'idle' && sim.servingTeam === 'B') sim.spawn('B');
    if (!practiceEnabled && !multiplayer && sim.phase === 'ready' && sim.readyFor === 'B') {
      sim.swing({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic, roll: 0, pitch: 0 }, 'B');
      sendToLaptops({ type: 'racket_hit', t: Date.now() });
    }
    // Return the current A shot's first in-bounds far-side bounce.
    // Solo mode gets the training return. When Player B has joined, the real
    // Player B phone/laptop owns the next contact and the bot stays out.
    if (!practiceEnabled && !multiplayer && sim.phase === 'rally' && sim.lastHitter === 'A' && !botScheduled) {
      const landed = sim.events.some((e, index) => index > contactIndex && e.type === 'bounce' && e.in_bounds && e.z < 0);
      if (landed) {
        botScheduled = true;
        botTimer = setTimeout(() => {
          botTimer = null;
          if (!multiplayer && sim.botReturn()) sendToLaptops({ type: 'racket_hit', t: Date.now() });
        }, 180);
      }
    }
  }, 1000 / CONFIG.simulation.hz);
  const broadcast = setInterval(() => {
    for (const client of hub.clients) {
      if (client.readyState !== WebSocket.OPEN || client.bufferedAmount > 65536) continue;
      const state = JSON.stringify(stateFor(client.player || 'A'));
      client.send(state);
    }
  }, 1000 / CONFIG.simulation.broadcastHz);
  const heartbeat = setInterval(() => {
    for (const ws of hub.clients) { if (!ws.isAlive) ws.terminate(); else { ws.isAlive = false; ws.ping(); } }
  }, CONFIG.network.heartbeatMs);
  const close = async () => {
    if (botTimer) clearTimeout(botTimer);
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
    else for (const address of lanAddresses()) console.log(`Phone / LAN: ${scheme}://${address}:${port}/client-phone/`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await relay.close(); process.exit(0); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
