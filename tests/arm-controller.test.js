import test from 'node:test';
import assert from 'node:assert/strict';
import { ArmController, constrainArmTarget, solveTwoBoneIK } from '../shared/arm-controller.js';
import { CONFIG } from '../shared/config.js';

const neutral = CONFIG.tracking.neutralWristOffset;
const shoulder = { x: 0.21, y: -0.12, z: -0.4 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const camera = (wristOffset = neutral, values = {}) => ({
  wristOffset: { ...wristOffset }, shoulderOffset: { ...shoulder },
  elbowOffset: { ...CONFIG.tracking.neutralElbowOffset }, activeWrist: CONFIG.tracking.paddleWrist,
  trackingPresent: true, wristConfidence: 0.95, ...values,
});

function settle(controller, end = 600, observation = camera()) {
  controller.observeCamera(observation, 0);
  let state;
  for (let t = 0; t <= end; t += 16) state = controller.update(t);
  return state;
}

function swing(controller, start = 608) {
  const states = [];
  controller.observePhone({ motionX: 1.2, motionY: 0, motionZ: 0.9, motionMagnitude: 1.5 }, start);
  for (let t = start; t < start + 180; t += 16) {
    controller.observeCamera(camera(), t); states.push(controller.update(t));
  }
  controller.observePhone({ motionX: -0.4, motionY: 0.2, motionZ: -3.5, motionMagnitude: 4 }, start + 180);
  for (let t = start + 180; t < start + 1300; t += 16) {
    controller.observeCamera(camera(), t); states.push(controller.update(t));
  }
  return states;
}

test('idle camera noise and a single acceleration spike barely move the handle', () => {
  const controller = new ArmController();
  settle(controller);
  const start = controller.state().position;
  for (let i = 0; i < 40; i++) {
    const noise = (i % 2 ? 1 : -1) * 0.002;
    controller.observeCamera(camera({ x: neutral.x + noise, y: neutral.y - noise, z: neutral.z }), 620 + i * 16);
    controller.update(620 + i * 16);
  }
  assert.ok(distance(start, controller.state().position) < 0.012);
  const beforeSpike = controller.state().position;
  controller.observePhone({ motionX: 20, motionY: 0, motionZ: 0, motionMagnitude: 20 }, 1300);
  controller.update(1300); controller.observePhone({ motionX: 0, motionY: 0, motionZ: 0, motionMagnitude: 0 }, 1316);
  assert.ok(distance(beforeSpike, controller.update(1316).position) < 0.012);
});

test('idle hand observation moves the arm and paddle together without a second smoothing delay', () => {
  const controller = new ArmController();
  settle(controller);
  const observed = { x: 0.16, y: -0.08, z: neutral.z };
  controller.observeCamera(camera(observed), 700);
  const state = controller.update(700);
  assert.ok(distance(state.hand, observed) < 1e-9);
  assert.ok(Math.abs(distance(state.shoulder, state.elbow) - CONFIG.arm.upperArmLength) < 1e-9);
  assert.ok(Math.abs(distance(state.elbow, state.hand) - CONFIG.arm.forearmLength) < 1e-9);
});

test('one swing has monotonic phase, one contact, and close-far-close depth', () => {
  const controller = new ArmController();
  settle(controller);
  const states = swing(controller);
  const active = states.filter(state => ['FORWARD', 'CONTACT', 'FOLLOW_THROUGH'].includes(state.phase));
  for (let i = 1; i < active.length; i++) assert.ok(active[i].progress + 1e-12 >= active[i - 1].progress);
  assert.equal(states.filter(state => state.contact).length, 1);
  const contact = states.find(state => state.phase === 'CONTACT');
  const farthest = Math.min(...states.map(state => state.position.z));
  assert.ok(farthest < neutral.z - 0.1, 'contact reaches visibly outward');
  assert.ok(states.at(-1).position.z > farthest + 0.1, 'follow-through and recovery return closer');
  assert.ok(Math.abs(contact.position.z - neutral.z) > Math.abs(contact.position.x - neutral.x), 'depth dominates at contact');
});

test('final handle dynamics and reach remain bounded throughout a swing', () => {
  const controller = new ArmController();
  settle(controller);
  const states = swing(controller);
  let previousVelocity = { x: 0, y: 0, z: 0 };
  for (const state of states) {
    assert.ok(distance(state.position, state.shoulder) <= CONFIG.arm.upperArmLength + CONFIG.arm.forearmLength + 1e-9);
    assert.ok(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) <= CONFIG.arm.maxVelocity + 1e-9);
    const acceleration = Math.hypot(
      state.velocity.x - previousVelocity.x, state.velocity.y - previousVelocity.y, state.velocity.z - previousVelocity.z,
    ) / 0.016;
    assert.ok(acceleration <= CONFIG.arm.maxAcceleration * 1.1);
    previousVelocity = state.velocity;
  }
});

test('brief camera loss continues smoothly; long loss recovers to neutral', () => {
  const controller = new ArmController();
  settle(controller);
  controller.observePhone({ motionX: 1, motionY: 0, motionZ: 1, motionMagnitude: 1.4 }, 608);
  let before;
  for (let t = 608; t <= 800; t += 16) { controller.observeCamera(camera(), t); before = controller.update(t).position; }
  controller.observeCamera(camera(neutral, { trackingPresent: false }), 816);
  const brief = controller.update(832);
  assert.ok(distance(before, brief.position) < CONFIG.arm.maxVelocity * 0.05);
  let recovered;
  for (let t = 1800; t < 4000; t += 16) recovered = controller.update(t);
  assert.ok(distance(recovered.position, neutral) < 0.04);
});

test('left-side observations cannot move the arm anchor, and seat-local inputs stay identical', () => {
  const a = new ArmController(), b = new ArmController();
  settle(a); settle(b);
  const before = a.state().position;
  const switched = camera(neutral, { activeWrist: 15, shoulderOffset: { ...shoulder, x: -shoulder.x } });
  a.observeCamera(switched, 700);
  const afterState = a.update(716);
  const after = afterState.position;
  assert.ok(distance(before, after) < CONFIG.arm.maxVelocity * 0.05);
  assert.equal(afterState.shoulder.x, CONFIG.tracking.shoulderMeters / 2);
  const input = camera({ x: 0.08, y: -0.2, z: neutral.z });
  a.reset(); b.reset(); a.observeCamera(input, 0); b.observeCamera(input, 0);
  for (let t = 0; t < 500; t += 16) assert.deepEqual(a.update(t).position, b.update(t).position);
});

test('phone orientation is outside translation state and cannot alter the endpoint', () => {
  const a = new ArmController(), b = new ArmController();
  settle(a); settle(b);
  // Both receive the same motion features; any quaternion is applied only by the render hand group.
  const features = { motionX: 0, motionY: 0, motionZ: 0, motionMagnitude: 0, angularSpeed: 240 };
  a.observePhone(features, 700); b.observePhone({ ...features, angularSpeed: 0 }, 700);
  assert.deepEqual(a.update(716).position, b.update(716).position);
});

test('tracked elbow changes the unified arm bend without detaching the hand', () => {
  const low = new ArmController(), high = new ArmController();
  const lowObservation = camera(neutral, { elbowOffset: { x: 0.38, y: -0.36, z: -0.52 } });
  const highObservation = camera(neutral, { elbowOffset: { x: 0.32, y: 0.02, z: -0.52 } });
  const lowState = settle(low, 400, lowObservation);
  const highState = settle(high, 400, highObservation);
  assert.ok(highState.elbow.y > lowState.elbow.y + 0.08, 'rendered elbow follows the observed elbow plane');
  assert.ok(distance(lowState.hand, highState.hand) < 1e-9, 'the paddle handle remains the same solved hand joint');
  for (const state of [lowState, highState]) {
    assert.ok(Math.abs(distance(state.shoulder, state.elbow) - CONFIG.arm.upperArmLength) < 1e-9);
    assert.ok(Math.abs(distance(state.elbow, state.hand) - CONFIG.arm.forearmLength) < 1e-9);
  }
});

test('two-bone IK preserves segment lengths, pole side, and full-extension stability', () => {
  for (const hand of [
    { x: -0.15, y: -0.22, z: -0.85 },
    { x: 0.21, y: -0.12, z: -4 },
    { x: 0.21, y: -0.12, z: -0.401 },
  ]) {
    const pole = { x: 0.45, y: -0.85, z: 0.22 };
    const rig = solveTwoBoneIK(shoulder, constrainArmTarget(hand, shoulder), pole);
    assert.ok(Object.values(rig.elbow).every(Number.isFinite));
    assert.ok(Math.abs(distance(rig.shoulder, rig.elbow) - CONFIG.arm.upperArmLength) < 1e-9);
    assert.ok(Math.abs(distance(rig.elbow, rig.hand) - CONFIG.arm.forearmLength) < 1e-9);
    const shoulderHand = { x: rig.hand.x - shoulder.x, y: rig.hand.y - shoulder.y, z: rig.hand.z - shoulder.z };
    const shoulderElbow = { x: rig.elbow.x - shoulder.x, y: rig.elbow.y - shoulder.y, z: rig.elbow.z - shoulder.z };
    const projection = (shoulderElbow.x * shoulderHand.x + shoulderElbow.y * shoulderHand.y + shoulderElbow.z * shoulderHand.z)
      / (shoulderHand.x ** 2 + shoulderHand.y ** 2 + shoulderHand.z ** 2);
    const bend = { x: shoulderElbow.x - shoulderHand.x * projection, y: shoulderElbow.y - shoulderHand.y * projection, z: shoulderElbow.z - shoulderHand.z * projection };
    assert.ok(bend.x * pole.x + bend.y * pole.y + bend.z * pole.z >= -1e-9);
  }
});

test('rendered object keeps regulation-scale paddle dimensions and Main camera framing', () => {
  assert.equal(CONFIG.render.paddle.headWidth, 0.20);
  assert.equal(CONFIG.render.paddle.headHeight, 0.24);
  assert.ok(CONFIG.render.paddle.handleLength <= 0.16);
  assert.equal(CONFIG.render.cameraFovDeg, 90);
  assert.equal(CONFIG.render.eyeHeight, 1.52);
  assert.equal(CONFIG.render.cameraLookHeight, 0.84);
  assert.equal(CONFIG.render.cameraLookDistance, 6);
});
