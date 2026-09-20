import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeControllerPose, parseMessage, validMessage } from '../shared/protocol.js';

const pose = (values = {}) => ({ t: 1, type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 1, ...values });

test('controller poses reject malformed, non-finite, and zero quaternions', () => {
  assert.equal(validMessage(pose()), true);
  assert.equal(validMessage(pose({ qx: NaN })), false);
  assert.equal(validMessage(pose({ qw: Infinity })), false);
  assert.equal(validMessage(pose({ qw: 0 })), false);
  assert.equal(parseMessage(JSON.stringify(pose({ extra: 1 }))), null);
});

test('acceptable controller quaternions are normalized', () => {
  const normalized = normalizeControllerPose(pose({ qx: 1, qy: 2, qz: 3, qw: 4 }));
  assert.ok(normalized);
  assert.ok(Math.abs(Math.hypot(normalized.qx, normalized.qy, normalized.qz, normalized.qw) - 1) < 1e-12);
});
