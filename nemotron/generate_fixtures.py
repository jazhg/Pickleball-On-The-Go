"""Author synthetic scenarios. Expectations below are separate, provisional assertions.

No official rulebook text or numbered citation is generated here. Do not regenerate
over human reviews: this script refuses to replace an existing fixture directory.
"""
import json
from pathlib import Path


def serve(**changes):
    return dict(event="serve", player="A", method="volley", foot_legal=True,
                contact_above_waist=False, upward_motion=True, paddle_below_wrist=True, **changes)


def valid_serve(**changes):
    result = serve()
    result.update(changes)
    return result


def opening():
    return [valid_serve(), {"event": "serve_landing", "player": "B", "correct_service_court": True},
            {"event": "hit", "player": "B", "id": "return", "volley": False},
            {"event": "bounce", "player": "A"}]


def hit(player="A", **changes):
    return dict(event="hit", player=player, id="v1", volley=True, **changes)


def momentum(**changes):
    return dict(event="momentum", player="A", volley_id="v1", touches_kitchen=True, **changes)


def make_cases():
    cases = []
    state = {"score": [6, 4], "serving_team": "A", "server_number": 1, "scoring_mode": "singles"}

    def add(category, name, events, loser=None, key="none", score=(6, 4), side_out=False,
            current=None, momentum_case=False, next_server=None, note=""):
        n = len(cases) + 1
        for t, event in enumerate(events):
            event["t"] = 1000 + t * 300
        prototypes = [
            ("dink", 1.8, 15, .7, "rally"), ("drive", 3.7, 10, 1.0, "rally"),
            ("drop", 1.9, 17, .7, "rally"), ("lob", 2.4, 55, 1.0, "rally"),
            ("smash", 4.8, -10, 1.7, "rally"), ("serve", 3.1, 15, .8, "serve"),
            ("mishit", .8, 0, 1.0, "rally")]
        label, peak, pitch, wrist, phase = prototypes[(n - 1) % len(prototypes)]
        game_state = dict(current or state)
        cases.append({
            "id": f"{n:02d}_{category}", "category": category, "name": name,
            "source": "Hand-authored synthetic scenario; NOT verified against rulebook examples.",
            "momentum_case": momentum_case,
            "game_state": game_state, "events": events,
            "expected_ruling": {"type": "ruling", "fault": loser is not None, "player": loser,
                "rule": "TODO:human-reviewed-citation" if loser else "none",
                "explanation": "Provisional scenario expectation; two human reviews required.",
                "score": list(score), "side_out": side_out},
            "expected_rule_key": key,
            "expected_next_server": list(next_server) if next_server else None,
            "review": {"status": "TODO", "reviewers": [], "rulebook_edition": "TODO",
                "source_page": "TODO", "notes": note or "Verify every verdict and scoring assumption independently."},
            "classifier_example": {"provenance": "synthetic_smoke_only", "expected_shot": label,
                "swing": {"t": 1234567 + n, "type": "swing", "peak_g": peak, "pitch": pitch,
                          "roll": -6.1 if n % 2 else 6.1, "yaw_rate": 220, "duration_ms": 310},
                "pose": {"wrist_h": wrist, "phase": phase, "court_y": 2.9}},
        })

    add("serve", "Legal volley serve", [valid_serve(), {"event": "serve_landing", "player": "B"}])
    add("serve", "Contact above waist", [valid_serve(contact_above_waist=True)], "A", "serve_height", side_out=True)
    add("serve", "No upward swing", [valid_serve(upward_motion=False)], "A", "serve_motion", side_out=True)
    add("serve", "Paddle above wrist", [valid_serve(paddle_below_wrist=False)], "A", "serve_paddle", side_out=True)
    add("serve", "Foot position illegal", [valid_serve(foot_legal=False)], "A", "serve_foot", side_out=True)
    add("serve", "Wrong diagonal service court", [valid_serve(), {"event": "serve_landing", "player": "B", "correct_service_court": False}], "A", "serve_target", side_out=True)
    add("serve", "Serve lands in kitchen", [valid_serve(), {"event": "serve_landing", "player": "B", "in_kitchen": True}], "A", "serve_kitchen", side_out=True)
    add("serve", "Legal drop serve ignores volley motion predicates", [valid_serve(method="drop", upward_motion=False, paddle_below_wrist=False)], note="Check drop-serve exceptions and ensure the dropped-ball conditions are sufficient.")
    add("serve", "Drop serve still has illegal foot position", [valid_serve(method="drop", foot_legal=False)], "A", "serve_foot", side_out=True)
    add("serve", "Volley serve exactly at supplied waist boundary", [valid_serve(contact_above_waist=False)])

    add("nvz", "Volley while standing in kitchen", opening() + [hit(in_kitchen=True)], "A", "nvz_volley", side_out=True)
    add("nvz", "Volley while touching kitchen line", opening() + [hit(touching_line=True)], "A", "nvz_volley", side_out=True)
    add("nvz", "Groundstroke in kitchen is allowed", opening() + [{"event": "hit", "player": "A", "id": "g1", "volley": False, "in_kitchen": True}])
    add("nvz", "Volley outside kitchen", opening() + [hit(in_kitchen=False)])
    add("nvz", "Momentum enters kitchen immediately", opening() + [hit(), momentum()], "A", "nvz_momentum", side_out=True, momentum_case=True)
    add("nvz", "Momentum contact after rally-end marker", opening() + [hit(), {"event": "rally_end"}, momentum()], "A", "nvz_momentum", side_out=True, momentum_case=True, note="Verify continued momentum liability after the ball becomes dead; marker does not assign a winner.")
    add("nvz", "Player regains balance before entry", opening() + [hit(), momentum(regained_balance=True)], momentum_case=True)
    add("nvz", "Momentum stops outside kitchen", opening() + [hit(), {"event": "momentum", "player": "A", "volley_id": "v1", "touches_kitchen": False}], momentum_case=True)
    add("nvz", "Other side's volley momentum fault", opening() + [hit(player="B"), {"event": "momentum", "player": "B", "volley_id": "v1", "touches_kitchen": True}], "B", "nvz_momentum", score=(7, 4), momentum_case=True)
    add("nvz", "Unlinked momentum requires no automatic penalty", opening() + [hit(), {"event": "momentum", "player": "A", "volley_id": "unknown", "touches_kitchen": True}], momentum_case=True, note="Insufficient causal linkage: provisional no-fault. Human review may prefer an explicit replay state.")
    add("nvz", "Receiver kitchen volley after initial bounces", opening() + [hit(player="B", in_kitchen=True)], "B", "nvz_volley", score=(7, 4))
    add("nvz", "Walk through kitchen without a volley", opening() + [{"event": "position", "player": "A", "in_kitchen": True}])

    add("two_bounce", "Receiver volleys the serve", [valid_serve(), hit(player="B")], "B", "two_bounce", score=(7, 4))
    add("two_bounce", "Server volleys the return", opening()[:-1] + [hit()], "A", "two_bounce", side_out=True)
    add("two_bounce", "Both initial bounces then server volley", opening() + [hit()])
    add("two_bounce", "Both initial bounces then receiver volley", opening() + [hit(player="B")])
    add("two_bounce", "Groundstroke return before server bounce", opening()[:-1])
    add("two_bounce", "Two receiving-side bounces cannot replace server bounce", opening()[:-1] + [{"event": "bounce", "player": "B"}, hit()], "A", "two_bounce", side_out=True, note="Evaluate initial-bounce accounting only; repeated bounces should also be reviewed for an earlier terminal fault.")
    add("two_bounce", "Groundstroke rally after both bounces", opening() + [{"event": "hit", "player": "A", "id": "g2", "volley": False}])
    add("two_bounce", "New rally starts with fresh bounce counters", [valid_serve(), hit(player="B")], "B", "two_bounce", score=(7, 4))
    add("two_bounce", "Serving team B must also wait for its return bounce", [{"event": "serve", "player": "B"}, {"event": "serve_landing", "player": "A"}, {"event": "hit", "player": "A", "id": "r", "volley": False}, hit(player="B")], "B", "two_bounce", current={**state, "serving_team": "B"}, side_out=True)
    add("two_bounce", "Serving team B after both bounces", [{"event": "serve", "player": "B"}, {"event": "serve_landing", "player": "A"}, {"event": "hit", "player": "A", "id": "r", "volley": False}, {"event": "bounce", "player": "B"}, hit(player="B")], current={**state, "serving_team": "B"})

    def ending(player):
        return opening() + [{"event": "fault", "player": player, "cause": "ball_out"}]

    add("scoring", "Singles serving A wins a point", ending("B"), "B", "rally_outcome", score=(7, 4), next_server=("A", 1))
    add("scoring", "Singles serving A loses service", ending("A"), "A", "rally_outcome", side_out=True, next_server=("B", 1))
    add("scoring", "Singles serving B wins a point", ending("A"), "A", "rally_outcome", score=(6, 5), current={**state, "serving_team": "B"}, next_server=("B", 1))
    add("scoring", "Singles serving B loses service", ending("B"), "B", "rally_outcome", side_out=True, current={**state, "serving_team": "B"}, next_server=("A", 1))
    add("scoring", "Doubles server one loses; server two serves", ending("A"), "A", "rally_outcome", current={**state, "scoring_mode": "doubles"}, next_server=("A", 2))
    add("scoring", "Doubles server two loses; side out", ending("A"), "A", "rally_outcome", side_out=True, current={**state, "scoring_mode": "doubles", "server_number": 2}, next_server=("B", 1))
    add("scoring", "Doubles first server wins; same server", ending("B"), "B", "rally_outcome", score=(7, 4), current={**state, "scoring_mode": "doubles"}, next_server=("A", 1))
    add("scoring", "Doubles second server wins; same server", ending("B"), "B", "rally_outcome", score=(7, 4), current={**state, "scoring_mode": "doubles", "server_number": 2}, next_server=("A", 2))
    add("scoring", "Doubles initial server encoded as server two", ending("A"), "A", "rally_outcome", score=(0, 0), side_out=True, current={**state, "score": [0, 0], "scoring_mode": "doubles", "server_number": 2}, next_server=("B", 1))
    add("scoring", "No rally fault means no score mutation", opening(), current={**state, "scoring_mode": "doubles"}, next_server=("A", 1))

    add("multi", "Illegal serve occurs before receiver early volley", [valid_serve(contact_above_waist=True), hit(player="B")], "A", "serve_height", side_out=True)
    add("multi", "Early volley also touches kitchen", [valid_serve(), hit(player="B", in_kitchen=True)], "B", "two_bounce", score=(7, 4), note="Two conditions on one event: provisional two-bounce branch precedence is not an official precedence rule.")
    add("multi", "Kitchen volley occurs before later terminal out", opening() + [hit(in_kitchen=True), {"event": "fault", "player": "B", "cause": "out"}], "A", "nvz_volley", side_out=True)
    add("multi", "Linked momentum occurs before opponent fault", opening() + [hit(), momentum(), {"event": "fault", "player": "B"}], "A", "nvz_momentum", side_out=True)
    add("multi", "Legal kitchen groundstroke followed by opponent out", opening() + [{"event": "hit", "player": "A", "id": "g", "volley": False, "in_kitchen": True}, {"event": "fault", "player": "B"}], "B", "rally_outcome", score=(7, 4))
    add("multi", "Two simultaneous serve predicates need citation review", [valid_serve(contact_above_waist=True, foot_legal=False)], "A", "serve_foot", side_out=True, note="Foot branch wins internally; official single-citation choice remains TODO.")
    add("multi", "Regained balance clears momentum; subsequent fault remains", opening() + [hit(), momentum(regained_balance=True), {"event": "fault", "player": "B"}], "B", "rally_outcome", score=(7, 4))
    add("multi", "Server two commits initial bounce fault", opening()[:-1] + [hit(in_kitchen=True)], "A", "two_bounce", side_out=True, current={**state, "scoring_mode": "doubles", "server_number": 2}, note="Review simultaneous two-bounce/NVZ citation and doubles rotation independently.")
    assert len(cases) == 50
    return cases


if __name__ == "__main__":
    destination = Path(__file__).parent / "fixtures"
    destination.mkdir(exist_ok=True)
    if list(destination.glob("*.json")):
        raise SystemExit("Refusing to overwrite existing fixtures or human reviews.")
    for case in make_cases():
        (destination / (case["id"] + ".json")).write_text(json.dumps(case, indent=2) + "\n")
    print("Wrote 50 provisional synthetic fixtures; citations and two reviews remain TODO.")
