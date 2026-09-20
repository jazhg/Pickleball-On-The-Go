import { CONFIG } from './config.js';
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const visible = (landmarks, index, threshold) => Number.isFinite(landmarks?.[index]?.x)
  && Number.isFinite(landmarks[index].y) && (landmarks[index].visibility ?? 0) >= threshold;

// Monocular body tracking. Public pose output deliberately retains the frozen
// wire schema; the shoulder/elbow/wrist chain and jumpHeight are render-only.
export class PositionTracker {
  constructor(config = CONFIG) { this.config = config; this.recenter(); }
  recenter() {
    this.samples = [];
    this.reference = null;
    this.activeWrist = this.config.tracking.paddleWrist;
    this.lastPositionAt = null;
    this.position = { x: this.config.player.x, z: this.config.player.homeDepth };
    this.wristOffset = { ...this.config.tracking.neutralWristOffset };
    this.shoulderOffset = { x: this.config.tracking.shoulderMeters / 2, y: -0.12, z: -0.4 };
    this.elbowOffset = { ...this.config.tracking.neutralElbowOffset };
    this.wristVelocity = { x: 0, y: 0, z: 0 };
    this.wristSamples = [];
    this.filteredWrist = null;
    this.lastRawWrist = null;
    this.lastWristAt = -Infinity;
    this.lastDynamicsAt = null;
    this.trackingPresent = false;
    this.wristConfidence = 0;
    this.jumpHeight = 0;
    this.jumpFrames = 0;
  }
  state() {
    return {
      position: { ...this.position }, wristOffset: { ...this.wristOffset },
      shoulderOffset: { ...this.shoulderOffset }, elbowOffset: { ...this.elbowOffset }, jumpHeight: this.jumpHeight,
      activeWrist: this.activeWrist, trackingPresent: this.trackingPresent,
      wristConfidence: this.wristConfidence,
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
      const normalizedReference = index => {
        const tracked = trackedFor(index === 15 ? 0 : 1);
        const shoulderSign = index === 15 ? -1 : 1;
        return tracked.length ? {
          x: mean(tracked.map(e => (e.wrist.x - (e.sample.shoulderX + shoulderSign * e.sample.shoulderWidth / 2)) / e.sample.shoulderWidth)),
          y: mean(tracked.map(e => (e.sample.shoulderY - e.wrist.y) / e.sample.shoulderWidth)),
        } : null;
      };
      this.reference = {
        shoulderX: mean(this.samples.map(s => s.shoulderX)), shoulderY: mean(this.samples.map(s => s.shoulderY)),
        shoulderWidth: mean(this.samples.map(s => s.shoulderWidth)),
        wrists: { 15: normalizedReference(15), 16: normalizedReference(16) },
      };
      this.reference.wrist = this.reference.wrists[this.activeWrist];
      const trackedShoulder = landmarks[this.activeWrist === 15 ? 11 : 12];
      this.reference.shoulderLift = (shoulderY - trackedShoulder.y) / shoulderWidth;
      // The first-person arm is permanently anchored on the visible right side.
      this.shoulderOffset.x = this.config.tracking.shoulderMeters / 2;
    }

    const rawX = clamp((this.reference.shoulderX - shoulderX) / shoulderWidth * c.shoulderMeters * c.lateralGain, -this.config.court.width / 2 + c.edgeMargin, this.config.court.width / 2 - c.edgeMargin);
    const depthDelta = c.referenceDistance * c.depthGain * (this.reference.shoulderWidth / shoulderWidth - 1);
    const rawZ = clamp(this.config.player.homeDepth + depthDelta, c.minDepth, c.maxDepth);
    const elapsed = this.lastPositionAt === null || t <= this.lastPositionAt ? 1 / this.config.simulation.poseHz : (t - this.lastPositionAt) / 1000;
    const dt = clamp(elapsed, 1 / 120, 0.1);
    this.lastPositionAt = t;
    const errorX = rawX - this.position.x;
    const x = Math.abs(errorX) < c.lateralDeadZone ? this.position.x : rawX;
    const response = Math.abs(errorX) > 0.08 ? c.lateralResponseSeconds : c.lateralRestResponseSeconds;
    const lateralAlpha = 1 - Math.exp(-dt / response);
    const z = Math.abs(rawZ - this.position.z) < c.movementDeadZone ? this.position.z : rawZ;
    this.position.x += lateralAlpha * (x - this.position.x);
    // Keep depth smoothing stable when the camera frame rate changes.
    this.position.z += (1 - Math.pow(1 - c.positionAlpha, dt * 15)) * (z - this.position.z);
    this.#updateWrist(landmarks, shoulderX, shoulderY, shoulderWidth, t);
    this.#updateJump(shoulderY, shoulderWidth);
    return { t, type: 'pose', court_x: this.position.x, court_y: this.position.z, torso_deg: 0, wrist_h: this.config.player.paddleHeight };
  }
  #updateWrist(landmarks, shoulderX, shoulderY, shoulderWidth, t) {
    const c = this.config.tracking;
    if (!this.reference?.wrist || !visible(landmarks, this.activeWrist, c.wristVisibility)) { this.#wristLost(t); return; }
    const wrist = landmarks[this.activeWrist];
    const shoulder = landmarks[this.activeWrist === 15 ? 11 : 12];
    const shoulderLift = (shoulderY - shoulder.y) / shoulderWidth - (this.reference.shoulderLift || 0);
    this.shoulderOffset.y = -0.12 + clamp(shoulderLift * c.shoulderMeters, -0.14, 0.14);
    const elbowIndex = this.activeWrist === 15 ? 13 : 14;
    if (visible(landmarks, elbowIndex, c.wristVisibility)) {
      const elbow = landmarks[elbowIndex];
      const elbowTarget = {
        x: this.shoulderOffset.x - (elbow.x - shoulder.x) / shoulderWidth * c.shoulderMeters,
        y: this.shoulderOffset.y + (shoulder.y - elbow.y) / shoulderWidth * c.shoulderMeters,
        // Monocular depth is unreliable, but the observed x/y defines the bend
        // plane while this conservative depth keeps the elbow anatomically near.
        z: this.shoulderOffset.z - 0.12,
      };
      for (const axis of ['x', 'y', 'z']) this.elbowOffset[axis] += c.elbowFilterAlpha * (elbowTarget[axis] - this.elbowOffset[axis]);
    }
    const raw = { x: (wrist.x - shoulder.x) / shoulderWidth, y: (shoulderY - wrist.y) / shoulderWidth };
    if (this.lastRawWrist && Math.hypot(raw.x - this.lastRawWrist.x, raw.y - this.lastRawWrist.y) > c.wristSampleMaxJump) {
      this.#wristLost(t); return;
    }
    this.lastRawWrist = raw;
    this.trackingPresent = true;
    this.wristConfidence = clamp(wrist.visibility ?? 0, 0, 1);
    this.wristSamples.push(raw);
    if (this.wristSamples.length > c.wristMedianSamples) this.wristSamples.shift();
    const stable = { x: median(this.wristSamples.map(v => v.x)), y: median(this.wristSamples.map(v => v.y)) };
    const previous = this.filteredWrist || stable;
    const dt = clamp((t - (this.lastWristAt > 0 ? this.lastWristAt : t - 67)) / 1000, 1 / 120, 0.15);
    const stableSpeed = Math.hypot(stable.x - previous.x, stable.y - previous.y) / dt;
    const response = clamp(stableSpeed / c.wristResponsiveSpeed, 0, 1);
    const alpha = c.wristFilterAlpha + (c.wristMovingAlpha - c.wristFilterAlpha) * response;
    this.filteredWrist = { x: previous.x + alpha * (stable.x - previous.x), y: previous.y + alpha * (stable.y - previous.y) };
    const neutral = this.config.tracking.neutralWristOffset;
    const target = {
      x: neutral.x - (this.filteredWrist.x - this.reference.wrist.x) * c.shoulderMeters * c.wristLateralGain,
      y: neutral.y + (this.filteredWrist.y - this.reference.wrist.y) * c.shoulderMeters * c.wristVerticalGain,
      // Monocular wrist Z is intentionally ignored. Procedural depth belongs
      // to ArmController, the sole owner of the final handle endpoint.
      z: neutral.z,
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
    const neutral = this.config.tracking.neutralWristOffset, max = this.config.render.maxWristOffset;
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
    // Do not snap to the target when a frame would cross it. The bounded
    // acceleration naturally brakes and settles without a visible velocity
    // discontinuity at the ends of the arc.
    for (const axis of axes) this.wristOffset[axis] += this.wristVelocity[axis] * dt;
    // This stage is a 2D monocular observation. Keeping depth exactly neutral
    // prevents filter coupling from becoming a second procedural trajectory.
    this.wristOffset.z = this.config.tracking.neutralWristOffset.z;
    this.wristVelocity.z = 0;
    this.lastDynamicsAt = t;
  }
  #wristLost(t) {
    this.trackingPresent = false;
    this.wristConfidence = 0;
    if (t - this.lastWristAt <= this.config.tracking.wristLossTimeoutMs) return;
    this.#stepWrist({ ...this.config.tracking.neutralWristOffset }, t);
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
