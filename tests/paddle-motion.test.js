import test from 'node:test';
import assert from 'node:assert/strict';
import { PaddleMotion, paddleCenter } from '../shared/paddle-motion.js';
import { Simulation } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';
import { validMessage } from '../shared/protocol.js';
const q = { x: 0, y: 1, z: 0, w: 0 };

test('gentle backswing moves backward, forward stroke moves in depth and triggers contact', () => {
  const motion = new PaddleMotion();
  let t = 0;
  for (let i = 0; i < 8; i++) assert.equal(motion.update(t += 20, { x: 0, y: 0, z: -2 }, q), null);
  const back = motion.pose().pz;
  assert.ok(back > 0.02);
  const swings = [];
  for (let i = 0; i < 14; i++) {
    const swing = motion.update(t += 20, { x: 0, y: 0, z: 4 }, q);
    if (swing) swings.push(swing);
  }
  assert.ok(motion.pose().pz < back);
  assert.equal(swings.length, 1);
  assert.ok(validMessage(swings[0]));
});

test('three-dimensional motion is bounded, rejects noise, and settles without drift', () => {
  const motion = new PaddleMotion(); let t = 0;
  for (let i = 0; i < 50; i++) assert.equal(motion.update(t += 20, { x: 0.05, y: -0.03, z: 0.04 }, q), null);
  assert.deepEqual(motion.pose(), { px: 0, py: 0, pz: 0 });
  for (let i = 0; i < 20; i++) motion.update(t += 20, { x: -4, y: 4, z: 4 }, q);
  assert.ok(motion.pose().px > 0 && motion.pose().py > 0 && motion.pose().pz < 0);
  assert.ok(Object.values(motion.pose()).every(v => Math.abs(v) <= 0.35));
  for (let i = 0; i < 300; i++) motion.update(t += 20, { x: 0, y: 0, z: 0 }, q);
  assert.ok(Object.values(motion.pose()).every(v => Math.abs(v) < 0.001));
});

test('both seats spawn and launch exactly from the rendered moving paddle center', () => {
  for (const player of ['A', 'B']) {
    const sim = new Simulation();
    const pose = { t: 1, type: 'controller_pose', qx: 0, qy: 1, qz: 0, qw: 0, px: 0.1, py: 0.05, pz: 0.2 };
    sim.setController(pose, player); sim.spawn(player);
    const center = paddleCenter({ x: 0, z: (player === 'A' ? 1 : -1) * CONFIG.player.homeDepth }, player, pose);
    for (const axis of ['x', 'y', 'z']) assert.equal(sim.ball[axis], center[axis]);
    assert.equal(sim.swing({ t: 2, type: 'swing', ...CONFIG.swing.synthetic }, player, pose), true);
    for (const axis of ['x', 'y', 'z']) assert.equal(sim.events.at(-1).ball[axis], center[axis]);
  }
});

test('motion payload requires three finite bounded offsets', () => {
  const pose = { t: 1, type: 'controller_pose', qx: 0, qy: 1, qz: 0, qw: 0 };
  assert.equal(validMessage({ ...pose, px: 0.2, py: -0.2, pz: 0.3 }), true);
  for (const bad of [{ px: 0.1 }, { px: 4, py: 0, pz: 0 }, { px: 0, py: NaN, pz: 0 }]) assert.equal(validMessage({ ...pose, ...bad }), false);
});
