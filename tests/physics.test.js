import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, speedFromPeak } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';
import { validMessage, parseMessage } from '../shared/protocol.js';
const swing = { t: 1234567, type: 'swing', ...CONFIG.swing.synthetic };

test('keyboard swing clears net and first bounces inside far court, then resets', () => {
  const sim = new Simulation();
  assert.equal(sim.swing(swing), true);
  let bounce;
  for (let i = 0; i < 500 && !bounce; i++) { sim.step(); bounce = sim.events.find(e => e.type === 'bounce'); }
  assert.ok(bounce); assert.equal(bounce.in_bounds, true); assert.ok(bounce.z < -CONFIG.court.kitchenDepth);
  assert.equal(sim.events.some(e => e.type === 'net_contact'), false);
  assert.ok(sim.ball.vy > 0, 'ball should rebound upward');
  for (let i = 0; i < 1500 && sim.phase !== 'ready'; i++) sim.step();
  assert.equal(sim.phase, 'ready');
});
test('hit window rejects distant ball; speed bounds and calibrated midpoint hold', () => {
  const sim = new Simulation(); sim.ball.x = 3;
  assert.equal(sim.swing(swing), false);
  assert.equal(speedFromPeak(0), CONFIG.physics.minSpeed);
  assert.equal(speedFromPeak(100), CONFIG.physics.maxSpeed);
  assert.equal(speedFromPeak(CONFIG.calibration.mediumG), CONFIG.calibration.mediumSpeed);
});
test('net catches low flight; floor bounces use restitution', () => {
  const sim = new Simulation(); sim.phase = 'rally';
  Object.assign(sim.ball, { x: 0, y: 0.5, z: 0.01, vx: 0, vy: 0, vz: -10 }); sim.step();
  assert.ok(sim.ball.vz > 0); assert.ok(sim.events.some(e => e.type === 'net_contact'));
  Object.assign(sim.ball, { y: 0.038, vy: -3, vz: 0 }); sim.step();
  assert.equal(sim.ball.y, CONFIG.physics.ballRadius); assert.ok(sim.ball.vy > 2 && sim.ball.vy < 2.4);
});
test('wire contract accepts design messages and rejects mutations/non-finite values', () => {
  assert.ok(validMessage(swing)); assert.ok(validMessage(new Simulation().state()));
  assert.ok(validMessage({ t: 1, type: 'pose', court_x: -1.2, court_y: 2.9, torso_deg: 18, wrist_h: 0.94 }));
  assert.ok(validMessage({ type: 'ruling', fault: true, player: 'A', rule: '9.B', explanation: 'Design schema example only.', score: [6, 5], side_out: true }));
  assert.equal(validMessage({ ...swing, player: 'A' }), false);
  assert.equal(validMessage({ ...swing, peak_g: Infinity }), false);
  assert.equal(validMessage({ ...swing, duration_ms: -1 }), false);
  assert.equal(parseMessage('{bad json'), null);
});
