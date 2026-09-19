"""Dependency-free strict JSON/schema guardrails for the fixed design messages."""
import json
import math

SHOTS = {"dink", "drive", "drop", "lob", "smash", "serve", "mishit"}
ZONES = {"near_left", "near_right", "deep_left", "deep_right", "kitchen"}


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(_value):
        raise ValueError("Non-finite JSON number")
    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)


def is_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate_state(state):
    if not isinstance(state, dict):
        raise ValueError("game_state must be an object")
    score = state.get("score")
    if not isinstance(score, list) or len(score) != 2 or any(type(x) is not int or x < 0 for x in score):
        raise ValueError("score must be two nonnegative integers")
    if state.get("serving_team") not in {"A", "B"}:
        raise ValueError("game_state needs serving_team A or B")
    if type(state.get("server_number", 1)) is not int or state.get("server_number", 1) not in {1, 2}:
        raise ValueError("server_number must be 1 or 2")
    if state.get("scoring_mode", "singles") not in {"singles", "doubles"}:
        raise ValueError("Unsupported scoring mode")
    return state


def validate_classification(value):
    if not isinstance(value, dict) or set(value) != {"shot", "target_zone", "confidence"}:
        raise ValueError("Classification must have exactly shot, target_zone, confidence")
    if (not isinstance(value["shot"], str) or not isinstance(value["target_zone"], str)
            or value["shot"] not in SHOTS or value["target_zone"] not in ZONES):
        raise ValueError("Unknown shot or target zone")
    if not is_number(value["confidence"]) or not 0 <= value["confidence"] <= 1:
        raise ValueError("confidence must be a finite number in [0,1]")
    return value


def validate_ruling(value, state, rule_ids):
    expected = {"type", "fault", "player", "rule", "explanation", "score", "side_out"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Ruling does not match the exact section-3 schema")
    if value["type"] != "ruling" or type(value["fault"]) is not bool or type(value["side_out"]) is not bool:
        raise ValueError("Invalid ruling type or booleans")
    if value["player"] not in ("A", "B", None):
        raise ValueError("Invalid player")
    if not isinstance(value["rule"], str) or value["rule"] not in (set(rule_ids) | {"none"}):
        raise ValueError("Unrecognized rule ID")
    if (not isinstance(value["explanation"], str) or not value["explanation"].strip()
            or len(value["explanation"].split()) >= 30):
        raise ValueError("Explanation must be nonempty and under 30 words")
    score = value["score"]
    if not isinstance(score, list) or len(score) != 2 or any(type(x) is not int or x < 0 for x in score):
        raise ValueError("Score must be two nonnegative integers")
    if not value["fault"]:
        if value["player"] is not None or value["rule"] != "none" or value["side_out"] or score != state["score"]:
            raise ValueError("No-fault/replay must not mutate score or service")
    else:
        if value["player"] is None or value["rule"] == "none":
            raise ValueError("Fault needs a player and recognized rule")
        # Basic score-safety validation, independent of adjudicating which fault occurred.
        delta = [new - old for new, old in zip(score, state["score"])]
        if delta not in ([0, 0], [1, 0], [0, 1]):
            raise ValueError("A ruling cannot remove points or award multiple points")
        serving = 0 if state["serving_team"] == "A" else 1
        if delta[1 - serving] != 0 or (value["side_out"] and any(delta)):
            raise ValueError("Invalid side-out scoring transition")
    return value


def validate_swing(swing):
    expected = {"t", "type", "peak_g", "pitch", "roll", "yaw_rate", "duration_ms"}
    if not isinstance(swing, dict) or set(swing) != expected or swing["type"] != "swing":
        raise ValueError("Swing must match the exact section-3 schema")
    if any(not is_number(swing[key]) for key in expected - {"type"}):
        raise ValueError("Swing fields must be finite numbers")
    if swing["peak_g"] < 0 or swing["duration_ms"] <= 0:
        raise ValueError("Invalid acceleration or duration")
    return swing
