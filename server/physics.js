import { CONFIG } from '../shared/config.js';
import { paddleAim } from '../shared/paddle.js';
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
    this.botEnabled = true; // a human joining seat B turns the opponent off
    this.botRandom = Math.random; // injectable so a rally can be replayed exactly
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
    this.age = 0; // monotonic rally clock; event timestamps must never run backwards
    this.sinceContact = 0; // resets on every hit, so a long rally is not cut short
    this.botX = 0;
    this.botSwingIn = 0;
    this.resetIn = 0;
    this.events = [];
  }
  // Opponent on seat B. It stands somewhere, has to cover ground to reach the
  // ball, and hands the rally back so the player can hit again. Returning false
  // means it could not get there: the ball bounces twice and the player wins.
  botReturn() {
    const c = this.config.bot, phys = this.config.physics, court = this.config.court;
    if (this.phase !== 'rally' || this.lastHitter === 'B') return false;
    const ball = this.ball;
    if (ball.z >= 0) return false; // the ball is not on the opponent's side
    if (Math.abs(ball.x - this.botX) > c.reach) return false; // out of reach
    const random = this.botRandom;
    const half = court.width / 2;
    // Play the ball to the player, not at the bare court. Aiming at wherever they
    // are standing is what keeps a rally going; the spread still makes them reach.
    const opponent = this.paddle(opponentOf('B'));
    let targetX = clamp(opponent.x + (random() * 2 - 1) * c.spread, -half + 0.3, half - 0.3);
    let targetZ = c.targetDepth;
    // Genuine errors, played out by the same physics as any other shot, so the
    // referee sees an ordinary net cord or a ball sprayed past the sideline.
    // Aiming long instead would just be swallowed by the loft cap and land deep
    // but legal, so the two error shapes are net and wide.
    let intoNet = false;
    if (random() < c.missChance) {
      if (random() < c.netMissShare) { intoNet = true; targetZ = 0.3; }
      else targetX = (targetX >= 0 ? 1 : -1) * (half + c.wideMissMetres);
    }
    const distance = Math.hypot(targetX - ball.x, targetZ - ball.z);
    let flight = Math.max(phys.minimumTargetFlightSeconds, distance / Math.max(c.speed, 1e-6));
    // Aiming at the landing spot alone is not enough: struck low after the bounce,
    // that trajectory is flat and clips the net. Loft it until it clears, unless
    // this shot is meant to be a net error.
    if (!intoNet) {
      flight = Math.max(flight, this.#flightToClearNet(ball, targetZ, c.netMargin));
      flight = Math.min(flight, c.maxFlightSeconds);
    }
    ball.vx = (targetX - ball.x) / flight;
    ball.vz = (targetZ - ball.z) / flight;
    ball.vy = (phys.ballRadius - ball.y) / flight + phys.gravity * flight / 2;
    // physics.maxUpwardSpeed bounds a PLAYER's swing from a waist-high contact; it
    // would truncate this solved arc and drive the return straight into the net.
    // The flight cap above already stops this becoming a moonball.
    ball.vy = Math.min(ball.vy, c.maxLoft);
    // Hand the rally back: without this the player is locked out of their own point.
    this.lastHitter = 'B';
    this.bounces = 0;
    this.sinceContact = 0;
    this.botSwingIn = 0;
    this.events.push({ type: 'contact', player: 'B', time: this.age, ball: { ...ball } });
    return true;
  }
  // Shortest flight time whose arc still passes over the net with margin.
  // Crossing at fraction f of the flight, height at the net is
  //   y0 + f*(yEnd - y0) + (g*T^2/2)*f*(1 - f),
  // which grows with T, so this inverts that for the required T.
  #flightToClearNet(ball, targetZ, margin) {
    const phys = this.config.physics, court = this.config.court;
    const span = targetZ - ball.z;
    if (span <= 0 || ball.z >= 0) return 0;
    const f = -ball.z / span;
    if (!(f > 0 && f < 1)) return 0;
    const needed = court.netHeight + phys.ballRadius + margin
      - ball.y - f * (phys.ballRadius - ball.y);
    if (needed <= 0) return 0;
    return Math.sqrt(2 * needed / (phys.gravity * f * (1 - f)));
  }
  // Cover ground while the ball is on the opponent's side, drift back to the
  // middle between shots, and swing once the reaction pause has elapsed.
  stepBot(dt) {
    if (!this.botEnabled || this.phase !== 'rally') return;
    const c = this.config.bot;
    const chasing = this.ball.z < 0 && this.lastHitter !== 'B';
    const goal = chasing ? this.ball.x : 0;
    const reach = (chasing ? c.moveSpeed : c.recoverSpeed) * dt;
    this.botX += clamp(goal - this.botX, -reach, reach);
    if (this.botSwingIn > 0) {
      this.botSwingIn -= dt;
      if (this.botSwingIn <= 0) { this.botSwingIn = 0; this.botReturn(); }
    }
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
  swing(msg, player = 'A', aim = null) {
    const canServe = this.phase === 'ready' && this.readyFor === player;
    const canReturn = this.phase === 'rally' && this.lastHitter !== player;
    if (!canServe && !canReturn) return false;

    const ball = this.ball, paddle = this.paddle(player), c = this.config.physics;
    if (Math.hypot(ball.x - paddle.x, ball.y - paddle.y, ball.z - paddle.z) > c.hitWindowRadius) return false;

    const attack = -seatSign(player);
    const right = seatSign(player);
    const pose = this.players[player];

    const speed = speedFromPeak(msg.peak_g, this.config.calibration);
    // Where the face points is where the ball goes. With a real paddle pose the
    // heading maps one-to-one and an open face adds the loft; a keyboard or
    // synthetic swing has no pose, so fall back to phone tilt and torso.
    const face = aim ? paddleAim(aim) : null;
    const headingDeg = face
      ? face.headingDeg * c.headingGain
      : (pose?.torso_deg || 0) * c.torsoGain + msg.roll * c.rollGain;
    const liftDeg = face
      ? face.tiltDeg * c.faceTiltGain
      : clamp(Math.asin(Math.sin(radians(msg.pitch))) * 180 / Math.PI, -c.maxPitchInputDeg, c.maxPitchInputDeg) * c.pitchGain;
    const elevation = radians(clamp(c.elevationBaseDeg + liftDeg, c.minElevationDeg, c.maxElevationDeg));
    const azimuth = radians(clamp(headingDeg, -c.maxAzimuthDeg, c.maxAzimuthDeg));
    const horizontal = speed * Math.cos(elevation);

    ball.vx = right * Math.sin(azimuth) * horizontal;
    ball.vy = Math.sin(elevation) * speed;
    ball.vz = attack * Math.cos(azimuth) * horizontal;
    // Aim assist steers direction only; it never lends power. Speed and loft stay
    // exactly what the swing produced, so a soft shot really does drop into the
    // net and a fast one really does carry. A paddle pose is already the player's
    // own aim, so by default it is left completely alone.
    const assist = face ? c.paddleAimAssist : c.aimAssist;
    if (assist > 0 && horizontal > 1e-6) {
      const targetX = right * Math.sign(msg.roll || 1) * c.targetX;
      const targetZ = attack * Math.abs(c.targetZ);
      const reach = Math.hypot(targetX - ball.x, targetZ - ball.z);
      if (reach > 1e-6) {
        const bx = ball.vx * (1 - assist) + (targetX - ball.x) / reach * horizontal * assist;
        const bz = ball.vz * (1 - assist) + (targetZ - ball.z) / reach * horizontal * assist;
        const blended = Math.hypot(bx, bz);
        if (blended > 1e-6) {
          ball.vx = bx / blended * horizontal;
          ball.vz = bz / blended * horizontal;
        }
      }
    }
    const magnitude = Math.hypot(ball.vx, ball.vy, ball.vz);
    const adjusted = clamp(magnitude, c.minSpeed, Math.min(this.config.calibration.powerCap, c.maxSpeed));
    for (const axis of ['vx', 'vy', 'vz']) ball[axis] *= adjusted / magnitude;
    ball.vy = Math.min(ball.vy, c.maxUpwardSpeed);

    this.phase = 'rally';
    this.readyFor = null;
    this.lastHitter = player;
    this.bounces = 0;
    this.sinceContact = 0;
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
    this.sinceContact += dt;
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
      // A second bounce ends the rally against the side that let it bounce twice,
      // wherever that bounce lands: the ball was already in play and the point was
      // lost by not returning it. Only a FIRST bounce outside the lines is "out",
      // which is the hitter's fault.
      if (this.bounces >= 2) this.finish('two_bounces');
      else if (!inBounds) this.finish('out');
      // One bounce in on the opponent's side: it may play the ball back.
      else if (this.botEnabled && b.z < 0 && this.lastHitter !== 'B') this.botSwingIn = this.config.bot.reactionSeconds;
    }
    if (this.phase === 'rally') this.stepBot(dt);
    if (this.phase === 'rally' && this.sinceContact >= this.config.simulation.maxFlightSeconds) this.finish('timeout');
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
