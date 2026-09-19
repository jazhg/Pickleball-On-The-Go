import { CONFIG } from '../shared/config.js';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const radians = deg => deg * Math.PI / 180;

export function speedFromPeak(peak, calibration = CONFIG.calibration) {
  const c = calibration;
  if (peak <= 0) return CONFIG.physics.minSpeed;
  const low = peak <= c.mediumG;
  const g0 = low ? c.softG : c.mediumG, g1 = low ? c.mediumG : c.hardG;
  const s0 = low ? c.softSpeed : c.mediumSpeed, s1 = low ? c.mediumSpeed : c.hardSpeed;
  return clamp(s0 + (s1 - s0) * (peak - g0) / (g1 - g0), CONFIG.physics.minSpeed, Math.min(c.powerCap, CONFIG.physics.maxSpeed));
}

export class Simulation {
  constructor(config = CONFIG) { this.config = config; this.pose = null; this.reset(); }
  reset() {
    const p = this.config.player;
    this.ball = { x: p.x, y: p.paddleHeight, z: p.feedZ, vx: 0, vy: 0, vz: 0 };
    this.phase = 'idle'; this.bounces = 0; this.age = 0; this.resetIn = 0;
    this.events = []; this.score = [0, 0]; this.server = 1;
  }
  spawn() {
    if (this.phase !== 'idle') return false;
    const p = this.paddle();
    this.ball = { x: p.x, y: p.y, z: p.z - (this.config.player.z - this.config.player.feedZ), vx: 0, vy: 0, vz: 0 };
    this.events = []; this.bounces = 0; this.age = 0; this.phase = 'ready';
    return true;
  }
  setPose(pose) {
    const c = this.config;
    this.pose = { ...pose,
      court_x: clamp(pose.court_x, -c.court.width / 2 + c.tracking.edgeMargin, c.court.width / 2 - c.tracking.edgeMargin),
      court_y: clamp(pose.court_y, c.tracking.minZ, c.tracking.maxZ),
      wrist_h: c.player.paddleHeight,
    };
    if (this.phase === 'ready') {
      this.ball.x = this.pose.court_x;
      this.ball.z = this.pose.court_y - (c.player.z - c.player.feedZ);
    }
  }
  paddle() {
    const p = this.config.player;
    return this.pose ? { x: this.pose.court_x, y: this.pose.wrist_h, z: this.pose.court_y }
      : { x: p.x, y: p.paddleHeight, z: p.z };
  }
  swing(swing, directionAngle) {
    if (this.phase !== 'ready') return false;
    const ball = this.ball, paddle = this.paddle(), c = this.config.physics;
    if (Math.hypot(ball.x - paddle.x, ball.y - paddle.y, ball.z - paddle.z) > c.hitWindowRadius) return false;
    const speed = speedFromPeak(swing.peak_g, this.config.calibration);
    // Equivalent paddle-face tilts should behave the same after a ±180° wrap.
    const facePitch = Math.asin(Math.sin(radians(swing.pitch))) * 180 / Math.PI;
    const gentlePitch = clamp(facePitch, -c.maxPitchInputDeg, c.maxPitchInputDeg);
    const elevation = radians(clamp(c.elevationBaseDeg + gentlePitch * c.pitchGain, c.minElevationDeg, c.maxElevationDeg));
    const directed = Number.isFinite(directionAngle);
    const azimuth = radians(clamp(directed ? directionAngle : (this.pose?.torso_deg || 0) * c.torsoGain + swing.roll * c.rollGain, -c.maxAzimuthDeg, c.maxAzimuthDeg));
    const horizontal = speed * Math.cos(elevation);
    const raw = { vx: Math.sin(azimuth) * horizontal, vy: Math.sin(elevation) * speed, vz: -Math.cos(azimuth) * horizontal };
    const targetX = Math.sign(swing.roll || 1) * c.targetX;
    const flight = Math.max(c.minimumTargetFlightSeconds, Math.hypot(targetX - ball.x, c.targetZ - ball.z) / horizontal);
    const aimed = { vx: (targetX - ball.x) / flight, vy: (c.ballRadius - ball.y) / flight + c.gravity * flight / 2, vz: (c.targetZ - ball.z) / flight };
    for (const axis of ['vx', 'vy', 'vz']) ball[axis] = raw[axis] * (1 - c.aimAssist) + aimed[axis] * c.aimAssist;
    // Preserve gentle vertical assistance but never let the old fixed side
    // target override calibrated left/center/right, even off court center.
    if (directed) {
      ball.vx = raw.vx;
      ball.vz = raw.vz;
    }
    const magnitude = Math.hypot(ball.vx, ball.vy, ball.vz);
    const adjusted = clamp(magnitude, c.minSpeed, Math.min(this.config.calibration.powerCap, c.maxSpeed));
    for (const axis of ['vx', 'vy', 'vz']) ball[axis] *= adjusted / magnitude;
    ball.vy = Math.min(ball.vy, c.maxUpwardSpeed);
    this.phase = 'rally'; this.bounces = 0; this.age = 0;
    this.events.push({ type: 'contact', player: 'A', time: this.age, ball: { ...ball }, swing: { ...swing } });
    return true;
  }
  finish(reason) {
    this.phase = 'reset'; this.resetIn = this.config.simulation.resetDelaySeconds;
    this.events.push({ type: 'rally_end', reason, time: this.age });
  }
  step(dt = 1 / this.config.simulation.hz) {
    if (this.phase === 'ready' || this.phase === 'idle') return;
    if (this.phase === 'reset') { this.resetIn -= dt; if (this.resetIn <= 0) this.phase = 'idle'; return; }
    const b = this.ball, c = this.config.physics, court = this.config.court;
    const oldZ = b.z, oldY = b.y;
    this.age += dt;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    b.vx -= c.drag * speed * b.vx * dt;
    b.vy -= (c.gravity + c.drag * speed * b.vy) * dt;
    b.vz -= c.drag * speed * b.vz * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (oldZ * b.z <= 0 && oldZ !== b.z && Math.abs(b.x) <= court.width / 2 + c.ballRadius) {
      const crossingY = oldY + (b.y - oldY) * oldZ / (oldZ - b.z);
      const netHeight = court.netHeight + (court.netPostHeight - court.netHeight) * Math.min(1, Math.abs(b.x) / (court.width / 2));
      if (crossingY - c.ballRadius <= netHeight) {
        b.z = Math.sign(oldZ) * c.ballRadius; b.vz *= -c.netRetention; b.vx *= c.netRetention;
        this.events.push({ type: 'net_contact', time: this.age });
      }
    }
    if (b.y <= c.ballRadius && b.vy < 0) {
      b.y = c.ballRadius; b.vy = -b.vy * c.restitution;
      b.vx *= c.surfaceRetention; b.vz *= c.surfaceRetention;
      this.bounces++;
      const inBounds = Math.abs(b.x) <= court.width / 2 + c.ballRadius && Math.abs(b.z) <= court.length / 2 + c.ballRadius;
      this.events.push({ type: 'bounce', time: this.age, x: b.x, z: b.z, in_bounds: inBounds });
      if (!inBounds || this.bounces >= 2) this.finish(inBounds ? 'two_bounces' : 'out');
    }
    if (this.phase === 'rally' && this.age >= this.config.simulation.maxFlightSeconds) this.finish('timeout');
  }
  state(t = Date.now()) { return { t, type: 'state', ball: { ...this.ball }, score: [...this.score], server: this.server, phase: this.phase }; }
}
