import test from 'node:test';
import assert from 'node:assert/strict';
import { BallInterpolation } from '../client-laptop/ball-interpolation.js';
const state = (x, phase = 'rally', rally_id = 1) => ({ phase, rally_id, ball: { x, y: 1, z: 2 } });
test('interpolation blends snapshots without extrapolating past collisions or pauses', () => {
  const b = new BallInterpolation(20);b.push(state(0),100);b.push(state(10),120);
  assert.equal(b.sample(130).x,5);assert.equal(b.sample(300).x,10);
  b.push(state(2,'ready',2),400);assert.equal(b.sample(401).x,2);
  b.push(state(3,'rally',2),420);assert.equal(b.sample(421).x,3);
});
