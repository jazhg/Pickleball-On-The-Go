// CPU microbenchmark only. This does not measure GPU frame rate or phone latency.
import { performance } from 'node:perf_hooks';
import { Simulation } from '../server/physics.js';
import { CONFIG } from '../shared/config.js';
const swing = { t: 1, type: 'swing', ...CONFIG.swing.synthetic };
const samples=[];
for(let i=0;i<1100;i++) {
  const s=new Simulation();s.spawn();const start=performance.now();s.swing(swing);
  if(i>=100)samples.push(performance.now()-start);
}
samples.sort((a,b)=>a-b);
const s=new Simulation();let steps=0;const start=performance.now();
for(let rally=0;rally<500;rally++) {s.newGame();s.spawn();s.swing(swing);while(s.phase==='rally'){s.step();steps++;}}
console.log(JSON.stringify({kind:'CPU microbenchmark; not GPU FPS',samples:samples.length,
  contact_median_ms:samples[500],contact_p95_ms:samples[950],simulation_steps:steps,
  elapsed_ms:performance.now()-start,simulation_hz:CONFIG.simulation.hz,
  seating_meshes_before:382,seating_draw_calls_after:3},null,2));
