// Reproducible simulated rallies; synthetic evidence, not human-play validation.
import fs from 'node:fs';
import { Simulation } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';
const swing = { type: 'swing', t: 1, ...CONFIG.swing.synthetic, roll: 0 };
const cases = [];
function capture(name, expected, action) {
  const s = new Simulation();s.spawn();s.swing(swing);action(s);
  cases.push({ name, expected, events: s.events, ruling: s.lastResult });
}
function bounce(s,x,z) {Object.assign(s.ball,{x,z,y:0.038,vx:0,vy:-1,vz:0});s.step();}
capture('serve into kitchen','serve_deep',s=>bounce(s,-1,-1));
capture('serve into wrong service box','serve_diagonal',s=>bounce(s,1,-4));
capture('sideline miss','reduce_angle',s=>bounce(s,-4,-4));
capture('baseline miss','soften_power',s=>bounce(s,-1,-8));
capture('failed net clearance','add_loft',s=>bounce(s,1,2));
capture('receiver misses second bounce','move_to_ball',s=>{bounce(s,-1,-4);bounce(s,-1,-5);});
capture('early return volley','wait_for_bounce',s=>{Object.assign(s.ball,s.paddle('B'));s.swing(swing,'B');});
capture('kitchen volley','leave_kitchen',s=>{s.hits=3;s.offsets.B={x:0,z:0};s.setPose({court_x:0,court_y:1.8,torso_deg:0},'B');Object.assign(s.ball,s.paddle('B'));s.swing(swing,'B');});
fs.writeFileSync(new URL('../nemotron/coach-fixtures.json',import.meta.url),JSON.stringify(cases,null,2)+'\n');
console.log(`Generated ${cases.length} synthetic coaching rallies.`);
