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
import { parseAnalysis, emptyAnalysis } from '../shared/shot-telemetry.js';
import { parseDirectedSwing } from '../shared/direction.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
export async function createRelay({ insecure = false, port = CONFIG.network.port, host = insecure ? '127.0.0.1' : '0.0.0.0' } = {}) {
  const sim = new Simulation();
  let lastShot = null, shotSequence = 0;
  const handler = async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'accelerometer=(self), gyroscope=(self)' };
    // Explicit user action over HTTP; existing section-3 WebSocket schemas stay fixed.
    if (req.method === 'POST' && req.url === '/api/spawn') {
      let sameOrigin = false;
      try { const origin = new URL(req.headers.origin); sameOrigin = origin.host === req.headers.host && origin.protocol === (insecure ? 'http:' : 'https:'); } catch {}
      if (!sameOrigin) { res.writeHead(403, headers); return res.end(); }
      const accepted = sim.spawn();
      res.writeHead(accepted ? 200 : 409, { ...headers, 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ accepted, phase: sim.phase }));
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); return res.end(); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400, headers); return res.end('Invalid URL'); }
    if (pathname === '/health') {
      res.writeHead(200, { ...headers, 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: true, simulation_hz: CONFIG.simulation.hz, broadcast_hz: CONFIG.simulation.broadcastHz }));
    }
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
  const publishShot = shot => {
    const message = JSON.stringify(shot);
    for (const client of hub.clients) if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) client.send(message);
  };
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    let sameOrigin = false;
    try { const origin = new URL(req.headers.origin); sameOrigin = origin.host === req.headers.host && origin.protocol === (insecure ? 'http:' : 'https:'); } catch { /* Non-browser test clients may omit Origin. */ }
    if (url.pathname !== '/ws' || !['laptop', 'phone'].includes(url.searchParams.get('role')) || (req.headers.origin && !sameOrigin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    hub.handleUpgrade(req, socket, head, ws => {
      ws.role = url.searchParams.get('role'); hub.emit('connection', ws);
    });
  });
  hub.on('connection', ws => {
    ws.isAlive = true; ws.lastSwing = -Infinity;
    ws.shots = new Map();
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.send(JSON.stringify(sim.state()));
    if (sim.pose) ws.send(JSON.stringify(sim.pose));
    if (lastShot) ws.send(JSON.stringify(lastShot));
    ws.on('message', (data, binary) => {
      if (binary) return;
      const directed = ws.role === 'phone' ? parseDirectedSwing(data) : null;
      const msg = directed?.swing || parseMessage(data);
      if (!msg) {
        const update = parseAnalysis(data);
        if (!update || ws.role !== 'phone') return;
        const shot = ws.shots.get(update.t);
        if (!shot || shot.analysis !== null) return;
        shot.analysis = update.analysis;
        // Older analyses may finish late: never overwrite a newer Last shot.
        if (lastShot?.id === shot.id) publishShot(shot);
        return;
      }
      if (msg.type === 'swing') {
        const now = performance.now();
        if (now - ws.lastSwing < CONFIG.network.minSwingIntervalMs || ws.shots.has(msg.t)) return;
        ws.lastSwing = now;
        const phase = sim.phase;
        const accepted = sim.swing(msg, directed?.angle);
        const ball = sim.ball;
        lastShot = { type: 'shot', id: ++shotSequence, t: msg.t, source: ws.role, accepted,
          reason: accepted ? 'contact' : phase === 'idle' ? 'no_ball' : phase === 'ready' ? 'missed' : 'busy',
          swing: { ...msg }, launch_speed_mps: accepted ? Math.hypot(ball.vx, ball.vy, ball.vz) : null,
          launch_angle_deg: accepted ? Math.atan2(ball.vy, Math.hypot(ball.vx, ball.vz)) * 180 / Math.PI : null,
          analysis: ws.role === 'laptop' ? emptyAnalysis('synthetic', msg.peak_g) : null };
        ws.shots.set(msg.t, lastShot);
        if (ws.shots.size > 8) ws.shots.delete(ws.shots.keys().next().value);
        publishShot(lastShot);
        console.log(`[${ws.role}] swing ${msg.peak_g.toFixed(2)}g pitch ${msg.pitch.toFixed(1)}° ${accepted ? 'CONTACT' : sim.phase === 'idle' ? 'no ball: press Spawn ball' : sim.phase === 'ready' ? 'outside hit window' : 'shot already in progress'}`);
      } else if (msg.type === 'pose' && ws.role === 'laptop') {
        sim.setPose(msg);
        const pose = JSON.stringify(sim.pose);
        for (const client of hub.clients) if (client.role === 'laptop' && client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) client.send(pose);
      }
    });
  });
  let previous = performance.now(), accumulator = 0;
  const step = 1 / CONFIG.simulation.hz;
  const tick = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min((now - previous) / 1000, CONFIG.simulation.maxCatchupSeconds);
    previous = now;
    while (accumulator >= step) { sim.step(step); accumulator -= step; }
  }, 1000 / CONFIG.simulation.hz);
  const broadcast = setInterval(() => {
    const state = JSON.stringify(sim.state());
    for (const client of hub.clients) if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) client.send(state);
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
