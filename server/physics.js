import { paddleCenter } from '../shared/paddle-motion.js';
import { normalizeControllerPose } from '../shared/protocol.js';
import { CONFIG } from '../shared/config.js';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const radians = deg => deg * Math.PI / 180;
const SEAT = { A: 1, B: -1 };
const seatSign = (player) => SEAT[player] ?? 1;
const opponentOf = (player) => (player === 'A' ? 'B' : 'A');

// Predict using the same drag and integration as the live ball. Only add loft
// for a shot aimed through the net; never rotate the player's horizontal aim.
function assistNetClearance(ball, config) {
  const c = config.physics, court = config.court;
  if (ball.z * ball.vz >= 0) return;
  const crossingX = ball.x - ball.z * ball.vx / ball.vz;
  if (Math.abs(crossingX) > court.width / 2 + c.ballRadius) return;
  const target = court.netHeight + (court.netPostHeight - court.netHeight)
    * Math.min(1, Math.abs(crossingX) / (court.width / 2)) + c.ballRadius + c.netClearance;
  const clears = vy => {
    const b = { ...ball, vy }, dt = 1 / config.simulation.hz;
    for (let i = 0; i < config.simulation.hz * 3; i++) {
      const oldZ = b.z, oldY = b.y, speed = Math.hypot(b.vx, b.vy, b.vz);
      b.vx -= c.drag * speed * b.vx * dt;
      b.vy -= (c.gravity + c.drag * speed * b.vy) * dt;
      b.vz -= c.drag * speed * b.vz * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (oldZ * b.z <= 0) return oldY + (b.y - oldY) * oldZ / (oldZ - b.z) >= target;
      if (b.y <= c.ballRadius) return false;
    }
    return false;
  };
  if (clears(ball.vy)) return;
  let low = ball.vy, high = c.maxAssistedUpwardSpeed;
  if (!clears(high)) { ball.vy = high; return; }
  for (let i = 0; i < 10; i++) {
    const mid = (low + high) / 2;
    if (clears(mid)) high = mid; else low = mid;
  }
  ball.vy = high;
}

export function speedFromPeak(peak, calibration = CONFIG.calibration) {
  const c = calibration;
  if (peak <= 0) return CONFIG.physics.minSpeed;
  const low = peak <= c.mediumG;
  const g0 = low ? c.softG : c.mediumG, g1 = low ? c.mediumG : c.hardG;
  const s0 = low ? c.softSpeed : c.mediumSpeed, s1 = low ? c.mediumSpeed : c.hardSpeed;
  return clamp(s0 + (s1 - s0) * (peak - g0) / (g1 - g0), CONFIG.physics.minSpeed, Math.min(c.powerCap, CONFIG.physics.maxSpeed));
}

export class Simulation {
  constructor(config = CONFIG) {
    this.config = config;
    this.pose = null;
    this.players = { A: null, B: null };
    this.controllers = { A: null, B: null };
    this.score = [0, 0];
    this.servingTeam = 'A';
    this.reset();
  }
  reset() {
    const p = this.config.player;
    this.ball = { x: p.x, y: p.paddleHeight, z: p.feedDepth, vx: 0, vy: 0, vz: 0 };
    this.phase = 'idle';
    this.readyFor = null;
    this.lastHitter = null;
    this.bounces = 0;
    this.age = 0;
    this.resetIn = 0;
    this.stationaryFor = 0;
    this.events = [];
  }
  // Wall bot ("B"): one return of the first in-bounds far-side bounce, ~0.35 s later,
  // so a solo player gets a real rally loop. A demo stand-in, not sensed input.
  botReturn() {
    if (this.phase !== 'rally') return false;
    const flight = 1.2;
    const targetX = (Math.random() * 2 - 1) * 1.2, targetZ = 3.0;
    this.ball.vx = (targetX - this.ball.x) / flight;
    this.ball.vz = (targetZ - this.ball.z) / flight;
    this.ball.vy = (this.config.physics.ballRadius - this.ball.y) / flight + this.config.physics.gravity * flight / 2;
    this.lastHitter = 'B';
    this.readyFor = null;
    this.bounces = 0;
    this.stationaryFor = 0;
    this.events.push({ type: 'contact', player: 'B', time: this.age, ball: { ...this.ball } });
    return true;
  }
  spawn(player = 'A') {
    if (this.phase !== 'idle') return false;
    const paddle = this.paddle(player);
    const x = this.players[player]?.court_x ?? this.config.player.x;
    // A stationary serve target in front of the player, clear of the paddle.
    this.ball = { x, y: paddle.y + 0.18, z: paddle.z - seatSign(player) * 0.35, vx: 0, vy: 0, vz: 0 };
    this.events = [];
    this.bounces = 0;
    this.age = 0;
    this.stationaryFor = 0;
    this.phase = 'ready';
    this.readyFor = player;
    this.lastHitter = null;
    return true;
  }
  setPose(pose, player = 'A') {
    const c = this.config;
    const s = seatSign(player);
    const halfWidth = c.court.width / 2 - c.tracking.edgeMargin;
    const depth = clamp(Math.abs(pose.court_y), c.tracking.minDepth, c.tracking.maxDepth);
    const normalized = {
      ...pose,
      player,
      court_x: clamp(pose.court_x, -halfWidth, halfWidth),
      court_y: s * depth,
      wrist_h: c.player.paddleHeight,
    };
    this.pose = normalized;
    this.players[player] = normalized;
  }
  setController(pose, player = 'A') {
    this.controllers[player] = pose;
  }
  paddle(player = 'A') {
    const pose = this.players[player], p = this.config.player;
    return paddleCenter({ x: pose?.court_x ?? p.x, z: pose?.court_y ?? seatSign(player) * p.homeDepth }, player, this.controllers[player] || {}, this.config);
  }
  swing(msg, player = 'A', controllerPose = null) {
    const canServe = this.phase === 'ready' && this.readyFor === player;
    const canReturn = this.phase === 'rally' && this.lastHitter !== player;
    if (!canServe && !canReturn) return false;

    if (controllerPose) this.setController(controllerPose, player);
    const ball = this.ball, paddle = this.paddle(player), c = this.config.physics;
    if (Math.hypot(ball.x - paddle.x, ball.y - paddle.y, ball.z - paddle.z) > c.hitWindowRadius) return false;

    if (!canServe) Object.assign(ball, paddle);
    const attack = -seatSign(player);
    const right = seatSign(player);
    const pose = this.players[player];

    const speed = speedFromPeak(msg.peak_g, this.config.calibration);
    const controller = normalizeControllerPose(controllerPose);
    // Controller +Z is centered in the player's neutral local frame. Seat
    // mirroring happens only when local right/forward become court X/Z.
    const face = controller && {
      x: 2 * (controller.qx * controller.qz + controller.qw * controller.qy),
      y: 2 * (controller.qy * controller.qz - controller.qw * controller.qx),
      z: 1 - 2 * (controller.qx ** 2 + controller.qy ** 2),
    };
    const facePitch = face ? Math.asin(clamp(face.y, -1, 1)) * 180 / Math.PI
      : Math.asin(Math.sin(radians(msg.pitch))) * 180 / Math.PI;
    const gentlePitch = clamp(facePitch, -c.maxPitchInputDeg, c.maxPitchInputDeg);
    const elevation = radians(clamp(c.elevationBaseDeg + gentlePitch * c.pitchGain, c.minElevationDeg, c.maxElevationDeg));
    const azimuth = face ? Math.atan2(face.x, face.z) : radians(clamp((pose?.torso_deg || 0) * c.torsoGain - msg.roll * c.rollGain, -c.maxAzimuthDeg, c.maxAzimuthDeg));
    const horizontal = speed * Math.cos(elevation);

    const raw = {
      vx: right * Math.sin(azimuth) * horizontal,
      vy: Math.sin(elevation) * speed,
      vz: attack * Math.cos(azimuth) * horizontal,
    };
    const targetX = -right * Math.sign(msg.roll || 1) * c.targetX;
    const targetZ = attack * Math.abs(c.targetZ);
    const flight = Math.max(c.minimumTargetFlightSeconds, Math.hypot(targetX - ball.x, targetZ - ball.z) / horizontal);
    const aimed = {
      vx: (targetX - ball.x) / flight,
      vy: (c.ballRadius - ball.y) / flight + c.gravity * flight / 2,
      vz: (targetZ - ball.z) / flight,
    };
    for (const axis of ['vx', 'vy', 'vz']) {
      // Preserve the paddle's horizontal bearing; assistance supplies loft only.
      const assist = face && axis !== 'vy' ? 0 : c.aimAssist;
      ball[axis] = raw[axis] * (1 - assist) + aimed[axis] * assist;
    }
    const magnitude = Math.hypot(ball.vx, ball.vy, ball.vz);
    const adjusted = clamp(magnitude, c.minSpeed, Math.min(this.config.calibration.powerCap, c.maxSpeed));
    for (const axis of ['vx', 'vy', 'vz']) ball[axis] *= adjusted / magnitude;
    ball.vy = Math.min(ball.vy, c.maxUpwardSpeed);
    assistNetClearance(ball, this.config);

    this.phase = 'rally';
    this.readyFor = null;
    this.lastHitter = player;
    this.bounces = 0;
    this.age = 0;
    this.stationaryFor = 0;
    this.events.push({ type: 'contact', player, time: this.age, ball: { ...ball }, swing: { ...msg } });
    return true;
  }
  finish(reason, resetDelay = this.config.simulation.resetDelaySeconds) {
    this.phase = 'reset';
    this.resetIn = resetDelay;
    this.events.push({ type: 'rally_end', reason, time: this.age });
  }
  step(dt = 1 / this.config.simulation.hz) {
    if (this.phase === 'ready' || this.phase === 'idle') return;
    if (this.phase === 'reset') {
      this.resetIn -= dt;
      if (this.resetIn <= 0) this.phase = 'idle';
      return;
    }
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
      const impactSpeed = -b.vy;
      b.y = c.ballRadius; b.vy = -b.vy * c.restitution;
      b.vx *= c.surfaceRetention; b.vz *= c.surfaceRetention;
      this.bounces++;
      const inBounds = Math.abs(b.x) <= court.width / 2 + c.ballRadius && Math.abs(b.z) <= court.length / 2 + c.ballRadius;
      this.events.push({ type: 'bounce', time: this.age, x: b.x, z: b.z, in_bounds: inBounds, impactSpeed });
      // Keep practice rallies alive through repeated in-bounds bounces.
      if (!inBounds) this.finish('out');
    }
    if (this.phase === 'rally') {
      const grounded = b.y <= c.ballRadius + this.config.simulation.stationaryGroundTolerance;
      const motionless = Math.hypot(b.vx, b.vy, b.vz) <= this.config.simulation.stationarySpeed;
      this.stationaryFor = grounded && motionless ? this.stationaryFor + dt : 0;
      if (this.stationaryFor >= this.config.simulation.stationaryTimeoutSeconds) this.finish('stopped', 0);
    }
  }
  state(player = 'A', t = Date.now()) {
    const server = this.servingTeam === 'A' ? 1 : 2;
    const players = Object.fromEntries(Object.entries(this.players).map(([key, value]) => [key, value ? { ...value } : null]));
    return {
      t,
      type: 'state',
      player,
      players,
      ball: { ...this.ball },
      score: [...this.score],
      server,
      phase: this.phase,
      ready_for: this.readyFor,
      last_hitter: this.lastHitter,
    };
  }
}
export { opponentOf };
