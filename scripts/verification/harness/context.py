"""Poll the storefront's /api/agent/context, the endpoint getUserContext calls.

The agent's own call happens inside Google's backend, so Playwright never sees
it. Polling the same endpoint with the session id taken from the collector POST
bodies is the closest observable proxy, and it runs before the chat opens so an
empty profile is caught before a turn is spent on it.

Signals answers 12-33s after an event (probe_latency.py) and runbook 10.2.1 saw
~60s, hence the retry loop rather than a single shot.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

from harness.checks import NO_EVENTS_MARKER

API_KEY_HEADER = "x-agent-api-key"


def _default_opener(url, headers):
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_context(base, secret, session_id, opener=None):
    """One GET. The secret goes in a header and is never logged."""
    query = urllib.parse.urlencode({"session_id": session_id})
    url = f"{base}/api/agent/context?{query}"
    return (opener or _default_opener)(url, {API_KEY_HEADER: secret})


def is_populated(payload):
    if not isinstance(payload, dict):
        return False
    profile = (payload or {}).get("profile") or {}
    activity = (payload or {}).get("recent_activity") or ""
    return bool(profile) and NO_EVENTS_MARKER not in activity


def poll_context(base, secret, session_id, timeout_s=90, interval_s=10,
                 opener=None, clock=time.monotonic, sleep=time.sleep):
    started = clock()
    attempts = 0
    last = None
    last_error = None

    while True:
        attempts += 1
        try:
            last = fetch_context(base, secret, session_id, opener=opener)
            last_error = None
            if is_populated(last):
                break
        except Exception as exc:  # transport, auth, or malformed JSON
            last_error = f"{type(exc).__name__}: {exc}"[:200]

        if clock() - started >= timeout_s:
            break
        sleep(interval_s)

    elapsed = clock() - started
    if last is None or not isinstance(last, dict):
        return {"profile": {}, "recent_activity": "", "agent_instructions": "",
                "polledAfterSeconds": elapsed, "attempts": attempts,
                "error": last_error or "no response"}

    result = {
        "profile": last.get("profile") or {},
        "recent_activity": last.get("recent_activity") or "",
        "agent_instructions": last.get("agent_instructions") or "",
        "polledAfterSeconds": elapsed,
        "attempts": attempts,
    }
    if last_error:
        result["error"] = last_error
    return result
