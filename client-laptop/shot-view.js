// Speed is the virtual ball's launch velocity, not inferred phone speed.
export function describeShot(report) {
  const a = report.analysis;
  let title = 'Matching swing…';
  if (a?.method === 'synthetic') title = 'Synthetic test swing';
  else if (a?.method === 'dtw' && a.shot !== 'unknown') title = a.shot[0].toUpperCase() + a.shot.slice(1);
  else if (a) title = 'Unknown';
  return { title, detail: report.accepted
    ? `Ball speed: ${(report.launch_speed_mps * 2.236936).toFixed(1)} mph`
    : 'Ball speed: — (no launch)' };
}
