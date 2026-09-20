const multiplyQuaternion = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
function normalizeQuaternion(q) {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  return Number.isFinite(length) && length > 1e-5 ? { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length } : null;
}
function axisQuaternion(x, y, z, angle) {
  const half = angle / 2, s = Math.sin(half);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(half) };
}
export function orientationQuaternion(event, platform = { alpha: 1, beta: 1, gamma: 1 }) {
  if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const alpha = event.alpha * platform.alpha * rad;
  const beta = event.beta * platform.beta * rad;
  const gamma = event.gamma * platform.gamma * rad;
  // Equivalent to the established DeviceOrientationControls Y-X-Z mapping.
  let q = multiplyQuaternion(axisQuaternion(0, 1, 0, alpha), axisQuaternion(1, 0, 0, beta));
  q = multiplyQuaternion(q, axisQuaternion(0, 0, 1, -gamma));
  q = multiplyQuaternion(q, axisQuaternion(1, 0, 0, -Math.PI / 2));
  // Track the physical handset, not the browser UI's portrait/landscape rotation.
  // Local +Z is the screen normal and +Y points toward the top of the phone.
  return normalizeQuaternion(q);
}

// Only calibrate heading: removing a full reference quaternion erases real tilt.
// The screen normal is mapped to camera-local forward (-Z), toward the net.
export function forwardReference(q) {
  const x = 2 * (q.x * q.z + q.w * q.y);
  const z = 1 - 2 * (q.x * q.x + q.y * q.y);
  // A face-up/down phone has no useful screen heading. Wait until raised.
  if (Math.hypot(x, z) < 0.25) return null;
  return axisQuaternion(0, 1, 0, Math.atan2(x, z) - Math.PI);
}

export function relativeOrientation(current, reference) {
  const inverse = { x: -reference.x, y: -reference.y, z: -reference.z, w: reference.w };
  return normalizeQuaternion(multiplyQuaternion(inverse, current));
}
