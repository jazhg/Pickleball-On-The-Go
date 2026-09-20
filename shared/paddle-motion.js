import { CONFIG } from './config.js';
const axes = ['x', 'y', 'z'];
const clamp = (n, limit) => Math.max(-limit, Math.min(limit, n));

export function rotateVector(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx };
}

// Shared court-space paddle center, independent of camera pitch and smoothing.
export function paddleCenter(position, player = 'A', motion = {}, config = CONFIG) {
  const sign = player === 'B' ? -1 : 1;
  const neutral = config.render.neutralPaddleOffset;
  return { x: position.x + sign * neutral.x,
    y: config.render.eyeHeight + neutral.y,
    z: position.z + sign * neutral.z };
}

// Extracts short-lived, camera-local gesture features for contact detection.
// Acceleration is never integrated into or applied to the visible handle position.
export class PaddleMotion {
  constructor(config = CONFIG) { this.config = config; this.reset(); }
  reset() {
    this.filteredAcceleration = { x: 0, y: 0, z: 0 };
    this.magnitude = 0; this.angularSpeed = 0;
    this.lastT = null; this.activeSince = null; this.lastSwing = -Infinity; this.peak = 0;
  }
  update(t, acceleration, q, rotationRate = {}, { serving = false } = {}) {
    if (!Number.isFinite(t) || !q || !axes.every(a => Number.isFinite(acceleration?.[a]))) return null;
    const elapsed = this.lastT === null ? 0 : (t - this.lastT) / 1000;
    if (elapsed < 0) return null;
    if (elapsed > 0.25) this.reset();
    this.lastT = t;
    const phone = rotateVector(acceleration, q);
    // Fixed phone-to-camera basis for the documented grip. This is a frame
    // conversion, not a platform-specific sensor correction.
    const a = { x: -phone.x, y: phone.y, z: -phone.z };
    const c = this.config.controller.motionFeatures;
    const rawMagnitude = Math.hypot(a.x, a.y, a.z);
    const alpha = rawMagnitude >= c.activeAcceleration ? c.accelerationAlpha : c.releaseAlpha;
    for (const axis of axes) {
      const bounded = clamp(a[axis], c.maxAcceleration);
      this.filteredAcceleration[axis] += alpha * (bounded - this.filteredAcceleration[axis]);
      if (Math.abs(this.filteredAcceleration[axis]) < c.deadZone) this.filteredAcceleration[axis] = 0;
    }
    const filtered = this.filteredAcceleration;
    this.magnitude = Math.hypot(filtered.x, filtered.y, filtered.z);
    this.angularSpeed = Math.min(c.maxAngularSpeed, Math.hypot(
      Number(rotationRate.alpha) || 0, Number(rotationRate.beta) || 0, Number(rotationRate.gamma) || 0,
    ));
    const activeAcceleration = serving ? 5 : c.activeAcceleration;
    if (this.magnitude > activeAcceleration) {
      this.activeSince ??= t;
      this.peak = Math.max(this.peak, this.magnitude);
    } else if (this.magnitude < (serving ? activeAcceleration : c.releaseAcceleration)) { this.activeSince = null; this.peak = 0; }
    const striking = filtered.z < -(serving ? 3.5 : this.config.arm.phoneForwardAcceleration)
      || (Math.hypot(filtered.x, filtered.y) > (serving ? 5 : 1.1) && this.angularSpeed > (serving ? 100 : 80));
    if (striking && this.activeSince !== null && t - this.activeSince >= (serving ? 100 : 60) && t - this.lastSwing >= 350) {
      this.lastSwing = t;
      return { t, type: 'swing', peak_g: 2.5 + this.peak / CONFIG.physics.gravity,
        pitch: 0, roll: 0, yaw_rate: 0, duration_ms: Math.max(1, Math.min(1400, t - this.activeSince)) };
    }
    return null;
  }
  pose() {
    return {
      motion_x: this.filteredAcceleration.x, motion_y: this.filteredAcceleration.y,
      motion_z: this.filteredAcceleration.z, motion_magnitude: this.magnitude,
      angular_speed: this.angularSpeed,
    };
  }
}
