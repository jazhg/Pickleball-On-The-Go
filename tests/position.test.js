import test from 'node:test';
import assert from 'node:assert/strict';
import { PositionTracker } from '../shared/position-tracker.js';
import { CONFIG } from '../shared/config.js';

function body(center = 0.5, width = 0.2, bodyY = 0.65, wrist = { x: center - 0.22, y: 0.5, z: 0 }, visibility = 1) {
  const points = Array.from({ length: 33 }, () => ({ x: center, y: bodyY, z: 0, visibility: 1 }));
  points[11] = { x: center - width / 2, y: bodyY - 0.25, z: 0, visibility: 1 };
  points[12] = { x: center + width / 2, y: bodyY - 0.25, z: 0, visibility: 1 };
  points[15] = { ...wrist, visibility };
  points[16] = { x: center + 0.22, y: 0.5, z: 0, visibility: 0.7 };
  return points;
}
function calibrated() {
  const tracker = new PositionTracker();
  let now = 1000;
  for (let i = 0; i < CONFIG.tracking.calibrationFrames; i++) tracker.update(body(), now += 67);
  return { tracker, now };
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('calibrates, maps body motion, and freezes court position on missing landmarks', () => {
  const tracker = new PositionTracker();
  for (let i = 0; i < CONFIG.tracking.calibrationFrames - 1; i++) assert.equal(tracker.update(body()), null);
  assert.equal(tracker.update(body()).court_y, CONFIG.player.homeDepth);
  const moved = tracker.update(body(0.6, 0.25));
  assert.ok(moved.court_x < 0, 'mirrored lateral movement');
  assert.ok(moved.court_y < CONFIG.player.homeDepth, 'larger shoulders mean closer to net');
  const before = { ...tracker.position };
  assert.equal(tracker.update([]), null);
  assert.deepEqual(tracker.position, before);
  for (let i = 0; i < 100; i++) tracker.update(body(0.99, 0.08));
  assert.ok(tracker.position.z <= CONFIG.tracking.maxDepth);
  assert.ok(Math.abs(tracker.position.x) <= CONFIG.court.width / 2 - CONFIG.tracking.edgeMargin);
  tracker.recenter(); assert.equal(tracker.reference, null);
});

test('wrist noise and one extreme wrist-Z sample cannot produce a large jump', () => {
  const { tracker, now } = calibrated();
  const initial = { ...tracker.state().wristOffset };
  let largestStep = 0, previous = initial;
  for (let i = 0; i < 30; i++) {
    const noise = ((i * 17) % 9 - 4) * 0.0015;
    const z = i === 15 ? -100 : i * 0.02;
    tracker.update(body(0.5, 0.2, 0.65, { x: 0.28 + noise, y: 0.5 - noise, z }), now + (i + 1) * 67);
    const current = tracker.state().wristOffset;
    largestStep = Math.max(largestStep, distance(previous, current));
    previous = current;
  }
  assert.ok(largestStep < 0.025, `noise step ${largestStep} is bounded`);
  assert.ok(Math.abs(previous.z - initial.z) < 0.045, 'raw wrist Z is not mapped to paddle depth');
});

test('paddle translation obeys configured velocity and acceleration limits', () => {
  const { tracker, now } = calibrated();
  let previous = { ...tracker.state().wristOffset }, previousVelocity = { x: 0, y: 0, z: 0 };
  const dt = 0.067;
  for (let i = 0; i < 24; i++) {
    tracker.update(body(0.5, 0.2, 0.65, { x: 0.28 + Math.min(i, 12) * 0.012, y: 0.5 - Math.min(i, 8) * 0.008, z: i % 2 ? 9 : -9 }), now + (i + 1) * 67);
    const current = tracker.state().wristOffset;
    const velocity = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, (current[axis] - previous[axis]) / dt]));
    assert.ok(Math.hypot(velocity.x, velocity.y, velocity.z) <= CONFIG.tracking.wristMaxVelocity + 1e-6);
    assert.ok(Math.hypot(velocity.x - previousVelocity.x, velocity.y - previousVelocity.y, velocity.z - previousVelocity.z) / dt <= CONFIG.tracking.wristMaxAcceleration + 1e-6);
    previous = current; previousVelocity = velocity;
  }
});

test('synthetic lateral swing produces close, far, close arc depth', () => {
  const { tracker, now } = calibrated();
  const depths = [];
  // Smooth travel avoids the single-frame landmark rejection and represents a
  // preparation-to-follow-through sweep across the body.
  for (let i = 0; i <= 70; i++) {
    const x = 0.28 + i / 70 * 0.42;
    tracker.update(body(0.5, 0.2, 0.65, { x, y: 0.5, z: i % 3 }), now + (i + 1) * 67);
    depths.push(tracker.state().wristOffset.z);
  }
  const first = Math.min(...depths.slice(0, 10));
  const middle = Math.min(...depths.slice(25, 50));
  const last = Math.min(...depths.slice(-8));
  assert.ok(middle < first - 0.05, `contact ${middle} reaches farther than start ${first}`);
  assert.ok(last > middle + 0.04, `follow-through ${last} returns closer than contact ${middle}`);
});

test('handle stays inside the active-shoulder reach envelope', () => {
  const { tracker, now } = calibrated();
  for (let i = 0; i < 60; i++) {
    tracker.update(body(0.5, 0.2, 0.65, { x: 0.28 + i * 0.012, y: 0.5 - i * 0.009, z: -50 }), now + (i + 1) * 67);
    const state = tracker.state();
    assert.ok(distance(state.wristOffset, state.shoulderOffset) <= CONFIG.tracking.armReachRadius + 0.005);
  }
});

test('lost tracking holds briefly, then eases smoothly to neutral', () => {
  const { tracker, now } = calibrated();
  let t = now;
  for (let i = 0; i < 35; i++) tracker.update(body(0.5, 0.2, 0.65, { x: 0.28 + i * 0.006, y: 0.46, z: 0 }), t += 67);
  const moved = { ...tracker.state().wristOffset };
  tracker.update([], t + CONFIG.tracking.wristLossTimeoutMs - 1);
  assert.deepEqual(tracker.state().wristOffset, moved);
  const beforeDistance = distance(moved, CONFIG.tracking.neutralWristOffset);
  let maximumStep = 0, previous = moved;
  for (let i = 0; i < 80; i++) {
    tracker.update([], t + CONFIG.tracking.wristLossTimeoutMs + (i + 1) * 67);
    const current = tracker.state().wristOffset;
    maximumStep = Math.max(maximumStep, distance(previous, current)); previous = current;
  }
  assert.ok(distance(previous, CONFIG.tracking.neutralWristOffset) < beforeDistance);
  assert.ok(maximumStep <= CONFIG.tracking.wristMaxVelocity * 0.067 * 1.1, 'loss recovery never snaps');
});

test('shoulders alone drive tracking and lateral wrist travel uses first-person axes', () => {
  const tracker = new PositionTracker();
  let now = 1000;
  const shoulderOnly = () => { const points = body(); points[23].visibility = points[24].visibility = 0; return points; };
  for (let i = 0; i < CONFIG.tracking.calibrationFrames; i++) tracker.update(shoulderOnly(), now += 67);
  assert.ok(tracker.reference, 'hips are not required for calibration');
  const neutral = { ...tracker.state().wristOffset };
  for (let i = 0; i < 30; i++) tracker.update(body(0.5, 0.2, 0.65, { x: 0.28 + i * 0.005, y: 0.5, z: 100 }), now += 67);
  assert.ok(tracker.state().wristOffset.x < neutral.x, 'camera-image right maps left in first-person view');
});

test('jump needs consistently raised shoulders and returns smoothly after landing', () => {
  const { tracker } = calibrated();
  for (let i = 0; i < 8; i++) tracker.update(body(0.5, 0.2, 0.648 + (i % 2) * 0.002), 2000 + i * 67);
  assert.equal(tracker.jumpHeight, 0);
  tracker.update(body(0.5, 0.2, 0.58), 3000);
  assert.equal(tracker.jumpHeight, 0);
  for (let i = 0; i < CONFIG.tracking.jumpConfirmationFrames; i++) tracker.update(body(0.5, 0.2, 0.58), 3100 + i * 67);
  assert.ok(tracker.jumpHeight > 0);
  const raised = tracker.jumpHeight;
  tracker.update(body(), 4000);
  assert.ok(tracker.jumpHeight < raised && tracker.jumpHeight > 0);
  for (let i = 0; i < 40; i++) tracker.update(body(), 4100 + i * 67);
  assert.ok(tracker.jumpHeight < 0.001);
});

test('moving during calibration restarts the stand-still capture', () => {
  const tracker = new PositionTracker(); tracker.update(body()); tracker.update(body(0.7));
  assert.equal(tracker.samples.length, 1);
});

test('a sidestep covers useful court distance and reverses within 100ms', () => {
  const { tracker, now } = calibrated();
  const expected = 0.1 / 0.2 * CONFIG.tracking.shoulderMeters * CONFIG.tracking.lateralGain;
  let t = now;
  for (let i = 0; i < 3; i++) tracker.update(body(0.4), t += 1000 / 30);
  assert.ok(tracker.position.x > expected * 0.85, 'at least 85% of the sidestep arrives within 100ms');
  assert.ok(tracker.position.x > 0.4, 'small physical step provides useful lateral court coverage');
  for (let i = 0; i < 3; i++) tracker.update(body(0.6), t += 1000 / 30);
  assert.ok(tracker.position.x < -expected * 0.75, 'opposite movement responds without lingering in the old direction');
});

test('faster lateral tracking holds still against small landmark noise', () => {
  const { tracker, now } = calibrated();
  for (let i = 0; i < 120; i++) {
    tracker.update(body(0.5 + (i % 2 ? 0.001 : -0.001)), now + (i + 1) * 1000 / 30);
    assert.ok(Math.abs(tracker.position.x) < 0.015);
  }
});

test('lateral response is consistent across 15 and 30fps camera feeds', () => {
  const results = [15, 30].map(hz => {
    const { tracker, now } = calibrated();
    for (let i = 1; i <= hz / 5; i++) tracker.update(body(0.4), now + i * 1000 / hz);
    return tracker.position.x;
  });
  assert.ok(Math.abs(results[0] - results[1]) < 0.025);
});
