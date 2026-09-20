import { CONFIG } from './config.js';
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const visible = (landmarks, index, threshold) => Number.isFinite(landmarks?.[index]?.x)
  && Number.isFinite(landmarks[index].y) && (landmarks[index].visibility ?? 0) >= threshold;

// Monocular body tracking. Public pose output deliberately retains the frozen wire
// schema; wristOffset and jumpHeight are local rendering state only.
export class PositionTracker {
  constructor(config = CONFIG) { this.config = config; this.recenter(); }
  recenter() {
    this.samples = [];
    this.reference = null;
    this.activeWrist = null;
    this.position = { x: this.config.player.x, z: this.config.player.homeDepth };
    this.wristOffset = { ...this.config.render.neutralPaddleOffset };
    this.jumpHeight = 0;
    this.jumpFrames = 0;
    this.lastWristAt = -Infinity;
  }
  state() {
    return { position: { ...this.position }, wristOffset: { ...this.wristOffset }, jumpHeight: this.jumpHeight, activeWrist: this.activeWrist };
  }
  update(landmarks, t = Date.now()) {
    const c = this.config.tracking;
    const bodyValid = [11, 12, 23, 24].every(i => visible(landmarks, i, c.visibility));
    if (!bodyValid) {
      if (!this.reference) this.samples = [];
      this.#wristLost(t); this.#settleJump();
      return null;
    }
    const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
    const hipX = (landmarks[23].x + landmarks[24].x) / 2;
    const hipY = (landmarks[23].y + landmarks[24].y) / 2;
    const shoulderY = (landmarks[11].y + landmarks[12].y) / 2;
    const bodySize = Math.abs(hipY - shoulderY);
    if (shoulderWidth < c.minShoulderWidth || bodySize < 0.04) {
      if (!this.reference) this.samples = [];
      this.#wristLost(t); this.#settleJump(); return null;
    }
    const wrists = [15, 16].map(index => visible(landmarks, index, c.wristVisibility)
      ? { index, x: landmarks[index].x, y: landmarks[index].y, z: Number.isFinite(landmarks[index].z) ? landmarks[index].z : 0, visibility: landmarks[index].visibility ?? 0 }
      : null);
    if (!this.reference) {
      const first = this.samples[0];
      if (first && (Math.abs(hipX - first.hipX) > c.calibrationTolerance || Math.abs(shoulderWidth - first.shoulderWidth) > c.calibrationTolerance || Math.abs(hipY - first.hipY) > c.calibrationTolerance)) this.samples = [];
      this.samples.push({ hipX, hipY, shoulderWidth, bodySize, wrists });
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
      this.reference = {
        hipX: mean(this.samples.map(s => s.hipX)), hipY: mean(this.samples.map(s => s.hipY)),
        shoulderWidth: mean(this.samples.map(s => s.shoulderWidth)), bodySize: mean(this.samples.map(s => s.bodySize)),
        wrist: tracked.length ? {
          x: mean(tracked.map(e => (e.wrist.x - e.sample.hipX) / e.sample.shoulderWidth)),
          y: mean(tracked.map(e => (e.sample.hipY - e.wrist.y) / e.sample.bodySize)),
          z: mean(tracked.map(e => e.wrist.z / e.sample.shoulderWidth)),
        } : null,
      };
    }

    const rawX = clamp((this.reference.hipX - hipX) / shoulderWidth * c.shoulderMeters, -this.config.court.width / 2 + c.edgeMargin, this.config.court.width / 2 - c.edgeMargin);
    const rawZ = clamp(this.config.player.homeDepth + c.referenceDistance * (this.reference.shoulderWidth / shoulderWidth - 1), c.minDepth, c.maxDepth);
    const x = Math.abs(rawX - this.position.x) < c.movementDeadZone ? this.position.x : rawX;
    const z = Math.abs(rawZ - this.position.z) < c.movementDeadZone ? this.position.z : rawZ;
    this.position.x += c.positionAlpha * (x - this.position.x);
    this.position.z += c.positionAlpha * (z - this.position.z);
    this.#updateWrist(landmarks, hipX, hipY, shoulderWidth, bodySize, t);
    this.#updateJump(hipY, bodySize);
    return { t, type: 'pose', court_x: this.position.x, court_y: this.position.z, torso_deg: 0, wrist_h: this.config.player.paddleHeight };
  }
  #updateWrist(landmarks, hipX, hipY, shoulderWidth, bodySize, t) {
    const c = this.config.tracking;
    if (!this.reference?.wrist || !visible(landmarks, this.activeWrist, c.wristVisibility)) { this.#wristLost(t); return; }
    const wrist = landmarks[this.activeWrist];
    const relative = { x: (wrist.x - hipX) / shoulderWidth, y: (hipY - wrist.y) / bodySize, z: (Number.isFinite(wrist.z) ? wrist.z : 0) / shoulderWidth };
    const neutral = this.config.render.neutralPaddleOffset, max = this.config.render.maxWristOffset;
    const target = {
      x: neutral.x + clamp((relative.x - this.reference.wrist.x) * c.shoulderMeters, -max.x, max.x),
      y: neutral.y + clamp((relative.y - this.reference.wrist.y) * c.shoulderMeters, -max.y, max.y),
      z: neutral.z + clamp(-(relative.z - this.reference.wrist.z) * c.shoulderMeters, -max.z, max.z),
    };
    const alpha = this.config.render.paddlePositionAlpha;
    for (const axis of ['x', 'y', 'z']) this.wristOffset[axis] += alpha * (target[axis] - this.wristOffset[axis]);
    this.lastWristAt = t;
  }
  #wristLost(t) {
    if (t - this.lastWristAt <= this.config.tracking.wristLossTimeoutMs) return;
    const target = this.config.render.neutralPaddleOffset, alpha = this.config.tracking.wristReturnAlpha;
    for (const axis of ['x', 'y', 'z']) this.wristOffset[axis] += alpha * (target[axis] - this.wristOffset[axis]);
  }
  #updateJump(hipY, bodySize) {
    const c = this.config.tracking;
    const normalized = (this.reference.hipY - hipY) / Math.max(bodySize, this.reference.bodySize);
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
