// Coordinate frames used by the controller pipeline (all right handed):
// DeviceOrientation: alpha turns about world +Y, beta about device +X, gamma
// about device +Y after the browser's intrinsic Z-X'-Y'' rotations.
// Phone local: +X right edge, +Y top edge, +Z out through the screen.
// Three camera local: +X right, +Y up, -Z into the court.
// Paddle local: +Y handle-to-face, +Z face normal; origin is the face center.
// Normal grip: portrait/right-side-up, with the screen facing the laptop/court.
export const PHONE_FRAME = Object.freeze({ right: [1, 0, 0], up: [0, 1, 0], screenNormal: [0, 0, 1] });
export const CAMERA_FRAME = Object.freeze({ right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] });
export const PADDLE_FRAME = Object.freeze({ handleToFace: [0, 1, 0], faceNormal: [0, 0, 1] });
// The model already shares the phone's right/up/normal axes.
export const PADDLE_MODEL_ALIGNMENT = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

const multiplyQuaternion = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
function normalizeQuaternion(q) {
  const length = Math.hypot(q?.x, q?.y, q?.z, q?.w);
  if (!Number.isFinite(length) || length < 1e-5) return null;
  const sign = q.w < 0 ? -1 : 1;
  return { x: sign * q.x / length, y: sign * q.y / length, z: sign * q.z / length, w: sign * q.w / length };
}
function axisQuaternion(x, y, z, angle) {
  const half = angle / 2, s = Math.sin(half);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(half) };
}
const rotate = (q, v) => {
  const t = { x: 2 * (q.y * v.z - q.z * v.y), y: 2 * (q.z * v.x - q.x * v.z), z: 2 * (q.x * v.y - q.y * v.x) };
  return { x: v.x + q.w * t.x + q.y * t.z - q.z * t.y, y: v.y + q.w * t.y + q.z * t.x - q.x * t.z, z: v.z + q.w * t.z + q.x * t.y - q.y * t.x };
};
const basisFor = q => ({
  right: rotate(q, { x: 1, y: 0, z: 0 }),
  up: rotate(q, { x: 0, y: 1, z: 0 }),
  normal: rotate(q, { x: 0, y: 0, z: 1 }),
});

// W3C DeviceOrientation / Three.js DeviceOrientationControls conversion.
// Device-specific Euler sign multipliers are deliberately absent: changing a
// sign before intrinsic composition changes the frame, not merely its labeling.
export function orientationQuaternion(event) {
  if (![event?.alpha, event?.beta, event?.gamma].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const alpha = event.alpha * rad, beta = event.beta * rad, gamma = event.gamma * rad;
  let q = multiplyQuaternion(axisQuaternion(0, 1, 0, alpha), axisQuaternion(1, 0, 0, beta));
  q = multiplyQuaternion(q, axisQuaternion(0, 0, 1, -gamma));
  q = multiplyQuaternion(q, axisQuaternion(1, 0, 0, -Math.PI / 2));
  return normalizeQuaternion(q);
}

// Calibrate heading only. Keeping gravity vertical is essential for both paddle
// tilt and gravity removal in the phone's 3D motion integrator.
export function forwardReference(q, minUprightDot = 0.15) {
  const quaternion = normalizeQuaternion(q);
  if (!quaternion) return null;
  const basis = basisFor(quaternion);
  if (basis.up.y < minUprightDot || Math.hypot(basis.normal.x, basis.normal.z) < 0.25) return null;
  return axisQuaternion(0, 1, 0, Math.atan2(basis.normal.x, basis.normal.z) - Math.PI);
}

export function relativeOrientation(current, reference) {
  const q = normalizeQuaternion(current), neutral = normalizeQuaternion(reference);
  if (!q || !neutral) return null;
  return normalizeQuaternion(multiplyQuaternion({ x: -neutral.x, y: -neutral.y, z: -neutral.z, w: neutral.w }, q));
}

export function orientationBasis(q) {
  const normalized = normalizeQuaternion(q);
  return normalized ? basisFor(normalized) : null;
}
