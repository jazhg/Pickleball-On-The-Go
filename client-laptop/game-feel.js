import { RallyFeedback } from './rally-feedback.js';

export function setupGameFeel() {
  const feedback = new RallyFeedback();
  const callout = document.getElementById('hit-callout');
  const title = document.getElementById('hit-title');
  const caption = document.getElementById('hit-caption');
  const rally = document.getElementById('rally-energy');
  const audioButton = document.getElementById('game-audio');
  let hideTimer, context, master, enabled = false, intensity = 0, active = false, beat = 0, nextBeat = 0;
  let impactBuffer;
  function racketImpact(speed) {
    if (!enabled || document.hidden || context?.state !== 'running') return;
    // A short broadband crack plus a hollow body resonance, like a pickleball
    // striking a paddle. Reuse the noise buffer for every confirmed contact.
    if (!impactBuffer) {
      impactBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.065), context.sampleRate);
      const samples = impactBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.012));
    }
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = impactBuffer;
    filter.type = 'bandpass'; filter.frequency.value = 1900; filter.Q.value = 0.7;
    gain.gain.value = Math.min(1.3, 0.65 + speed * 0.025);
    source.connect(filter); filter.connect(gain); gain.connect(master);
    source.start();
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    tone(390, context.currentTime, 0.055, 0.35, 'triangle', 180);
  }
  function tone(frequency, when, duration, volume, type = 'sine', end = frequency) {
    if (!context || context.state !== 'running') return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), when + duration);
    gain.gain.setValueAtTime(0.001, when);
    gain.gain.linearRampToValueAtTime(volume, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    oscillator.connect(gain); gain.connect(master);
    oscillator.start(when); oscillator.stop(when + duration + 0.01);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  audioButton.addEventListener('click', async () => {
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        context = new Audio(); master = context.createGain(); master.gain.value = 0.35; master.connect(context.destination);
      }
      enabled = !enabled;
      if (enabled) { await context.resume(); nextBeat = context.currentTime; }
      else await context.suspend();
      audioButton.textContent = enabled ? 'Sound on' : 'Enable sound';
      audioButton.setAttribute('aria-pressed', String(enabled));
    } catch { enabled = false; audioButton.textContent = 'Sound unavailable'; }
  });
  // Original procedural music: bass pulse, percussion and rising arpeggio layers.
  const musicTimer = setInterval(() => {
    if (!enabled || !active || document.hidden || context?.state !== 'running') return;
    const now = context.currentTime;
    if (nextBeat < now - 0.1) nextBeat = now;
    while (nextBeat < now + 0.12) {
      const notes = [110, 130.81, 164.81, 146.83];
      const note = notes[Math.floor(beat / 8) % notes.length];
      if (beat % 4 === 0) tone(120, nextBeat, 0.16, 0.32, 'sine', 38);
      if (beat % 2 === 0) tone(note / 2, nextBeat, 0.19, 0.13, 'triangle');
      if (intensity >= 1 && beat % 2 === 1) tone(1800, nextBeat, 0.035, 0.018, 'square', 700);
      if (intensity >= 2) tone(note * [1, 1.5, 2, 1.5][beat % 4], nextBeat, 0.11, 0.07, 'triangle');
      if (intensity >= 3 && beat % 4 === 2) tone(220, nextBeat, 0.07, 0.1, 'triangle', 70);
      nextBeat += 60 / (88 + intensity * 20) / 2; beat++;
    }
  }, 50);
  function show(headline, detail, player) {
    title.textContent = headline; caption.textContent = detail;
    callout.dataset.team = player === 'B' ? 'blue' : 'red';
    callout.classList.add('visible'); clearTimeout(hideTimer);
    hideTimer = setTimeout(() => callout.classList.remove('visible'), 1800);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) context?.suspend();
    else if (enabled) context?.resume().catch(() => {});
  });
  window.addEventListener('pagehide', () => { active = false; context?.suspend(); });
  return {
    state(state) {
      intensity = feedback.state(state);
      active = state.phase === 'rally';
      rally.hidden = feedback.hits < 3;
      rally.textContent = `${feedback.hits} HIT RALLY${intensity >= 3 ? ' · ON FIRE' : intensity >= 2 ? ' · HEATING UP' : ''}`;
      rally.dataset.level = String(intensity);
      if (!active) { callout.classList.remove('visible'); beat = 0; }
    },
    shot(shot) {
      if (!feedback.contact(shot, performance.now())) return;
      show('CLEAN CONTACT', `${shot.player === 'B' ? 'Blue' : 'Red'} · ${Math.round(shot.launch_speed_mps * 3.6)} km/h`, shot.player);
      racketImpact(shot.launch_speed_mps);
    },
    classification(message) {
      const text = feedback.classify(message, performance.now());
      if (text) show(text.split(' · ')[0], `${text.split(' · ')[1]} · ${message.path === 'model' ? 'Nemotron' : 'Local estimate'}`, message.player);
    },
    disconnect() { feedback.reset(); active = false; rally.hidden = true; callout.classList.remove('visible'); },
    destroy() { clearInterval(musicTimer); clearTimeout(hideTimer); context?.close(); },
  };
}
