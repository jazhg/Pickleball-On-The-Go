import { paddleCenter } from '../shared/paddle-motion.js';
import { normalizeControllerPose } from '../shared/protocol.js';
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
    this.rawPlayers = {};
    this.offsets = { A: { x: 0, z: 0 }, B: { x: 0, z: 0 } };
    this.practice = false;
    this.winner = null;
    this.rallyId = 0;
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
    this.shotAge = 0;
    this.resetIn = 0;
    this.stationaryFor = 0;
    this.events = [];
    this.spin = 0;
    this.hits = 0;
    this.lastResult = null;
    this.rallyStart = { score: [...this.score], servingTeam: this.servingTeam };
  }
  newGame() {
    this.score = [0, 0]; this.servingTeam = 'A'; this.winner = null;
    this.practice = false; this.reset();
  }
  serviceX(player = this.servingTeam) {
    return seatSign(player) * (this.score[player === 'A' ? 0 : 1] % 2 === 0 ? 1 : -1) * this.config.court.width / 4;
  }
  positionForServe() {
    const x = this.serviceX();
    for (const player of ['A', 'B']) {
      const raw = this.rawPlayers[player] || { court_x: 0, court_y: this.config.player.homeDepth, torso_deg: 0 };
      const targetX = player === this.servingTeam ? x : -x;
      const depth = player === this.servingTeam ? this.config.court.length / 2 + 0.3 : this.config.player.homeDepth;
      this.offsets[player] = { x: targetX - raw.court_x, z: depth - Math.abs(raw.court_y) };
      this.setPose(raw, player);
    }
  }
  // Solo bot ("B"): returns each in-bounds far-side bounce after 180 ms,
  // so a solo player gets a real rally loop. A demo stand-in, not sensed input.
  botReturn() {
    if (this.phase !== 'rally') return false;
    // Finite bot reach makes a well-placed passing shot winnable.
    const botX = this.players.B?.court_x ?? 0;
    if (Math.abs(this.ball.x - botX) > 2.2 || this.ball.y > 2.0 || this.ball.z >= 0) return false;
    this.players.B = { ...(this.players.B || {}), t: Date.now(), player: 'B',
      court_x: this.ball.x + this.config.render.neutralPaddleOffset.x,
      court_y: this.ball.z + this.config.render.neutralPaddleOffset.z, torso_deg: 0, wrist_h: this.config.player.paddleHeight };
    const flight = 1.2;
    const receivingPaddle = this.paddle('A');
    const targetX = clamp(receivingPaddle.x, -2.4, 2.4), targetZ = Math.max(2.6, receivingPaddle.z - 1.3);
    this.ball.vx = (targetX - this.ball.x) / flight;
    this.ball.vz = (targetZ - this.ball.z) / flight;
    this.ball.vy = (this.config.physics.ballRadius - this.ball.y) / flight + this.config.physics.gravity * flight / 2;
    this.hits++;
    this.spin = 0;
    this.shotAge = 0;
    this.lastHitter = 'B';
    this.readyFor = null;
    this.bounces = 0;
    this.stationaryFor = 0;
    this.events.push({ type: 'contact', player: 'B', time: this.age, ball: { ...this.ball } });
    return true;
  }
  spawn(player = 'A') {
    if (this.phase !== 'idle' || this.winner || player !== this.servingTeam) return false;
    this.practice = false;
    this.positionForServe();
    this.rallyId++;
    this.rallyStart = { score: [...this.score], servingTeam: this.servingTeam };
    this.lastResult = null;
    this.hits = 0; this.spin = 0;
    const paddle = this.paddle(player);
    const x = this.players[player]?.court_x ?? this.config.player.x;
    // A stationary serve target in front of the player, clear of the paddle.
    this.ball = { x, y: Math.min(0.85, paddle.y), z: paddle.z - seatSign(player) * 0.35, vx: 0, vy: 0, vz: 0 };
    this.events = [];
    this.bounces = 0;
    this.age = 0;
    this.shotAge = 0;
    this.stationaryFor = 0;
    this.phase = 'ready';
    this.readyFor = player;
    this.lastHitter = null;
    return true;
  }
  practiceFeed(player = 'A') {
    this.practice = true;
    this.hits = 3; this.spin = 0;
    this.lastResult = null;
    const c = this.config;
    const sign = seatSign(player);
    const receiver = this.players[player];
    const spread = this.practiceFocus === 'move_to_ball' ? 2.2 : c.practice.lateralSpread;
    const startX = (Math.random() * 2 - 1) * spread;
    const startZ = -sign * (c.court.length / 2 - 0.8);
    const targetX = clamp((receiver?.court_x ?? 0) + (Math.random() * 2 - 1) * (this.practiceFocus === 'move_to_ball' ? 1.6 : 0.45),
      -c.court.width / 2 + c.physics.ballRadius, c.court.width / 2 - c.physics.ballRadius);
    const targetZ = receiver?.court_y ?? sign * c.player.homeDepth;
    const flight = this.practiceFocus === 'add_loft' ? 1.05 : this.practiceFocus === 'soften_power' ? 1.7 : c.practice.flightSeconds;
    this.ball = {
      x: startX,
      y: c.practice.launchHeight,
      z: startZ,
      vx: (targetX - startX) / flight,
      vy: (c.physics.ballRadius - c.practice.launchHeight) / flight + c.physics.gravity * flight / 2,
      vz: (targetZ - startZ) / flight,
    };
    this.phase = 'rally';
    this.readyFor = null;
    this.lastHitter = opponentOf(player);
    this.bounces = 0;
    this.age = 0;
    this.shotAge = 0;
    this.resetIn = 0;
    this.stationaryFor = 0;
    this.events = [{ type: 'contact', player: opponentOf(player), time: 0, ball: { ...this.ball } }];
    return true;
  }
  setPose(pose, player = 'A') {
    const c = this.config;
    const s = seatSign(player);
    const halfWidth = c.court.width / 2 - c.tracking.edgeMargin;
    this.rawPlayers[player] = { ...pose };
    const offset = this.offsets[player];
    const depth = clamp(Math.abs(pose.court_y) + offset.z, 0.5, c.court.length / 2 + 1.5);
    const normalized = {
      ...pose,
      player,
      court_x: clamp(pose.court_x + offset.x, -halfWidth, halfWidth),
      court_y: s * depth,
      wrist_h: c.player.paddleHeight,
    };
    this.pose = normalized;
    this.players[player] = normalized;
    const lastContact = this.events?.findLast(e => e.type === 'contact');
    if (!this.practice && this.phase === 'rally' && this.lastHitter === player && lastContact?.volley
      && Math.abs(normalized.court_y) <= c.court.kitchenDepth + c.court.lineWidth / 2) this.finish('kitchen_volley', undefined, player);
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

    const volley = !canServe && this.bounces === 0;
    if (!canServe && seatSign(player) * ball.z <= 0) return false;
    if (canServe && (Math.abs(this.players[player].court_y) <= this.config.court.length / 2 + this.config.court.lineWidth / 2
      || this.players[player].court_x * Math.sign(this.serviceX(player)) <= this.config.court.lineWidth / 2)) {
      this.phase = 'rally'; this.finish('serve_foot_fault', undefined, player); return false;
    }
    if (!this.practice && volley && this.hits < 3) { this.finish('two_bounce_rule', undefined, player); return false; }
    if (!this.practice && volley && Math.abs(this.players[player]?.court_y ?? this.config.player.homeDepth) <= this.config.court.kitchenDepth + this.config.court.lineWidth / 2) {
      this.finish('kitchen_volley', undefined, player); return false;
    }
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
    // A centered face sends a serve diagonally; rallies follow the actual face.
    const faceYaw = face ? Math.atan2(face.x, Math.abs(face.z)) * 180 / Math.PI
      : (pose?.torso_deg || 0) * c.torsoGain - msg.roll * c.rollGain;
    const base = canServe ? Math.atan2(right * (-this.serviceX() - ball.x), 4.6 + Math.abs(ball.z)) : 0;
    const azimuth = base + radians(clamp(faceYaw, -c.maxAzimuthDeg, c.maxAzimuthDeg));
    const horizontal = speed * Math.cos(elevation);
    ball.vx = right * Math.sin(azimuth) * horizontal;
    ball.vz = attack * Math.cos(azimuth) * horizontal;
    // Solve loft with the same drag/integration as the game. Assistance changes
    // height, never horizontal bearing, and gives soft strokes enough net clearance.
    const targetZ = attack * (canServe ? 4.6 : clamp(2.6 + (speed - 7.5) * 0.45, 2.6, 5.2));
    const landingHeight = (vy) => {
      let y = ball.y, z = ball.z, vx = ball.vx, vz = ball.vz;
      const dt = 1 / this.config.simulation.hz;
      for (let i = 0; i < 600; i++) {
        const v = Math.hypot(vx, vy, vz);
        vx -= c.drag * v * vx * dt; vz -= c.drag * v * vz * dt;
        vy -= (c.gravity + c.drag * v * vy) * dt;
        const oldZ = z, oldY = y; z += vz * dt; y += vy * dt;
        if (attack * (z - targetZ) >= 0) return oldY + (y - oldY) * (targetZ - oldZ) / (z - oldZ);
      }
      return -100;
    };
    let lo = 0, hi = 12;
    for (let i = 0; i < 15; i++) {
      const mid = (lo + hi) / 2;
      if (landingHeight(mid) < c.ballRadius) lo = mid; else hi = mid;
    }
    ball.vy = Math.min(c.maxUpwardSpeed, (lo + hi) / 2 + (canServe ? 0 : gentlePitch * 0.018));
    // Only measured brushing motion creates spin; synthetic yaw is not spin.
    this.spin = canServe ? 0 : clamp((controller?.motion_x || 0) * 1.5, -8, 8);
    this.hits++;
    this.phase = 'rally';
    this.readyFor = null;
    this.shotAge = 0;
    this.lastHitter = player;
    this.bounces = 0;
    this.stationaryFor = 0;
    this.events.push({ type: 'contact', player, time: this.age, ball: { ...ball }, volley, swing: { ...msg } });
    return true;
  }
  finish(reason, resetDelay = this.config.simulation.resetDelaySeconds, loser = this.lastHitter) {
    if (this.phase !== 'rally') return;
    this.phase = 'reset';
    this.resetIn = resetDelay;
    if (!this.practice && ['A', 'B'].includes(loser)) {
      const winner = opponentOf(loser), sideOut = loser === this.servingTeam;
      if (sideOut) this.servingTeam = winner;
      else this.score[winner === 'A' ? 0 : 1]++;
      if (Math.max(...this.score) >= 11 && Math.abs(this.score[0] - this.score[1]) >= 2) {
        this.winner = this.score[0] > this.score[1] ? 'A' : 'B';
        this.phase = 'game_over';
      }
      const explanations = {
        serve_foot_fault: 'Serve from behind the baseline on the correct service side.',
        out: 'The ball landed outside the court.', wrong_side: 'The shot did not land on the opponent’s court.',
        serve_short: 'The serve must clear the kitchen, including its line.', serve_diagonal: 'The serve must land in the diagonal service court.',
        two_bounces: 'The ball bounced twice before the receiver returned it.',
        two_bounce_rule: 'The serve and its return must each bounce before volleying.',
        kitchen_volley: 'A volley cannot be played while touching the kitchen or its line.',
        stopped: 'The ball was not returned.', timeout: 'The ball was not returned in time.',
      };
      this.lastResult = { type: 'ruling', fault: true, player: loser, rule: reason,
        explanation: explanations[reason] || reason, score: [...this.score], side_out: sideOut };
    }
    this.events.push({ type: 'rally_end', reason, player: loser, time: this.age });
  }
  step(dt = 1 / this.config.simulation.hz) {
    if (this.phase === 'ready' || this.phase === 'idle' || this.phase === 'game_over') return;
    if (this.phase === 'reset') {
      this.resetIn -= dt;
      if (this.resetIn <= 0) this.phase = 'idle';
      return;
    }
    const b = this.ball, c = this.config.physics, court = this.config.court;
    const oldZ = b.z, oldY = b.y, oldX = b.x;
    this.age += dt;
    this.shotAge += dt;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    b.vx -= c.drag * speed * b.vx * dt;
    b.vy -= (c.gravity + c.drag * speed * b.vy) * dt;
    b.vz -= c.drag * speed * b.vz * dt;
    const curve = (this.spin || 0) * c.spinLift;
    const vx = b.vx;
    b.vx += curve * b.vz * dt; b.vz -= curve * vx * dt;
    this.spin *= Math.exp(-c.spinDecay * dt);
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (oldZ * b.z <= 0 && oldZ !== b.z) {
      const crossingY = oldY + (b.y - oldY) * oldZ / (oldZ - b.z);
      const crossingX = oldX + (b.x - oldX) * oldZ / (oldZ - b.z);
      const netHeight = court.netHeight + (court.netPostHeight - court.netHeight) * Math.min(1, Math.abs(crossingX) / (court.width / 2));
      if (Math.abs(crossingX) <= court.width / 2 + c.ballRadius && crossingY - c.ballRadius <= netHeight) {
        b.z = Math.sign(oldZ) * c.ballRadius; b.vz *= -c.netRetention; b.vx *= c.netRetention;
        this.events.push({ type: 'net_contact', time: this.age });
      }
    }
    if (b.y <= c.ballRadius && b.vy < 0) {
      const impactSpeed = -b.vy;
      b.y = c.ballRadius; b.vy = -b.vy * c.restitution;
      b.vx *= c.surfaceRetention; b.vz *= c.surfaceRetention;
      this.spin *= 0.55;
      this.bounces++;
      const inBounds = Math.abs(b.x) <= court.width / 2 + c.ballRadius && Math.abs(b.z) <= court.length / 2 + c.ballRadius;
      this.events.push({ type: 'bounce', time: this.age, x: b.x, z: b.z, in_bounds: inBounds, impactSpeed });
      const receiver = opponentOf(this.lastHitter);
      if (!this.practice && this.lastHitter) {
        // Once a legal bounce happened, an untouched ball belongs to the receiver,
        // including a second bounce outside the lines.
        if (this.bounces >= 2) this.finish('two_bounces', undefined, receiver);
        else if (!inBounds) this.finish('out');
        else if (seatSign(this.lastHitter) * b.z >= 0) this.finish('wrong_side');
        else if (this.hits === 1 && Math.abs(b.z) <= court.kitchenDepth + court.lineWidth / 2 + c.ballRadius) this.finish('serve_short');
        else if (this.hits === 1 && b.x * Math.sign(this.serviceX(this.rallyStart.servingTeam)) > c.ballRadius + court.lineWidth / 2) this.finish('serve_diagonal');
      } else if (!inBounds) this.finish('out');
    }
    if (this.phase === 'rally') {
      if (this.shotAge > 15 || b.y < -1) this.finish('timeout', undefined, this.bounces ? opponentOf(this.lastHitter) : this.lastHitter);
      const grounded = b.y <= c.ballRadius + this.config.simulation.stationaryGroundTolerance;
      const motionless = Math.hypot(b.vx, b.vy, b.vz) <= this.config.simulation.stationarySpeed;
      this.stationaryFor = grounded && motionless ? this.stationaryFor + dt : 0;
      if (this.stationaryFor >= this.config.simulation.stationaryTimeoutSeconds) this.finish('stopped', undefined, this.bounces ? opponentOf(this.lastHitter) : this.lastHitter);
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
      winner: this.winner,
      serve_side: this.score[this.servingTeam === 'A' ? 0 : 1] % 2 === 0 ? 'right' : 'left',
      bounce_required: !this.practice && this.hits < 3 && this.bounces === 0,
      rally_id: this.rallyId,
    };
  }
}
export { opponentOf };
