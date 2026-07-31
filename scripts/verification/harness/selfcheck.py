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

    Every case must produce at least one result. Silence is not a failure, it is
    a predicate that asserted nothing -- the rule checks.evaluate() enforces at
    run level, applied here too so that deleting a guard which turns an explicit
    "no zero-match control turn was recorded" into an empty list is caught.
    """
    fn = checks.PREDICATES.get(check_id)
    if fn is None:
        print(f"  {prefix:<9} {checks.FAIL_MARK} no predicate registered for {check_id}")
        return 1
    failures = 0
    for label, obs_obj, expected_pass in cases:
        results = fn(obs_obj)
        spoke = bool(results)
        actual_pass = spoke and all(r.passed for r in results)
        ok = spoke and actual_pass == expected_pass
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  {prefix:<9} {mark} {label:<44} -> "
              + ("no results" if not spoke else repr(actual_pass))
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


def run_unlabelled_turn_cases():
    """A turn with no `label` must yield a red check with a readable id.

    The per-turn predicates once indexed t['label'] directly, so one malformed
    turn raised KeyError out of evaluate() instead of returning a failing
    CheckResult -- the wrong failure mode for a harness whose whole job is to
    report rather than crash.
    """
    failures = 0
    for check_id, obs_obj in UNLABELLED_TURN_CASES:
        try:
            results = list(checks.PREDICATES[check_id](obs_obj))
            crash = None
        except Exception as exc:  # a predicate must never raise on bad input
            results, crash = [], f"{type(exc).__name__}: {exc}"
        spoke = bool(results)
        red = spoke and any(not r.passed for r in results)
        readable = spoke and all("<unlabelled>" in r.id for r in results)
        ok = crash is None and red and readable
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  unlabelled {mark} {check_id:<44} -> "
              + (crash if crash else f"red={red} readable-id={readable}"))
    return failures


def run_signals_detail_cases():
    """The recent_activity state named in check_signals_profile's detail must
    match the observation. Empty string, empty-buffer marker and recorded
    activity are three different debugging leads; naming the wrong one sends
    the reader the wrong way at exactly the wrong moment."""
    failures = 0
    for label, ctx, want in AC6_DETAIL_CASES:
        [result] = checks.PREDICATES["ac6-signals"](obs(signalsContext=ctx))
        ok = f"recent_activity={want}:" in result.detail
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  ac6-detail {mark} {label:<44}"
              + ("" if ok else f"  detail: {result.detail!r}"))
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


def _find_nested_mutables(obj, path=()):
    """Every mutable container (dict or list) reachable in obj, obj included,
    each with its path.

    Deliberately no comparison against BASE_OBS: the original sweep only
    descended into keys whose value differed from the base, and only yielded a
    dict when the base value was not a dict, so any container matching
    BASE_OBS's shape -- a shared `click`, `console` or `signalsContext` dict --
    was never mutation-tested at all. Mutating an independent container is
    harmless (the sweep restores it), so everything is tested.
    """
    mutables = []
    if isinstance(obj, dict):
        mutables.append((list(path), obj))
        for key, value in obj.items():
            mutables.extend(_find_nested_mutables(value, path + (key,)))
    elif isinstance(obj, list):
        mutables.append((list(path), obj))
        for i, item in enumerate(obj):
            mutables.extend(_find_nested_mutables(item, path + (i,)))
    return mutables


def _aliasing_failures(fixtures, base_obs):
    """Mutate every discovered container of every fixture, one at a time, and
    report each mutation that leaks into the fixture's sibling, another
    fixture pair, or base_obs.

    Every mutation is reverted before the next, and full restoration is
    checked at the end, so the sweep can never corrupt what it guards.
    Returns (failures, containers_tested_by_check_id); each failure is a
    (check_id, role:path, leak-description) triple.
    """
    initial = copy.deepcopy(fixtures)
    base_initial = copy.deepcopy(base_obs)
    failures = []
    tested = {}
    for check_id, pair in fixtures.items():
        tested[check_id] = 0
        for role_ix, fixture in enumerate(pair):
            role = ("good", "bad")[role_ix]
            sibling_ix = 1 - role_ix
            for path, target in _find_nested_mutables(fixture):
                if isinstance(target, list):
                    target.append("ALIASING-TEST")
                else:
                    target["ALIASING-TEST"] = True
                tested[check_id] += 1
                sibling_ok = pair[sibling_ix] == initial[check_id][sibling_ix]
                others_ok = all(fixtures[other] == initial[other]
                                for other in fixtures if other != check_id)
                base_ok = base_obs == base_initial
                if isinstance(target, list):
                    target.pop()
                else:
                    del target["ALIASING-TEST"]
                if not (sibling_ok and others_ok and base_ok):
                    where = ".".join(str(p) for p in path) or "<root>"
                    failures.append((check_id, f"{role}:{where}",
                                     f"sibling_ok={sibling_ok} "
                                     f"others_ok={others_ok} base_ok={base_ok}"))
    if fixtures != initial or base_obs != base_initial:
        failures.append(("<sweep>", "<restore>",
                         "the sweep failed to restore a mutation"))
    return failures, tested


def test_fixture_aliasing():
    """Verify no two fixtures share a mutable container.

    obs() takes its overrides by reference, so a container reused across
    fixtures -- or left pointing into BASE_OBS -- lets one fixture's mutation
    silently corrupt others. Every container of every fixture pair is
    mutation-tested. run_aliasing_detection_cases() proves the sweep itself
    fires for each container shape a fixture can share.
    """
    failures, tested = _aliasing_failures(FIXTURES, BASE_OBS)
    by_id = {}
    for check_id, where, leak in failures:
        by_id.setdefault(check_id, []).append((where, leak))
    for check_id in FIXTURES:
        leaks = by_id.pop(check_id, [])
        mark = checks.PASS_MARK if not leaks else checks.FAIL_MARK
        print(f"  fixture aliasing {mark} {check_id}: "
              f"{tested[check_id]} container(s) mutation-tested")
        for where, leak in leaks:
            print(f"        {where}: {leak}")
    for check_id, leaks in by_id.items():  # e.g. the <sweep> restore sentinel
        for where, leak in leaks:
            print(f"  fixture aliasing {checks.FAIL_MARK} {check_id} {where}: {leak}")
    mark = checks.PASS_MARK if not failures else checks.FAIL_MARK
    print(f"  fixture aliasing {mark} all fixture pairs are aliasing-safe")
    return len(failures)


def run_aliasing_detection_cases():
    """_aliasing_failures must fire for every shape of shared container.

    The original sweep only descended into keys whose value differed from
    BASE_OBS and only yielded a dict when the base value was not a dict, so a
    shared `click`, `console` or `signalsContext` dict -- any container
    matching BASE_OBS's shape -- was invisible: ac3-spa-nav, ac5-console and
    ac6-signals reported "no custom mutables to test" and a green tick. Each
    case plants one deliberately-aliased container in a synthetic fixture
    mapping and requires the sweep to name exactly the planted pairs; the
    clean case must stay silent.
    """
    shared_click = click_result()
    shared_console = {"errors": 0, "warnings": 0, "lines": []}
    shared_ctx = {"profile": {"total_product_views": 2},
                  "recent_activity": "- product_viewed: p1",
                  "agent_instructions": ""}
    shared_profile = {"total_product_views": 2}
    shared_turns = [turn()]
    shared_browse = browse()
    base = copy.deepcopy(BASE_OBS)
    base_backed = copy.deepcopy(BASE_OBS)
    base_backed["console"] = base["console"]

    cases = [
        ("shared click dict between good and bad",
         {"x": (obs(click=shared_click), obs(click=shared_click))},
         copy.deepcopy(BASE_OBS), {"x"}),
        ("shared console dict across two pairs",
         {"x": (obs(console=shared_console), obs()),
          "y": (obs(console=shared_console), obs())},
         copy.deepcopy(BASE_OBS), {"x", "y"}),
        ("shared signalsContext dict between good and bad",
         {"x": (obs(signalsContext=shared_ctx), obs(signalsContext=shared_ctx))},
         copy.deepcopy(BASE_OBS), {"x"}),
        ("shared profile inside distinct signalsContexts",
         {"x": (obs(signalsContext={"profile": shared_profile,
                                    "recent_activity": "- pv",
                                    "agent_instructions": ""}),
                obs(signalsContext={"profile": shared_profile,
                                    "recent_activity": "No events buffered.",
                                    "agent_instructions": ""}))},
         copy.deepcopy(BASE_OBS), {"x"}),
        ("shared turns list between good and bad",
         {"x": (obs(turns=shared_turns), obs(turns=shared_turns))},
         copy.deepcopy(BASE_OBS), {"x"}),
        ("shared browse dict between good and bad",
         {"x": (obs(browse=shared_browse), obs(browse=shared_browse))},
         copy.deepcopy(BASE_OBS), {"x"}),
        ("fixture reusing a BASE_OBS container",
         {"x": (base_backed, obs())},
         base, {"x"}),
        ("independent containers everywhere",
         {"x": (obs(turns=[turn()], click=click_result()),
                obs(turns=[turn(cards=[])], click=click_result())),
          "y": (obs(console={"errors": 0, "warnings": 0, "lines": []}),
                obs(console={"errors": 1, "warnings": 0, "lines": []}))},
         copy.deepcopy(BASE_OBS), set()),
    ]

    failures = 0
    for label, fixtures, base_obs, want in cases:
        found, _tested = _aliasing_failures(fixtures, base_obs)
        got = {check_id for check_id, _where, _leak in found}
        ok = got == want
        failures += 0 if ok else 1
        mark = checks.PASS_MARK if ok else checks.FAIL_MARK
        print(f"  aliasing-det {mark} {label:<44} -> "
              f"flagged {sorted(got) or 'nothing'}"
              + ("" if ok else f"  expected {sorted(want) or 'nothing'}"))
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


def browse(productPages=2, productViewed=2, sids=("a1b2",), events=None):
    """One browse phase as phase A records it.

    A factory, not a constant, for the same reason as invented_card(): two
    fixtures sharing one nested list is the aliasing bug this file already has a
    regression test for. `sids` is taken as a tuple and copied into a list so a
    default argument can never be mutated by a caller.
    """
    return {"paths": ["/products/a", "/products/b"],
            "productPages": productPages,
            "productViewed": productViewed,
            "sids": list(sids),
            "events": dict(events) if events is not None
                      else {"product_viewed": productViewed, "pv": 5}}


def complete_obs(**overrides):
    """A whole run in which every check id produces at least one PASSING result.

    The baseline for the evaluate() cases: start from all-green, then break one
    thing, so a failure can only come from the thing that was broken.
    """
    merged = obs(
        turns=[turn(), turn(label="3-details"), zero_match_turn()],
        expectedTurns=3,
        click=click_result(),
        browse=browse(),
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


def _unlabelled(t):
    """A phase-A turn that lost its `label` -- the malformed shape the per-turn
    result ids must survive."""
    del t["label"]
    return t


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

# AC3: `landed and survived and preserved`, where preserved is itself
# `chatMessagesAfter > 0 and cardsAfter > 0`. AC3_URL_CASES only ever drives
# `landed`, and the fixture/fault pair covers `survived` and the cardsAfter half
# of `preserved` -- so the transcript half needs a case of its own. Every case
# here keeps clickedUri set, or the predicate takes its "no card was clickable"
# branch and proves nothing about the three terms.
AC3_PRESERVE_CASES = [
    ("chat and prior cards both survived the click",
     obs(click=click_result()), True),
    ("full page load wiped the SPA probe",
     obs(click=click_result(spaProbeSurvived=False)), False),
    ("transcript wiped, prior cards intact",
     obs(click=click_result(chatMessagesAfter=0)), False),
    ("prior cards wiped, transcript intact",
     obs(click=click_result(cardsAfter=0)), False),
    ("widget remounted empty", obs(click=click_result(
        spaProbeSurvived=False, chatMessagesAfter=0, cardsAfter=0)), False),
    ("no card item carried a uri to click",
     obs(click=click_result(clickedUri=None)), False),
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

# AC5: `errors == 0 and warnings == 0`. A run with warnings but no errors is the
# shape the errors-only fixture could never reach.
AC5_CONSOLE_CASES = [
    ("console clean",
     obs(console={"errors": 0, "warnings": 0, "lines": []}), True),
    ("errors only",
     obs(console={"errors": 1, "warnings": 0, "lines": []}), False),
    ("warnings only",
     obs(console={"errors": 0, "warnings": 3, "lines": []}), False),
    ("both errors and warnings",
     obs(console={"errors": 2, "warnings": 1, "lines": []}), False),
]

# AC6a: `expected > 0 and actual == expected and len(sids) == 1`. The count term
# is the only one the fixture pair reaches; a browse plan with no product pages
# would otherwise pass vacuously, and a session id that rotated mid-run -- the
# theory probe_rotation.py and probe_session.py were written to chase -- would
# go unreported.
AC6_COLLECTOR_CASES = [
    ("one product_viewed per product page, one sid", obs(browse=browse()), True),
    ("no product pages in the browse plan",
     obs(browse=browse(productPages=0, productViewed=0, events={"pv": 5})), False),
    ("fewer product_viewed than product pages",
     obs(browse=browse(productViewed=1)), False),
    ("more product_viewed than product pages (double-track)",
     obs(browse=browse(productViewed=4)), False),
    ("two session ids on the wire",
     obs(browse=browse(sids=("a1b2", "c3d4"))), False),
    ("no session id on the wire at all",
     obs(browse=browse(sids=())), False),
]

# AC6b: `bool(profile) and not unbuffered`, behind an errored-poll guard. The
# marker term is the "No events buffered" assertion whose absence let a broken
# run report PASS for a day, so it gets a case with a POPULATED profile -- the
# only shape that reaches it.
AC6_SIGNALS_CASES = [
    ("populated profile with recorded activity",
     obs(signalsContext={"profile": {"total_product_views": 2},
                         "recent_activity": "- product_viewed: p1",
                         "agent_instructions": ""}), True),
    ("empty profile despite recorded activity",
     obs(signalsContext={"profile": {},
                         "recent_activity": "- product_viewed: p1",
                         "agent_instructions": ""}), False),
    ("profile populated but no events buffered",
     obs(signalsContext={"profile": {"total_product_views": 2},
                         "recent_activity": "No events buffered. Based on last "
                                            "100 recorded events for the last "
                                            "3600 seconds.",
                         "agent_instructions": ""}), False),
    ("neither a profile nor a buffered event",
     obs(signalsContext={"profile": {},
                         "recent_activity": "No events buffered.",
                         "agent_instructions": ""}), False),
    ("the poll itself failed, whatever came back with it",
     obs(signalsContext={"profile": {"total_product_views": 2},
                         "recent_activity": "- product_viewed: p1",
                         "error": "HTTPError: 401 Unauthorized",
                         "agent_instructions": ""}), False),
]

# The per-turn predicates format the turn's label into their result id. A turn
# dict that lost its `label` must come back as a red CheckResult with a readable
# id, never as a KeyError out of evaluate() -- reporting, not crashing, is the
# whole job. Content is broken alongside the missing label so the expected
# verdict is red on its own terms, not green-with-a-placeholder. ac7-zero-match
# has no case here: it selects control turns BY label, so an unlabelled turn
# never reaches its id formatting.
UNLABELLED_TURN_CASES = [
    ("ac1-commentary", obs(turns=[_unlabelled(turn(prose=""))])),
    ("ac2-cards", obs(turns=[_unlabelled(turn(cards=[]))])),
    ("ac4-mode", obs(turns=[_unlabelled(turn(mode=None, modes=[]))])),
]

# check_signals_profile's detail string names the state of recent_activity --
# it is what someone reads while debugging a failed ac6-signals. An empty
# string once read as 'populated', exactly the wrong hint mid-debug. Pass/fail
# is AC6_SIGNALS_CASES' job; these pin the wording only.
# (case label, signalsContext, the state the detail must name)
AC6_DETAIL_CASES = [
    ("empty recent_activity reads as empty",
     {"profile": {"total_product_views": 2}, "recent_activity": "",
      "agent_instructions": ""}, "empty"),
    ("no-events marker reads as empty-marker",
     {"profile": {"total_product_views": 2},
      "recent_activity": "No events buffered.",
      "agent_instructions": ""}, "empty-marker"),
    ("recorded activity reads as populated",
     {"profile": {"total_product_views": 2},
      "recent_activity": "- product_viewed: p1",
      "agent_instructions": ""}, "populated"),
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


# Each `bad` fixture breaks exactly ONE term of its predicate, and wherever the
# predicate is a conjunction the matching fault hook in checks.py breaks a
# different one. (ac1-commentary has a single term, so its fixture and its fault
# necessarily drive the same thing.) A fixture that breaks two terms of a
# conjunction proves only the first.
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
        # survived term. clickedUri and cardsAfter stay valid on purpose: zero
        # them too and the predicate takes its "no card was clickable" branch or
        # short-circuits before `preserved`, which is the fault hook's job.
        obs(click=click_result(spaProbeSurvived=False, cardsAfter=4)),
    ),
    "ac4-mode": (
        obs(turns=[turn()]),
        # mode term; the masked-UNRENDERABLE modes-list term is the fault hook's
        # job. A fixture recording mode="UNRENDERABLE" breaks BOTH terms and
        # short-circuits on the modes list, leaving the mode term unproven here.
        obs(turns=[turn(mode=None, modes=[])]),
    ),
    "ac5-console": (
        obs(console={"errors": 0, "warnings": 0, "lines": []}),
        # warnings term; the errors term is the fault hook's job
        obs(console={"errors": 0, "warnings": 1, "lines": []}),
    ),
    "ac6-collector": (
        obs(browse=browse()),
        # count term; the session-id term is the fault hook's job and the
        # were-there-any-product-pages term is AC6_COLLECTOR_CASES'
        obs(browse=browse(productViewed=0, events={"pv": 5})),
    ),
    "ac6-signals": (
        obs(signalsContext={"profile": {"total_product_views": 2,
                                        "recently_viewed_product_ids": "p1, p2"},
                            "recent_activity": "- product_viewed: p1",
                            "agent_instructions": ""}),
        # empty-profile term. recent_activity is POPULATED: pair an empty
        # profile with the no-events marker and the conjunction short-circuits
        # on the profile, leaving the marker term -- the "No events buffered"
        # assertion whose absence let a broken run report PASS for a day --
        # unproven. The marker term is the fault hook's job.
        obs(signalsContext={"profile": {},
                            "recent_activity": "- product_viewed: p1",
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


def run_fault_isolation_cases():
    """Each fault must fire against a WHOLE run, and take nothing else with it.

    run_fault_cases() applies a fault to that check's own minimal fixture, where
    every other area of the observation is the empty BASE_OBS default. That
    cannot tell a fault that works from one that only works on a skeleton, and
    it cannot see collateral: a fault which also trips a neighbouring check
    makes a live VERIFY_FAULT run ambiguous about what it just proved.
    """
    failures = 0
    for check_id in checks.CHECK_ORDER:
        corrupted = complete_obs()
        checks.apply_fault(corrupted, check_id)
        run = checks.evaluate(corrupted)
        failed = sorted({r.id.split("[")[0] for r in run.failed})
        ok = failed == [check_id]
        failures += 0 if ok else 1
        print(f"  isolation  {checks.PASS_MARK if ok else checks.FAIL_MARK} "
              f"{check_id + ' alone fails a whole run':<44}"
              + ("" if ok else f"  failed: {failed or 'nothing'}"))
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
    failures += run_fault_isolation_cases()
    failures += test_fixture_aliasing()
    failures += run_aliasing_detection_cases()
    failures += run_redact_cases()
    failures += run_predicate_cases("ac0-turns", "ac0-turns", AC0_TURN_CASES)
    failures += run_predicate_cases("ac2-token", "ac2-cards", AC2_TOKEN_CASES)
    failures += run_predicate_cases("ac3-url", "ac3-spa-nav", AC3_URL_CASES)
    failures += run_predicate_cases("ac3-keep", "ac3-spa-nav", AC3_PRESERVE_CASES)
    failures += run_predicate_cases("ac4-mode", "ac4-mode", AC4_MODE_CASES)
    failures += run_predicate_cases("ac5-cons", "ac5-console", AC5_CONSOLE_CASES)
    failures += run_predicate_cases("ac6-coll", "ac6-collector", AC6_COLLECTOR_CASES)
    failures += run_predicate_cases("ac6-sig", "ac6-signals", AC6_SIGNALS_CASES)
    failures += run_predicate_cases("ac7-token", "ac7-zero-match", AC7_TOKEN_CASES)
    failures += run_unlabelled_turn_cases()
    failures += run_signals_detail_cases()
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
