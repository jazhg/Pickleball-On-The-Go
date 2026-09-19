import { CONFIG } from './config.js';
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

// Monocular estimate: hip midpoint for lateral movement, shoulder scale for depth.
// Coordinates mirror the preview, so stepping left moves left on the court.
export class PositionTracker {
  constructor(config = CONFIG) { this.config = config; this.recenter(); }
  recenter() {
    this.samples = []; this.reference = null;
    this.position = { x: this.config.player.x, z: this.config.player.homeDepth };
  }
  update(landmarks, t = Date.now()) {
    const c = this.config.tracking;
    if (![11, 12, 23, 24].every(i => Number.isFinite(landmarks?.[i]?.x) && Number.isFinite(landmarks?.[i]?.y) && landmarks[i].visibility >= c.visibility)) {
      if (!this.reference) this.samples = [];
      return null;
    }
    const width = Math.abs(landmarks[11].x - landmarks[12].x);
    if (width < c.minShoulderWidth) { if (!this.reference) this.samples = []; return null; }
    const hip = (landmarks[23].x + landmarks[24].x) / 2;
    if (!this.reference) {
      if (this.samples.length && (Math.abs(hip - this.samples[0].hip) > c.calibrationTolerance || Math.abs(width - this.samples[0].width) > c.calibrationTolerance)) this.samples = [];
      this.samples.push({ hip, width });
      if (this.samples.length < c.calibrationFrames) return null;
      this.reference = {
        hip: this.samples.reduce((s, p) => s + p.hip, 0) / this.samples.length,
        width: this.samples.reduce((s, p) => s + p.width, 0) / this.samples.length,
      };
    }
    const x = clamp((this.reference.hip - hip) / width * c.shoulderMeters, -this.config.court.width / 2 + c.edgeMargin, this.config.court.width / 2 - c.edgeMargin);
    const z = clamp(
      this.config.player.homeDepth + c.referenceDistance * (this.reference.width / width - 1),
      c.minDepth, c.maxDepth,
    );
    this.position.x += c.positionAlpha * (x - this.position.x);
    this.position.z += c.positionAlpha * (z - this.position.z);
    // Keep contact height stable: camera is for body position, phone for swing dynamics.
    return { t, type: 'pose', court_x: this.position.x, court_y: this.position.z, torso_deg: 0, wrist_h: this.config.player.paddleHeight };
  }
}
