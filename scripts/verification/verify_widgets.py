"""Asserting E2E harness for the runbook §11.5 widget walkthrough (issue #9).

Usage:
  VERIFY_BASE=https://... AGENT_SHARED_SECRET=... python3 scripts/verification/verify_widgets.py
  python3 scripts/verification/verify_widgets.py --selfcheck
  VERIFY_FAULT=ac6-signals VERIFY_BASE=... AGENT_SHARED_SECRET=... python3 scripts/verification/verify_widgets.py

Exit codes: 0 all checks passed, 1 one or more failed, 2 misconfigured.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import checks, config, selfcheck  # noqa: E402


def observe(base, secret):
    raise NotImplementedError("phase A lands in Task 7")


def main(argv):
    if "--selfcheck" in argv:
        return selfcheck.run()

    try:
        base = config.require_base()
        secret = config.require_secret()
    except config.ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    print(f"base: {base}")
    observation = observe(base, secret)
    run = checks.evaluate(observation)
    print(run.render())
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
