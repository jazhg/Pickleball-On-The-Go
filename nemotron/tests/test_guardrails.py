"""Offline tests for score safety, JSON attacks, rate limits and deadline behavior."""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from nemotron.classifier import classify_with_metadata, heuristic_classify
from nemotron.metrics import referee_metrics
from nemotron.referee import referee, referee_with_metadata, replay_ruling
from nemotron.schema import strict_json, validate_classification, validate_ruling
from nemotron.transport import NvidiaClient, ModelError, retry_delay

ROOT = Path(__file__).resolve().parents[1]
STATE = {"score": [6, 4], "serving_team": "A", "server_number": 1, "scoring_mode": "singles"}
SWING = {"t": 123, "type": "swing", "peak_g": 1.8, "pitch": 12, "roll": -2,
         "yaw_rate": 220, "duration_ms": 310}


class StubClient:
    def __init__(self, content, delay=0):
        self.content, self.delay, self.calls = content, delay, []

    def complete(self, messages, **kwargs):
        self.calls.append(kwargs)
        time.sleep(self.delay)
        return {"content": self.content, "raw_logs": []}


class Response(io.BytesIO):
    status = 200


class FakeOpener:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def open(self, req, timeout):
        self.calls.append((req, timeout))
        outcome = self.responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return Response(outcome)


def envelope(content, finish="stop"):
    return json.dumps({"choices": [{"message": {"content": content}, "finish_reason": finish}]}).encode()


class GuardrailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.log_dir = Path(self.tmp.name)
        # Explicitly synthetic test data, NEVER official rule text or a citation.
        rule_data = {"edition": "TEST_ONLY", "source_url": "TEST_ONLY", "reviewed_by": ["test one", "test two"],
                     "sections": [{"topic": topic, "text": "Synthetic unit-test passage only.",
                                   "rule_ids": ["TEST_ONLY"]}
                                  for topic in ("two_bounce", "non_volley_zone", "serve", "scoring")]}
        self.rules = self.log_dir / "test_rules.json"
        self.rules.write_text(json.dumps(rule_data))

    def tearDown(self):
        self.tmp.cleanup()

    def test_json_rejects_duplicates_fences_and_nonfinite(self):
        for value in ('{"fault":true,"fault":false}', '```json\n{}\n```', '{"x":NaN}', '{"x":Infinity}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                strict_json(value)

    def test_classification_rejects_invalid_enums_confidence_and_extras(self):
        good = {"shot": "dink", "target_zone": "kitchen", "confidence": .9}
        for value in ({**good, "confidence": True}, {**good, "confidence": 1.01},
                      {**good, "confidence": float("nan")}, {**good, "shot": "magic"},
                      {**good, "shot": []}, {**good, "extra": 1}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_classification(value)

    def test_ruling_rejects_boolean_scores_unknown_citations_and_mutation(self):
        good = replay_ruling(STATE)
        for value in ({**good, "score": [True, 4]}, {**good, "score": [7, 4]},
                      {**good, "side_out": True}, {**good, "rule": "imagined"},
                      {**good, "player": "A"}, {**good, "fault": 0},
                      {**good, "extra": 0}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_ruling(value, STATE, {"TEST_ONLY"})

    def test_unknown_citation_and_malformed_json_preserve_score(self):
        values = ["not JSON", json.dumps({**replay_ruling(STATE), "fault": True,
                  "player": "A", "rule": "UNKNOWN", "score": [99, 99]})]
        for value in values:
            result = referee_with_metadata([], STATE, client=StubClient(value),
                     rules_path=self.rules, log_dir=self.log_dir)
            self.assertEqual(result["path"], "fallback")
            self.assertEqual(result["ruling"], replay_ruling(STATE))

    def test_referee_returns_exact_wire_schema_and_defaults_to_super_reasoning(self):
        client = StubClient(json.dumps(replay_ruling(STATE)))
        ruling = referee([], STATE, client=client, rules_path=self.rules, log_dir=self.log_dir)
        self.assertEqual(ruling, replay_ruling(STATE))
        self.assertEqual(client.calls[0]["model"], "super")
        self.assertTrue(client.calls[0]["reasoning"])

    def test_placeholders_never_reach_model(self):
        client = StubClient("{}")
        result = referee_with_metadata([], STATE, client=client, log_dir=self.log_dir)
        self.assertEqual(client.calls, [])
        self.assertEqual(result["path"], "fallback")

    def test_classifier_uses_nano_reasoning_off_and_accepts_valid_json(self):
        value = {"shot": "drop", "target_zone": "kitchen", "confidence": .8}
        client = StubClient(json.dumps(value))
        result = classify_with_metadata(SWING, client=client, log_dir=self.log_dir)
        self.assertEqual(result["classification"], value)
        self.assertEqual(result["path"], "model")
        self.assertEqual(client.calls[0]["model"], "nano")
        self.assertFalse(client.calls[0]["reasoning"])
        self.assertEqual(client.calls[0]["retries"], 0)

    def test_classifier_total_deadline_does_not_wait_for_late_worker(self):
        client = StubClient('{"shot":"lob","target_zone":"deep_left","confidence":1}', delay=.42)
        start = time.monotonic()
        result = classify_with_metadata(SWING, client=client, log_dir=self.log_dir)
        elapsed = time.monotonic() - start
        self.assertLess(elapsed, .38)  # 300ms deadline plus conservative CI scheduler margin.
        self.assertEqual(result["path"], "fallback")
        self.assertEqual(result["reason"], "deadline_exceeded")
        self.assertEqual(result["classification"], heuristic_classify(SWING))
        time.sleep(.16)  # Allow the late worker to prove it logs and discards.
        logs = [json.loads(p.read_text()) for p in self.log_dir.glob("*.json")]
        self.assertTrue(any(r.get("kind") == "late_classifier_response" for r in logs))

    def test_malformed_classifier_falls_back_and_logs_path(self):
        result = classify_with_metadata(SWING, client=StubClient("```json {} ```"), log_dir=self.log_dir)
        self.assertEqual(result["classification"], heuristic_classify(SWING))
        self.assertEqual(result["reason"], "invalid_classification")
        self.assertTrue(any(json.loads(p.read_text()).get("kind") == "classifier_path" for p in self.log_dir.glob("*.json")))

    def test_unreviewed_citations_are_excluded_from_denominator(self):
        fixture = json.loads((ROOT / "fixtures/02_serve.json").read_text())
        metrics, _ = referee_metrics([(fixture, {"ruling": fixture["expected_ruling"], "path": "baseline"})])
        self.assertEqual(metrics["citation"], "N/A (0 eligible)")
        fixture["review"] = {"status": "reviewed", "reviewers": ["same", "same"]}
        metrics, _ = referee_metrics([(fixture, {"ruling": fixture["expected_ruling"], "path": "baseline"})])
        self.assertEqual(metrics["reviewed_verdict"], "N/A (0 eligible)")

    def test_rate_limit_retries_logs_every_raw_envelope_and_temperature_zero(self):
        throttled = HTTPError("https://integrate.api.nvidia.com/v1/chat/completions", 429,
                              "limited", {"Retry-After": "0.01"}, io.BytesIO(b'{"error":"limited TEST_SECRET"}'))
        opener = FakeOpener([throttled, envelope("{}")])
        sleeps = []
        with patch.dict(os.environ, {"NVIDIA_API_KEY": "TEST_SECRET"}):
            result = NvidiaClient(self.log_dir, opener=opener, sleep=sleeps.append).complete(
                [{"role": "user", "content": "test"}], model="super", reasoning=True,
                max_tokens=10, timeout=1, retries=2)
        self.assertEqual(sleeps, [.01])
        self.assertEqual(result["content"], "{}")
        records = [json.loads(p.read_text()) for p in self.log_dir.glob("*.json") if p != self.rules]
        self.assertEqual([r["http_status"] for r in sorted(records, key=lambda r: r["attempt"])], [429, 200])
        self.assertNotIn("TEST_SECRET", "".join(p.read_text() for p in self.log_dir.glob("*.json")))
        payload = json.loads(opener.calls[0][0].data)
        self.assertEqual(payload["temperature"], 0)
        self.assertTrue(payload["chat_template_kwargs"]["enable_thinking"])

    def test_missing_key_makes_no_network_request(self):
        opener = FakeOpener([])
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ModelError, "missing_api_key"):
            NvidiaClient(self.log_dir, opener=opener).complete([], model="nano", reasoning=False,
                         max_tokens=10, timeout=.3)
        self.assertEqual(opener.calls, [])

    def test_truncation_is_not_accepted_as_a_complete_model_reply(self):
        opener = FakeOpener([envelope("{}", "length")])
        with patch.dict(os.environ, {"NVIDIA_API_KEY": "TEST_SECRET"}), self.assertRaisesRegex(ModelError, "incomplete_response"):
            NvidiaClient(self.log_dir, opener=opener).complete([], model="nano", reasoning=False,
                         max_tokens=10, timeout=.3)

    def test_fixture_count_categories_momentum_and_provenance(self):
        from collections import Counter
        fixtures = [json.loads(p.read_text()) for p in (ROOT / "fixtures").glob("*.json")]
        self.assertEqual(len(fixtures), 50)
        self.assertEqual(Counter(f["category"] for f in fixtures),
                         {"serve": 10, "nvz": 12, "two_bounce": 10, "scoring": 10, "multi": 8})
        self.assertEqual(sum(f["momentum_case"] for f in fixtures if f["category"] == "nvz"), 6)
        self.assertTrue(all(f["classifier_example"]["provenance"] == "synthetic_smoke_only" for f in fixtures))


if __name__ == "__main__":
    unittest.main()
