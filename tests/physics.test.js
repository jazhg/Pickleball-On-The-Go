import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, speedFromPeak } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';
import { validMessage, parseMessage } from '../shared/protocol.js';
const swing = { t: 1234567, type: 'swing', ...CONFIG.swing.synthetic };

test('positive roll aims left and negative roll aims right', () => {
  const launch = roll => {
    const sim = new Simulation();
    sim.spawn();
    sim.swing({ ...swing, roll });
    return sim.ball.vx;
  };
  assert.ok(launch(10) < 0);
  assert.ok(launch(-10) > 0);
});

test('in-bounds ball keeps bouncing beyond two bounces and only an out landing ends it', () => {
  const sim = new Simulation();
  sim.phase = 'rally';
  sim.ball = { x: 0, y: 1, z: 3, vx: 0, vy: 0, vz: 0 };
  for (let i = 0; i < 300; i++) sim.step();
  assert.ok(sim.bounces > 2);
  assert.equal(sim.phase, 'rally');
  assert.equal(sim.spawn(), false);
  assert.equal(sim.events.some(e => e.type === 'rally_end'), false);
  sim.ball.x = CONFIG.court.width;
  sim.ball.y = CONFIG.physics.ballRadius;
  sim.ball.vy = -1;
  sim.step();
  assert.equal(sim.phase, 'reset');
  assert.equal(sim.events.at(-1).reason, 'out');
  for (let i = 0; i < 300; i++) sim.step();
  assert.equal(sim.phase, 'idle');
  assert.equal(sim.spawn(), true);
});

test('a motionless grounded ball enables respawn after three seconds', () => {
  const sim = new Simulation();
  sim.phase = 'rally';
  sim.ball = { x: 0, y: CONFIG.physics.ballRadius, z: 2, vx: 0, vy: 0, vz: 0 };
  const nearlyThreeSeconds = CONFIG.simulation.hz * CONFIG.simulation.stationaryTimeoutSeconds - 1;
  for (let i = 0; i < nearlyThreeSeconds; i++) sim.step();
  assert.equal(sim.phase, 'rally');
  assert.equal(sim.spawn(), false);
  for (let i = 0; i < 3; i++) sim.step();
  assert.equal(sim.phase, 'idle');
  assert.equal(sim.events.at(-1).reason, 'stopped');
  assert.equal(sim.spawn(), true);
});

test('bot return rebounds on the near court and allows a player return', () => {
  const sim = new Simulation();
  sim.phase = 'rally'; sim.lastHitter = 'A'; sim.bounces = 1;
  sim.ball = { x: 0, y: 0.5, z: -3, vx: 0, vy: 0, vz: 0 };
  assert.equal(sim.botReturn(), true);
  assert.equal(sim.lastHitter, 'B');
  for (let i = 0; i < 240 && sim.bounces === 0; i++) sim.step();
  assert.equal(sim.phase, 'rally');
  assert.ok(sim.ball.z > 0 && sim.ball.vy > 0);
  Object.assign(sim.ball, sim.paddle('A'));
  assert.equal(sim.swing(swing, 'A'), true);
});

test('keyboard swing clears net, bounces inside far court, then waits for spawn', () => {
  const sim = new Simulation();
  assert.equal(sim.phase, 'idle');
  assert.equal(sim.swing(swing), false);
  assert.equal(sim.spawn(), true);
  assert.equal(sim.spawn(), false);
  assert.equal(sim.swing(swing), true);
  let bounce;
  for (let i = 0; i < 500 && !bounce; i++) { sim.step(); bounce = sim.events.find(e => e.type === 'bounce'); }
  assert.ok(bounce); assert.equal(bounce.in_bounds, true); assert.ok(bounce.z < 0, 'first bounce is on the far side');
  assert.equal(sim.events.some(e => e.type === 'net_contact'), false);
  assert.ok(sim.ball.vy > 0, 'ball should rebound upward');
  for (let i = 0; i < 1500 && sim.phase !== 'idle'; i++) sim.step();
  assert.equal(sim.phase, 'idle');
  for (let i = 0; i < 1200; i++) sim.step();
  assert.equal(sim.phase, 'idle');
  assert.equal(sim.swing(swing), false);
});
test('hit window rejects distant ball; speed bounds and calibrated midpoint hold', () => {
  const sim = new Simulation(); sim.spawn(); sim.ball.x = 3;
  assert.equal(sim.swing(swing), false);
  assert.equal(speedFromPeak(0), CONFIG.physics.minSpeed);
  assert.equal(speedFromPeak(100), CONFIG.calibration.powerCap);
  assert.equal(speedFromPeak(CONFIG.calibration.mediumG), CONFIG.calibration.mediumSpeed);
});
test('extreme phone angles and force cannot launch the ball above two meters', () => {
  for (const pitch of [-180, -113.5, -23.8, 31.4, 92.6, 174.8, 180]) {
    const sim = new Simulation(); sim.spawn(); sim.swing({ ...swing, peak_g: 12.61, pitch });
    assert.ok(sim.ball.vy <= CONFIG.physics.maxUpwardSpeed);
    assert.equal(sim.swing(swing), false, 'ignore follow-through contacts during flight');
    for (let i = 0; i < 2400 && sim.phase === 'rally'; i++) { sim.step(); assert.ok(sim.ball.y < 2, `too high at pitch ${pitch}`); }
  }
});
test('serve ball stays fixed when the player moves and needs a nearby hit', () => {
  const sim = new Simulation(); sim.spawn();
  const waiting = { ...sim.ball };
  sim.setPose({ t: 1, type: 'pose', court_x: 2, court_y: 4.8, torso_deg: 0, wrist_h: 1 });
  assert.deepEqual(sim.ball, waiting);
  assert.equal(sim.swing(swing), false);
  assert.equal(sim.phase, 'ready');
  sim.setPose({ ...sim.players.A, court_x: CONFIG.player.x, court_y: CONFIG.player.homeDepth });
  assert.equal(sim.swing(swing), true);
  const x = sim.ball.x;
  sim.setPose({ ...sim.players.A, court_x: -1 }, 'A');
  assert.equal(sim.ball.x, x);
});
test('player B serves toward positive z and can return player A shots', () => {
  const sim = new Simulation();
  sim.setPose({ t: 1, type: 'pose', court_x: 0, court_y: 5.25, torso_deg: 0, wrist_h: 0.95 }, 'B');
  assert.equal(sim.players.B.court_y, -5.25, 'server signs B depth authoritatively');
  assert.equal(sim.spawn('B'), true);
  assert.equal(sim.readyFor, 'B');
  assert.equal(sim.swing(swing, 'A'), false, 'the wrong player cannot serve');
  assert.equal(sim.swing(swing, 'B'), true);
  assert.ok(sim.ball.vz > 0, 'B attacks toward positive z');

  Object.assign(sim.ball, sim.paddle('A'));
  assert.equal(sim.swing(swing, 'B'), false, 'one player cannot hit twice in a row');
  assert.equal(sim.swing(swing, 'A'), true);
  assert.ok(sim.ball.vz < 0, 'A returns toward negative z');
  assert.equal(sim.lastHitter, 'A');
});
test('controller orientation has equivalent egocentric launch behavior for seats A and B', () => {
  const angle = 12 * Math.PI / 180;
  const controller = { t: 1, type: 'controller_pose', qx: 0, qy: Math.sin(angle / 2), qz: 0, qw: Math.cos(angle / 2) };
  const launches = {};
  for (const player of ['A', 'B']) {
    const sim = new Simulation();
    sim.spawn(player);
    assert.equal(sim.swing(swing, player, controller), true);
    const sign = CONFIG.seats[player].sign;
    launches[player] = { right: sign * sim.ball.vx, forward: -sign * sim.ball.vz, up: sim.ball.vy };
    assert.ok(Math.abs(launches[player].right) < 1e-9, `${player} launches straight despite paddle yaw`);
    assert.ok(launches[player].forward > 0, `${player} still launches into the far court`);
  }
  for (const axis of ['right', 'forward', 'up']) assert.ok(Math.abs(launches.A[axis] - launches.B[axis]) < 1e-9);
});
test('rally reset preserves both tracked player poses', () => {
  const sim = new Simulation();
  const poseA = { t: 1, type: 'pose', court_x: 0.3, court_y: 5, torso_deg: 0, wrist_h: 0.95 };
  const poseB = { ...poseA, court_x: -0.4 };
  sim.setPose(poseA, 'A');
  sim.setPose(poseB, 'B');
  sim.reset();
  assert.equal(sim.players.A.court_x, 0.3);
  assert.equal(sim.players.B.court_x, -0.4);
  assert.equal(sim.players.B.court_y, -5);
});
test('net catches low flight; floor bounces use restitution', () => {
  const sim = new Simulation(); sim.phase = 'rally';
  Object.assign(sim.ball, { x: 0, y: 0.5, z: 0.01, vx: 0, vy: 0, vz: -10 }); sim.step();
  assert.ok(sim.ball.vz > 0); assert.ok(sim.events.some(e => e.type === 'net_contact'));
  Object.assign(sim.ball, { y: 0.038, vy: -3, vz: 0 }); sim.step();
  assert.equal(sim.ball.y, CONFIG.physics.ballRadius); assert.ok(sim.ball.vy > 2 && sim.ball.vy < 2.4);
});
test('wire contract accepts design messages and rejects mutations/non-finite values', () => {
  assert.ok(validMessage(swing)); assert.ok(validMessage(new Simulation().state()));
  assert.ok(validMessage({ t: 1, type: 'spawn' }));
  assert.ok(validMessage({ type: 'hello', player: 'B', role: 'phone' }));
  assert.ok(validMessage({ t: 1, type: 'pose', court_x: -1.2, court_y: 2.9, torso_deg: 18, wrist_h: 0.94 }));
  assert.ok(validMessage({ type: 'ruling', fault: true, player: 'A', rule: '9.B', explanation: 'Design schema example only.', score: [6, 5], side_out: true }));
  assert.equal(validMessage({ ...swing, player: 'A' }), false);
  assert.equal(validMessage({ ...swing, peak_g: Infinity }), false);
  assert.equal(validMessage({ ...swing, duration_ms: -1 }), false);
  assert.equal(validMessage({ t: 1, type: 'pose', player: '', court_x: 0, court_y: 5, torso_deg: 0, wrist_h: 1 }), false);
  assert.equal(parseMessage('{bad json'), null);
});

test('phone paddle yaw does not steer a straight stroke sideways for either seat', () => {
  for (const player of ['A', 'B']) {
    for (const degrees of [-70, -45, 0, 45, 70, 120]) {
      const sim = new Simulation();
      sim.setPose({ t: 1, type: 'pose', court_x: 1, court_y: 5, torso_deg: 80, wrist_h: 0.95 }, player);
      sim.spawn(player);
      const yaw = degrees * Math.PI / 180;
      const aim = { t: 1, type: 'controller_pose', qx: 0, qy: Math.sin(yaw / 2), qz: 0, qw: Math.cos(yaw / 2) };
      assert.equal(sim.swing({ ...swing, roll: -90 }, player, aim), true);
      const sign = player === 'A' ? 1 : -1;
      const bearing = Math.atan2(sign * sim.ball.vx, -sign * sim.ball.vz) * 180 / Math.PI;
      assert.ok(Math.abs(bearing) < 1e-10, `${player}: expected straight launch, got ${bearing}`);
      assert.ok(sim.ball.vy <= CONFIG.physics.maxUpwardSpeed);
    }
  }
});

test('missing or invalid paddle orientation retains keyboard shot behavior', () => {
  const expected = new Simulation(); expected.spawn(); expected.swing(swing);
  for (const aim of [null, { t: 1, type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 0 }]) {
    const sim = new Simulation(); sim.spawn(); sim.swing(swing, 'A', aim);
    assert.deepEqual(sim.ball, expected.ball);
  }
});
