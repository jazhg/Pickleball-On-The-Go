import test from 'node:test';
import assert from 'node:assert/strict';
import { PaddleMotion, paddleCenter } from '../shared/paddle-motion.js';
import { Simulation } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';
import { validMessage } from '../shared/protocol.js';
const q = { x: 0, y: 0, z: 0, w: 1 };

test('backswing and forward acceleration become features and emit one contact intent', () => {
  const motion = new PaddleMotion();
  let t = 0;
  for (let i = 0; i < 8; i++) assert.equal(motion.update(t += 20, { x: 0, y: 0, z: -2 }, q), null);
  const back = motion.pose().motion_z;
  assert.ok(back > 0.2);
  const swings = [];
  for (let i = 0; i < 14; i++) {
    const swing = motion.update(t += 20, { x: 0, y: 0, z: 4 }, q);
    if (swing) swings.push(swing);
  }
  assert.ok(motion.pose().motion_z < 0);
  assert.equal(swings.length, 1);
  assert.ok(validMessage(swings[0]));
});

test('three-dimensional features are bounded, reject noise, and settle without drift', () => {
  const motion = new PaddleMotion(); let t = 0;
  for (let i = 0; i < 50; i++) assert.equal(motion.update(t += 20, { x: 0.05, y: -0.03, z: 0.04 }, q), null);
  assert.deepEqual(motion.pose(), { motion_x: 0, motion_y: 0, motion_z: 0, motion_magnitude: 0, angular_speed: 0 });
  for (let i = 0; i < 20; i++) motion.update(t += 20, { x: -4, y: 4, z: 4 }, q);
  assert.ok(motion.pose().motion_x > 0 && motion.pose().motion_y > 0 && motion.pose().motion_z < 0);
  assert.ok(motion.pose().motion_magnitude <= CONFIG.controller.motionFeatures.maxAcceleration * Math.sqrt(3));
  for (let i = 0; i < 300; i++) motion.update(t += 20, { x: 0, y: 0, z: 0 }, q);
  assert.ok(Object.values(motion.pose()).every(v => Math.abs(v) < 0.001));
});

test('high-frequency sensor shake and one acceleration spike remain transient features', () => {
  const motion = new PaddleMotion(); let t = 0, maximum = 0;
  for (let i = 0; i < 100; i++) {
    motion.update(t += 20, { x: (i % 2 ? 1 : -1) * 0.8, y: 0, z: 0 }, q);
    maximum = Math.max(maximum, Math.abs(motion.pose().motion_x));
  }
  assert.ok(maximum < 0.3, `alternating sensor shake leaked ${maximum}m/s²`);
  const spike = new PaddleMotion();
  spike.update(20, { x: 0, y: 0, z: 0 }, q);
  spike.update(40, { x: 20, y: 0, z: 0 }, q);
  assert.ok(spike.pose().motion_magnitude < 6, 'single-frame spike is filtered instead of integrated');
});

test('both seats keep authoritative contact seat-symmetric and independent of motion features', () => {
  for (const player of ['A', 'B']) {
    const sim = new Simulation();
    const pose = { t: 1, type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 1,
      motion_x: 4, motion_y: 2, motion_z: -5, motion_magnitude: 6.7, angular_speed: 120 };
    sim.setController(pose, player); sim.spawn(player);
    const center = paddleCenter({ x: 0, z: (player === 'A' ? 1 : -1) * CONFIG.player.homeDepth }, player, pose, CONFIG);
    for (const axis of ['x', 'y', 'z']) assert.equal(sim.ball[axis], center[axis]);
    assert.equal(sim.swing({ t: 2, type: 'swing', ...CONFIG.swing.synthetic }, player, pose), true);
    for (const axis of ['x', 'y', 'z']) assert.equal(sim.events.at(-1).ball[axis], center[axis]);
  }
});

test('motion payload requires a complete finite bounded feature set', () => {
  const pose = { t: 1, type: 'controller_pose', qx: 0, qy: 1, qz: 0, qw: 0 };
  const features = { motion_x: 0.38, motion_y: -0.32, motion_z: -5, motion_magnitude: 5.1, angular_speed: 300 };
  assert.equal(validMessage({ ...pose, ...features }), true);
  for (const bad of [{ motion_x: 0.1 }, { ...features, motion_x: 40 }, { ...features, motion_y: NaN }]) {
    assert.equal(validMessage({ ...pose, ...bad }), false);
  }
});

test('motion features never displace either player or the authoritative paddle center', () => {
  for (const player of ['A', 'B']) {
    const sim = new Simulation();
    sim.setPose({ t: 1, type: 'pose', court_x: 1.2, court_y: 4.5, torso_deg: 15, wrist_h: 1 }, player);
    const before = structuredClone(sim.players);
    sim.setController({ t: 2, type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 1,
      motion_x: 4, motion_y: 2, motion_z: -5, motion_magnitude: 6.7, angular_speed: 120 }, player);
    sim.setController({ t: 3, type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 1,
      motion_x: 0, motion_y: 0, motion_z: 0, motion_magnitude: 0, angular_speed: 0 }, player);
    assert.deepEqual(sim.players, before);
    const sign = player === 'A' ? 1 : -1;
    assert.equal(sim.paddle(player).x, before[player].court_x + sign * CONFIG.render.neutralPaddleOffset.x);
    assert.ok((sim.paddle(player).z - before[player].court_y) * sign < 0);
  }
});
