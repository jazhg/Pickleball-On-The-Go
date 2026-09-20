import { CONFIG } from '/shared/config.js';
import { PositionTracker } from '/shared/position-tracker.js';

export function setupTracking({ onPose }) {
  const button = document.getElementById('camera-button');
  const recenter = document.getElementById('recenter-button');
  const status = document.getElementById('tracking-status');
  const label = document.getElementById('position-label');
  const video = document.getElementById('tracking-video');
  const tracker = new PositionTracker();
  let stream, model, timer, loading = false, lastFrame = -1, active = false;
  function stop(message = 'Camera off. Position held at the last estimate.') {
    active = false; clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.srcObject = null; video.hidden = true;
    model?.close(); model = null;
    button.textContent = 'Enable camera'; button.disabled = false; recenter.disabled = true;
    status.textContent = message; label.textContent = 'You · camera off';
  }
  function tick() {
    if (!active) return;
    try {
      if (video.readyState >= 2 && video.currentTime !== lastFrame) {
        lastFrame = video.currentTime;
        const result = model.detectForVideo(video, performance.now());
        const pose = tracker.update(result.landmarks?.[0], performance.now());
        onPose(pose, tracker.state());
        if (pose) {
          label.textContent = 'You · tracking';
          status.textContent = 'Tracking your position. Step sideways or toward/away from the camera. Depth is approximate.';
        } else if (!tracker.reference && tracker.samples.length) {
          status.textContent = `Stand still: calibrating ${tracker.samples.length}/${CONFIG.tracking.calibrationFrames}.`;
          label.textContent = 'Calibrating';
        } else {
          status.textContent = 'Show your shoulders and hips clearly. Position is held while you are out of view.';
          label.textContent = 'You · not tracked';
        }
      }
    } catch (error) { stop(`Camera tracking stopped: ${error.message}. You can still spawn and hit balls.`); return; }
    timer = setTimeout(tick, 1000 / CONFIG.simulation.poseHz);
  }
  button.addEventListener('click', async () => {
    if (loading) return;
    if (active) { stop(); return; }
    loading = true; button.disabled = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost in a supported browser');
      status.textContent = 'Allow camera access, then stand where your whole upper body is visible.';
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      video.srcObject = stream; video.hidden = false; await video.play();
      status.textContent = 'Loading the pose tracker…';
      const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CONFIG.tracking.version}`;
      const { FilesetResolver, PoseLandmarker } = await import(`${base}/vision_bundle.mjs`);
      const wasm = await FilesetResolver.forVisionTasks(`${base}/wasm`);
      model = await PoseLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: CONFIG.tracking.visibility,
        minPosePresenceConfidence: CONFIG.tracking.visibility,
        minTrackingConfidence: CONFIG.tracking.visibility,
      });
      tracker.recenter(); lastFrame = -1; active = true;
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (active) stop('Camera disconnected. Re-enable it to track your position.'); });
      button.textContent = 'Disable camera'; button.disabled = false; recenter.disabled = false;
      tick();
    } catch (error) { stop(`Camera unavailable: ${error.message}. Allow access and retry; phone swings still work.`); }
    finally { loading = false; }
  });
  recenter.addEventListener('click', () => { tracker.recenter(); status.textContent = 'Stand still to set your new center position.'; });
  window.addEventListener('pagehide', () => stop());
}
