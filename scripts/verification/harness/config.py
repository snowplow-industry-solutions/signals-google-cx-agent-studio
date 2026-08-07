"""Environment resolution and shared thresholds.

The leaf module: everything else in harness/ may import this, and it imports
nothing of ours.

VERIFY_BASE has no default on purpose: issue #9 requires the harness target to
come from config rather than a hardcoded storefront URL, and a default is just a
hardcoded URL you can override. PROBE_BASE keeps its localhost default because
the probes predate that rule and are run against local builds by habit.
"""

import os

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A bubble carrying fewer characters than this is a label or a timestamp, not
# agent commentary. Lives here because chat.py waits on it and checks.py
# asserts on it -- one threshold, one definition.
MIN_PROSE = 20


class ConfigError(Exception):
    """Raised when a required environment variable is missing."""


def require_base():
    base = os.environ.get("VERIFY_BASE", "").strip().rstrip("/")
    if not base:
        raise ConfigError(
            "VERIFY_BASE is not set. Point it at the storefront under test, e.g.\n"
            "  VERIFY_BASE=https://your-storefront.example.com\n"
            "  VERIFY_BASE=http://localhost:3000   (after: npm --prefix storefront run build && npm --prefix storefront start)"
        )
    return base


def require_secret():
    secret = os.environ.get("AGENT_SHARED_SECRET", "").strip()
    if not secret:
        raise ConfigError(
            "AGENT_SHARED_SECRET is not set. AC6 polls /api/agent/context and will "
            "not silently skip -- that is the failure mode issue #9 exists to prevent.\n"
            "  export AGENT_SHARED_SECRET=...   (value is in storefront/.env.local)"
        )
    return secret


def probe_base():
    return os.environ.get("PROBE_BASE", "http://localhost:3000").rstrip("/")


def out_dir():
    path = os.environ.get("VERIFY_OUT", os.path.join(SCRIPT_DIR, "out"))
    os.makedirs(path, exist_ok=True)
    return path


def fault():
    value = os.environ.get("VERIFY_FAULT", "").strip()
    return value or None
