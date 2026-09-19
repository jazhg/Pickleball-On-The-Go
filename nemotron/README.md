# Standalone Nemotron replay package

Python 3.9+ standard library only. No pip packages, game imports, GPU or phone
required. Fixtures and the replay harness were built and run before model calls.

```sh
cd nemotron
python3 eval.py
python3 -m unittest discover -s tests -v
python3 referee.py fixtures/15_nvz.json --offline
python3 classifier.py fixtures/03_serve.json --offline
```

`python eval.py` works when `python` points to Python 3. It prints the Markdown
report and writes `results.md`; the default run is completely offline. From the
repository root, `python3 -m nemotron.eval` also works.

The report contains measured state-machine agreement and measured safe-fallback
behavior. Model comparison rows stay **NOT RUN** until live calls occur. All 50
rally fixtures are provisional, all official citations require human review, and
the classifier examples bundled in those fixtures are synthetic smoke tests.
There are **zero human-captured swings and zero reviewed citations** in this
delivery. A perfect provisional regression score is not a validated rule score.
Each observed mismatch and each referee fallback is explained in `results.md`.

Live evaluation requires both a privately configured `NVIDIA_API_KEY` environment
variable and completed `rules.json` as described in [RULES_REVIEW.md](RULES_REVIEW.md).
No key is embedded, loaded from a browser, or written to reports. Use your shell
or secret manager to set it without committing it, then run:

```sh
python3 eval.py --live --limit 1 --output results-live-smoke.md
python3 eval.py --live --output results-live.md
```

A full run makes up to 200 referee requests (Nano/Super × reasoning off/on × 50)
plus 50 classifier requests, before retries. The referee defaults to Super with
reasoning enabled. Its transport retries 429 and transient 5xx errors twice,
respects capped Retry-After/exponential delays and shares a 20-second budget.
The latency budget allows backoff; it is not a claim of measured 1–3 second service.
Classifier requests always use Nano, reasoning disabled, temperature 0, and
160 output tokens. All referee configurations also use temperature 0 as requested,
even though NVIDIA's general model-card sampling recommendation differs.

The classifier accepts a model result only within 300ms total elapsed time,
including request setup, parsing and validation. It uses a bounded daemon worker
because socket timeouts alone do not bound DNS resolution. A late result is
discarded; the threshold prior remains. At most four requests can be outstanding.
No classifier retries extend the deadline. Path logging adds ordinary local disk
and scheduler overhead to the returned wall time. A late worker continues logging
while the process is alive; shutting down the process can cancel in-flight work.
Keep the host process alive if late-response audit capture is required.

Every received provider envelope, including HTTP errors, is logged before parsing,
along with model, reasoning mode, attempt, request ID and temperature. Per-call
classification/ruling, selected path, fallback reason and latency are logged in
separate records. `logs/` is local, ignored by Git, and never pruned automatically.
Credentials/authorization headers are not logged; echoed API keys are redacted.
Redirects are rejected so a credential cannot be sent to another host.

```python
from nemotron.referee import referee, referee_with_metadata
from nemotron.classifier import classify, heuristic_classify

# referee(events, game_state) returns exactly the section-3 ruling shape.
# classify(swing, pose) returns exactly shot/target_zone/confidence.
# *_with_metadata also returns the logged path, reason and latency.
```

`game_state` requires `score: [int, int]`, `serving_team: "A" | "B"`, optional
`server_number: 1 | 2`, and `scoring_mode: "singles" | "doubles"`. Rally events
are disk-local observations (serve, serve_landing, hit, bounce, momentum, fault).
The design specifies no network schema for full rally logs; this local envelope
does not modify any of its four fixed network messages. The game-state network
message's numeric `server` alone is insufficient to infer a team's identity, so
the offline envelope makes the serving team explicit. Review fixture contents for
the observation fields and causally linked `volley_id` used for momentum.

For human classifier evaluation, capture 100 swings with prompted labels. Each
record in a JSON list must have `id`, `provenance: "human_captured"`, `swing` (the
exact section-3 payload), `pose`, and `expected_shot` from the seven shot names.
Set the label at capture time, rather than labeling predictions retrospectively.

```sh
python3 eval.py --swings captured-swings.json
python3 eval.py --live --swings captured-swings.json --output results-live.md
```

The report includes overall accuracy, each class's recall and full confusion
matrix, measured p50/p95 latency, and fallback rate. Missing classes receive
`N/A (0 eligible)`. The synthetic data intentionally includes low-speed drops
whose features overlap dinks; baseline mistakes expose that ambiguity.

NVIDIA primary references checked 2026-09-19:

- [Hosted endpoint and Nano model ID](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b-infer)
- [Nano reasoning toggle](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b)
- [Super model card and reasoning toggle](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard)

Endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`. Model IDs:
`nvidia/nemotron-3-nano-30b-a3b` and `nvidia/nemotron-3-super-120b-a12b`.
Raw HTTP requests use `chat_template_kwargs: {"enable_thinking": true/false}`;
this is the field passed through `extra_body` in NVIDIA's SDK examples.
No unsupported JSON-mode parameter is assumed; JSON and schema checks are local.
