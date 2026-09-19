"""NVIDIA hosted OpenAI-compatible API using only the Python standard library."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import socket
import time
from urllib import error, request
from uuid import uuid4

ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
MODELS = {"nano": "nvidia/nemotron-3-nano-30b-a3b", "super": "nvidia/nemotron-3-super-120b-a12b"}
DEFAULT_LOG_DIR = Path(__file__).resolve().parent / "logs"


class ModelError(Exception):
    """A deliberately sanitized transport or response error."""


def write_log(directory, record):
    directory = Path(directory or DEFAULT_LOG_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    record = {"timestamp": datetime.now(timezone.utc).isoformat(), **record}
    # Defense against a service echoing the authorization value in an error body.
    serialized = json.dumps(record, ensure_ascii=False, indent=2, allow_nan=False)
    secret = os.environ.get("NVIDIA_API_KEY")
    if secret:
        serialized = serialized.replace(secret, "[REDACTED_API_KEY]")
    destination = directory / f"{time.time_ns()}_{uuid4().hex}.json"
    with destination.open("x", encoding="utf-8") as output:
        output.write(serialized + "\n")
    return str(destination)


class NoRedirect(request.HTTPRedirectHandler):
    """Never forward an API credential to a redirect target."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def retry_delay(value, attempt):
    if value:
        try:
            return min(8.0, max(0.0, float(value)))
        except ValueError:
            try:
                return min(8.0, max(0.0, parsedate_to_datetime(value).timestamp() - time.time()))
            except (TypeError, ValueError, OverflowError):
                pass
    return min(8.0, .5 * 2 ** attempt)


class NvidiaClient:
    def __init__(self, log_dir=None, opener=None, sleep=time.sleep):
        self.log_dir = Path(log_dir or DEFAULT_LOG_DIR)
        self.opener = opener or request.build_opener(NoRedirect())
        self.sleep = sleep

    def complete(self, messages, *, model, reasoning, max_tokens, timeout, retries=0, request_id=None):
        key = os.environ.get("NVIDIA_API_KEY", "")
        if not key:
            raise ModelError("missing_api_key")
        if model not in MODELS:
            raise ValueError("Unknown model alias")
        payload = {"model": MODELS[model], "messages": messages, "temperature": 0,
                   "max_tokens": max_tokens, "stream": False,
                   "chat_template_kwargs": {"enable_thinking": bool(reasoning)}}
        # No response_format extension is assumed. Strict JSON is prompted, then
        # independently parsed and schema-validated. All raw envelopes are retained.
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
        req = request.Request(ENDPOINT, data=body, method="POST",
                              headers={"Authorization": "Bearer " + key,
                                       "Content-Type": "application/json", "Accept": "application/json"})
        deadline = time.monotonic() + timeout
        logs = []
        for attempt in range(retries + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ModelError("timeout")
            meta = {"kind": "raw_response", "request_id": request_id, "model": payload["model"],
                    "reasoning": reasoning, "temperature": 0, "attempt": attempt + 1}
            retry_after = None
            try:
                with self.opener.open(req, timeout=remaining) as response:
                    raw = response.read().decode("utf-8", errors="replace")
                    status = response.status
            except error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                status = exc.code
                retry_after = exc.headers.get("Retry-After")
            except (error.URLError, socket.timeout, TimeoutError, OSError) as exc:
                write_log(self.log_dir, {**meta, "kind": "transport_error", "error_type": type(exc).__name__})
                raise ModelError("transport_error") from None
            logs.append(write_log(self.log_dir, {**meta, "http_status": status, "raw_response": raw}))
            if status == 429 or status in (500, 502, 503, 504):
                if attempt < retries:
                    delay = retry_delay(retry_after, attempt)
                    if delay < deadline - time.monotonic():
                        self.sleep(delay)
                        continue
                raise ModelError("rate_limited" if status == 429 else "upstream_error")
            if status != 200:
                raise ModelError(f"http_{status}")
            try:
                envelope = json.loads(raw)
                choice = envelope["choices"][0]
                if choice.get("finish_reason") != "stop":
                    raise ModelError("incomplete_response")
                content = choice["message"]["content"]
                if not isinstance(content, str):
                    raise ModelError("missing_content")
            except (ValueError, KeyError, IndexError, TypeError):
                raise ModelError("invalid_response_envelope") from None
            return {"content": content, "raw_logs": logs}
        raise ModelError("retry_exhausted")
