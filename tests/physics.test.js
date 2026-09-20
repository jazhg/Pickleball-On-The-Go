import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, speedFromPeak } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';
import { validMessage } from '../shared/protocol.js';
const swing = { t: 1, type: 'swing', ...CONFIG.swing.synthetic, roll: 0, pitch: 0 };
const pose = (x, z) => ({ t: 1, type: 'pose', court_x: x, court_y: z, torso_deg: 0, wrist_h: 0.95 });
const aim = degrees => ({ t: 1, type: 'controller_pose', qx: 0, qy: Math.sin(degrees * Math.PI / 360), qz: 0, qw: Math.cos(degrees * Math.PI / 360) });
function rally(player = 'A') {
  const s = new Simulation(); s.phase = 'rally'; s.hits = 3; s.lastHitter = player === 'A' ? 'B' : 'A'; s.bounces = 1;
  Object.assign(s.ball, s.paddle(player)); return s;
}
function bounce(s, x, z) { Object.assign(s.ball, { x, z, y: 0.038, vx: 0, vy: -1, vz: 0 }); s.step(); }

test('only the correct server can request or hit the ball; score parity positions both seats', () => {
  for (const player of ['A', 'B']) for (const score of [0, 1, 2, 11]) {
    const s = new Simulation(); s.servingTeam = player; s.score[player === 'A' ? 0 : 1] = score;
    const other = player === 'A' ? 'B' : 'A';
    assert.equal(s.spawn(other), false); assert.equal(s.spawn(player), true);
    assert.equal(s.readyFor, player); assert.equal(s.swing(swing, other), false);
    assert.ok(Math.abs(s.players[player].court_y) > CONFIG.court.length / 2);
    assert.equal(Math.sign(s.players[player].court_x), (player === 'A' ? 1 : -1) * (score % 2 ? -1 : 1));
    assert.equal(s.swing(swing, player), true);
    assert.ok(s.ball.vz * (player === 'A' ? -1 : 1) > 0);
  }
});
test('neutral serves from either service side clear the net and land diagonally beyond kitchen', () => {
  for (const player of ['A', 'B']) for (const score of [0, 1]) for (const peak_g of [2.5, 3.8, 8]) {
    const s = new Simulation(); s.servingTeam = player; s.score[player === 'A' ? 0 : 1] = score;
    s.spawn(player); s.swing({ ...swing, peak_g }, player, aim(0));
    for (let i = 0; i < 600 && !s.bounces; i++) s.step();
    const b = s.events.find(e => e.type === 'bounce');
    assert.ok(b?.in_bounds, `${player}/${score}/${peak_g}: in bounds`);
    assert.ok(b.z * (player === 'A' ? -1 : 1) > CONFIG.court.kitchenDepth);
    assert.ok(b.x * s.serviceX(player) < 0); assert.equal(s.phase, 'rally');
    assert.equal(s.events.some(e => e.type === 'net_contact'), false);
  }
});
test('side-out awards no point; server winning awards exactly one; finish is idempotent', () => {
  const s = new Simulation(); s.spawn(); s.swing(swing);
  s.finish('out', undefined, 'A'); assert.deepEqual(s.score, [0, 0]); assert.equal(s.servingTeam, 'B');
  s.finish('out', undefined, 'B'); assert.deepEqual(s.score, [0, 0]);
  s.reset(); s.spawn('B'); s.swing(swing, 'B'); s.finish('two_bounces', undefined, 'A');
  assert.deepEqual(s.score, [0, 1]); assert.equal(s.servingTeam, 'B');
});
test('11 requires a two-point lead, deuce continues, game over blocks play until rematch', () => {
  for (const [before, after, winner] of [[[10,9],[11,9],'A'], [[10,10],[11,10],null], [[11,10],[12,10],'A'], [[15,15],[16,15],null]]) {
    const s = new Simulation(); s.score = [...before]; s.spawn(); s.swing(swing); s.finish('two_bounces', undefined, 'B');
    assert.deepEqual(s.score, after); assert.equal(s.winner, winner);
    if (winner) { for(let i=0;i<1000;i++)s.step(); assert.equal(s.phase,'game_over'); assert.equal(s.spawn(),false); assert.equal(s.swing(swing),false); s.newGame(); assert.deepEqual(s.score,[0,0]); assert.equal(s.spawn(),true); }
  }
});
test('second bounce outside still faults the receiver after a valid first bounce', () => {
  const s = new Simulation(); s.spawn(); s.swing(swing); bounce(s, -1.5, -4); assert.equal(s.phase,'rally');
  bounce(s, -4, -8); assert.equal(s.lastResult.player,'B'); assert.equal(s.lastResult.rule,'two_bounces'); assert.deepEqual(s.score,[1,0]);
});
test('first-bounce out, wrong side, short serve, and wrong diagonal fault the hitter', () => {
  for (const [x,z,reason] of [[4,-4,'out'],[1,4,'wrong_side'],[-1,-1,'serve_short'],[1,-4,'serve_diagonal']]) {
    const s=new Simulation(); s.spawn(); s.swing(swing); bounce(s,x,z);
    assert.equal(s.lastResult.rule,reason); assert.equal(s.lastResult.player,'A'); assert.equal(s.servingTeam,'B');
  }
});
test('serve and return must bounce before volleying, then volleys become legal', () => {
  for (const hits of [1,2,3]) {
    const s=rally();s.hits=hits;s.bounces=0;
    const accepted=s.swing(swing);
    assert.equal(accepted,hits===3);
    if(hits<3) assert.equal(s.lastResult.rule,'two_bounce_rule');
  }
});
test('kitchen volley faults; a bounced shot in the kitchen is legal', () => {
  for(const bounces of [0,1]) {
    const s=rally();s.setPose(pose(0,1.8));Object.assign(s.ball,s.paddle());s.bounces=bounces;
    assert.equal(s.swing(swing),bounces===1);
    if(!bounces)assert.equal(s.lastResult.rule,'kitchen_volley');
  }
});
test('paddle yaw steers rally shots symmetrically for both seats with bounded extreme angles', () => {
  for(const degrees of [-70,-30,0,30,70]) {
    const velocities=[];
    for(const player of ['A','B']) {
      const s=rally(player);assert.equal(s.swing(swing,player,aim(degrees)),true);
      const sign=player==='A'?1:-1;
      const bearing=Math.atan2(sign*s.ball.vx,-sign*s.ball.vz)*180/Math.PI;
      assert.ok(Math.abs(bearing-Math.max(-38,Math.min(38,degrees)))<1e-7);
      velocities.push([sign*s.ball.vx,-sign*s.ball.vz,s.ball.vy]);
      assert.ok(Object.values(s.ball).every(Number.isFinite));
    }
    for(let i=0;i<3;i++)assert.ok(Math.abs(velocities[0][i]-velocities[1][i])<1e-7);
  }
});
test('keyboard roll controls lateral direction; bad orientation uses keyboard fallback', () => {
  for(const roll of [-20,20]) {const s=rally();s.swing({...swing,roll});assert.equal(Math.sign(s.ball.vx),-Math.sign(roll));}
  const expected=rally();expected.swing(swing);
  const s=rally();s.swing(swing,'A',{...aim(0),qw:0});assert.deepEqual(s.ball,expected.ball);
});
test('contact preserves ball position, rejects remote hits and repeat hits', () => {
  const s=rally();s.ball.x+=0.4;const at={...s.ball};assert.equal(s.swing(swing),true);
  for(const axis of ['x','y','z'])assert.equal(s.ball[axis],at[axis]);assert.equal(s.swing(swing),false);
  const far=rally();far.ball.x=20;assert.equal(far.swing(swing),false);
});
test('brushing motion produces bounded decaying spin; no spin on a serve', () => {
  const controller={...aim(0),motion_x:4,motion_y:0,motion_z:-4,motion_magnitude:6,angular_speed:200};
  const s=rally();s.swing(swing,'A',controller);assert.equal(s.spin,6);s.step();assert.ok(s.ball.vx<0);assert.ok(s.spin<6);
  const serve=new Simulation();serve.spawn();serve.swing(swing,'A',controller);assert.equal(serve.spin,0);
});
test('practice remains unscored and permits repeated bounces', () => {
  const s=new Simulation();s.practiceFeed();s.ball={x:0,y:1,z:3,vx:0,vy:0,vz:0};
  for(let i=0;i<300;i++)s.step();assert.ok(s.bounces>2);assert.deepEqual(s.score,[0,0]);
});
test('speed calibration and expanded state remain finite and wire-valid', () => {
  assert.equal(speedFromPeak(0),CONFIG.physics.minSpeed);assert.equal(speedFromPeak(100),CONFIG.calibration.powerCap);
  assert.equal(speedFromPeak(CONFIG.calibration.mediumG),CONFIG.calibration.mediumSpeed);
  const s=new Simulation();assert.ok(validMessage(s.state()));s.spawn();s.swing(swing);assert.ok(validMessage(s.state()));
});
