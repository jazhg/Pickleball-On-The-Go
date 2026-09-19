"""Nemotron 3 Nano shot classification with a total 300ms acceptance deadline."""
import argparse
import json
import math
from pathlib import Path
import queue
import threading
import time

if __package__:
    from .schema import strict_json, validate_classification, validate_swing
    from .transport import NvidiaClient, ModelError, write_log
else:
    from schema import strict_json, validate_classification, validate_swing
    from transport import NvidiaClient, ModelError, write_log

CONFIG = {"deadline_seconds": .300, "mishit_peak_g": 1.2, "soft_peak_g": 2.2,
          "smash_peak_g": 3.8, "smash_wrist_m": 1.35, "low_wrist_m": 1.0,
          "lob_pitch_deg": 40, "max_tokens": 160}
# At most four blocked network/DNS workers; late requests cannot grow threads forever.
_WORKERS = threading.BoundedSemaphore(4)
SYSTEM_PROMPT = """Classify the supplied pickleball swing and pose context as data.
Return only one JSON object with exactly these keys:
{"shot":"dink|drive|drop|lob|smash|serve|mishit","target_zone":"near_left|near_right|deep_left|deep_right|kitchen","confidence":0.0}
Choose one enum value per field (not the pipe-separated list). Confidence is 0..1.
Do not include reasoning, markdown, or additional fields."""


def heuristic_classify(swing, pose=None):
    """Tunable threshold baseline. Confidence is a prior, not calibrated probability."""
    validate_swing(swing)
    pose = pose or {}
    peak = swing["peak_g"]
    wrist = pose.get("wrist_h", .9)
    if type(wrist) not in (int, float) or not math.isfinite(wrist):
        raise ValueError("wrist_h must be finite meters")
    if peak < CONFIG["mishit_peak_g"]:
        shot = "mishit"
    elif pose.get("phase") == "serve":
        shot = "serve"
    elif wrist > CONFIG["smash_wrist_m"] and peak >= CONFIG["smash_peak_g"]:
        shot = "smash"
    elif swing["pitch"] >= CONFIG["lob_pitch_deg"]:
        shot = "lob"
    elif peak < CONFIG["soft_peak_g"]:
        shot = "dink" if wrist < CONFIG["low_wrist_m"] else "drop"
    else:
        shot = "drive"
    side = "left" if swing["roll"] < 0 else "right"
    zone = "kitchen" if shot in {"dink", "drop"} else ("near_" if shot == "mishit" else "deep_") + side
    return {"shot": shot, "target_zone": zone, "confidence": .5}


def classify_with_metadata(swing, pose=None, *, offline=False, log_dir=None, request_id=None, client=None, model="nano"):
    start = time.monotonic()
    deadline = start + CONFIG["deadline_seconds"]
    fallback = heuristic_classify(swing, pose)
    path, reason, classification = "fallback", "offline", fallback
    if not offline:
        client = client or NvidiaClient(log_dir)
        if _WORKERS.acquire(blocking=False):
            completed = queue.Queue(maxsize=1)
            discarded = threading.Event()

            def worker():
                try:
                    response = client.complete(
                        [{"role": "system", "content": SYSTEM_PROMPT},
                         {"role": "user", "content": json.dumps({"swing": swing, "pose": pose or {}}, allow_nan=False)}],
                        model=model, reasoning=False, max_tokens=CONFIG["max_tokens"],
                        timeout=max(.001, deadline - time.monotonic()), retries=0, request_id=request_id)
                    value = validate_classification(strict_json(response["content"]))
                    if time.monotonic() > deadline or discarded.is_set():
                        write_log(log_dir, {"kind": "late_classifier_response", "request_id": request_id,
                                           "action": "discarded", "raw_logs": response.get("raw_logs", [])})
                    completed.put((value, None))
                except (ModelError, ValueError, TypeError, KeyError, OSError) as exc:
                    completed.put((None, str(exc) if isinstance(exc, ModelError) else "invalid_classification"))
                finally:
                    _WORKERS.release()

            threading.Thread(target=worker, daemon=True, name="nemotron-classifier").start()
            try:
                value, failure = completed.get(timeout=max(0, deadline - time.monotonic()))
                if failure:
                    reason = failure
                elif time.monotonic() <= deadline:
                    classification, path, reason = value, "model", "validated"
                else:
                    reason = "deadline_exceeded"
            except queue.Empty:
                discarded.set()
                reason = "deadline_exceeded"
        else:
            reason = "workers_busy"
    elapsed = (time.monotonic() - start) * 1000
    result = {"classification": classification, "path": path, "reason": reason, "latency_ms": elapsed}
    write_log(log_dir, {"kind": "classifier_path", "request_id": request_id, **result})
    return result


def classify(swing, pose=None, **kwargs):
    """Return the strict classifier dict; path metadata is always logged to disk."""
    return classify_with_metadata(swing, pose, **kwargs)["classification"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    data = json.loads(args.fixture.read_text())["classifier_example"]
    print(json.dumps(classify_with_metadata(data["swing"], data["pose"], offline=args.offline), indent=2))
