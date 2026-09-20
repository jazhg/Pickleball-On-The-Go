import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../server/physics.js';
import {CONFIG} from '../shared/config.js';
const swing={t:1,type:'swing',...CONFIG.swing.synthetic};
test('stepping into the kitchen during a volley follow-through faults the hitter',()=>{
  const s=new Simulation();s.phase='rally';s.hits=3;s.lastHitter='B';Object.assign(s.ball,s.paddle());
  s.swing(swing);s.setPose({court_x:0,court_y:1.9,torso_deg:0});
  assert.equal(s.lastResult.rule,'kitchen_volley');assert.equal(s.lastResult.player,'A');
});
test('tracked movement stays relative to automatic serve placement across successive points',()=>{
  const s=new Simulation();const p={court_x:0.8,court_y:5,torso_deg:0};s.setPose(p);s.spawn();
  const start={...s.players.A};s.setPose(p);assert.equal(s.players.A.court_x,start.court_x);assert.equal(s.players.A.court_y,start.court_y);
  s.swing(swing);s.finish('two_bounces',undefined,'B');s.reset();s.spawn();s.setPose(p);
  assert.ok(s.players.A.court_x<0);s.setPose({...p,court_x:1});assert.ok(Math.abs(s.players.A.court_x-(-CONFIG.court.width/4+0.2))<1e-8);
});
test('practice focus changes the feed trajectory without changing the score',()=>{
  const s=new Simulation();s.practiceFocus='add_loft';s.practiceFeed();const fast=s.ball.vz;
  s.practiceFocus='soften_power';s.practiceFeed();assert.ok(Math.abs(s.ball.vz)<Math.abs(fast));assert.deepEqual(s.score,[0,0]);
});
test('net collision is retained and a failed crossing faults the hitter on its first bounce',()=>{
  const s=new Simulation();s.phase='rally';s.lastHitter='A';s.hits=3;
  Object.assign(s.ball,{x:0,y:0.5,z:0.01,vx:0,vy:0,vz:-10});s.step();assert.ok(s.ball.vz>0);
  for(let i=0;i<200&&s.phase==='rally';i++)s.step();assert.equal(s.lastResult.rule,'wrong_side');assert.equal(s.lastResult.player,'A');
});
test('a server moving onto the baseline before contact commits a service fault',()=>{
  const s=new Simulation();s.spawn();s.players.A.court_y=CONFIG.court.length/2;
  assert.equal(s.swing(swing),false);assert.equal(s.lastResult.rule,'serve_foot_fault');assert.equal(s.servingTeam,'B');
});
test('a well-placed passing shot can beat the solo bot’s bounded reach',()=>{
  const s=new Simulation();s.spawn();s.phase='rally';s.lastHitter='A';s.hits=3;s.bounces=1;
  Object.assign(s.ball,{x:2.6,y:0.8,z:-4,vx:0,vy:1,vz:-2});
  assert.equal(s.botReturn(),false);assert.equal(s.lastHitter,'A');
});
