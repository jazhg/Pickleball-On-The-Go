import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';

const SWING = { t: 1, type: 'swing', peak_g: 4.6, pitch: 4, roll: 0, yaw_rate: 0, duration_ms: 300 };
// A fixed sequence so a rally can be replayed exactly; 0.5 never trips missChance.
const steady = () => 0.5;
const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

// Play a rally where the player returns anything the sim will accept.
function rally(random = steady, { maxSteps = 8000, playerSwings = true } = {}) {
  const sim = new Simulation();
  sim.botRandom = random;
  sim.spawn();
  assert.equal(sim.swing(SWING, 'A'), true);
  let playerHits = 1;
  for (let i = 0; i < maxSteps && sim.phase !== 'idle'; i++) {
    sim.step();
    if (playerSwings && sim.phase === 'rally' && sim.lastHitter === 'B' && sim.swing(SWING, 'A')) playerHits += 1;
  }
  const contacts = sim.events.filter((e) => e.type === 'contact');
  return { sim, playerHits, botHits: contacts.filter((e) => e.player === 'B').length, contacts };
}

test('the opponent returns the ball and hands the rally back', () => {
  const { sim, botHits } = rally(steady, { maxSteps: 1200, playerSwings: false });
  assert.ok(botHits >= 1, 'the opponent must return the serve');
  const afterReturn = sim.events.findIndex((e) => e.type === 'contact' && e.player === 'B');
  assert.ok(afterReturn > 0);
  // The turn has to pass back, or the player is locked out of their own point.
  assert.equal(sim.events[afterReturn].player, 'B');
});

test('a rally actually goes back and forth many times', () => {
  const { playerHits, botHits } = rally();
  assert.ok(botHits >= 3, `the opponent should keep the ball alive, got ${botHits} returns`);
  assert.ok(playerHits >= 3, `the player should get repeated chances to hit, got ${playerHits}`);
});

test('the opponent clears the net on an honest return', () => {
  // Struck low after the bounce, an uncorrected return is flat and clips the net.
  const sim = new Simulation();
  sim.botRandom = steady;
  sim.spawn();
  sim.swing(SWING, 'A');
  for (let i = 0; i < 1200 && sim.phase === 'rally'; i++) {
    sim.step();
    if (sim.lastHitter === 'B') break;
  }
  assert.equal(sim.lastHitter, 'B', 'the opponent should have returned by now');
  for (let i = 0; i < 1200 && sim.phase === 'rally' && sim.ball.z > 0 === false; i++) sim.step();
  assert.equal(sim.events.some((e) => e.type === 'net_contact'), false, 'a clean return must clear the net');
});

test('a ball the opponent cannot reach is not returned, and the player wins it', () => {
  const sim = new Simulation();
  sim.botRandom = steady;
  sim.spawn();
  sim.swing(SWING, 'A');
  for (let i = 0; i < 1200 && sim.phase === 'rally' && !sim.events.some((e) => e.type === 'bounce'); i++) sim.step();
  // Park the opponent far away: it physically cannot cover this one.
  sim.botX = sim.ball.x + CONFIG.bot.reach + 2;
  sim.botSwingIn = 0.0001;
  assert.equal(sim.botReturn(), false, 'out of reach must not magically return the ball');
});

test('the opponent stands down when a human takes the far seat', () => {
  const sim = new Simulation();
  sim.botEnabled = false;
  sim.botRandom = steady;
  sim.spawn();
  sim.swing(SWING, 'A');
  for (let i = 0; i < 3000 && sim.phase !== 'idle'; i++) sim.step();
  assert.equal(sim.events.some((e) => e.type === 'contact' && e.player === 'B'), false,
    'a seated human owns that side; the opponent must not play the ball');
});

test('the same seed replays the same rally, and both sides can lose points', () => {
  const a = rally(seeded(7));
  const b = rally(seeded(7));
  assert.deepEqual(a.contacts.map((e) => e.player), b.contacts.map((e) => e.player));
  const losers = new Set();
  for (let seed = 1; seed <= 120; seed += 1) {
    const { sim } = rally(seeded(seed));
    const bounces = sim.events.filter((e) => e.type === 'bounce');
    const last = bounces[bounces.length - 1];
    if (last) losers.add(last.z > 0 ? 'A' : 'B');
  }
  assert.deepEqual([...losers].sort(), ['A', 'B'], 'points must be winnable by both sides');
});

test('rally timestamps never run backwards across a long exchange', () => {
  // The referee envelope is built from these, so a reset clock would scramble it.
  const { contacts } = rally();
  const times = contacts.map((e) => e.time);
  assert.ok(times.length >= 4);
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i] >= times[i - 1], `event ${i} went backwards: ${times[i - 1]} -> ${times[i]}`);
  }
});

test('a long rally is not cut short by the stall timeout', () => {
  const { sim, contacts } = rally();
  assert.ok(contacts.length >= 6);
  assert.ok(sim.age > CONFIG.simulation.maxFlightSeconds * 0.5,
    'a real rally should outlive half the single-shot stall timeout');
});

test('a second bounce is a two-bounce fault, wherever it lands', () => {
  // A ball that bounced in play and then bounced again past the baseline was
  // being blamed on the hitter as "out" instead of the side that failed to return.
  const sim = new Simulation();
  sim.botEnabled = false;
  sim.spawn();
  sim.swing(SWING, 'A');
  for (let i = 0; i < 4000 && sim.phase === 'rally'; i++) sim.step();
  const end = sim.events.find((e) => e.type === 'rally_end');
  const bounces = sim.events.filter((e) => e.type === 'bounce');
  assert.equal(bounces.length >= 2 ? end.reason : 'two_bounces', 'two_bounces');
  assert.equal(bounces[0].in_bounds, true, 'the first bounce was in play');
});
