import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceOrientationQuaternion, framePaddlePosition, paddleAim, parsePaddleSwing, relativeOrientation, rotateVector } from '../shared/paddle.js';
import { Simulation } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';

const SWING = { t: 1, type: 'swing', peak_g: 4, pitch: 0, roll: 0, yaw_rate: 0, duration_ms: 300 };
// Camera-local axes, matching how the laptop parents the paddle to the camera.
const about = (axis, deg) => {
  const half = deg * Math.PI / 360, s = Math.sin(half);
  return { qx: axis === 'x' ? s : 0, qy: axis === 'y' ? s : 0, qz: axis === 'z' ? s : 0, qw: Math.cos(half) };
};
const toWire = (q) => ({ qx: q.x, qy: q.y, qz: q.z, qw: q.w });
const yaw = (deg) => about('y', deg); // turn the face across the court
const tilt = (deg) => about('x', deg); // open the face upward

// Play one full rally from a serve and report where it ended up.
function playShot(peak, aim, player = 'A') {
  const sim = new Simulation();
  sim.spawn(player);
  assert.equal(sim.swing({ ...SWING, peak_g: peak }, player, aim), true);
  let crossed = false;
  for (let i = 0; i < 3000 && sim.phase === 'rally'; i++) {
    sim.step();
    if (sim.ball.z * (player === 'A' ? 1 : -1) < -0.05) crossed = true;
  }
  const bounce = sim.events.find((e) => e.type === 'bounce');
  return { crossed, bounce, netContact: sim.events.some((e) => e.type === 'net_contact') };
}

test('a level face at rest launches straight down the court', () => {
  const aim = paddleAim({ qx: 0, qy: 0, qz: 0, qw: 1 });
  assert.deepEqual(aim, { headingDeg: 0, tiltDeg: 0 });
  assert.deepEqual(rotateVector({ qx: 0, qy: 0, qz: 0, qw: 1 }), { x: 0, y: 0, z: -1 });
});

test('the face angle reads back as the heading and tilt a player would feel', () => {
  // Turning the face left reads as a negative heading and leaves the loft alone.
  assert.ok(Math.abs(paddleAim(yaw(30)).headingDeg + 30) < 1e-6);
  assert.ok(Math.abs(paddleAim(yaw(30)).tiltDeg) < 1e-6);
  assert.ok(Math.abs(paddleAim(yaw(-30)).headingDeg - 30) < 1e-6);
  // Opening the face upward is pure tilt, with no sideways drift.
  assert.ok(Math.abs(paddleAim(tilt(25)).tiltDeg - 25) < 1e-6);
  assert.ok(Math.abs(paddleAim(tilt(25)).headingDeg) < 1e-6);
  assert.equal(paddleAim({ qx: 0, qy: 0, qz: 0, qw: 0 }), null);
  assert.equal(paddleAim(null), null);
});

test('pointing the paddle left sends the ball left, and right sends it right', () => {
  const left = playShot(4, yaw(30));
  const right = playShot(4, yaw(-30));
  const straight = playShot(4, yaw(0));
  assert.ok(left.bounce.x < -0.8, `left aim went to x=${left.bounce.x}`);
  assert.ok(right.bounce.x > 0.8, `right aim went to x=${right.bounce.x}`);
  assert.ok(Math.abs(straight.bounce.x) < 0.2);
  // Mirrored for the far seat: left is still the player's own left.
  assert.ok(playShot(4, yaw(30), 'B').bounce.x > 0.8);
});

test('aiming wider turns the ball further, and never off the side of the court', () => {
  let previous = 0;
  for (const degrees of [10, 20, 30, 45]) {
    const shot = playShot(8, yaw(degrees));
    assert.ok(shot.bounce.x <= previous, `aiming ${degrees}° should not pull back toward the middle`);
    assert.equal(shot.bounce.in_bounds, true, `full power at ${degrees}° landed out at x=${shot.bounce.x}`);
    previous = shot.bounce.x;
  }
});

test('swing speed decides the net: a soft flat swing falls short, a faster one carries', () => {
  const soft = playShot(CONFIG.calibration.softG, tilt(0));
  assert.equal(soft.crossed, false, 'a soft, flat swing must not reach the far side');
  const medium = playShot(CONFIG.calibration.mediumG, tilt(0));
  assert.equal(medium.crossed, true);
  assert.equal(medium.bounce.in_bounds, true);
  const hard = playShot(CONFIG.calibration.hardG, tilt(0));
  assert.equal(hard.crossed, true);
  assert.equal(hard.bounce.in_bounds, true);
  // Harder really does travel deeper into the far court.
  assert.ok(hard.bounce.z < medium.bounce.z, 'a harder swing should land deeper');
});

test('opening the paddle face lifts a soft swing over the net', () => {
  assert.equal(playShot(CONFIG.calibration.softG, tilt(0)).crossed, false);
  const lifted = playShot(CONFIG.calibration.softG, tilt(25));
  assert.equal(lifted.crossed, true, 'an open face should lift the same soft swing over');
  assert.equal(lifted.bounce.in_bounds, true);
});

test('a paddle-aimed swing is never overridden by aim assist', () => {
  // The legacy target sits to one side; an aimed shot must ignore it entirely.
  assert.equal(CONFIG.physics.paddleAimAssist, 0);
  const straight = playShot(4, yaw(0));
  assert.ok(Math.abs(straight.bounce.x) < 0.05, `assist pulled an aimed shot to x=${straight.bounce.x}`);
});

test('the paddle_swing envelope is atomic and normalized, or rejected', () => {
  const ok = parsePaddleSwing(JSON.stringify({ type: 'paddle_swing', swing: SWING, aim: { qx: 0, qy: 2, qz: 0, qw: 0 } }));
  assert.ok(ok);
  assert.ok(Math.abs(Math.hypot(ok.aim.qx, ok.aim.qy, ok.aim.qz, ok.aim.qw) - 1) < 1e-9, 'aim is normalized');
  assert.deepEqual(ok.swing, SWING, 'the frozen swing schema travels through unchanged');
  for (const bad of [
    { type: 'paddle_swing', swing: SWING, aim: { qx: 0, qy: 0, qz: 0, qw: 0 } }, // zero quaternion
    { type: 'paddle_swing', swing: SWING, aim: { qx: 0, qy: 0, qz: 0, qw: NaN } },
    { type: 'paddle_swing', swing: { ...SWING, peak_g: 'hard' }, aim: { qx: 0, qy: 0, qz: 0, qw: 1 } },
    { type: 'paddle_swing', swing: SWING, aim: { qx: 0, qy: 0, qz: 0, qw: 1 }, t: 1 },
    { type: 'swing_but_wrong', swing: SWING, aim: { qx: 0, qy: 0, qz: 0, qw: 1 } },
  ]) assert.equal(parsePaddleSwing(JSON.stringify(bad)), null, JSON.stringify(bad));
  assert.equal(parsePaddleSwing('not json'), null);
});

test('a swing without a face angle still plays through the fallback', () => {
  const sim = new Simulation();
  sim.spawn();
  assert.equal(sim.swing(SWING, 'A', null), true);
  assert.ok(Math.hypot(sim.ball.vx, sim.ball.vy, sim.ball.vz) > 0);
});

test('device orientation resolves without touching globals, for every held angle', () => {
  // This maths once threw a ReferenceError on every sensor event, which silently
  // froze the paddle instead of surfacing anywhere a player would notice.
  for (const alpha of [0, 90, 180, 359]) {
    for (const beta of [-90, 0, 45, 90]) {
      for (const gamma of [-90, -45, 0, 90]) {
        const q = deviceOrientationQuaternion({ alpha, beta, gamma });
        assert.ok(q, `no quaternion for ${alpha}/${beta}/${gamma}`);
        assert.ok(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-9, 'must stay a unit quaternion');
      }
    }
  }
  assert.equal(deviceOrientationQuaternion({ alpha: NaN, beta: 0, gamma: 0 }), null);
  assert.equal(deviceOrientationQuaternion(null), null);
});

test('the grip a player recentres on reads as a level face, and turning it aims', () => {
  const held = deviceOrientationQuaternion({ alpha: 12, beta: 62, gamma: -84 }); // phone flat in the hand
  const centred = paddleAim(toWire(relativeOrientation(held, held)));
  assert.ok(Math.abs(centred.headingDeg) < 1e-9 && Math.abs(centred.tiltDeg) < 1e-9, `the recentred grip should be straight ahead, got ${JSON.stringify(centred)}`);
  // Turning the phone the same way twice must not drift or flip.
  const turned = deviceOrientationQuaternion({ alpha: 32, beta: 62, gamma: -84 });
  const first = paddleAim(toWire(relativeOrientation(turned, held)));
  assert.ok(Math.abs(first.headingDeg) > 1, 'turning the phone must move the aim off centre');
  assert.deepEqual(paddleAim(toWire(relativeOrientation(turned, held))), first, 'the same pose must give the same aim');
});

test('the grip roll is a look-only rotation about the launch axis', () => {
  // Rolling the paddle about its own face normal must not steer the ball, or the
  // rendered grip angle would quietly change where shots go.
  const rolled = about('z', CONFIG.render.gripRollDeg);
  const aim = paddleAim(rolled);
  assert.ok(Math.abs(aim.headingDeg) < 1e-6, `grip roll changed the heading to ${aim.headingDeg}`);
  assert.ok(Math.abs(aim.tiltDeg) < 1e-6, `grip roll changed the tilt to ${aim.tiltDeg}`);
});

test('the paddle stays on screen at every window shape and hand position', () => {
  // Fixed camera-local metres only framed correctly for one window shape: on a
  // tall viewport, or once the tracked hand moved outward, the paddle slid off
  // the edge and the player was holding something invisible.
  const frame = CONFIG.render.paddleFrame;
  const depth = CONFIG.render.neutralPaddleOffset.z;
  const reach = CONFIG.render.maxWristOffset;
  for (const [width, height] of [[1345, 1030], [1345, 1400], [1345, 760], [900, 1200], [2400, 700], [600, 900]]) {
    const aspect = width / height;
    const halfHeight = Math.tan(90 * Math.PI / 360) * Math.abs(depth);
    const halfWidth = halfHeight * aspect;
    for (const dx of [-reach.x, 0, reach.x]) {
      for (const dy of [-reach.y, 0, reach.y]) {
        const placed = framePaddlePosition({ fovDeg: 90, aspect, depth, dx, dy, rest: frame, limit: frame.limit });
        const ndcX = placed.x / halfWidth, ndcY = placed.y / halfHeight;
        assert.ok(Math.abs(ndcX) < 1 && Math.abs(ndcY) < 1,
          `${width}x${height} with hand offset ${dx},${dy} put the paddle off screen at ${ndcX.toFixed(2)},${ndcY.toFixed(2)}`);
      }
    }
  }
});

test('the paddle rests in the same visible spot whatever the window shape', () => {
  const frame = CONFIG.render.paddleFrame;
  const depth = CONFIG.render.neutralPaddleOffset.z;
  const seen = new Set();
  for (const aspect of [0.75, 1, 1.31, 1.78, 3.4]) {
    const halfHeight = Math.tan(90 * Math.PI / 360) * Math.abs(depth);
    const placed = framePaddlePosition({ fovDeg: 90, aspect, depth, rest: frame, limit: frame.limit });
    seen.add(`${(placed.x / (halfHeight * aspect)).toFixed(3)},${(placed.y / halfHeight).toFixed(3)}`);
  }
  assert.equal(seen.size, 1, `the resting spot drifted with the window shape: ${[...seen].join(' | ')}`);
  // It sits toward the lower right, where a right hand holds the paddle.
  assert.ok(frame.x > 0 && frame.y > 0 && frame.limit < 1);
});

test('a broken depth or aspect still leaves the paddle somewhere visible', () => {
  const frame = CONFIG.render.paddleFrame;
  for (const bad of [{ aspect: 0, depth: -0.62 }, { aspect: NaN, depth: -0.62 }, { aspect: 1.3, depth: -0.62, dx: NaN, dy: NaN }]) {
    const placed = framePaddlePosition({ fovDeg: 90, rest: frame, limit: frame.limit, ...bad });
    assert.ok(Number.isFinite(placed.x) && Number.isFinite(placed.y), `got ${JSON.stringify(placed)}`);
  }
});
