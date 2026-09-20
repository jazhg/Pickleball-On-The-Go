// Rules for the observable virtual court. Physical serve mechanics are not inferred.
export function singlesResult(score, server, loser) {
  const next = [...score], sideOut = loser === server;
  if (!sideOut) next[server === 'A' ? 0 : 1]++;
  return { score: next, server: sideOut ? (server === 'A' ? 'B' : 'A') : server,
    sideOut, winner: Math.max(...next) >= 11 && Math.abs(next[0] - next[1]) >= 2 ? (next[0] > next[1] ? 'A' : 'B') : null };
}
export const FAULTS = {
  serve_position: 'Serve from behind the baseline on the correct service side.',
  serve_target: 'Serve must land in the diagonal service court, beyond the kitchen line.',
  two_bounce: 'The serve and return must each bounce before a volley.',
  kitchen: 'A volley cannot be played while touching the kitchen or its line.',
  double_bounce: 'The ball bounced twice before it was returned.',
  out: 'The first bounce landed outside the opponent’s court.',
  net: 'The ball failed to cross the net before bouncing.',
};
