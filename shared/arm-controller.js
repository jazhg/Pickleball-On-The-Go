import { CONFIG } from './config.js';

const axes = ['x', 'y', 'z'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const copy = value => ({ x: value.x, y: value.y, z: value.z });
const length = value => Math.hypot(value.x, value.y, value.z);
const mix = (a, b, amount) => Object.fromEntries(axes.map(axis => [axis, a[axis] + (b[axis] - a[axis]) * amount]));
const smoothstep = value => value * value * (3 - 2 * value);

export function constrainArmTarget(target, shoulder, config = CONFIG) {
  const arm = config.arm;
  const neutral = config.tracking.neutralWristOffset;
  const bounded = {
    x: clamp(target.x, neutral.x - config.render.maxWristOffset.x, neutral.x + config.render.maxWristOffset.x),
    y: clamp(target.y, neutral.y - config.render.maxWristOffset.y, neutral.y + config.render.maxWristOffset.y),
    z: clamp(target.z, neutral.z - config.render.maxWristOffset.z, Math.min(arm.nearPlane, neutral.z + config.render.maxWristOffset.z)),
  };
  const delta = { x: bounded.x - shoulder.x, y: bounded.y - shoulder.y, z: bounded.z - shoulder.z };
  const distance = length(delta);
  const maxReach = arm.upperArmLength + arm.forearmLength - arm.reachEpsilon;
  if (distance > maxReach) {
    for (const axis of axes) bounded[axis] = shoulder[axis] + delta[axis] * maxReach / distance;
  }
  return bounded;
}

export function solveTwoBoneIK(shoulder, requestedHand, pole, config = CONFIG) {
  const { upperArmLength: upper, forearmLength: lower, reachEpsilon: epsilon } = config.arm;
  const requested = { x: requestedHand.x - shoulder.x, y: requestedHand.y - shoulder.y, z: requestedHand.z - shoulder.z };
  const rawDistance = length(requested);
  const direction = rawDistance > 1e-8
    ? { x: requested.x / rawDistance, y: requested.y / rawDistance, z: requested.z / rawDistance }
    : { x: 0, y: -0.2, z: -0.98 };
  const distance = clamp(rawDistance, Math.abs(upper - lower) + epsilon, upper + lower - epsilon);
  const hand = Object.fromEntries(axes.map(axis => [axis, shoulder[axis] + direction[axis] * distance]));
  const poleDot = pole.x * direction.x + pole.y * direction.y + pole.z * direction.z;
  let bend = Object.fromEntries(axes.map(axis => [axis, pole[axis] - direction[axis] * poleDot]));
  let bendLength = length(bend);
  if (bendLength < 1e-6) {
    const fallback = Math.abs(direction.y) < 0.9 ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 };
    const dot = fallback.x * direction.x + fallback.y * direction.y + fallback.z * direction.z;
    bend = Object.fromEntries(axes.map(axis => [axis, fallback[axis] - direction[axis] * dot]));
    bendLength = length(bend);
  }
  for (const axis of axes) bend[axis] /= bendLength;
  const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper ** 2 - along ** 2));
  const elbow = Object.fromEntries(axes.map(axis => [axis, shoulder[axis] + direction[axis] * along + bend[axis] * height]));
  return { shoulder: copy(shoulder), elbow, hand };
}

export class ArmController {
  constructor(config = CONFIG) { this.config = config; this.reset(); }

  reset() {
    const neutral = this.config.tracking.neutralWristOffset;
    this.position = copy(neutral);
    this.velocity = { x: 0, y: 0, z: 0 };
    this.observed = copy(neutral);
    this.shoulder = { x: this.config.tracking.shoulderMeters / 2, y: -0.12, z: -0.4 };
    this.elbowObservation = copy(this.config.tracking.neutralElbowOffset);
    this.cameraVelocity = { x: 0, y: 0, z: 0 };
    this.cameraConfidence = 0;
    this.trackingPresent = false;
    this.lastCameraAt = -Infinity;
    this.lastObservedAt = null;
    this.activeWrist = this.config.tracking.paddleWrist;
    this.cameraMotionSign = 0;
    this.cameraMotionFrames = 0;
    this.phone = { x: 0, y: 0, z: 0, magnitude: 0, angularSpeed: 0 };
    this.lastPhoneAt = -Infinity;
    this.phase = 'IDLE';
    this.progress = 0;
    this.phaseStartedAt = 0;
    this.swingDirection = 1;
    this.swingShoulder = copy(this.shoulder);
    this.swingStart = copy(this.position);
    this.contactPending = false;
    this.contactEmitted = false;
    this.lastUpdateAt = null;
  }

  observeCamera(observation, t) {
    if (!observation || !Number.isFinite(t)) return;
    if (observation.shoulderOffset) this.shoulder = {
      x: this.config.tracking.shoulderMeters / 2,
      y: observation.shoulderOffset.y,
      z: observation.shoulderOffset.z,
    };
    if (observation.elbowOffset) this.elbowObservation = copy(observation.elbowOffset);
    this.trackingPresent = observation.trackingPresent !== false && Boolean(observation.wristOffset);
    this.cameraConfidence = clamp(Number(observation.wristConfidence) || 0, 0, 1);
    if (!this.trackingPresent || !observation.wristOffset) return;
    const next = copy(observation.wristOffset);
    if (this.lastObservedAt !== null && t > this.lastObservedAt) {
      const dt = clamp((t - this.lastObservedAt) / 1000, 1 / 120, 0.15);
      for (const axis of axes) this.cameraVelocity[axis] = (next[axis] - this.observed[axis]) / dt;
      const sign = Math.sign(this.cameraVelocity.x);
      if (Math.abs(this.cameraVelocity.x) >= this.config.arm.cameraPrepareSpeed) {
        this.cameraMotionFrames = sign === this.cameraMotionSign ? this.cameraMotionFrames + 1 : 1;
        this.cameraMotionSign = sign;
      } else {
        this.cameraMotionFrames = 0;
        this.cameraMotionSign = 0;
      }
    }
    this.observed = next;
    this.lastObservedAt = t;
    this.lastCameraAt = t;
  }

  observePhone(features, t) {
    if (!features || !Number.isFinite(t)) return;
    this.phone = {
      x: Number(features.motionX) || 0,
      y: Number(features.motionY) || 0,
      z: Number(features.motionZ) || 0,
      magnitude: Math.max(0, Number(features.motionMagnitude) || 0),
      angularSpeed: Math.max(0, Number(features.angularSpeed) || 0),
    };
    this.lastPhoneAt = t;
  }

  #begin(phase, t) {
    this.phase = phase;
    this.phaseStartedAt = t;
    if (phase === 'PREPARE') {
      const lateral = Math.abs(this.cameraVelocity.x) > 0.08 ? this.cameraVelocity.x : this.phone.x;
      this.swingDirection = Math.sign(lateral) || 1;
      this.swingShoulder = copy(this.shoulder);
      this.swingStart = copy(this.position);
      this.progress = 0;
      this.contactPending = false;
      this.contactEmitted = false;
    }
  }

  #trajectory(progress) {
    const c = this.config.arm;
    const shoulder = this.swingShoulder;
    const direction = this.swingDirection;
    const point = (x, y, z) => ({ x: shoulder.x + x * direction, y: shoulder.y + y, z: shoulder.z + z });
    const p0 = point(-c.windupLateral, -c.windupDrop, c.windupDepth);
    const p1 = point(-c.earlyLateral, -c.earlyDrop, -c.earlyDepth);
    const p2 = point(c.contactLateral, c.contactLift, -c.contactDepth);
    const p3 = point(c.followLateral, c.followLift, -c.followDepth);
    const t = smoothstep(clamp(progress, 0, 1));
    const u = 1 - t;
    return Object.fromEntries(axes.map(axis => [axis,
      u ** 3 * p0[axis] + 3 * u ** 2 * t * p1[axis] + 3 * u * t ** 2 * p2[axis] + t ** 3 * p3[axis],
    ]));
  }

  #advancePhase(t) {
    const c = this.config.arm;
    const cameraFresh = t - this.lastCameraAt <= c.cameraVelocityHoldMs;
    const phoneFresh = t - this.lastPhoneAt <= c.phoneFeatureHoldMs;
    const cameraSpeed = cameraFresh ? Math.hypot(this.cameraVelocity.x, this.cameraVelocity.y) : 0;
    const phone = phoneFresh ? this.phone : { x: 0, y: 0, z: 0, magnitude: 0, angularSpeed: 0 };
    if (this.phase === 'IDLE') {
      if (this.cameraMotionFrames >= 2 || phone.magnitude >= c.phonePrepareAcceleration) this.#begin('PREPARE', t);
      return;
    }
    if (this.phase === 'PREPARE') {
      this.progress = clamp((t - this.phaseStartedAt) / c.prepareDurationMs, 0, 1) * c.prepareFraction;
      const reversal = this.cameraVelocity.x * this.swingDirection < -c.cameraForwardSpeed;
      const phoneForward = phone.z < -c.phoneForwardAcceleration;
      if (reversal || phoneForward || (this.progress >= c.prepareFraction && cameraSpeed >= c.cameraPrepareSpeed)) {
        this.phase = 'FORWARD'; this.phaseStartedAt = t;
      }
      return;
    }
    if (this.phase === 'FORWARD') {
      const intensity = clamp(phone.magnitude / c.phoneFullIntensity, 0, 1);
      const duration = c.forwardDurationMs * (1 - c.intensitySpeedup * intensity);
      const next = c.prepareFraction + (t - this.phaseStartedAt) / duration * (c.contactProgress - c.prepareFraction);
      this.progress = Math.max(this.progress, clamp(next, c.prepareFraction, c.contactProgress));
      if (this.progress >= c.contactProgress
        && this.position.z <= this.config.tracking.neutralWristOffset.z - c.contactReachDepth) {
        this.phase = 'CONTACT'; this.phaseStartedAt = t;
        if (!this.contactEmitted) { this.contactPending = true; this.contactEmitted = true; }
      }
      return;
    }
    if (this.phase === 'CONTACT') {
      if (t - this.phaseStartedAt >= c.contactHoldMs) { this.phase = 'FOLLOW_THROUGH'; this.phaseStartedAt = t; }
      return;
    }
    if (this.phase === 'FOLLOW_THROUGH') {
      const next = c.contactProgress + (t - this.phaseStartedAt) / c.followDurationMs * (1 - c.contactProgress);
      this.progress = Math.max(this.progress, clamp(next, c.contactProgress, 1));
      if (this.progress >= 1) { this.phase = 'RECOVER'; this.phaseStartedAt = t; }
      return;
    }
    if (this.phase === 'RECOVER' && t - this.phaseStartedAt >= c.recoverMinMs
      && length(this.velocity) < c.restVelocity && length({ x: this.position.x - this.observed.x, y: this.position.y - this.observed.y, z: this.position.z - this.observed.z }) < c.restDistance) {
      this.phase = 'IDLE'; this.progress = 0;
    }
  }

  update(t) {
    if (!Number.isFinite(t)) return this.state();
    const dt = this.lastUpdateAt === null ? 1 / 60 : clamp((t - this.lastUpdateAt) / 1000, 1 / 240, 0.05);
    this.lastUpdateAt = t;
    this.#advancePhase(t);
    const c = this.config.arm;
    const trackingAge = t - this.lastCameraAt;
    const cameraAvailable = this.trackingPresent && trackingAge <= c.cameraHoldMs;
    let observed = cameraAvailable ? this.observed : copy(this.config.tracking.neutralWristOffset);
    if (!cameraAvailable && this.phase !== 'IDLE' && trackingAge > c.cameraRecoverMs) {
      this.phase = 'RECOVER'; this.phaseStartedAt = t;
    }
    let target = observed;
    let procedural = null;
    if (['PREPARE', 'FORWARD', 'CONTACT', 'FOLLOW_THROUGH'].includes(this.phase)) {
      procedural = this.#trajectory(this.progress);
      const phaseWeight = this.phase === 'PREPARE'
        ? c.swingWeight * smoothstep(clamp(this.progress / c.prepareFraction, 0, 1))
        : c.swingWeight;
      const confidenceWeight = cameraAvailable ? phaseWeight : 1;
      target = mix(observed, procedural, confidenceWeight);
    }
    target = constrainArmTarget(target, this.shoulder, this.config);
    if (this.phase === 'IDLE' && cameraAvailable) {
      // PositionTracker already supplies a filtered, velocity-limited hand
      // observation. Copy it once here instead of adding a second lag layer.
      this.position = target;
      this.velocity = copy(this.cameraVelocity);
      return this.state(procedural, target);
    }
    const acceleration = Object.fromEntries(axes.map(axis => [axis,
      c.spring * (target[axis] - this.position[axis]) - c.damping * this.velocity[axis],
    ]));
    const accelerationLength = length(acceleration);
    const accelerationScale = accelerationLength > c.maxAcceleration ? c.maxAcceleration / accelerationLength : 1;
    for (const axis of axes) this.velocity[axis] += acceleration[axis] * accelerationScale * dt;
    const speed = length(this.velocity);
    if (speed > c.maxVelocity) for (const axis of axes) this.velocity[axis] *= c.maxVelocity / speed;
    for (const axis of axes) this.position[axis] += this.velocity[axis] * dt;
    this.position = constrainArmTarget(this.position, this.shoulder, this.config);
    return this.state(procedural, target);
  }

  state(procedural = null, target = this.position) {
    const contact = this.contactPending;
    this.contactPending = false;
    const elbowPole = {
      x: this.elbowObservation.x - this.shoulder.x,
      y: this.elbowObservation.y - this.shoulder.y,
      z: this.elbowObservation.z - this.shoulder.z,
    };
    const rig = solveTwoBoneIK(this.shoulder, this.position, elbowPole, this.config);
    return {
      position: copy(rig.hand), hand: copy(rig.hand), elbow: copy(rig.elbow),
      velocity: copy(this.velocity), shoulder: copy(rig.shoulder),
      observedElbow: copy(this.elbowObservation),
      observed: copy(this.observed), procedural: procedural && copy(procedural), target: copy(target),
      phase: this.phase, progress: this.progress, contact,
      confidence: this.cameraConfidence, trackingPresent: this.trackingPresent,
    };
  }
}
