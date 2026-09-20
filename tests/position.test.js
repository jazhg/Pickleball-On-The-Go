import test from 'node:test';
import assert from 'node:assert/strict';
import { PositionTracker } from '../shared/position-tracker.js';
import { CONFIG } from '../shared/config.js';
function body(hip = 0.5, width = 0.2, hipY = 0.65, wrist = { x: hip - 0.22, y: 0.5, z: 0 }) {
  const points = Array.from({ length: 33 }, () => ({ x: hip, y: hipY, z: 0, visibility: 1 }));
  points[11] = { x: hip - width / 2, y: 0.4, z: 0, visibility: 1 };
  points[12] = { x: hip + width / 2, y: 0.4, z: 0, visibility: 1 };
  points[15] = { ...wrist, visibility: 1 };
  points[16] = { x: hip + 0.22, y: 0.5, z: 0, visibility: 0.7 };
  return points;
}
test('calibrates, maps sideways/depth motion, and freezes on missing landmarks', () => {
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

test('wrist offsets are clamped, held briefly, then return toward neutral', () => {
  const tracker = new PositionTracker();
  let now = 1000;
  for (let i = 0; i < CONFIG.tracking.calibrationFrames; i++) tracker.update(body(), now += 67);
  assert.equal(tracker.activeWrist, 15);
  for (let i = 0; i < 20; i++) tracker.update(body(0.5, 0.2, 0.65, { x: 4, y: -3, z: 5 }), now += 67);
  const moved = tracker.state().wristOffset;
  const neutral = CONFIG.render.neutralPaddleOffset, max = CONFIG.render.maxWristOffset;
  assert.ok(Math.abs(moved.x - neutral.x) <= max.x + 1e-6);
  assert.ok(Math.abs(moved.y - neutral.y) <= max.y + 1e-6);
  const held = { ...moved };
  tracker.update([], now + CONFIG.tracking.wristLossTimeoutMs - 1);
  assert.deepEqual(tracker.state().wristOffset, held);
  tracker.update([], now + CONFIG.tracking.wristLossTimeoutMs + 100);
  assert.ok(Math.abs(tracker.state().wristOffset.x - neutral.x) < Math.abs(held.x - neutral.x));
});

test('jump needs consistent raised hips and returns smoothly after landing', () => {
  const tracker = new PositionTracker();
  for (let i = 0; i < CONFIG.tracking.calibrationFrames; i++) tracker.update(body(), i * 67);
  for (let i = 0; i < 8; i++) tracker.update(body(0.5, 0.2, 0.648 + (i % 2) * 0.002), 2000 + i * 67);
  assert.equal(tracker.jumpHeight, 0, 'stationary noise stays in the vertical dead zone');
  tracker.update(body(0.5, 0.2, 0.58), 3000);
  assert.equal(tracker.jumpHeight, 0, 'a single raised frame is rejected');
  for (let i = 0; i < CONFIG.tracking.jumpConfirmationFrames; i++) tracker.update(body(0.5, 0.2, 0.58), 3100 + i * 67);
  assert.ok(tracker.jumpHeight > 0, 'consistent raised hips produce a jump');
  const raised = tracker.jumpHeight;
  tracker.update(body(), 4000);
  assert.ok(tracker.jumpHeight < raised && tracker.jumpHeight > 0, 'landing eases rather than snapping');
  for (let i = 0; i < 40; i++) tracker.update(body(), 4100 + i * 67);
  assert.ok(tracker.jumpHeight < 0.001);
});
test('moving during calibration restarts the stand-still capture', () => {
  const tracker = new PositionTracker(); tracker.update(body()); tracker.update(body(0.7));
  assert.equal(tracker.samples.length, 1);
});

test('the paddle follows the hand in the player own frame, not the camera image', () => {
  const tracker = new PositionTracker();
  let now = 1000;
  for (let i = 0; i < CONFIG.tracking.calibrationFrames; i++) tracker.update(body(), now += 67);
  assert.equal(tracker.activeWrist, 15);
  const neutral = CONFIG.render.neutralPaddleOffset;
  const settle = (wrist) => {
    const fresh = new PositionTracker();
    let t = 1000;
    for (let i = 0; i < CONFIG.tracking.calibrationFrames; i++) fresh.update(body(), t += 67);
    for (let i = 0; i < 40; i++) fresh.update(body(0.5, 0.2, 0.65, wrist), t += 67);
    return fresh.state().wristOffset;
  };
  // The camera faces the player, so image-left is the player's own right.
  const toMyRight = settle({ x: 0.5 - 0.34, y: 0.5, z: 0 });
  const toMyLeft = settle({ x: 0.5 - 0.10, y: 0.5, z: 0 });
  assert.ok(toMyRight.x > neutral.x, `hand to the right should move the paddle right, got ${toMyRight.x}`);
  assert.ok(toMyLeft.x < neutral.x, `hand to the left should move the paddle left, got ${toMyLeft.x}`);
  // Image y grows downward: a raised hand lifts the paddle.
  assert.ok(settle({ x: 0.5 - 0.22, y: 0.2, z: 0 }).y > neutral.y, 'raising the hand raises the paddle');
  // Landmark depth is negative toward the camera; the view looks down -Z, so
  // reaching out must push the paddle away from the eye.
  assert.ok(settle({ x: 0.5 - 0.22, y: 0.5, z: -0.4 }).z < neutral.z, 'reaching out pushes the paddle forward');
  assert.ok(settle({ x: 0.5 - 0.22, y: 0.5, z: 0.4 }).z > neutral.z, 'pulling back brings the paddle in');
});
