"""Synthetic observations proving each predicate can both pass and fail.

A predicate that cannot fail is worse than no predicate: the 2026-07-30 issue #3
runs reported PASS while carrying the empty profile that turned out to be issue
#7. Every predicate registered in checks.PREDICATES must have a fixture pair
here, and run() fails if one is missing.
"""

import copy

from harness import checks, collector

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
    merged = copy.deepcopy(BASE_OBS)
    merged.update(overrides)
    return merged


# (name, collector payload entry, expected event_name result)
EVENT_NAME_CASES = [
    ("page view", {"e": "pv"}, "pv"),
    ("unencoded ue_pr", {"e": "ue", "ue_pr": '{"data":{"schema":'
        '"iglu:com.snowplow_demo.fashion/product_viewed/jsonschema/1-0-0"}}'},
     "product_viewed"),
    ("base64 ue_px", {"e": "ue", "ue_px": "eyJkYXRhIjp7InNjaGVtYSI6ImlnbHU6Y29t"
        "LnNub3dwbG93X2RlbW8uZmFzaGlvbi9jYXJ0X3ZpZXdlZC9qc29uc2NoZW1hLzEtMC0wIn19"},
     "cart_viewed"),
    ("no event fields", {}, "unknown"),
    ("undecodable ue_px", {"e": "ue", "ue_px": "!!!not base64!!!"}, "undecodable"),
    ("unparseable json", {"e": "ue", "ue_pr": "{not json"}, "unparseable"),
]


def run_event_name_cases():
    failures = 0
    for label, payload, expected in EVENT_NAME_CASES:
        actual = collector.event_name(payload)
        ok = actual == expected
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  event_name {mark} {label:<20} -> {actual!r}"
              + ("" if ok else f"  expected {expected!r}"))
    return failures


def turn(label="2a-carousel", prose="Here are three evening pieces I think work.",
         cards=None, raw_token=False, mode="payload-mode", widget=True):
    return {
        "label": label,
        "prompt": "Can you recommend a couple of accessories?",
        "prose": prose,
        "cards": cards if cards is not None else [
            {"kind": "product_detail_carousel",
             "items": [{"uri": "/products/satin-evening-pouch",
                        "img": "https://example/1.jpg",
                        "text": ["Satin Evening Pouch", "$760"]}]}],
        "rawToken": raw_token,
        "mode": mode,
        "wire": ["wire:structured-payload"],
        "isWidgetTurn": widget,
        "screenshot": "turn-2a.png",
    }


ZERO_MATCH_OK = {
    "label": "5-zero-match",
    "prompt": "Do you have any neon orange swimwear under $15?",
    "prose": "We have nothing in neon orange at that price. Shall I broaden the search?",
    "cards": [], "rawToken": False, "mode": None, "wire": [],
    "isWidgetTurn": False, "screenshot": "turn-5.png",
}


FIXTURES = {
    "ac1-commentary": (
        obs(turns=[turn()]),
        obs(turns=[turn(prose="")]),
    ),
    "ac2-cards": (
        obs(turns=[turn()]),
        obs(turns=[turn(cards=[], raw_token=True)]),
    ),
    "ac4-mode": (
        obs(turns=[turn()]),
        obs(turns=[turn(mode="UNRENDERABLE")]),
    ),
    "ac5-console": (
        obs(console={"errors": 0, "warnings": 0, "lines": []}),
        obs(console={"errors": 2, "warnings": 1, "lines": []}),
    ),
    "ac7-zero-match": (
        obs(turns=[turn(), ZERO_MATCH_OK]),
        obs(turns=[turn(), dict(ZERO_MATCH_OK, cards=[
            {"kind": "base_product_detail",
             "items": [{"uri": "/products/neon-orange-swim-brief",
                        "img": None, "text": ["Neon Orange Swim Brief", "$12"]}]}])]),
    ),
}


def run():
    missing = sorted(set(checks.PREDICATES) - set(FIXTURES))
    if missing:
        print(f"  {checks.FAIL_MARK} no selfcheck fixture for: {', '.join(missing)}")
        return 1
    unimplemented = sorted(set(FIXTURES) - set(checks.PREDICATES))
    if unimplemented:
        print(f"  {checks.FAIL_MARK} fixture with no predicate: {', '.join(unimplemented)}")
        return 1

    failures = run_event_name_cases()
    total = len([c for c in checks.CHECK_ORDER if c in checks.PREDICATES])
    predicate_failures = 0
    for check_id in checks.CHECK_ORDER:
        fn = checks.PREDICATES.get(check_id)
        if fn is None:
            continue
        good, bad = FIXTURES[check_id]
        passes = all(r.passed for r in fn(good))
        fires = any(not r.passed for r in fn(bad))
        ok = passes and fires
        predicate_failures += 0 if ok else 1
        print(f"  {check_id:<16} fires {checks.PASS_MARK if fires else checks.FAIL_MARK}"
              f"  passes {checks.PASS_MARK if passes else checks.FAIL_MARK}")

    print(f"\n  {total - predicate_failures}/{total} predicates proven both ways")
    return 1 if (failures or predicate_failures) else 0
