"""Synthetic observations proving each predicate can both pass and fail.

A predicate that cannot fail is worse than no predicate: the 2026-07-30 issue #3
runs reported PASS while carrying the empty profile that turned out to be issue
#7. Every predicate registered in checks.PREDICATES must have a fixture pair
here, and run() fails if one is missing.

A fixture pair alone is not enough for a predicate whose verdict is a
conjunction. `bool(cards) and not raw` short-circuits, so a bad fixture that
empties `cards` *and* sets `rawToken` never reaches the token term -- deleting
that term outright passed both the fixture pair and the fault hook. Each
conjunction therefore gets a named case list below that drives one term at a
time, on the AC3_URL_CASES pattern.
"""

import copy
import re

from harness import checks, collector, context, redact

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
    "expectedTurns": 0,
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


def run_predicate_cases(prefix, check_id, cases):
    """Extra named cases for one predicate, beyond its single fixture pair.

    A fixture pair proves a predicate can pass and can fail. It does not prove
    that *each term* of a conjunction can fail: a bad fixture that breaks two
    terms only ever exercises whichever short-circuits first. These lists cover
    the terms the fixture pair and the fault hook cannot isolate on their own.
    """
    fn = checks.PREDICATES.get(check_id)
    if fn is None:
        print(f"  {prefix:<9} {checks.FAIL_MARK} no predicate registered for {check_id}")
        return 1
    failures = 0
    for label, obs_obj, expected_pass in cases:
        results = fn(obs_obj)
        # An empty result list is not a pass -- see checks.evaluate().
        actual_pass = bool(results) and all(r.passed for r in results)
        ok = actual_pass == expected_pass
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  {prefix:<9} {mark} {label:<44} -> {actual_pass!r}"
              + ("" if ok else f"  expected {expected_pass!r}"))
    return failures


def run_evaluate_cases():
    """evaluate() must never report all-green on an observation that asserted
    nothing.

    Exercised through evaluate() rather than through a single predicate,
    because the empty-result rule lives there and it is what stands between a
    run whose turns all timed out and `8/8 checks passed`, exit 0.
    """
    failures = 0
    for label, obs_obj, expect_pass, must_fail in EVALUATE_CASES:
        run = checks.evaluate(obs_obj)
        actual_pass = run.exit_code == 0
        failed_ids = [r.id for r in run.failed]
        missing = [want for want in must_fail
                   if not any(fid.startswith(want) for fid in failed_ids)]
        ok = actual_pass == expect_pass and bool(run.results) and not missing
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  evaluate  {mark} {label:<44} -> exit {run.exit_code}, "
              f"{len(run.failed)}/{len(run.results)} failed"
              + ("" if ok else f"  expected pass={expect_pass!r}"
                               f"{', never failed: ' + ', '.join(missing) if missing else ''}"))
    return failures


def run_redact_cases():
    """The redactor is a security control, so it gets the same treatment as a
    predicate: cases that must be redacted and cases that must not."""
    failures = 0
    for label, line, should_change in REDACT_CASES:
        got = redact.redact_line(line)
        changed = got != line
        leaked = _looks_like_token(got)
        ok = changed == should_change and not (should_change and leaked)
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  redact    {mark} {label:<44} -> "
              f"{'redacted' if changed else 'untouched'}"
              + ("" if ok else f"  expected {'redacted' if should_change else 'untouched'}"
                               f"{', residual token material' if leaked else ''}"))
    # Idempotence: running the redactor twice must not re-mangle a clean line.
    twice_ok = all(redact.redact_line(redact.redact_line(line))
                   == redact.redact_line(line) for _l, line, _c in REDACT_CASES)
    failures += 0 if twice_ok else 1
    print(f"  redact    {checks.PASS_MARK if twice_ok else checks.FAIL_MARK} "
          f"{'redaction is idempotent':<44}")
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
         cards=None, raw_token=False, mode="payload-mode", modes=None,
         widget=True, timed_out=False):
    """One widget turn as phase A records it.

    `modes` defaults to [mode] so the two stay consistent unless a case
    deliberately drives them apart -- which is the whole point of the
    UNRENDERABLE-masked-by-a-later-success case.
    """
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
        "modes": list(modes) if modes is not None else ([mode] if mode else []),
        "mode": mode,
        "wire": ["wire:structured-payload"],
        "isWidgetTurn": widget,
        "timedOut": timed_out,
        "screenshot": "turn-2a.png",
    }


def zero_match_turn(label="5-zero-match",
                     prose="We have nothing in neon orange at that price. Shall I broaden the search?",
                     cards=None, raw_token=False, timed_out=False):
    return {
        "label": label,
        "prompt": "Do you have any neon orange swimwear under $15?",
        "prose": prose,
        "cards": cards if cards is not None else [],
        "rawToken": raw_token,
        "modes": [],
        "mode": None,
        "wire": [],
        "isWidgetTurn": False,
        "timedOut": timed_out,
        "screenshot": "turn-5.png",
    }


def invented_card():
    """A card the zero-match control must never produce. A factory, not a
    constant: two fixtures sharing one dict is the aliasing bug this file
    already has a regression test for."""
    return {"kind": "base_product_detail",
            "items": [{"uri": "/products/neon-orange-swim-brief",
                       "img": None,
                       "text": ["Neon Orange Swim Brief", "$12"]}]}


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


def complete_obs(**overrides):
    """A whole run in which every check id produces at least one PASSING result.

    The baseline for the evaluate() cases: start from all-green, then break one
    thing, so a failure can only come from the thing that was broken.
    """
    merged = obs(
        turns=[turn(), turn(label="3-details"), zero_match_turn()],
        expectedTurns=3,
        click=click_result(),
        browse={"paths": ["/products/a", "/products/b"], "productPages": 2,
                "productViewed": 2, "sids": ["a1b2"],
                "events": {"product_viewed": 2, "pv": 5}},
        signalsContext={"profile": {"total_product_views": 2},
                        "recent_activity": "- product_viewed: p1",
                        "agent_instructions": ""},
        console={"errors": 0, "warnings": 0, "lines": []},
    )
    merged.update(copy.deepcopy(overrides))
    return merged


def _timed_out_run():
    """What a run looks like when the agent never answers: turns recorded, all
    of them empty, none of them a widget turn. This shape reported 8/8 green."""
    return complete_obs(
        turns=[turn(label=lbl, prose="", cards=[], mode=None, widget=False,
                    timed_out=True)
               for lbl in ("2a-carousel", "3-details")]
              + [zero_match_turn(timed_out=True)],
        expectedTurns=3,
    )


def _text_only_run():
    """Every turn answered, none of them rendered a card. ac0 is clean, so the
    only thing standing between this and an all-green report is evaluate()
    refusing to treat an empty result list as a pass."""
    return complete_obs(
        turns=[turn(cards=[], mode=None, widget=False), zero_match_turn()],
        expectedTurns=2,
    )


def _drop(observation, key):
    del observation[key]
    return observation


AC3_URL_CASES = [
    ("exact path match", obs(click=click_result(
        clickedUri="/products/chunky-mohair-pullover",
        afterUrl="http://localhost:3000/products/chunky-mohair-pullover"
    )), True),
    ("path with trailing slash", obs(click=click_result(
        clickedUri="/products/chunky-mohair-pullover",
        afterUrl="http://localhost:3000/products/chunky-mohair-pullover/"
    )), True),
    ("path with query string", obs(click=click_result(
        clickedUri="/products/chunky-mohair-pullover",
        afterUrl="http://localhost:3000/products/chunky-mohair-pullover?ref=cx-agent"
    )), True),
    ("path with hash", obs(click=click_result(
        clickedUri="/products/chunky-mohair-pullover",
        afterUrl="http://localhost:3000/products/chunky-mohair-pullover#section"
    )), True),
    ("wrong product suffix false positive", obs(click=click_result(
        clickedUri="/products/pullover",
        afterUrl="http://localhost:3000/products/mohair-pullover"
    )), False),
]

# AC0: the count term and the timeout term, each on its own. The fixture pair
# drives the timeout term and the fault hook drives the count term, but neither
# covers a missing expectedTurns, which is what a phase A that forgot to write
# the field would look like.
AC0_TURN_CASES = [
    ("every planned turn ran", obs(turns=[turn(), zero_match_turn()],
                                   expectedTurns=2), True),
    ("one turn timed out", obs(turns=[turn(), zero_match_turn(timed_out=True)],
                               expectedTurns=2), False),
    ("fewer turns recorded than planned",
     obs(turns=[turn()], expectedTurns=2), False),
    ("more turns recorded than planned",
     obs(turns=[turn(), turn(label="3-details"), zero_match_turn()],
         expectedTurns=2), False),
    ("no turns recorded at all", obs(turns=[], expectedTurns=5), False),
    ("expectedTurns never written by phase A",
     _drop(obs(turns=[turn(), zero_match_turn()]), "expectedTurns"), False),
    ("expectedTurns is zero", obs(turns=[], expectedTurns=0), False),
]

# AC2: `bool(cards) and not raw`. The raw-token term is the issue #1 leak and
# the reason this harness exists; it needs a case where cards ARE present.
AC2_TOKEN_CASES = [
    ("cards rendered, no raw token", obs(turns=[turn()]), True),
    ("raw {@Widget: token alongside rendered cards",
     obs(turns=[turn(raw_token=True)]), False),
    ("no cards, no raw token", obs(turns=[turn(cards=[])]), False),
    ("neither cards nor a clean reply",
     obs(turns=[turn(cards=[], raw_token=True)]), False),
]

# AC4: the whole `modes` list, not just the last mark.
AC4_MODE_CASES = [
    ("single payload-mode mark", obs(turns=[turn()]), True),
    ("single token-mode mark", obs(turns=[turn(mode="token-mode")]), True),
    ("UNRENDERABLE masked by a later success",
     obs(turns=[turn(mode="payload-mode",
                     modes=["UNRENDERABLE", "payload-mode"])]), False),
    ("UNRENDERABLE as the only mark",
     obs(turns=[turn(mode="UNRENDERABLE", modes=["UNRENDERABLE"])]), False),
    ("no renderer mark at all",
     obs(turns=[turn(mode=None, modes=[])]), False),
]

# AC7: `not cards and not raw`, same short-circuit as AC2.
AC7_TOKEN_CASES = [
    ("degraded to plain text", obs(turns=[turn(), zero_match_turn()]), True),
    ("invented a product card",
     obs(turns=[turn(), zero_match_turn(cards=[invented_card()])]), False),
    ("raw {@Widget: token in the degraded reply",
     obs(turns=[turn(), zero_match_turn(raw_token=True)]), False),
    ("no zero-match control turn in the run", obs(turns=[turn()]), False),
]

EVALUATE_CASES = [
    # (label, observation, expected overall pass, ids that must be among the
    #  failures -- matched as a prefix, since per-turn ids carry a [label])
    ("a complete run stays green", complete_obs(), True, ()),
    ("every turn timed out", _timed_out_run(), False,
     ("ac0-turns", "ac1-commentary", "ac2-cards", "ac4-mode")),
    ("turns answered but no cards anywhere", _text_only_run(), False,
     ("ac1-commentary", "ac2-cards", "ac4-mode")),
]

# Token shapes the redactor must catch, and benign lines it must leave alone.
# Every value here is synthetic. The domain_sessionid line is load-bearing:
# collector.Recorder.forwarded_id() parses it to find the session to poll
# Signals for, so redacting it would break session detection.
_HEAD = "EXAMPLE-TOKEN-HEAD-0123456789abcdef0123"
_TAIL = "0123456789abcdef-EXAMPLE-TOKEN-TAIL"

REDACT_CASES = [
    ("ellipsis-truncated value (the real captured shape)",
     "Token received from token broker: {chatToken: " + _HEAD + "…" + _TAIL
     + ", expireTime: 2026-07-31T12:02:50.687240Z}", True),
    ("single-quoted key and value",
     "config {'chatToken': '" + _HEAD + "'}", True),
    ("double-quoted JSON access_token",
     '{"access_token": "' + _HEAD + '"}', True),
    ("authorization header with a Bearer prefix",
     "authorization=Bearer " + _HEAD, True),
    ("standard base64 with + / = padding",
     "token: QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo+/aGk=", True),
    ("a report written by the pre-fix redactor",
     "{chatToken: <redacted>…" + _TAIL + "}", True),
    ("domain_sessionid forwarded to the widget",
     "[Signals Demo] Passed domain_sessionid to widget "
     "{sessionId: 8f3c11e6-921f-4889-924d-3c5e26c92838}", False),
    ("prose that merely mentions the word token",
     "Rendered rich-response widget token(s) in chat", False),
    ("a value too short to be a token", "token: abc", False),
]

# A crude high-entropy detector: a real token, a base64 blob and an
# ellipsis-truncated tail all read as one long unpunctuated run. ISO timestamps
# and UUIDs break every 4-13 characters, so they fall under the threshold.
_TOKEN_RESIDUE = re.compile(r"[A-Za-z0-9_+/=]{16,}")


def _looks_like_token(text):
    return bool(_TOKEN_RESIDUE.search(text))


# Each `bad` fixture breaks exactly ONE term of its predicate, and the matching
# fault hook in checks.py breaks a different one. A fixture that breaks two
# terms of a conjunction proves only the first.
FIXTURES = {
    "ac0-turns": (
        obs(turns=[turn(), zero_match_turn()], expectedTurns=2),
        # timeout term; the count term is the fault hook's job
        obs(turns=[turn(timed_out=True), zero_match_turn()], expectedTurns=2),
    ),
    "ac1-commentary": (
        obs(turns=[turn()]),
        obs(turns=[turn(prose="")]),
    ),
    "ac2-cards": (
        obs(turns=[turn()]),
        # cards term; the rawToken term is the fault hook's job
        obs(turns=[turn(cards=[])]),
    ),
    "ac3-spa-nav": (
        obs(click=click_result()),
        obs(click=click_result(spaProbeSurvived=False, cardsAfter=0)),
    ),
    "ac4-mode": (
        obs(turns=[turn()]),
        # last-mark term; the masked-UNRENDERABLE term is the fault hook's job
        obs(turns=[turn(mode="UNRENDERABLE", modes=["UNRENDERABLE"])]),
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
        # invented-card term; the rawToken term is the fault hook's job
        obs(turns=[turn(), zero_match_turn(cards=[invented_card()])]),
    ),
}


def run_fault_cases():
    """Every check id must have a fault that actually makes that check fail."""
    failures = 0
    for check_id in checks.CHECK_ORDER:
        good, _bad = FIXTURES[check_id]
        # Deep copy: the fault hooks mutate nested turn dicts, and a shallow
        # copy would corrupt the fixtures the predicate loop reads afterwards.
        corrupted = copy.deepcopy(good)
        try:
            checks.apply_fault(corrupted, check_id)
        except KeyError:
            print(f"  fault      {checks.FAIL_MARK} {check_id}: no fault registered")
            failures += 1
            continue
        fires = any(not r.passed for r in checks.PREDICATES[check_id](corrupted))
        failures += 0 if fires else 1
        print(f"  fault      {checks.PASS_MARK if fires else checks.FAIL_MARK} "
              f"{check_id} fails when injected")
    return failures


def run():
    missing = sorted(set(checks.PREDICATES) - set(FIXTURES))
    if missing:
        print(f"  {checks.FAIL_MARK} no selfcheck fixture for: {', '.join(missing)}")
        return 1
    unimplemented = sorted(set(FIXTURES) - set(checks.PREDICATES))
    if unimplemented:
        print(f"  {checks.FAIL_MARK} fixture with no predicate: {', '.join(unimplemented)}")
        return 1

    failures = run_event_name_cases() + run_context_cases() + run_fault_cases()
    failures += test_fixture_aliasing()
    failures += run_redact_cases()
    failures += run_predicate_cases("ac0-turns", "ac0-turns", AC0_TURN_CASES)
    failures += run_predicate_cases("ac2-token", "ac2-cards", AC2_TOKEN_CASES)
    failures += run_predicate_cases("ac3-url", "ac3-spa-nav", AC3_URL_CASES)
    failures += run_predicate_cases("ac4-mode", "ac4-mode", AC4_MODE_CASES)
    failures += run_predicate_cases("ac7-token", "ac7-zero-match", AC7_TOKEN_CASES)
    failures += run_evaluate_cases()
    total = len([c for c in checks.CHECK_ORDER if c in checks.PREDICATES])
    predicate_failures = 0
    for check_id in checks.CHECK_ORDER:
        fn = checks.PREDICATES.get(check_id)
        if fn is None:
            continue
        good, bad = FIXTURES[check_id]
        good_results = fn(good)
        # An empty result list is not a pass -- see checks.evaluate().
        passes = bool(good_results) and all(r.passed for r in good_results)
        fires = any(not r.passed for r in fn(bad))
        ok = passes and fires
        predicate_failures += 0 if ok else 1
        print(f"  {check_id:<16} fires {checks.PASS_MARK if fires else checks.FAIL_MARK}"
              f"  passes {checks.PASS_MARK if passes else checks.FAIL_MARK}")

    print(f"\n  {total - predicate_failures}/{total} predicates proven both ways")
    return 1 if (failures or predicate_failures) else 0
