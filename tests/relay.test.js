import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createRelay } from '../server/index.js';
import { CONFIG } from '../shared/config.js';
import { validMessage } from '../shared/protocol.js';

test('game mode synchronizes both seats, waits for referee and ends only with a two-point lead', async () => {
  let release;
  const relay = await createRelay({ insecure: true, port: 0, reviewGame: () => new Promise(resolve => { release = resolve; }) });
  const endpoint = `ws://127.0.0.1:${relay.server.address().port}/ws?role=laptop`;
  const a = new WebSocket(`${endpoint}&seat=A`), b = new WebSocket(`${endpoint}&seat=B`);
  try {
    await Promise.all([once(a, 'open'), once(b, 'open')]);
    const started = waitForMessage(b, m => m.type === 'state' && m.match?.mode === 'game');
    a.send(JSON.stringify({ t: 1, type: 'mode', mode: 'game' })); await started;
    relay.sim.score = [10, 10]; relay.sim.spawn('A'); relay.sim.fault('B', 'double_bounce');
    await waitForMessage(b, m => m.type === 'state' && m.match?.pending);
    assert.deepEqual(relay.sim.score, [10, 10]); assert.equal(relay.sim.spawn('A'), false);
    const ruling = waitForMessage(a, m => m.type === 'ruling'); release(null); await ruling;
    assert.deepEqual(relay.sim.score, [11, 10]); assert.equal(relay.sim.winner, null);
    await waitForMessage(a, m => m.type === 'state' && m.phase === 'idle');
    relay.sim.spawn('A'); relay.sim.fault('B', 'double_bounce');
    await waitForMessage(b, m => m.type === 'state' && m.match?.pending);
    const won = waitForMessage(b, m => m.type === 'state' && m.match?.winner === 'A'); release(null); await won;
    assert.deepEqual(relay.sim.score, [12, 10]); assert.equal(relay.sim.spawn('A'), false);
    const rematch = waitForMessage(b, m => m.type === 'state' && m.match?.mode === 'game' && !m.match.winner && m.score[0] === 0);
    a.send(JSON.stringify({ t: 2, type: 'mode', mode: 'game' })); await rematch;
  } finally { a.close(); b.close(); await relay.close(); }
});

test('serve recordings reach both players once, without replaying on rejected spawn requests', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const endpoint = `ws://127.0.0.1:${relay.server.address().port}/ws?role=laptop`;
  const a = new WebSocket(`${endpoint}&seat=A`), b = new WebSocket(`${endpoint}&seat=B`);
  try {
    await Promise.all([once(a, 'open'), once(b, 'open')]);
    let count = 0;
    a.on('message', data => { if (JSON.parse(String(data)).type === 'referee_voice') count++; });
    const heard = Promise.all([a, b].map(ws => waitForMessage(ws, msg => msg.type === 'referee_voice')));
    a.send(JSON.stringify({ t: Date.now(), type: 'spawn' }));
    const messages = await heard;
    assert.equal(messages[0].clip, 'red_serves');
    assert.deepEqual(messages[0], messages[1]);
    assert.ok(messages[0].expires_at > Date.now());
    for (let i = 0; i < 10; i++) a.send(JSON.stringify({ t: Date.now(), type: 'spawn' }));
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(count, 1);
  } finally { a.close(); b.close(); await relay.close(); }
});

test('confirmed racket contacts sound on both laptops, missed swings stay silent', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const endpoint = `ws://127.0.0.1:${relay.server.address().port}/ws?role=laptop`;
  const a = new WebSocket(`${endpoint}&seat=A`), b = new WebSocket(`${endpoint}&seat=B`);
  try {
    await Promise.all([once(a, 'open'), once(b, 'open')]);
    let count = 0;
    a.on('message', data => { if (JSON.parse(String(data)).type === 'racket_hit') count++; });
    const heard = Promise.all([a, b].map(ws => waitForMessage(ws, msg => msg.type === 'racket_hit')));
    relay.sim.spawn('A');
    a.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    await heard;
    const missed = waitForMessage(b, msg => msg.type === 'shot' && msg.accepted === false);
    relay.sim.ball = { x: 0, y: 1, z: 100, vx: 0, vy: 0, vz: 0 };
    b.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    await missed;
    assert.equal(count, 1);
  } finally { a.close(); b.close(); await relay.close(); }
});

test('a floor bounce sends one sound event to each laptop', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const endpoint = `ws://127.0.0.1:${relay.server.address().port}/ws?role=laptop`;
  const a = new WebSocket(`${endpoint}&seat=A`), b = new WebSocket(`${endpoint}&seat=B`);
  try {
    await Promise.all([once(a, 'open'), once(b, 'open')]);
    let count = 0;
    a.on('message', data => { if (JSON.parse(String(data)).type === 'ground_bounce') count++; });
    const heard = Promise.all([a, b].map(ws => waitForMessage(ws, msg => msg.type === 'ground_bounce')));
    relay.sim.phase = 'rally';
    relay.sim.lastHitter = 'B';
    relay.sim.ball = { x: 0, y: CONFIG.physics.ballRadius + 0.001, z: 3, vx: 0, vy: -2, vz: 0 };
    const messages = await heard;
    assert.ok(messages.every(msg => Number.isFinite(msg.t)));
    relay.sim.phase = 'ready';
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(count, 1, 'state broadcasts must not replay the impact');
    relay.sim.phase = 'rally';
    relay.sim.ball = { x: 0, y: CONFIG.physics.ballRadius, z: 3, vx: 0, vy: -0.05, vz: 0 };
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(count, 1, 'tiny settling bounces must remain silent');
  } finally { a.close(); b.close(); await relay.close(); }
});

function waitForMessage(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('timed out waiting for WebSocket message'));
    }, timeoutMs);
    function onMessage(payload) {
      let message;
      try { message = JSON.parse(String(payload)); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    }
    ws.on('message', onMessage);
  });
}

async function openClient(url) {
  const ws = new WebSocket(url);
  const helloPromise = waitForMessage(ws, message => message.type === 'hello');
  const statePromise = waitForMessage(ws, message => message.type === 'state');
  await once(ws, 'open');
  return { ws, hello: await helloPromise, state: await statePromise };
}

test('relay accepts seat-attributed laptop and phone input and protects private files', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const port = relay.server.address().port;
  const endpoint = `http://127.0.0.1:${port}`;
  let laptop;
  let phone;
  try {
    const healthResponse = await fetch(`${endpoint}/health`);
    assert.equal(healthResponse.status, 200);
    assert.ok(Array.isArray((await healthResponse.json()).phone_urls));
    for (const file of ['.env', '.certs/key.pem', 'server/index.js', 'shared/%2e%2e/%2e%2e/.env']) {
      assert.equal((await fetch(`${endpoint}/${file}`)).status, 404);
    }
    assert.equal((await fetch(`${endpoint}/api/spawn`, { method: 'POST' })).status, 405);

    const laptopClient = await openClient(`ws://127.0.0.1:${port}/ws?role=laptop&seat=A`);
    laptop = laptopClient.ws;
    assert.deepEqual(laptopClient.hello, { type: 'hello', player: 'A', role: 'laptop' });
    assert.ok(validMessage(laptopClient.state));
    assert.equal(laptopClient.state.phase, 'idle');

    laptop.send(JSON.stringify({ t: Date.now(), type: 'spawn' }));
    await waitForMessage(laptop, message => message.type === 'state' && message.phase === 'ready');
    laptop.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    const launched = await waitForMessage(laptop, message => message.type === 'state' && message.phase === 'rally');
    assert.ok(launched.ball.vz < 0);

    relay.sim.reset();
    const phoneClient = await openClient(`ws://127.0.0.1:${port}/ws?role=phone&seat=A`);
    phone = phoneClient.ws;
    assert.deepEqual(phoneClient.hello, { type: 'hello', player: 'A', role: 'phone' });

    const poseReceived = waitForMessage(laptop, message => message.type === 'pose', 150);
    laptop.send(JSON.stringify({ t: Date.now(), type: 'pose', court_x: 0.5, court_y: 5, torso_deg: 0, wrist_h: 0.95 }));
    await assert.rejects(poseReceived, /timed out/, 'sender pose should not be echoed');

    phone.send(JSON.stringify({ t: Date.now(), type: 'spawn' }));
    await waitForMessage(phone, message => message.type === 'state' && message.phase === 'ready');
    phone.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    const phoneLaunch = await waitForMessage(phone, message => message.type === 'state' && message.phase === 'rally');
    assert.ok(phoneLaunch.ball.vz < 0);
  } finally {
    phone?.close();
    laptop?.close();
    await relay.close();
  }
});

test('two laptop stations get distinct seats and opponent-only poses', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const port = relay.server.address().port;
  let first;
  let second;
  try {
    const firstClient = await openClient(`ws://127.0.0.1:${port}/ws?role=laptop`);
    first = firstClient.ws;
    const secondClient = await openClient(`ws://127.0.0.1:${port}/ws?role=laptop`);
    second = secondClient.ws;
    assert.equal(firstClient.hello.player, 'A');
    assert.equal(secondClient.hello.player, 'B');

    const poseForSecond = waitForMessage(second, message => message.type === 'pose' && message.player === 'A' && message.court_x === 0.25);
    first.send(JSON.stringify({ t: Date.now(), type: 'pose', court_x: 0.25, court_y: 5.2, torso_deg: 10, wrist_h: 0.95 }));
    assert.equal((await poseForSecond).court_y, 5.2);

    const poseForFirst = waitForMessage(first, message => message.type === 'pose' && message.player === 'B' && message.court_x === 0.4);
    second.send(JSON.stringify({ t: Date.now(), type: 'pose', court_x: 0.4, court_y: 5.4, torso_deg: -8, wrist_h: 0.92 }));
    const opponent = await poseForFirst;
    assert.equal(opponent.court_x, 0.4);
    assert.equal(opponent.court_y, -5.4);
    assert.equal(relay.sim.players.B.court_y, -5.4);
  } finally {
    second?.close();
    first?.close();
    await relay.close();
  }
});

test('explicit duplicate seats are rejected before the WebSocket upgrade', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const port = relay.server.address().port;
  let first;
  let second;
  try {
    first = (await openClient(`ws://127.0.0.1:${port}/ws?role=laptop&seat=A`)).ws;
    second = (await openClient(`ws://127.0.0.1:${port}/ws?role=laptop&seat=B`)).ws;

    const third = new WebSocket(`ws://127.0.0.1:${port}/ws?role=laptop&seat=A`);
    const [request, response] = await once(third, 'unexpected-response');
    assert.equal(response.statusCode, 409);
    request.destroy();
  } finally {
    second?.close();
    first?.close();
    await relay.close();
  }
});

test('controller poses are normalized, rate limited, and paired to the matching laptop only', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const port = relay.server.address().port;
  let laptopA, laptopB, phoneA;
  try {
    laptopA = (await openClient(`ws://127.0.0.1:${port}/ws?role=laptop&seat=A`)).ws;
    laptopB = (await openClient(`ws://127.0.0.1:${port}/ws?role=laptop&seat=B`)).ws;
    phoneA = (await openClient(`ws://127.0.0.1:${port}/ws?role=phone&seat=A`)).ws;
    const match = waitForMessage(laptopA, message => message.type === 'controller_pose');
    const wrongSeat = waitForMessage(laptopB, message => message.type === 'controller_pose', 150);
    phoneA.send(JSON.stringify({ t: 1, type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 2 }));
    assert.equal((await match).qw, 1);
    await assert.rejects(wrongSeat, /timed out/);

    const received = [];
    laptopA.on('message', payload => { const message = JSON.parse(String(payload)); if (message.type === 'controller_pose') received.push(message); });
    for (let i = 0; i < 20; i++) phoneA.send(JSON.stringify({ t: i + 2, type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 1 }));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok(received.length < 20, 'rapid controller flood is limited');
  } finally {
    phoneA?.close(); laptopB?.close(); laptopA?.close(); await relay.close();
  }
});

test('two live player stations share one rally without the solo bot taking Player B turns', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const port = relay.server.address().port;
  const endpoint = `ws://127.0.0.1:${port}/ws`;
  const clients = [];
  try {
    const aLaptop = await openClient(`${endpoint}?role=laptop&seat=A`); clients.push(aLaptop.ws);
    const bLaptop = await openClient(`${endpoint}?role=laptop&seat=B`); clients.push(bLaptop.ws);
    const aPhone = await openClient(`${endpoint}?role=phone&seat=A`); clients.push(aPhone.ws);
    const bPhone = await openClient(`${endpoint}?role=phone&seat=B`); clients.push(bPhone.ws);
    assert.equal(aLaptop.hello.player, 'A');
    assert.equal(bLaptop.hello.player, 'B');
    assert.equal(aPhone.hello.player, 'A');
    assert.equal(bPhone.hello.player, 'B');
    assert.equal(bPhone.state.multiplayer, true);
    assert.deepEqual(bPhone.state.connections, { A: { laptop: true, phone: true }, B: { laptop: true, phone: true } });

    // A starts the point. The ball is ready for A on every connected view.
    aPhone.ws.send(JSON.stringify({ t: Date.now(), type: 'spawn' }));
    await waitForMessage(aLaptop.ws, message => message.type === 'state' && message.phase === 'ready' && message.ready_for === 'A');
    aPhone.ws.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    await waitForMessage(bLaptop.ws, message => message.type === 'state' && message.phase === 'rally' && message.last_hitter === 'A');

    // Give B a current phone pose, then hit from B. The contact must be B's,
    // proving the live opponent owns the return instead of the training bot.
    // A landed shot would trigger the old bot after 350ms. Humans must retain
    // the turn even after that delay and if B briefly loses both connections.
    relay.sim.events.push({ type: 'bounce', time: relay.sim.age, x: 0, z: -3, in_bounds: true });
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(relay.sim.lastHitter, 'A');
    bPhone.ws.send(JSON.stringify({ t: Date.now(), type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 1 }));
    Object.assign(relay.sim.ball, relay.sim.paddle('B'));
    bPhone.ws.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    await waitForMessage(aLaptop.ws, message => message.type === 'state' && message.phase === 'rally' && message.last_hitter === 'B');
    assert.equal(relay.sim.events.filter(event => event.type === 'contact').at(-1).player, 'B');
    assert.equal(relay.sim.events.some(event => event.type === 'contact' && event.player === 'B'), true);
    assert.ok(relay.sim.ball.vz > 0, 'B returns toward A in the shared world');
    Object.assign(relay.sim.ball, relay.sim.paddle('A'));
    aPhone.ws.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    await waitForMessage(bLaptop.ws, message => message.type === 'state' && message.last_hitter === 'A');
    const closedLaptop = once(bLaptop.ws, 'close'), closedPhone = once(bPhone.ws, 'close');
    bLaptop.ws.close(); bPhone.ws.close();
    await Promise.all([closedLaptop, closedPhone]);
    relay.sim.events.push({ type: 'bounce', time: relay.sim.age, x: 0, z: -3, in_bounds: true });
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(relay.sim.lastHitter, 'A', 'disconnect never activates the bot in a human match');
  } finally {
    for (const client of clients) client.close();
    await relay.close();
  }
});

test('latest phone aim steers contact despite visual throttling and does not affect keyboard aim', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const endpoint = `ws://127.0.0.1:${relay.server.address().port}/ws`;
  let phone, laptop;
  try {
    phone = (await openClient(`${endpoint}?role=phone&seat=B`)).ws;
    laptop = (await openClient(`${endpoint}?role=laptop&seat=B`)).ws;
    relay.sim.spawn('B');
    const pose = { t: 1, type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 1 };
    for (let i = 0; i < 8; i++) phone.send(JSON.stringify(pose));
    // Aim received after the visual rate limit must still steer the contact.
    phone.send(JSON.stringify({ ...pose, qy: Math.sin(Math.PI / 8), qw: Math.cos(Math.PI / 8) }));
    const shot = waitForMessage(laptop, m => m.type === 'shot' && m.source === 'phone');
    phone.send(JSON.stringify({ t: 2, type: 'swing', ...CONFIG.swing.synthetic }));
    assert.equal((await shot).accepted, true);
    const contact = relay.sim.events.find(e => e.type === 'contact').ball;
    assert.ok(contact.vz > 0);
    assert.ok(Math.abs(contact.vx / contact.vz + 1) < 1e-10);

    relay.sim.reset(); relay.sim.spawn('B');
    const keyboard = waitForMessage(laptop, m => m.type === 'shot' && m.source === 'laptop');
    laptop.send(JSON.stringify({ t: 3, type: 'swing', ...CONFIG.swing.synthetic }));
    assert.equal((await keyboard).accepted, true);
    const fallback = relay.sim.events.find(e => e.type === 'contact').ball;
    assert.ok(Math.abs(fallback.vx / fallback.vz) < 0.5);
  } finally {
    phone?.close(); laptop?.close(); await relay.close();
  }
});
