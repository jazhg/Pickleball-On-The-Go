import { CONFIG } from './config.js';

const axes = ['x', 'y', 'z'];
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const wrapDegrees = n => ((n + 180) % 360 + 360) % 360 - 180;
const angleFromGravity = gravity => ({
  pitch: Math.atan2(gravity.y, gravity.z) * 180 / Math.PI,
  roll: Math.atan2(-gravity.x, Math.hypot(gravity.y, gravity.z)) * 180 / Math.PI,
});

export function validCalibration(peaks, config = CONFIG) {
  return peaks && ['soft', 'medium', 'hard'].every(key => Number.isFinite(peaks[key])
    && peaks[key] >= config.swing.startG && peaks[key] <= 100)
    && peaks.medium - peaks.soft >= config.calibration.minGapG
    && peaks.hard - peaks.medium >= config.calibration.minGapG;
}

// Keep the section 3 wire schema fixed: personal measured peaks map onto the
// shared canonical g anchors, which the authoritative server maps onto speed.
export function calibratedPeakG(rawG, peaks, config = CONFIG) {
  if (!validCalibration(peaks, config)) return rawG;
  const canonical = config.calibration;
  if (rawG <= peaks.soft) return clamp(rawG / peaks.soft * canonical.softG, 0, 100);
  const from = rawG < peaks.medium ? [peaks.soft, canonical.softG] : [peaks.medium, canonical.mediumG];
  const to = rawG < peaks.medium ? [peaks.medium, canonical.mediumG] : [peaks.hard, canonical.hardG];
  return clamp(from[1] + (rawG - from[0]) / (to[0] - from[0]) * (to[1] - from[1]), 0, 100);
}

export class SwingDetector {
  constructor(config = CONFIG) {
    this.config = config;
    this.gravity = null;
    this.reference = { pitch: config.controller.center.pitch, roll: config.controller.center.roll };
    this.pitch = 0;
    this.roll = 0;
    this.magnitudeG = 0;
    this.isStatic = false;
    this.staticSince = null;
    this.referenceCaptured = true;
    this.reset();
  }

  reset() {
    this.state = 'IDLE';
    this.lastT = null;
    this.startT = null;
    this.followT = null;
    this.peakG = 0;
    this.dominantAxis = null;
    this.peakSign = 0;
    this.yawRate = 0;
  }

  setReference(reference) {
    if (reference && Number.isFinite(reference.pitch) && Number.isFinite(reference.roll)
      && Math.abs(reference.pitch) <= 180 && Math.abs(reference.roll) <= 180) {
      this.reference = { ...reference };
      this.referenceCaptured = true;
      return true;
    }
    return false;
  }

  captureGravityReference() {
    if (!this.gravity || !this.isStatic || this.state !== 'IDLE') return null;
    this.reference = angleFromGravity(this.gravity);
    this.referenceCaptured = true;
    this.pitch = 0;
    this.roll = 0;
    return { ...this.reference };
  }

  get readings() {
    return { state: this.state, magnitudeG: this.magnitudeG, peakG: this.peakG,
      pitch: this.pitch, roll: this.roll, yawRate: this.yawRate,
      isStatic: this.isStatic, gravityKnown: this.gravity !== null };
  }

  update({ t, acceleration, rotationRate }) {
    if (!Number.isFinite(t) || !acceleration || !axes.every(axis => Number.isFinite(acceleration[axis]))) return null;
    if (this.lastT !== null && t <= this.lastT) return null;
    const { swing, physics } = this.config;
    const dt = this.lastT === null ? 0 : clamp((t - this.lastT) / 1000, 0, swing.maxGyroStepSeconds);
    this.lastT = t;
    const gyro = {
      alpha: Number.isFinite(rotationRate?.alpha) ? rotationRate.alpha : 0,
      beta: Number.isFinite(rotationRate?.beta) ? rotationRate.beta : 0,
      gamma: Number.isFinite(rotationRate?.gamma) ? rotationRate.gamma : 0,
    };
    this.magnitudeG = Math.hypot(...axes.map(axis => acceleration[axis])) / physics.gravity;
    this.yawRate = gyro.alpha;
    this.isStatic = Math.abs(this.magnitudeG - 1) <= swing.staticToleranceG
      && Math.hypot(gyro.alpha, gyro.beta, gyro.gamma) <= swing.staticMaxRate;

    if (this.state === 'IDLE' && this.isStatic) {
      if (this.staticSince === null) this.staticSince = t;
      if (!this.gravity) this.gravity = { ...acceleration };
      else for (const axis of axes) this.gravity[axis] += swing.gravityAlpha * (acceleration[axis] - this.gravity[axis]);
      if (!this.referenceCaptured && t - this.staticSince >= swing.gravityCaptureMs) this.captureGravityReference();
      const orientation = angleFromGravity(this.gravity);
      this.pitch = wrapDegrees(this.reference.pitch - orientation.pitch);
      this.roll = wrapDegrees(this.reference.roll - orientation.roll);
    } else if (this.gravity) {
      if (!this.isStatic) this.staticSince = null;
      // DeviceMotion beta/gamma are x/y-axis angular rates, in degrees/second.
      // Gravity stays frozen through a swing so it cannot absorb linear motion.
      this.pitch = wrapDegrees(this.pitch - gyro.beta * dt);
      this.roll = wrapDegrees(this.roll - gyro.gamma * dt);
    }
    if (!this.gravity || !this.referenceCaptured) return null;
    const linear = Object.fromEntries(axes.map(axis => [axis, (acceleration[axis] - this.gravity[axis]) / physics.gravity]));

    if (this.state === 'IDLE') {
      if (this.magnitudeG > swing.startG) {
        this.state = 'BACKSWING';
        this.startT = t;
        this.recordPeak(linear);
      }
      return null;
    }
    if (this.state === 'BACKSWING') {
      if (t - this.startT > swing.maxWindowMs) {
        // An unfinished motion gets the same refractory protection as a swing.
        this.state = 'FOLLOW';
        this.followT = t;
        return null;
      }
      if (this.magnitudeG > this.peakG) this.recordPeak(linear);
      const reversed = linear[this.dominantAxis] * this.peakSign < -swing.reversalG;
      if (t - this.startT >= swing.minWindowMs && this.peakG - this.magnitudeG >= swing.peakDecayG && reversed) {
        this.state = 'CONTACT';
        return { t, type: 'swing', peak_g: this.peakG, pitch: this.pitch, roll: this.roll,
          yaw_rate: this.yawRate, duration_ms: t - this.startT };
      }
      return null;
    }
    if (this.state === 'CONTACT') {
      if (this.magnitudeG < swing.endG || t - this.startT > swing.maxWindowMs) {
        this.state = 'FOLLOW';
        this.followT = t;
      }
      return null;
    }
    if (this.state === 'FOLLOW') {
      if (this.magnitudeG >= swing.endG) this.followT = t;
      else if (t - this.followT >= swing.refractoryMs) this.state = 'IDLE';
    }
    return null;
  }

  recordPeak(linear) {
    this.peakG = this.magnitudeG;
    this.dominantAxis = axes.reduce((best, axis) => Math.abs(linear[axis]) > Math.abs(linear[best]) ? axis : best, 'x');
    this.peakSign = Math.sign(linear[this.dominantAxis]);
  }
}
