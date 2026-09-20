import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/physics.js';
import { singlesResult } from '../shared/singles-rules.js';
import { CONFIG } from '../shared/config.js';
const stroke = { t: 1, type: 'swing', ...CONFIG.swing.synthetic };
function game() { const sim = new Simulation(); sim.startMode('game'); return sim; }
function bounce(sim, x, z) {
  sim.ball = { x, z, y: 0.038, vx: 0, vy: -1, vz: 0 }; sim.step();
}
test('singles side-out scoring and win-by-two continue beyond 11', () => {
  assert.deepEqual(singlesResult([4, 3], 'A', 'A'), { score: [4, 3], server: 'B', sideOut: true, winner: null });
  assert.equal(singlesResult([10, 10], 'A', 'B').winner, null);
  assert.equal(singlesResult([11, 10], 'A', 'B').winner, 'A');
  assert.equal(singlesResult([10, 9], 'A', 'B').winner, 'A');
  assert.equal(singlesResult([15, 15], 'B', 'A').winner, null);
  assert.equal(singlesResult([15, 16], 'B', 'A').winner, 'B');
});
test('only the server can spawn and service positions alternate for either seat', () => {
  for (const seat of ['A', 'B']) for (const points of [0, 1, 2]) {
    const sim = game(); sim.servingTeam = seat; sim.score[seat === 'A' ? 0 : 1] = points;
    assert.equal(sim.spawn(seat === 'A' ? 'B' : 'A'), false);
    assert.equal(sim.spawn(seat), true);
    const sign = seat === 'A' ? 1 : -1;
    assert.equal(Math.sign(sim.players[seat].court_x) * sign, points % 2 === 0 ? 1 : -1);
    assert.ok(Math.abs(sim.players[seat].court_y) > CONFIG.court.length / 2);
  }
});
test('serve must land diagonally beyond kitchen; net touch alone is not a fault', () => {
  for (const [x, z, reason] of [[1, -4, 'serve_target'], [-1, -2, 'serve_target'], [-4, -4, 'out'], [1, 4, 'net'], [-1, -4, null]]) {
    const sim = game(); sim.spawn(); sim.swing(stroke);
    bounce(sim, x, z);
    assert.equal(sim.gameFault?.reason ?? null, reason);
  }
});
test('two-bounce rule, kitchen volleys and double bounces end a game rally', () => {
  const early = game(); early.spawn(); early.swing(stroke);
  Object.assign(early.ball, early.paddle('B'));
  assert.equal(early.swing(stroke, 'B'), false);
  assert.equal(early.gameFault.reason, 'two_bounce');
  const sim = game(); sim.spawn(); sim.swing(stroke); bounce(sim, -1, -4);
  Object.assign(sim.ball, sim.paddle('B')); assert.equal(sim.swing(stroke, 'B'), true);
  bounce(sim, 1, 4);
  Object.assign(sim.ball, sim.paddle('A')); assert.equal(sim.swing(stroke, 'A'), true);
  sim.players.B.court_y = -1.5;
  Object.assign(sim.ball, sim.paddle('B')); assert.equal(sim.swing(stroke, 'B'), false);
  assert.equal(sim.gameFault.reason, 'kitchen');
  const two = game(); two.spawn(); two.swing(stroke); bounce(two, -1, -4); bounce(two, -1, -4);
  assert.equal(two.gameFault.reason, 'double_bounce');
  assert.equal(two.gameFault.player, 'B');
  for (let i = 0; i < 500; i++) two.step();
  assert.equal(two.phase, 'reset'); assert.equal(two.spawn(), false);
});
test('completed match blocks balls; new match resets score and practice remains permissive', () => {
  const sim = game(); sim.winner = 'A'; assert.equal(sim.spawn(), false);
  sim.startMode('game'); assert.equal(sim.winner, null); assert.deepEqual(sim.score, [0, 0]);
  sim.startMode('practice'); sim.spawn('B'); assert.equal(sim.swing(stroke, 'B'), true);
  bounce(sim, 1, 4); bounce(sim, 1, 4); assert.equal(sim.gameFault, null);
});
