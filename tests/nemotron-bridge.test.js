import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import {
  adjudicateRally,
  classifySwing,
  validateRulingForApply,
} from '../server/nemotron-bridge.js';
import { buildRallyEnvelope } from '../server/index.js';
import { Simulation } from '../server/physics.js';
import { createRelay } from '../server/index.js';
import { validMessage } from '../shared/protocol.js';
import { CONFIG } from '../shared/config.js';

const SWING = { t: 123, type: 'swing', peak_g: 3.8, pitch: 14.2, roll: -6.1, yaw_rate: 220, duration_ms: 310 };
const HANG = ['python3', '-c', 'import time; time.sleep(30)'];

test('classifier works offline: valid wire shape, heuristic path', async () => {
  const result = await classifySwing(SWING, { wrist_h: 0.95 });
  assert.equal(result.path, 'heuristic');
  assert.ok(validMessage({ t: Date.now(), type: 'classification', ...result.classification, path: result.path }));
});

test('classifier timeout falls back cleanly and never throws', async () => {
  const start = Date.now();
  const result = await classifySwing(SWING, {}, { timeoutMs: 150, command: HANG });
  assert.ok(Date.now() - start < 5000, 'must resolve near the timeout, not hang');
  assert.equal(result.path, 'fallback');
  assert.ok(validMessage({ t: Date.now(), type: 'classification', ...result.classification, path: result.path }));
});

test('malformed bridge output falls back instead of crashing', async () => {
  const result = await classifySwing(SWING, {}, { timeoutMs: 2000, command: ['python3', '-c', 'print("garbage{{{")'] });
  assert.equal(result.path, 'fallback');
});

test('validateRulingForApply accepts good rulings, rejects malformed ones', () => {
  const good = { type: 'ruling', fault: true, player: 'A', rule: 'rally_outcome', explanation: 'x', score: [0, 0], side_out: true };
  assert.deepEqual(validateRulingForApply(good, [0, 0]), good);
  const badScores = [
    { ...good, score: [1] },
    { ...good, score: [-1, 0] },
    { ...good, score: [1.5, 0] },
    { ...good, side_out: 'yes' },
    { ...good, player: null }, // fault needs a player
    { ...good, rule: '' },
    { type: 'ruling', fault: false, player: null, rule: 'none', explanation: 'x', score: [1, 0], side_out: false }, // no-fault must not move score
    { type: 'ruling', fault: false, player: null, rule: 'none', explanation: 'x', score: [0, 0], side_out: true }, // no-fault must not side out
    null, undefined, 'ruling',
  ];
  for (const bad of badScores) assert.equal(validateRulingForApply(bad, [0, 0]), null);
});

test('referee adjudicates a double-bounce rally offline with score safety', async () => {
  const sim = new Simulation();
  sim.events = [
    { type: 'contact', player: 'A', time: 0, ball: {} },
    { type: 'bounce', time: 0.5, x: 1.0, z: -3.8, in_bounds: true },
    { type: 'contact', player: 'B', time: 0.85, ball: {} },
    { type: 'bounce', time: 2.0, x: 0.5, z: 3.0, in_bounds: true },
    { type: 'bounce', time: 2.6, x: 0.4, z: 2.8, in_bounds: true },
    { type: 'rally_end', reason: 'two_bounces', time: 2.6 },
  ];
  const envelope = buildRallyEnvelope(sim);
  assert.deepEqual(envelope.game_state, { score: [0, 0], serving_team: 'A', server_number: 1, scoring_mode: 'singles' });
  const response = await adjudicateRally(envelope.events, envelope.game_state);
  assert.ok(response && response.ruling);
  assert.equal(response.path, 'baseline');
  const ruling = validateRulingForApply(response.ruling, sim.score);
  assert.ok(ruling, 'offline baseline ruling must pass the score guard');
  assert.equal(ruling.fault, true);
  assert.equal(ruling.player, 'A');
  assert.equal(ruling.side_out, true);
  assert.deepEqual(ruling.score, [0, 0]); // side-out: no point awarded
});

test('referee timeout yields no ruling and never corrupts the score', async () => {
  const response = await adjudicateRally([], { score: [2, 1], serving_team: 'A', server_number: 1, scoring_mode: 'singles' }, { timeoutMs: 150, command: HANG });
  assert.equal(response, null);
});

test('wall bot returns the first far-side bounce and schedules one return only', () => {
  const sim = new Simulation();
  sim.spawn();
  sim.phase = 'rally';
  sim.ball = { x: 1, y: 0.2, z: -4, vx: 0, vy: 0, vz: -2 };
  assert.equal(sim.botReturn(), true);
  assert.ok(sim.ball.vz > 0, 'bot sends the ball back toward the player side');
  const contacts = sim.events.filter((e) => e.type === 'contact' && e.player === 'B');
  assert.equal(contacts.length, 1);
  sim.phase = 'reset';
  assert.equal(sim.botReturn(), false, 'no returns once the rally is over');
});

test('full relay loop continues after the near bounce and rules only after an out landing', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const port = relay.server.address().port;
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const laptop = new WebSocket(`ws://127.0.0.1:${port}/ws?role=laptop`);
    await once(laptop, 'open');
    const seen = [];
    laptop.on('message', (data) => { try { seen.push(JSON.parse(String(data))); } catch {} });
    assert.equal((await fetch(`${endpoint}/api/spawn`, { method: 'POST', headers: { Origin: endpoint } })).status, 200);
    laptop.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    const classification = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no classification broadcast')), 5000);
      const check = () => {
        const msg = seen.find((m) => m.type === 'classification');
        if (msg) { clearTimeout(timer); resolve(msg); } else setTimeout(check, 50);
      };
      check();
    });
    assert.ok(validMessage(classification), 'classification must match the wire schema');
    const ruling = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no ruling broadcast')), 20000);
      const check = () => {
        const msg = seen.find((m) => m.type === 'ruling');
        if (msg) { clearTimeout(timer); resolve(msg); } else setTimeout(check, 100);
      };
      check();
    });
    assert.ok(validMessage(ruling), 'ruling must match the frozen wire schema');
    assert.equal(ruling.fault, true);
    assert.equal(relay.sim.events.at(-1).reason, 'out');
    assert.ok(relay.sim.events.some(e => e.type === 'bounce' && e.in_bounds && e.z > 0));
    assert.equal(ruling.player, 'B');
    assert.equal(ruling.side_out, false);
    assert.deepEqual(ruling.score, [1, 0]);
    // B's return eventually goes out; A retains serve.
    const states = seen.filter((m) => m.type === 'state');
    assert.ok(states.every((s) => s.server === 1));
    assert.deepEqual(relay.sim.score, [1, 0]);
    assert.equal(relay.sim.servingTeam, 'A');
    const evidence = seen.find((m) => m.type === 'ruling_evidence');
    assert.ok(evidence && validMessage(evidence), 'evidence panel payload must validate');
    assert.ok(evidence.trigger_events.length >= 3, 'timeline shows the rally sequence');
    laptop.close();
  } finally { await relay.close(); }
});
