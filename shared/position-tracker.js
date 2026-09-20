import { CONFIG } from './config.js';
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const visible = (landmarks, index, threshold) => Number.isFinite(landmarks?.[index]?.x)
  && Number.isFinite(landmarks[index].y) && (landmarks[index].visibility ?? 0) >= threshold;

// Monocular body tracking. Public pose output deliberately retains the frozen
// wire schema; wristOffset, shoulderOffset, and jumpHeight are render-only.
export class PositionTracker {
  constructor(config = CONFIG) { this.config = config; this.recenter(); }
  recenter() {
    this.samples = [];
    this.reference = null;
    this.activeWrist = null;
    this.position = { x: this.config.player.x, z: this.config.player.homeDepth };
    this.wristOffset = { ...this.config.render.neutralPaddleOffset };
    this.shoulderOffset = { x: 0, y: -0.12, z: -0.4 };
    this.wristVelocity = { x: 0, y: 0, z: 0 };
    this.wristSamples = [];
    this.filteredWrist = null;
    this.lastRawWrist = null;
    this.lastWristAt = -Infinity;
    this.lastDynamicsAt = null;
    this.swing = { active: false, startX: 0, direction: 0, progress: 0, lastMovingAt: -Infinity };
    this.jumpHeight = 0;
    this.jumpFrames = 0;
  }
  state() {
    return {
      position: { ...this.position }, wristOffset: { ...this.wristOffset },
      shoulderOffset: { ...this.shoulderOffset }, jumpHeight: this.jumpHeight,
      activeWrist: this.activeWrist, swingProgress: this.swing.progress,
    };
  }
  update(landmarks, t = Date.now()) {
    const c = this.config.tracking;
    const bodyValid = [11, 12].every(i => visible(landmarks, i, c.visibility));
    if (!bodyValid) {
      if (!this.reference) this.samples = [];
      this.#wristLost(t); this.#settleJump();
      return null;
    }
    const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
    const shoulderX = (landmarks[11].x + landmarks[12].x) / 2;
    const shoulderY = (landmarks[11].y + landmarks[12].y) / 2;
    if (shoulderWidth < c.minShoulderWidth) {
      if (!this.reference) this.samples = [];
      this.#wristLost(t); this.#settleJump(); return null;
    }
    const wrists = [15, 16].map(index => visible(landmarks, index, c.wristVisibility)
      ? { index, x: landmarks[index].x, y: landmarks[index].y, visibility: landmarks[index].visibility ?? 0 }
      : null);
    if (!this.reference) {
      const first = this.samples[0];
      if (first && (Math.abs(shoulderX - first.shoulderX) > c.calibrationTolerance || Math.abs(shoulderWidth - first.shoulderWidth) > c.calibrationTolerance || Math.abs(shoulderY - first.shoulderY) > c.calibrationTolerance)) this.samples = [];
      this.samples.push({ shoulderX, shoulderY, shoulderWidth, wrists });
      if (this.samples.length < c.calibrationFrames) return null;
      const trackedFor = arrayIndex => this.samples.map(sample => ({ sample, wrist: sample.wrists[arrayIndex] })).filter(entry => entry.wrist);
      const scoreWrist = arrayIndex => {
        const tracked = trackedFor(arrayIndex);
        if (!tracked.length) return -Infinity;
        const movement = Math.max(...tracked.map(e => e.wrist.x)) - Math.min(...tracked.map(e => e.wrist.x));
        return tracked.length / this.samples.length * 2 + mean(tracked.map(e => e.wrist.visibility)) + movement;
      };
      this.activeWrist = scoreWrist(0) >= scoreWrist(1) ? 15 : 16;
      const tracked = trackedFor(this.activeWrist === 15 ? 0 : 1);
      const shoulderIndex = this.activeWrist === 15 ? 11 : 12;
      this.reference = {
        shoulderX: mean(this.samples.map(s => s.shoulderX)), shoulderY: mean(this.samples.map(s => s.shoulderY)),
        shoulderWidth: mean(this.samples.map(s => s.shoulderWidth)),
        wrist: tracked.length ? {
          x: mean(tracked.map(e => (e.wrist.x - (e.sample.shoulderX + (shoulderIndex === 11 ? -e.sample.shoulderWidth / 2 : e.sample.shoulderWidth / 2))) / e.sample.shoulderWidth)),
          y: mean(tracked.map(e => (e.sample.shoulderY - e.wrist.y) / e.sample.shoulderWidth)),
        } : null,
      };
      // The camera-local active shoulder is mirrored with the selfie image.
      this.shoulderOffset.x = this.activeWrist === 15 ? this.config.tracking.shoulderMeters / 2 : -this.config.tracking.shoulderMeters / 2;
    }

    const rawX = clamp((this.reference.shoulderX - shoulderX) / shoulderWidth * c.shoulderMeters, -this.config.court.width / 2 + c.edgeMargin, this.config.court.width / 2 - c.edgeMargin);
    const rawZ = clamp(this.config.player.homeDepth + c.referenceDistance * (this.reference.shoulderWidth / shoulderWidth - 1), c.minDepth, c.maxDepth);
    const x = Math.abs(rawX - this.position.x) < c.movementDeadZone ? this.position.x : rawX;
    const z = Math.abs(rawZ - this.position.z) < c.movementDeadZone ? this.position.z : rawZ;
    this.position.x += c.positionAlpha * (x - this.position.x);
    this.position.z += c.positionAlpha * (z - this.position.z);
    this.#updateWrist(landmarks, shoulderX, shoulderY, shoulderWidth, t);
    this.#updateJump(shoulderY, shoulderWidth);
    return { t, type: 'pose', court_x: this.position.x, court_y: this.position.z, torso_deg: 0, wrist_h: this.config.player.paddleHeight };
  }
  #updateWrist(landmarks, shoulderX, shoulderY, shoulderWidth, t) {
    const c = this.config.tracking;
    if (!this.reference?.wrist || !visible(landmarks, this.activeWrist, c.wristVisibility)) { this.#wristLost(t); return; }
    const wrist = landmarks[this.activeWrist];
    const shoulder = landmarks[this.activeWrist === 15 ? 11 : 12];
    const raw = { x: (wrist.x - shoulder.x) / shoulderWidth, y: (shoulderY - wrist.y) / shoulderWidth };
    if (this.lastRawWrist && Math.hypot(raw.x - this.lastRawWrist.x, raw.y - this.lastRawWrist.y) > c.wristSampleMaxJump) {
      this.#wristLost(t); return;
    }
    this.lastRawWrist = raw;
    this.wristSamples.push(raw);
    if (this.wristSamples.length > c.wristMedianSamples) this.wristSamples.shift();
    const stable = { x: median(this.wristSamples.map(v => v.x)), y: median(this.wristSamples.map(v => v.y)) };
    const previous = this.filteredWrist || stable;
    const dt = clamp((t - (this.lastWristAt > 0 ? this.lastWristAt : t - 67)) / 1000, 1 / 120, 0.15);
    this.filteredWrist = {
      x: previous.x + c.wristFilterAlpha * (stable.x - previous.x),
      y: previous.y + c.wristFilterAlpha * (stable.y - previous.y),
    };
    const lateralVelocity = (this.filteredWrist.x - previous.x) / dt;
    if (!this.swing.active && Math.abs(lateralVelocity) >= c.swingStartVelocity) {
      this.swing = { active: true, startX: previous.x, direction: Math.sign(lateralVelocity), progress: 0, lastMovingAt: t };
    }
    if (this.swing.active) {
      const travel = (this.filteredWrist.x - this.swing.startX) * this.swing.direction;
      this.swing.progress = Math.max(this.swing.progress, clamp(travel / c.swingTravel, 0, 1));
      if (Math.abs(lateralVelocity) >= c.swingStartVelocity * 0.35) this.swing.lastMovingAt = t;
      if (t - this.swing.lastMovingAt > c.swingIdleMs) this.swing.active = false;
    }
    const neutral = this.config.render.neutralPaddleOffset;
    const target = {
      x: neutral.x - (this.filteredWrist.x - this.reference.wrist.x) * c.shoulderMeters * c.wristLateralGain,
      y: neutral.y + (this.filteredWrist.y - this.reference.wrist.y) * c.shoulderMeters * c.wristVerticalGain,
      // Monocular wrist Z is intentionally ignored. Lateral swing progress
      // generates a close -> far -> close reach curve.
      z: neutral.z + c.swingCloseBias - c.swingArcDepth * Math.sin(Math.PI * this.swing.progress),
    };
    this.#constrainToShoulder(target);
    this.#stepWrist(target, t);
    this.lastWristAt = t;
  }
  #constrainToShoulder(target) {
    const radius = this.config.tracking.armReachRadius;
    const delta = { x: target.x - this.shoulderOffset.x, y: target.y - this.shoulderOffset.y, z: target.z - this.shoulderOffset.z };
    const length = Math.hypot(delta.x, delta.y, delta.z);
    if (length > radius) for (const axis of ['x', 'y', 'z']) target[axis] = this.shoulderOffset[axis] + delta[axis] * radius / length;
    const neutral = this.config.render.neutralPaddleOffset, max = this.config.render.maxWristOffset;
    for (const axis of ['x', 'y', 'z']) target[axis] = clamp(target[axis], neutral[axis] - max[axis], neutral[axis] + max[axis]);
  }
  #stepWrist(target, t) {
    const c = this.config.tracking;
    const dt = clamp((t - (this.lastDynamicsAt ?? t - 67)) / 1000, 1 / 120, 0.067);
    const axes = ['x', 'y', 'z'];
    const delta = Object.fromEntries(axes.map(axis => [axis, target[axis] - this.wristOffset[axis]]));
    const distance = Math.hypot(delta.x, delta.y, delta.z);
    const desiredScale = distance > 0 ? Math.min(c.wristMaxVelocity, distance / dt) / distance : 0;
    const desired = Object.fromEntries(axes.map(axis => [axis, delta[axis] * desiredScale]));
    const velocityDelta = Object.fromEntries(axes.map(axis => [axis, desired[axis] - this.wristVelocity[axis]]));
    const accelerationStep = Math.hypot(velocityDelta.x, velocityDelta.y, velocityDelta.z);
    const accelerationScale = accelerationStep > 0 ? Math.min(1, c.wristMaxAcceleration * dt / accelerationStep) : 0;
    for (const axis of axes) this.wristVelocity[axis] += velocityDelta[axis] * accelerationScale;
    const stepLength = Math.hypot(this.wristVelocity.x, this.wristVelocity.y, this.wristVelocity.z) * dt;
    if (distance > 0 && stepLength >= distance) {
      for (const axis of axes) { this.wristOffset[axis] = target[axis]; this.wristVelocity[axis] = 0; }
    } else {
      for (const axis of axes) this.wristOffset[axis] += this.wristVelocity[axis] * dt;
    }
    this.lastDynamicsAt = t;
  }
  #wristLost(t) {
    if (t - this.lastWristAt <= this.config.tracking.wristLossTimeoutMs) return;
    this.swing.active = false;
    this.swing.progress += this.config.tracking.wristReturnAlpha * (0 - this.swing.progress);
    this.#stepWrist({ ...this.config.render.neutralPaddleOffset }, t);
  }
  #updateJump(shoulderY, shoulderWidth) {
    const c = this.config.tracking;
    const normalized = (this.reference.shoulderY - shoulderY) / Math.max(shoulderWidth, this.reference.shoulderWidth);
    this.jumpFrames = normalized > c.jumpThreshold ? this.jumpFrames + 1 : 0;
    const effective = this.jumpFrames >= c.jumpConfirmationFrames && normalized > c.verticalDeadZone ? normalized - c.verticalDeadZone : 0;
    const target = clamp(effective * c.shoulderMeters * 2.2, 0, c.maxPovRise);
    this.jumpHeight += c.verticalAlpha * (target - this.jumpHeight);
  }
  #settleJump() {
    this.jumpFrames = 0;
    this.jumpHeight += this.config.tracking.verticalAlpha * (0 - this.jumpHeight);
  }
}
