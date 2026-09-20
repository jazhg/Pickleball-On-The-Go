// One snapshot of delay hides network jitter without extrapolating through a hit.
export class BallInterpolation {
  constructor(delayMs = 35) { this.delayMs = delayMs; this.samples = []; }
  push(state, now) {
    if (state.phase !== 'rally' || this.phase !== 'rally' || state.rally_id !== this.rallyId) this.samples.length = 0;
    this.phase = state.phase; this.rallyId = state.rally_id;
    this.samples.push({ now, ...state.ball });
    if (this.samples.length > 12) this.samples.shift();
  }
  sample(now) {
    const a = this.samples;
    if (!a.length) return null;
    const target = now - this.delayMs;
    while (a.length > 2 && a[1].now <= target) a.shift();
    if (a.length === 1 || target <= a[0].now) return a[0];
    const t = Math.max(0, Math.min(1, (target - a[0].now) / Math.max(1, a[1].now - a[0].now)));
    return { x: a[0].x + (a[1].x - a[0].x) * t, y: a[0].y + (a[1].y - a[0].y) * t, z: a[0].z + (a[1].z - a[0].z) * t };
  }
}
