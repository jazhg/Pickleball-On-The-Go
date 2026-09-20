export function setupBackgroundMusic() {
  const tracks = [
    { name: 'State of Focus', url: './audio/state-of-focus.mp3' },
    { name: 'Championship Concentricity', url: './audio/championship-concentricity.mp3' },
  ];
  const audio = document.getElementById('background-music');
  const toggle = document.getElementById('music-toggle');
  let index = 0, enabled = true;
  try { enabled = localStorage.getItem('background-music-enabled') !== 'false'; } catch { /* Storage is optional. */ }
  audio.volume = 0.25;
  function render() {
    toggle.checked = enabled;
  }
  function select() { audio.src = new URL(tracks[index].url, import.meta.url).href; render(); }
  async function play() {
    if (!enabled || document.hidden) return;
    try { await audio.play(); }
    catch (error) {
      if (error.name === 'AbortError') return;
      // Autoplay may be blocked; retry on the next user interaction without
      // changing the user's music preference or showing playback controls.
    }
  }
  toggle.addEventListener('change', () => {
    enabled = toggle.checked;
    try { localStorage.setItem('background-music-enabled', String(enabled)); } catch { /* Storage is optional. */ }
    if (enabled) play(); else audio.pause();
  });
  function advance() { index = (index + 1) % tracks.length; select(); play(); }
  audio.addEventListener('ended', advance);
  const unlock = event => {
    if (event.target === toggle || event.target?.closest?.('.music-setting')) return;
    if (audio.paused && enabled) play();
  };
  document.addEventListener('click', unlock);
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.pause(); else play(); });
  window.addEventListener('pagehide', () => audio.pause());
  window.addEventListener('pageshow', () => play());
  select();
  play();
}
