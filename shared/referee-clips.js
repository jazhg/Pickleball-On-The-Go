export const REFEREE_CLIPS = Object.freeze({
  ready: 'players_ready.mp3', red_serves: 'RedToServe.mp3', blue_serves: 'bluetoserve.mp3',
  net: 'Intothenet.mp3', out: 'out.mp3', fault_red: 'faultred.mp3', fault_blue: 'faultblue.mp3',
  game_point_red: 'gamepointred.mp3', game_point_blue: 'gamepointblue.mp3',
  point_red: 'pointred.mp3', point_blue: 'pointblue.mp3', replay: 'replaypoint.mp3', side_out: 'sideout.mp3',
  great_return: 'greatreturn.mp3', recovery: 'increrecovery.mp3', drive: 'powerfuldrive.mp3',
  close_game: 'thisoneisgoingdowntothewire.mp3', angle: 'whatanangle.mp3', rally: 'whatarally.mp3',
});

export class RefereeVoiceGate {
  constructor() { this.last = -Infinity; this.lastPraise = -Infinity; this.clips = new Map(); this.lastPriority = null; }
  allow(clip, priority, now) {
    if (!Object.hasOwn(REFEREE_CLIPS, clip) || !['official', 'praise'].includes(priority)) return false;
    if (now - this.last < 4500 && !(priority === 'official' && this.lastPriority === 'praise')) return false;
    if (now - (this.clips.get(clip) ?? -Infinity) < (priority === 'praise' ? 60000 : 15000)) return false;
    if (priority === 'praise' && now - this.lastPraise < 15000) return false;
    this.last = now; this.lastPriority = priority; this.clips.set(clip, now);
    if (priority === 'praise') this.lastPraise = now;
    return true;
  }
}
