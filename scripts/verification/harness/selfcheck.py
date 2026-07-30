"""Synthetic observations proving each predicate can both pass and fail.

A predicate that cannot fail is worse than no predicate: the 2026-07-30 issue #3
runs reported PASS while carrying the empty profile that turned out to be issue
#7. Every predicate registered in checks.PREDICATES must have a fixture pair
here, and run() fails if one is missing.
"""

from harness import checks

# Minimal observation skeleton. Fixtures deep-copy this and corrupt one area,
# so a predicate reading the wrong key gets an empty default rather than a
# coincidentally-valid value from another check's data.
BASE_OBS = {
    "base": "http://localhost:3000",
    "browse": {"paths": [], "events": {}, "sids": [], "productViewed": 0,
               "productPages": 0},
    "signalsContext": {"profile": {}, "recent_activity": "",
                       "agent_instructions": ""},
    "turns": [],
    "click": {},
    "console": {"errors": 0, "warnings": 0, "lines": []},
}


def obs(**overrides):
    merged = {k: (v.copy() if isinstance(v, dict) else list(v))
              for k, v in BASE_OBS.items()}
    merged.update(overrides)
    return merged


FIXTURES = {
    "ac5-console": (
        obs(console={"errors": 0, "warnings": 0, "lines": []}),
        obs(console={"errors": 2, "warnings": 1, "lines": []}),
    ),
}


def run():
    missing = sorted(set(checks.PREDICATES) - set(FIXTURES))
    if missing:
        print(f"  {checks.FAIL_MARK} no selfcheck fixture for: {', '.join(missing)}")
        return 1

    failures = 0
    for check_id in checks.CHECK_ORDER:
        fn = checks.PREDICATES.get(check_id)
        if fn is None:
            continue
        good, bad = FIXTURES[check_id]
        passes = all(r.passed for r in fn(good))
        fires = any(not r.passed for r in fn(bad))
        ok = passes and fires
        failures += 0 if ok else 1
        print(f"  {check_id:<16} fires {checks.PASS_MARK if fires else checks.FAIL_MARK}"
              f"  passes {checks.PASS_MARK if passes else checks.FAIL_MARK}")

    total = len([c for c in checks.CHECK_ORDER if c in checks.PREDICATES])
    print(f"\n  {total - failures}/{total} predicates proven both ways")
    return 1 if failures else 0
