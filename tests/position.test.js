import test from 'node:test';
import assert from 'node:assert/strict';
import { PositionTracker } from '../shared/position-tracker.js';
import { CONFIG } from '../shared/config.js';
function body(hip = 0.5, width = 0.2) {
  const points = Array.from({ length: 33 }, () => ({ x: hip, y: 0.5, visibility: 1 }));
  points[11].x = hip - width / 2; points[12].x = hip + width / 2;
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
test('moving during calibration restarts the stand-still capture', () => {
  const tracker = new PositionTracker(); tracker.update(body()); tracker.update(body(0.7));
  assert.equal(tracker.samples.length, 1);
});
