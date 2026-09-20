#!/usr/bin/env python3
"""Line-delimited JSON bridge between the Node relay and the Nemotron package.

Reads one JSON request per line on stdin, writes one JSON response per line on
stdout. Ops: ping, classify, referee, coach. Never logs or echoes NVIDIA_API_KEY.

Offline (default) paths: heuristic classifier + provisional state-machine
referee. Live model calls happen only when NEMOTRON_LIVE=1 AND NVIDIA_API_KEY
is set in this process's environment.
"""
import json
import os
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from baseline import adjudicate  # noqa: E402
from coach import coach_with_metadata  # noqa: E402
from classifier import classify_with_metadata, heuristic_classify  # noqa: E402
from referee import referee_with_metadata  # noqa: E402
from schema import SHOTS, ZONES  # noqa: E402


def live_enabled():
    return os.environ.get("NEMOTRON_LIVE") == "1" and bool(os.environ.get("NVIDIA_API_KEY"))


def op_ping(_req):
    return {"op": "pong", "live": live_enabled()}


def op_classify(req):
    swing, pose = req["swing"], req.get("pose") or {}
    if not live_enabled():
        start = time.monotonic()
        classification = heuristic_classify(swing, pose)
        return {"op": "classify", "classification": classification, "path": "heuristic",
                "reason": "offline", "latency_ms": (time.monotonic() - start) * 1000}
    meta = classify_with_metadata(swing, pose, offline=False, model="lightning")
    return {"op": "classify", "classification": meta["classification"], "path": meta["path"],
            "reason": meta["reason"], "latency_ms": meta["latency_ms"]}


def wire_ruling_from_baseline(events, game_state):
    """Provisional state-machine ruling, shaped as a section-3 wire ruling.

    The baseline's internal rule_key labels a branch, not a rulebook citation;
    it is surfaced as rule only while rules.json is unreviewed, and the
    response marks provisional=true so the HUD can label it honestly.
    """
    out = adjudicate(events, game_state)
    ruling = dict(out["ruling"])
    rule_key = out.get("rule_key", "none")
    ruling["rule"] = rule_key if rule_key != "none" else "none"
    return ruling, out


def op_referee(req):
    events, game_state = req["events"], req["game_state"]
    if not live_enabled():
        ruling, out = wire_ruling_from_baseline(events, game_state)
        return {"op": "referee", "ruling": ruling, "path": "baseline", "reason": "offline",
                "provisional": True, "rule_key": out.get("rule_key"),
                "next_state": out.get("next_state")}
    meta = referee_with_metadata(events, game_state, offline=False, model="lightning")
    if meta["path"] == "model":
        return {"op": "referee", "ruling": meta["ruling"], "path": "model",
                "reason": meta["reason"], "provisional": False,
                "latency_ms": meta["latency_ms"]}
    # Model path fell back (bad rules, API error): keep the game ruling with the
    # provisional state machine and say exactly why.
    ruling, out = wire_ruling_from_baseline(events, game_state)
    return {"op": "referee", "ruling": ruling, "path": "baseline",
            "reason": "model_fallback:" + str(meta.get("reason", "unknown")),
            "provisional": True, "rule_key": out.get("rule_key"),
            "next_state": out.get("next_state")}


def op_coach(req):
    if not live_enabled():
        return {"op": "coach", "tip": None, "reason": "offline"}
    meta = coach_with_metadata(req["shot"], req.get("confidence"), req.get("dtw_distance"), req["swing"])
    return {"op": "coach", "tip": meta["tip"], "reason": meta["reason"], "latency_ms": meta["latency_ms"]}


OPS = {"ping": op_ping, "coach": op_coach, "classify": op_classify, "referee": op_referee}


def respond(payload):
    sys.stdout.write(json.dumps(payload, allow_nan=False) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            respond({"op": "error", "error": "invalid_json"})
            continue
        try:
            handler = OPS.get(req.get("op"))
            if handler is None:
                respond({"op": "error", "error": "unknown_op"})
            else:
                respond(handler(req))
        except Exception as exc:  # never let one bad request kill the bridge
            respond({"op": "error", "error": "internal", "detail": type(exc).__name__})
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
