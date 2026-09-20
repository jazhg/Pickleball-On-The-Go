import { validMessage } from './protocol.js';

// The phone is held flat, like the paddle face itself. Its recentred quaternion
// is the paddle's rotation in camera-local space — the very rotation the laptop
// renders — so the direction the face points on screen is the direction the ball
// leaves. Point the face left and the ball goes left, with no hidden correction.
//
// Paddle-local -Z is that launch direction: the rendered face is a cylinder
// turned a quarter turn about X, so its normal is +Z (toward the player) and the
// ball departs from the far side.
const LAUNCH = Object.freeze({ x: 0, y: 0, z: -1 });
const degrees = (radians) => radians * 180 / Math.PI;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function normalizeQuaternion(q) {
  if (!q || ![q.qx, q.qy, q.qz, q.qw].every(Number.isFinite)) return null;
  const length = Math.hypot(q.qx, q.qy, q.qz, q.qw);
  if (!Number.isFinite(length) || length < 1e-4) return null;
  return { qx: q.qx / length, qy: q.qy / length, qz: q.qz / length, qw: q.qw / length };
}

// v' = v + 2w(q x v) + 2q x (q x v)
export function rotateVector(q, v = LAUNCH) {
  const tx = 2 * (q.qy * v.z - q.qz * v.y);
  const ty = 2 * (q.qz * v.x - q.qx * v.z);
  const tz = 2 * (q.qx * v.y - q.qy * v.x);
  return {
    x: v.x + q.qw * tx + q.qy * tz - q.qz * ty,
    y: v.y + q.qw * ty + q.qz * tx - q.qx * tz,
    z: v.z + q.qw * tz + q.qx * ty - q.qy * tx,
  };
}

// Where the paddle face is pointing, as two angles a player can feel:
// heading is left (negative) to right (positive) across the court, and tilt is
// how far open the face is — the loft it will put under the ball.
export function paddleAim(pose) {
  const q = normalizeQuaternion(pose);
  if (!q) return null;
  const forward = rotateVector(q);
  if (![forward.x, forward.y, forward.z].every(Number.isFinite)) return null;
  const flat = Math.hypot(forward.x, forward.z);
  // Pointing straight up or down has no heading to read; keep the last-known
  // sideways intent out of it rather than inventing one from sensor noise.
  if (flat < 1e-4) return { headingDeg: 0, tiltDeg: forward.y >= 0 ? 90 : -90 };
  return {
    headingDeg: degrees(Math.atan2(forward.x, -forward.z)),
    tiltDeg: degrees(Math.asin(clamp(forward.y, -1, 1))),
  };
}

// Where the first-person paddle sits in the view. Fixed camera-local metres only
// land on screen for one window shape: on a tall viewport, or as soon as the
// tracked hand moves outward, the paddle silently slides off the edge and the
// player is left holding something they cannot see. Placing it as a fraction of
// the frustum at its own depth keeps it framed on any window, and the limit is a
// hard guarantee it never leaves.
export function framePaddlePosition({ fovDeg, aspect, depth, dx = 0, dy = 0, rest, limit }) {
  const halfHeight = Math.tan(fovDeg * Math.PI / 360) * Math.abs(depth);
  const halfWidth = halfHeight * (aspect > 0 ? aspect : 1);
  const hold = (value, bound) => Math.max(-bound, Math.min(bound, value));
  return {
    x: hold(halfWidth * rest.x + (Number.isFinite(dx) ? dx : 0), halfWidth * limit),
    y: hold(-halfHeight * rest.y + (Number.isFinite(dy) ? dy : 0), halfHeight * limit),
  };
}

// --- Device orientation, in the phone's own {x,y,z,w} form ---
// Kept here rather than in the phone page so the grip maths is reachable by tests:
// a browser-only module cannot be imported, and a fault in here silently freezes
// the paddle instead of raising anything the player would ever see.
export const multiplyQuaternion = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

export function axisQuaternion(x, y, z, angle) {
  const half = angle / 2, s = Math.sin(half);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(half) };
}

export function unitQuaternion(q) {
  if (!q || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) return null;
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  return Number.isFinite(length) && length > 1e-5
    ? { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length }
    : null;
}

// The device's physical orientation, with no screen-angle compensation: that
// correction keeps a camera upright while the device turns, which is the reverse
// of what a hand-held paddle wants. Turning the phone turns the paddle, and the
// player's grip is whatever Recenter captured.
export function deviceOrientationQuaternion(event, platform = { alpha: 1, beta: 1, gamma: 1 }) {
  if (!event || ![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  let q = multiplyQuaternion(
    axisQuaternion(0, 1, 0, event.alpha * platform.alpha * rad),
    axisQuaternion(1, 0, 0, event.beta * platform.beta * rad),
  );
  q = multiplyQuaternion(q, axisQuaternion(0, 0, 1, -event.gamma * platform.gamma * rad));
  return unitQuaternion(multiplyQuaternion(q, axisQuaternion(1, 0, 0, -Math.PI / 2)));
}

// How far the phone has turned away from the grip the player recentred on.
export function relativeOrientation(current, neutral) {
  if (!current || !neutral) return null;
  return unitQuaternion(multiplyQuaternion(
    { x: -neutral.x, y: -neutral.y, z: -neutral.z, w: neutral.w }, current,
  ));
}

// Atomic envelope: the phone captures its own orientation at the instant of
// contact and sends it with that swing, so a late pose sample can never steer a
// different shot. The frozen swing schema travels inside, unchanged.
export function parsePaddleSwing(data) {
  try {
    const msg = JSON.parse(String(data));
    if (!msg || typeof msg !== 'object' || Object.keys(msg).length !== 3) return null;
    if (msg.type !== 'paddle_swing') return null;
    if (!validMessage(msg.swing) || msg.swing.type !== 'swing') return null;
    const aim = normalizeQuaternion(msg.aim);
    return aim ? { type: 'paddle_swing', swing: msg.swing, aim } : null;
  } catch { return null; }
}
