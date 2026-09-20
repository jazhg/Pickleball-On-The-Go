// Triggered by authoritative collisions, not by render frames or swing input.
export function setupImpactAudio(file, { replacePrevious = false } = {}) {
  let context, buffer, loading;
  let previousSource;
  const bytes = fetch(new URL(file, import.meta.url))
    .then(response => { if (!response.ok) throw new Error('Impact audio unavailable'); return response.arrayBuffer(); })
    .catch(() => null);
  async function unlock() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context ??= new Audio();
      await context.resume();
      if (!loading) loading = bytes.then(data => data ? context.decodeAudioData(data) : null).then(decoded => { buffer = decoded; }).catch(() => {});
      await loading;
    } catch { /* A later user gesture can retry browser audio activation. */ }
  }
  document.addEventListener('click', unlock);
  document.addEventListener('keydown', unlock);
  window.addEventListener('pagehide', () => context?.suspend());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) context?.suspend();
    else if (context) context.resume().catch(() => {});
  });
  return () => {
    if (!buffer || document.hidden || context?.state !== 'running') return;
    if (replacePrevious && previousSource) { try { previousSource.stop(); } catch { /* Already ended. */ } }
    const source = context.createBufferSource(), gain = context.createGain();
    previousSource = source;
    source.buffer = buffer; gain.gain.value = 0.65;
    source.connect(gain); gain.connect(context.destination); source.start();
    source.onended = () => { source.disconnect(); gain.disconnect(); if (previousSource === source) previousSource = null; };
  };
}
