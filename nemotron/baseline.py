"""Deliberately small PROVISIONAL event state machine, not an official rules engine.

Internal rule_key strings name branches; they are never rulebook citations.
Fixtures must be reviewed independently before treating accuracy as rules accuracy.
"""
from copy import deepcopy


def score_transition(state, loser):
    score = list(state["score"])
    serving = state["serving_team"]
    number = state.get("server_number", 1)
    side_out = False
    next_team, next_number = serving, number
    if loser != serving:
        score[0 if serving == "A" else 1] += 1
    elif state.get("scoring_mode", "singles") == "doubles" and number == 1:
        next_number = 2
    else:
        side_out = True
        next_team, next_number = ("B" if serving == "A" else "A"), 1
    return score, side_out, next_team, next_number


def adjudicate(events, state):
    """Return provisional ruling + next-server diagnostic without reading expected labels."""
    bounced = {"A": False, "B": False}
    volleys = {}
    fault = None
    for event in events:
        kind, player = event["event"], event.get("player")
        if kind == "serve":
            if not event.get("foot_legal", True):
                fault = (player, "serve_foot", "Server's foot position was marked illegal.")
            elif event.get("method", "volley") == "volley":
                if event.get("contact_above_waist", False):
                    fault = (player, "serve_height", "Volley serve contacted above the supplied waist estimate.")
                elif not event.get("upward_motion", True):
                    fault = (player, "serve_motion", "Volley serve lacked the supplied upward motion.")
                elif not event.get("paddle_below_wrist", True):
                    fault = (player, "serve_paddle", "Volley serve paddle was marked above the wrist.")
        elif kind == "serve_landing":
            if not event.get("correct_service_court", True):
                fault = (state["serving_team"], "serve_target", "Serve landed outside the supplied service target.")
            elif event.get("in_kitchen", False):
                fault = (state["serving_team"], "serve_kitchen", "Serve landed in the supplied non-volley zone.")
            else:
                bounced[player] = True
        elif kind == "bounce":
            bounced[player] = True
        elif kind == "hit":
            if event.get("volley", False):
                if not all(bounced.values()):
                    fault = (player, "two_bounce", "A volley occurred before both required initial bounces.")
                elif event.get("in_kitchen", False) or event.get("touching_line", False):
                    fault = (player, "nvz_volley", "Player volleyed while contacting the non-volley zone.")
                volleys[event["id"]] = player
        elif kind == "momentum":
            if (event.get("volley_id") in volleys
                    and volleys[event["volley_id"]] == player
                    and not event.get("regained_balance", False)
                    and event.get("touches_kitchen", False)):
                fault = (player, "nvz_momentum", "Momentum from the linked volley caused non-volley-zone contact.")
        elif kind == "fault":
            fault = (player, "rally_outcome", "The event log records a terminal rally fault.")
        if fault:
            break  # Earliest detectable fault wins; ambiguous simultaneous cases need review.
    ruling = {"type": "ruling", "fault": False, "player": None, "rule": "none",
              "explanation": "No fault detected by the provisional state machine.",
              "score": list(state["score"]), "side_out": False}
    next_state = deepcopy(state)
    rule_key = "none"
    if fault:
        loser, rule_key, explanation = fault
        score, side_out, serving, number = score_transition(state, loser)
        ruling.update(fault=True, player=loser, explanation=explanation,
                      score=score, side_out=side_out)
        # Missing citations are explicit. This object is only for offline evaluation;
        # it must never be sent as a validated model ruling.
        ruling["rule"] = "TODO:human-reviewed-citation"
        next_state.update(score=score, serving_team=serving, server_number=number)
    return {"ruling": ruling, "rule_key": rule_key, "next_state": next_state}
