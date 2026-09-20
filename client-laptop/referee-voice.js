import { REFEREE_CLIPS } from '/shared/referee-clips.js';

export function setupRefereeVoice() {
  const toggle = document.getElementById('voice-toggle');
  let muted = false, context, source, playingPriority, lastId = 0, generation = 0;
  let lastStart = -Infinity;
  const played = new Map(), buffers = new Map();
  try { muted = localStorage.getItem('referee-muted') === 'true'; } catch { /* Optional storage. */ }
  const duck = active => document.dispatchEvent(new CustomEvent('referee-speaking', { detail: active }));
  const render = () => { toggle.textContent = muted ? '🔇 Voice off' : '🔊 Voice on'; toggle.setAttribute('aria-pressed', String(!muted)); };
  function stop() {
    generation++;
    if (source) { source.onended = null; source.stop(); source.disconnect(); source = null; }
    duck(false);
  }
  async function unlock() {
    if (muted) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context ??= new Audio();
      await context.resume();
    } catch { /* Retry on the next user gesture. Never queue old announcements. */ }
  }
  toggle.addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('referee-muted', String(muted)); } catch { /* Optional storage. */ }
    if (muted) stop(); else unlock();
    render();
  });
  document.addEventListener('click', unlock);
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  render();
  return {
    async receive(message) {
      if (!Number.isSafeInteger(message.id) || message.id <= lastId || !Object.hasOwn(REFEREE_CLIPS, message.clip)
        || !['official', 'praise'].includes(message.priority) || !Number.isFinite(message.expires_at)) return;
      lastId = message.id;
      const now = Date.now();
      if (muted || document.hidden || context?.state !== 'running' || now > message.expires_at) return;
      if (source && !(message.priority === 'official' && playingPriority === 'praise')) return;
      if (message.priority === 'praise' && now - lastStart < 15000) return;
      if (now - (played.get(message.clip) ?? -Infinity) < (message.priority === 'praise' ? 60000 : 15000)) return;
      stop(); const token = generation;
      try {
        if (!buffers.has(message.clip)) buffers.set(message.clip, fetch(new URL(`./audio/referee/${REFEREE_CLIPS[message.clip]}`, import.meta.url))
          .then(response => { if (!response.ok) throw new Error('Missing recording'); return response.arrayBuffer(); })
          .then(data => context.decodeAudioData(data)));
        const buffer = await buffers.get(message.clip);
        if (generation !== token || muted || document.hidden || Date.now() > message.expires_at) return;
        source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
        playingPriority = message.priority; lastStart = Date.now(); played.set(message.clip, lastStart);
        source.onended = () => { source.disconnect(); source = null; duck(false); };
        duck(true); source.start();
      } catch { buffers.delete(message.clip); if (token === generation) stop(); }
    },
    reset() { stop(); lastId = 0; },
  };
}
