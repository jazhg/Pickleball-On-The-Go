"""Author 10 provisional fixtures for real two-seat (A/B) doubles-style play.

Same schema as generate_fixtures.py. "player" is the seat/team that served or faulted.
Rule citations stay placeholders; expectations are synthetic and need two human reviews.
Refuses to overwrite any existing fixture file.
"""
import json
from pathlib import Path

try:
    from .generate_fixtures import hit, opening, valid_serve
except ImportError:
    from generate_fixtures import hit, opening, valid_serve

PLACEHOLDER = "TODO:human-reviewed-citation"
PROTOTYPES = [("dink", 1.8, 15, .7, "rally"), ("drive", 3.7, 10, 1.0, "rally"),
              ("drop", 1.9, 17, .7, "rally"), ("lob", 2.4, 55, 1.0, "rally"),
              ("smash", 4.8, -10, 1.7, "rally"), ("serve", 3.1, 15, .8, "serve"),
              ("mishit", .8, 0, 1.0, "rally")]


def state(score, team, number):
    return {"score": list(score), "serving_team": team, "server_number": number, "scoring_mode": "doubles"}


def rally_b_serving():
    return [valid_serve(player="B"), {"event": "serve_landing", "player": "A", "correct_service_court": True},
            {"event": "hit", "player": "A", "id": "return", "volley": False},
            {"event": "bounce", "player": "B"}]


def make_cases():
    cases = []

    def add(name, current, events, loser, key, score, side_out, next_server, note):
        n = 51 + len(cases)
        for t, event in enumerate(events):
            event["t"] = 1000 + t * 300
        label, peak, pitch, wrist, phase = PROTOTYPES[(n - 1) % len(PROTOTYPES)]
        cases.append({
            "id": f"{n}_multiplayer", "category": "multiplayer", "name": name,
            "source": "Hand-authored synthetic scenario; NOT verified against rulebook examples.",
            "momentum_case": False, "game_state": current, "events": events,
            "expected_ruling": {"type": "ruling", "fault": loser is not None, "player": loser,
                                "rule": PLACEHOLDER if loser else "none",
                                "explanation": "Provisional scenario expectation; two human reviews required.",
                                "score": list(score), "side_out": side_out},
            "expected_rule_key": key, "expected_next_server": list(next_server),
            "review": {"status": "TODO", "reviewers": [], "rulebook_edition": "TODO",
                       "source_page": "TODO", "notes": note},
            "classifier_example": {"provenance": "synthetic_smoke_only", "expected_shot": label,
                "swing": {"t": 1234567 + n, "type": "swing", "peak_g": peak, "pitch": pitch,
                          "roll": -6.1 if n % 2 else 6.1, "yaw_rate": 220, "duration_ms": 310},
                "pose": {"wrist_h": wrist, "phase": phase, "court_y": 2.9}}})

    ok = "Provisional multiplayer expectation; rule citation is a placeholder. Verify independently."
    add("Opening service: first server faults, immediate side-out", state((0, 0), "A", 2),
        [valid_serve(foot_legal=False)], "A", "serve_foot", (0, 0), True, ("B", 1),
        "Opening-service exception: the first side-out of the game hands serve over after one fault (server_number 2 at 0-0). " + ok)
    add("Opening service: first server wins the point and keeps serve", state((0, 0), "A", 2),
        opening() + [{"event": "fault", "player": "B", "cause": "ball_out"}], "B", "rally_outcome", (1, 0), False, ("A", 2),
        "Opening-service exception: the lone server continues serving after scoring. " + ok)
    add("Doubles: server 1 faults, serve passes to partner without score change", state((3, 2), "A", 1),
        opening() + [{"event": "fault", "player": "A"}], "A", "rally_outcome", (3, 2), False, ("A", 2),
        "Service rotation 1 -> 2. " + ok)
    add("Doubles: second server faults, side-out with no score change", state((3, 2), "A", 2),
        opening() + [{"event": "fault", "player": "A"}], "A", "rally_outcome", (3, 2), True, ("B", 1),
        "Second-server fault flips serve to the other team as server 1. " + ok)
    add("Doubles: second server wins the rally and scores", state((3, 2), "A", 2),
        opening() + [{"event": "fault", "player": "B"}], "B", "rally_outcome", (4, 2), False, ("A", 2),
        "Server number stays 2 after a point. " + ok)
    add("Doubles: first server wins the rally and keeps server number 1", state((3, 2), "A", 1),
        opening() + [{"event": "fault", "player": "B"}], "B", "rally_outcome", (4, 2), False, ("A", 1),
        ok)
    add("Doubles: receiving team faults after a side-out, new server scores", state((3, 2), "B", 1),
        rally_b_serving() + [{"event": "fault", "player": "A"}], "A", "rally_outcome", (3, 3), False, ("B", 1),
        "Team B is serving; score index 1 is team B. " + ok)
    add("Doubles NVZ foot fault by the receiving team's player", state((2, 4), "B", 1),
        rally_b_serving() + [{"event": "hit", "player": "B", "id": "g", "volley": False},
                             hit(player="A", in_kitchen=True)], "A", "nvz_volley", (2, 5), False, ("B", 1),
        "Foot in the kitchen on a volley: receiving-team fault awards the server a point. " + ok)
    add("Doubles NVZ foot fault by second server ends the service turn", state((5, 5), "A", 2),
        opening() + [hit(touching_line=True)], "A", "nvz_volley", (5, 5), True, ("B", 1),
        "Kitchen-line volley by the serving team's second server causes side-out. " + ok)
    add("Doubles: serving partner volleys before both initial bounces", state((0, 3), "A", 1),
        opening()[:-1] + [hit()], "A", "two_bounce", (0, 3), False, ("A", 2),
        "Two-bounce fault by server 1 moves serve to server 2 without side-out. " + ok)
    assert len(cases) == 10
    return cases


if __name__ == "__main__":
    destination = Path(__file__).parent / "fixtures"
    for case in make_cases():
        path = destination / (case["id"] + ".json")
        if path.exists():
            raise SystemExit(f"Refusing to overwrite {path.name}.")
        path.write_text(json.dumps(case, indent=2) + "\n")
    print("Wrote 10 provisional multiplayer fixtures; citations and two reviews remain TODO.")
