"""Synthetic observations proving each predicate can both pass and fail.

A predicate that cannot fail is worse than no predicate: the 2026-07-30 issue #3
runs reported PASS while carrying the empty profile that turned out to be issue
#7. Every predicate registered in checks.PREDICATES must have a fixture pair
here, and run() fails if one is missing.
"""

import copy

from harness import checks, collector, context

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


def _canned_opener(*responses):
    """An opener that returns each canned payload in turn, then repeats the last."""
    box = {"i": 0}

    def opener(url, headers):
        i = min(box["i"], len(responses) - 1)
        box["i"] += 1
        result = responses[i]
        if isinstance(result, Exception):
            raise result
        return result

    return opener


def run_context_cases():
    empty = {"profile": {}, "recent_activity": "No events buffered.",
             "agent_instructions": ""}
    full = {"profile": {"total_product_views": 2}, "recent_activity": "- pv",
            "agent_instructions": "Be helpful."}
    ticks = {"t": 0.0}

    def clock():
        return ticks["t"]

    def sleep(seconds):
        ticks["t"] += seconds

    cases = []

    got = context.poll_context("http://x", "s", "sid",
                               opener=_canned_opener(full),
                               clock=clock, sleep=sleep)
    cases.append(("populated on first attempt",
                  got["attempts"] == 1 and got["profile"] == full["profile"]))

    ticks["t"] = 0.0
    got = context.poll_context("http://x", "s", "sid",
                               opener=_canned_opener(empty, empty, full),
                               clock=clock, sleep=sleep)
    cases.append(("retries until populated",
                  got["attempts"] == 3 and got["profile"] == full["profile"]
                  and got["polledAfterSeconds"] > 0))

    ticks["t"] = 0.0
    got = context.poll_context("http://x", "s", "sid", timeout_s=30,
                               opener=_canned_opener(empty),
                               clock=clock, sleep=sleep)
    cases.append(("gives up and returns the last empty payload",
                  got["profile"] == {} and "error" not in got
                  and got["attempts"] > 1))

    ticks["t"] = 0.0
    got = context.poll_context("http://x", "s", "sid", timeout_s=30,
                               opener=_canned_opener(RuntimeError("401 Unauthorized")),
                               clock=clock, sleep=sleep)
    cases.append(("reports a transport error", "error" in got))

    ticks["t"] = 0.0
    got = context.poll_context("http://x", "s", "sid", timeout_s=30,
                               opener=_canned_opener([1, 2, 3]),
                               clock=clock, sleep=sleep)
    cases.append(("handles non-dict JSON body",
                  isinstance(got, dict) and "error" in got))

    cases.append(("is_populated rejects the empty-buffer marker",
                  not context.is_populated(empty)))
    cases.append(("is_populated accepts a real profile",
                  context.is_populated(full)))
    cases.append(("is_populated rejects non-dict payloads",
                  not context.is_populated([1, 2, 3]) and not context.is_populated("string")))

    failures = 0
    for label, ok in cases:
        failures += 0 if ok else 1
        print(f"  context    {checks.PASS_MARK if ok else checks.FAIL_MARK} {label}")
    return failures


def run_ac3_url_cases():
    failures = 0
    ac3_predicate = checks.PREDICATES.get("ac3-spa-nav")
    if not ac3_predicate:
        return 0
    for label, click_obs, expected_pass in AC3_URL_CASES:
        obs_obj = obs(click=click_obs)
        results = ac3_predicate(obs_obj)
        actual_pass = all(r.passed for r in results)
        ok = actual_pass == expected_pass
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  ac3-url {mark} {label:<30} -> {actual_pass!r}"
              + ("" if ok else f"  expected {expected_pass!r}"))
    return failures


def _find_nested_mutables(obj, base_obj, path=[]):
    """Recursively find all nested mutable containers (lists/dicts) in obj that
    differ from base_obj, so we can test them for aliasing."""
    mutables = []
    if isinstance(obj, dict) and isinstance(base_obj, dict):
        for key in obj:
            if key not in base_obj or obj[key] != base_obj[key]:
                child_mutables = _find_nested_mutables(
                    obj[key],
                    base_obj.get(key),
                    path + [key]
                )
                mutables.extend(child_mutables)
    elif isinstance(obj, list):
        if not isinstance(base_obj, list) or obj != base_obj:
            mutables.append((path, obj))
        if isinstance(base_obj, list):
            for i, item in enumerate(obj):
                if isinstance(item, (dict, list)):
                    base_item = base_obj[i] if i < len(base_obj) else None
                    child_mutables = _find_nested_mutables(
                        item,
                        base_item,
                        path + [i]
                    )
                    mutables.extend(child_mutables)
    elif isinstance(obj, dict) and not isinstance(base_obj, dict):
        if obj:
            mutables.append((path, obj))
        for key in obj:
            if isinstance(obj[key], (dict, list)):
                child_mutables = _find_nested_mutables(
                    obj[key],
                    None,
                    path + [key]
                )
                mutables.extend(child_mutables)
    return mutables


def test_fixture_aliasing():
    """Verify fixtures don't alias shared mutable references.

    This test catches regressions where obs() overrides share nested dicts
    instead of deep-copying them, which would cause mutations in one fixture
    to silently corrupt others. Sweeps every fixture pair to ensure all use
    proper factory construction.
    """
    failures = 0

    for check_id in FIXTURES:
        good, bad = FIXTURES[check_id]

        all_initial = copy.deepcopy(FIXTURES)
        good_initial = copy.deepcopy(good)
        bad_initial = copy.deepcopy(bad)

        mutables = _find_nested_mutables(bad, BASE_OBS)

        if not mutables:
            print(f"  fixture aliasing {checks.PASS_MARK} {check_id}: no custom mutables to test")
            continue

        for path, mutation_target in mutables:
            if isinstance(mutation_target, list):
                mutation_target.append("ALIASING-TEST")
            elif isinstance(mutation_target, dict):
                mutation_target["ALIASING-TEST"] = True

            good_now = good
            siblings_ok = good_now == good_initial
            others_ok = all(FIXTURES[other_id] == all_initial[other_id]
                           for other_id in FIXTURES if other_id != check_id)
            base_ok = BASE_OBS == copy.deepcopy(BASE_OBS)

            mutation_ok = siblings_ok and others_ok and base_ok

            if not mutation_ok:
                failures += 1
                path_str = ".".join(str(p) for p in path)
                print(f"  fixture aliasing {checks.FAIL_MARK} {check_id} at {path_str}: "
                      f"siblings_ok={siblings_ok} others_ok={others_ok} base_ok={base_ok}")
            else:
                path_str = ".".join(str(p) for p in path)
                print(f"  fixture aliasing {checks.PASS_MARK} {check_id} at {path_str}: no aliasing")

            if isinstance(mutation_target, list):
                mutation_target.pop()
            elif isinstance(mutation_target, dict):
                del mutation_target["ALIASING-TEST"]

    mark = checks.PASS_MARK if failures == 0 else checks.FAIL_MARK
    summary = "all fixture pairs are aliasing-safe"
    print(f"  fixture aliasing {mark} {summary}")

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


def zero_match_turn(label="5-zero-match",
                     prose="We have nothing in neon orange at that price. Shall I broaden the search?",
                     cards=None):
    return {
        "label": label,
        "prompt": "Do you have any neon orange swimwear under $15?",
        "prose": prose,
        "cards": cards if cards is not None else [],
        "rawToken": False,
        "mode": None,
        "wire": [],
        "isWidgetTurn": False,
        "screenshot": "turn-5.png",
    }


def click_result(clickedUri="/products/chunky-mohair-pullover",
                 beforeUrl="http://localhost:3000/collections/accessory-atelier",
                 afterUrl="http://localhost:3000/products/chunky-mohair-pullover",
                 spaProbeSurvived=True, chatMessagesAfter=11, cardsAfter=4):
    return {
        "clickedUri": clickedUri,
        "beforeUrl": beforeUrl,
        "afterUrl": afterUrl,
        "spaProbeSurvived": spaProbeSurvived,
        "chatMessagesAfter": chatMessagesAfter,
        "cardsAfter": cardsAfter,
    }


AC3_URL_CASES = [
    ("exact path match", click_result(
        clickedUri="/products/chunky-mohair-pullover",
        afterUrl="http://localhost:3000/products/chunky-mohair-pullover"
    ), True),
    ("path with trailing slash", click_result(
        clickedUri="/products/chunky-mohair-pullover",
        afterUrl="http://localhost:3000/products/chunky-mohair-pullover/"
    ), True),
    ("path with query string", click_result(
        clickedUri="/products/chunky-mohair-pullover",
        afterUrl="http://localhost:3000/products/chunky-mohair-pullover?ref=cx-agent"
    ), True),
    ("path with hash", click_result(
        clickedUri="/products/chunky-mohair-pullover",
        afterUrl="http://localhost:3000/products/chunky-mohair-pullover#section"
    ), True),
    ("wrong product suffix false positive", click_result(
        clickedUri="/products/pullover",
        afterUrl="http://localhost:3000/products/mohair-pullover"
    ), False),
]


FIXTURES = {
    "ac1-commentary": (
        obs(turns=[turn()]),
        obs(turns=[turn(prose="")]),
    ),
    "ac2-cards": (
        obs(turns=[turn()]),
        obs(turns=[turn(cards=[], raw_token=True)]),
    ),
    "ac3-spa-nav": (
        obs(click=click_result()),
        obs(click=click_result(spaProbeSurvived=False, cardsAfter=0)),
    ),
    "ac4-mode": (
        obs(turns=[turn()]),
        obs(turns=[turn(mode="UNRENDERABLE")]),
    ),
    "ac5-console": (
        obs(console={"errors": 0, "warnings": 0, "lines": []}),
        obs(console={"errors": 2, "warnings": 1, "lines": []}),
    ),
    "ac6-collector": (
        obs(browse={"paths": ["/products/a", "/products/b"], "productPages": 2,
                    "productViewed": 2, "sids": ["a1b2"],
                    "events": {"product_viewed": 2, "pv": 5}}),
        obs(browse={"paths": ["/products/a", "/products/b"], "productPages": 2,
                    "productViewed": 0, "sids": ["a1b2"],
                    "events": {"pv": 5}}),
    ),
    "ac6-signals": (
        obs(signalsContext={"profile": {"total_product_views": 2,
                                        "recently_viewed_product_ids": "p1, p2"},
                            "recent_activity": "- product_viewed: p1",
                            "agent_instructions": ""}),
        obs(signalsContext={"profile": {},
                            "recent_activity": "No events buffered. Based on last "
                                               "100 recorded events for the last "
                                               "3600 seconds.",
                            "agent_instructions": ""}),
    ),
    "ac7-zero-match": (
        obs(turns=[turn(), zero_match_turn()]),
        obs(turns=[turn(), zero_match_turn(cards=[
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

    failures = run_event_name_cases() + run_context_cases()
    failures += test_fixture_aliasing()
    failures += run_ac3_url_cases()
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
