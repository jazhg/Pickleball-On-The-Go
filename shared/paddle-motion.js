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
  return { x: position.x + sign * (neutral.x + (motion.px || 0)),
    y: config.render.eyeHeight + neutral.y + (motion.py || 0),
    z: position.z + sign * (neutral.z + (motion.pz || 0)) };
}

// Short, damped inertial motion, not absolute positional tracking. Gravity-free
// acceleration is rotated into the calibrated court view before integration.
export class PaddleMotion {
  constructor() { this.reset(); }
  reset() {
    this.offset = { x: 0, y: 0, z: 0 }; this.velocity = { x: 0, y: 0, z: 0 };
    this.lastT = null; this.activeSince = null; this.lastSwing = -Infinity; this.peak = 0;
  }
  update(t, acceleration, q) {
    if (!Number.isFinite(t) || !q || !axes.every(a => Number.isFinite(acceleration?.[a]))) return null;
    const elapsed = this.lastT === null ? 0 : (t - this.lastT) / 1000;
    if (elapsed < 0) return null;
    if (elapsed > 0.25) this.reset();
    this.lastT = t;
    const dt = Math.min(elapsed, 0.04);
    const a = rotateVector(acceleration, q);
    const magnitude = Math.hypot(a.x, a.y, a.z);
    if (magnitude > 0.6) {
      this.activeSince ??= t;
      this.peak = Math.max(this.peak, magnitude);
    } else if (magnitude < 0.25) { this.activeSince = null; this.peak = 0; }
    for (const axis of axes) {
      const force = Math.abs(a[axis]) < 0.15 ? 0 : clamp(a[axis], 30);
      this.velocity[axis] += (force * 2.5 - 12 * this.offset[axis]) * dt;
      this.velocity[axis] *= Math.exp(-5 * dt);
      this.offset[axis] = clamp(this.offset[axis] + this.velocity[axis] * dt, axis === 'z' ? 0.35 : 0.3);
    }
    // Backward travel animates the wind-up; forward/lateral travel makes contact.
    const striking = this.velocity.z < -0.16 || Math.hypot(this.velocity.x, this.velocity.y) > 0.24;
    if (striking && this.activeSince !== null && t - this.activeSince >= 60 && t - this.lastSwing >= 350) {
      this.lastSwing = t;
      return { t, type: 'swing', peak_g: 2.5 + this.peak / CONFIG.physics.gravity,
        pitch: 0, roll: 0, yaw_rate: 0, duration_ms: Math.max(1, Math.min(1400, t - this.activeSince)) };
    }
    return null;
  }
  pose() { return { px: this.offset.x, py: this.offset.y, pz: this.offset.z }; }
}
