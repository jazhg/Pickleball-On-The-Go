// Presentation state only: never modifies the simulation or awards points.
export class RallyFeedback {
  constructor() { this.reset(); }
  reset() { this.hits = 0; this.hitter = null; this.shot = null; this.phase = null; }
  state(state) {
    if (state.phase !== 'rally') {
      this.hits = 0; this.hitter = null; this.shot = null;
    } else if (state.last_hitter && state.last_hitter !== this.hitter) {
      this.hits++;
      this.hitter = state.last_hitter;
    }
    this.phase = state.phase;
    return Math.min(3, Math.floor(this.hits / 3));
  }
  contact(shot, now) {
    if (!shot.accepted || shot.id <= (this.lastId || 0)) return false;
    this.lastId = shot.id;
    this.shot = { id: shot.id, player: shot.player, at: now };
    return true;
  }
  classify(message, now) {
    if (!this.shot || message.shot_id !== this.shot.id || message.player !== this.shot.player
      || now - this.shot.at > 3500 || message.confidence < 0.45
      || !['model', 'heuristic'].includes(message.path) || message.shot === 'mishit') return null;
    const descriptions = { drive: 'DRIVE · Pace through the court', dink: 'DINK · A soft touch',
      drop: 'DROP · Taking the pace off', lob: 'LOB · Up and over', smash: 'SMASH · Bringing the power', serve: 'SERVE · Rally on' };
    return descriptions[message.shot] || null;
  }
}
