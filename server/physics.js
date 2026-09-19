import { CONFIG } from '../shared/config.js';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const radians = deg => deg * Math.PI / 180;
const SEAT = { A: 1, B: -1 };
const seatSign = (player) => SEAT[player] ?? 1;
const opponentOf = (player) => (player === 'A' ? 'B' : 'A');

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
    this.events.push({ type: 'contact', player: 'B', time: this.age, ball: { ...this.ball } });
    return true;
  }
  spawn(player = 'A') {
    if (this.phase !== 'idle') return false;
    const p = this.config.player;
    const s = seatSign(player);
    const paddle = this.paddle(player);
    const setback = s * (p.homeDepth - p.feedDepth);
    this.ball = { x: paddle.x, y: paddle.y, z: paddle.z - setback, vx: 0, vy: 0, vz: 0 };
    this.events = [];
    this.bounces = 0;
    this.age = 0;
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
    if (this.phase === 'ready' && this.readyFor === player) {
      const p = c.player;
      this.ball.x = normalized.court_x;
      this.ball.z = normalized.court_y - s * (p.homeDepth - p.feedDepth);
    }
  }
  paddle(player = 'A') {
    const p = this.config.player;
    const pose = this.players[player];
    if (pose) return { x: pose.court_x, y: pose.wrist_h, z: pose.court_y };
    return { x: p.x, y: p.paddleHeight, z: seatSign(player) * p.homeDepth };
  }
  swing(msg, player = 'A') {
    const canServe = this.phase === 'ready' && this.readyFor === player;
    const canReturn = this.phase === 'rally' && this.lastHitter !== player;
    if (!canServe && !canReturn) return false;

    const ball = this.ball, paddle = this.paddle(player), c = this.config.physics;
    if (Math.hypot(ball.x - paddle.x, ball.y - paddle.y, ball.z - paddle.z) > c.hitWindowRadius) return false;

    const attack = -seatSign(player);
    const right = seatSign(player);
    const pose = this.players[player];

    const speed = speedFromPeak(msg.peak_g, this.config.calibration);
    const facePitch = Math.asin(Math.sin(radians(msg.pitch))) * 180 / Math.PI;
    const gentlePitch = clamp(facePitch, -c.maxPitchInputDeg, c.maxPitchInputDeg);
    const elevation = radians(clamp(c.elevationBaseDeg + gentlePitch * c.pitchGain, c.minElevationDeg, c.maxElevationDeg));
    const azimuth = radians(clamp((pose?.torso_deg || 0) * c.torsoGain + msg.roll * c.rollGain, -c.maxAzimuthDeg, c.maxAzimuthDeg));
    const horizontal = speed * Math.cos(elevation);

    const raw = {
      vx: right * Math.sin(azimuth) * horizontal,
      vy: Math.sin(elevation) * speed,
      vz: attack * Math.cos(azimuth) * horizontal,
    };
    const targetX = right * Math.sign(msg.roll || 1) * c.targetX;
    const targetZ = attack * Math.abs(c.targetZ);
    const flight = Math.max(c.minimumTargetFlightSeconds, Math.hypot(targetX - ball.x, targetZ - ball.z) / horizontal);
    const aimed = {
      vx: (targetX - ball.x) / flight,
      vy: (c.ballRadius - ball.y) / flight + c.gravity * flight / 2,
      vz: (targetZ - ball.z) / flight,
    };
    for (const axis of ['vx', 'vy', 'vz']) ball[axis] = raw[axis] * (1 - c.aimAssist) + aimed[axis] * c.aimAssist;
    const magnitude = Math.hypot(ball.vx, ball.vy, ball.vz);
    const adjusted = clamp(magnitude, c.minSpeed, Math.min(this.config.calibration.powerCap, c.maxSpeed));
    for (const axis of ['vx', 'vy', 'vz']) ball[axis] *= adjusted / magnitude;
    ball.vy = Math.min(ball.vy, c.maxUpwardSpeed);

    this.phase = 'rally';
    this.readyFor = null;
    this.lastHitter = player;
    this.bounces = 0;
    this.age = 0;
    this.events.push({ type: 'contact', player, time: this.age, ball: { ...ball }, swing: { ...msg } });
    return true;
  }
  finish(reason) {
    this.phase = 'reset';
    this.resetIn = this.config.simulation.resetDelaySeconds;
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
      b.y = c.ballRadius; b.vy = -b.vy * c.restitution;
      b.vx *= c.surfaceRetention; b.vz *= c.surfaceRetention;
      this.bounces++;
      const inBounds = Math.abs(b.x) <= court.width / 2 + c.ballRadius && Math.abs(b.z) <= court.length / 2 + c.ballRadius;
      this.events.push({ type: 'bounce', time: this.age, x: b.x, z: b.z, in_bounds: inBounds });
      if (!inBounds || this.bounces >= 2) this.finish(inBounds ? 'two_bounces' : 'out');
    }
    if (this.phase === 'rally' && this.age >= this.config.simulation.maxFlightSeconds) this.finish('timeout');
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
