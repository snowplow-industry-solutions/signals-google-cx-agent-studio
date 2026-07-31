"""Pure assertions over a recorded Observation.

Nothing in this module imports Playwright. Every predicate takes the plain dict
produced by phase A and returns CheckResults, which is what makes both
--selfcheck (synthetic observations) and VERIFY_FAULT (a corrupted real
observation) possible.
"""

from dataclasses import dataclass
from urllib.parse import urlsplit

from harness.config import MIN_PROSE

PASS_MARK = "✓"
FAIL_MARK = "✗"

PREDICATES = {}
CHECK_ORDER = [
    "ac0-turns",
    "ac1-commentary",
    "ac2-cards",
    "ac3-spa-nav",
    "ac4-mode",
    "ac5-console",
    "ac6-collector",
    "ac6-signals",
    "ac7-zero-match",
]

VALID_MODES = ("payload-mode", "token-mode")

# The Signals event-log summary when nothing has been ingested for the session.
NO_EVENTS_MARKER = "No events buffered"


@dataclass
class CheckResult:
    id: str
    label: str
    passed: bool
    detail: str = ""


class CheckRun:
    def __init__(self):
        self.results = []

    def record(self, result):
        self.results.append(result)

    @property
    def failed(self):
        return [r for r in self.results if not r.passed]

    @property
    def exit_code(self):
        return 1 if self.failed else 0

    def render(self):
        lines = []
        for r in self.results:
            lines.append(f"  {PASS_MARK if r.passed else FAIL_MARK} {r.id}  {r.label}")
            if not r.passed and r.detail:
                lines.append(f"        {r.detail}")
        passed = len(self.results) - len(self.failed)
        lines.append(f"\n  === {passed}/{len(self.results)} checks passed ===")
        return "\n".join(lines)


def predicate(check_id):
    def register(fn):
        PREDICATES[check_id] = fn
        return fn
    return register


def evaluate(obs):
    """Run every registered predicate over one observation.

    A predicate that returns nothing is recorded as a FAILURE, not skipped.
    The per-turn checks iterate widget turns, and a turn that timed out has no
    cards, so it is not a widget turn -- which meant a run where every turn
    timed out produced zero results and reported all-green. Silence is the one
    thing this harness must never read as a pass.
    """
    run = CheckRun()
    for check_id in CHECK_ORDER:
        fn = PREDICATES.get(check_id)
        if fn is None:
            continue
        results = list(fn(obs))
        if not results:
            run.record(CheckResult(
                id=check_id,
                label="had at least one instance to evaluate",
                passed=False,
                detail="no instances to evaluate -- the check asserted nothing",
            ))
            continue
        for result in results:
            run.record(result)
    return run


def _widget_turns(obs):
    return [t for t in obs.get("turns", []) if t.get("isWidgetTurn")]


@predicate("ac0-turns")
def check_turns_completed(obs):
    """AC0: every planned turn ran and came back with a reply.

    The gate in front of every per-turn check. `timedOut` was recorded by phase
    A from the first commit and read by nobody: a turn that times out has no
    cards, so it is not a widget turn, so ac1/ac2/ac4 emit no results for it.
    Three of five turns timing out still printed `8/8 checks passed`, exit 0.
    """
    turns = obs.get("turns") or []
    expected = obs.get("expectedTurns")
    timed_out = [t.get("label") for t in turns if t.get("timedOut")]
    counted = isinstance(expected, int) and expected > 0 and len(turns) == expected
    return [CheckResult(
        id="ac0-turns",
        label="every planned turn ran and returned a reply",
        passed=counted and not timed_out,
        detail=(f"{len(turns)} turn(s) recorded, expectedTurns={expected!r}; "
                f"timed out: {timed_out or 'none'}"),
    )]


@predicate("ac1-commentary")
def check_commentary(obs):
    """AC1 (issue #3): every widget turn also carries a text bubble.

    Prose arrives already stripped of [data-widget-card] subtrees, so card text
    cannot be mistaken for commentary.
    """
    results = []
    for t in _widget_turns(obs):
        prose = (t.get("prose") or "").strip()
        results.append(CheckResult(
            id=f"ac1-commentary[{t['label']}]",
            label="text bubble accompanied the cards",
            passed=len(prose) >= MIN_PROSE,
            detail=f"prose was {len(prose)} chars: {prose[:80]!r}",
        ))
    return results


@predicate("ac2-cards")
def check_cards(obs):
    """AC2 (issue #1): cards rendered, and no raw {@Widget: token leaked."""
    results = []
    for t in _widget_turns(obs):
        cards = t.get("cards") or []
        raw = bool(t.get("rawToken"))
        results.append(CheckResult(
            id=f"ac2-cards[{t['label']}]",
            label="cards rendered, no raw {@Widget: token",
            passed=bool(cards) and not raw,
            detail=f"{len(cards)} card(s), rawToken={raw}",
        ))
    return results


@predicate("ac3-spa-nav")
def check_spa_navigation(obs):
    """AC3: a card click SPA-navigates and preserves the conversation.

    spaProbeSurvived is an in-page variable set before the click; a full page
    load would remount the widget and wipe it, along with the transcript.

    Three clauses below are diagnostics, not assertions: the no-clickable-card
    early return, the `not after or not clicked_uri` fallback, and the truthiness
    half of `clicked_last and clicked_last == after_last`. Deleting any of them
    leaves --selfcheck green, which normally means an unfailable term -- here it
    means the verdict is unchanged and only the message would get worse. Every
    shape they catch already fails on `landed`, verified by enumerating the
    clickedUri x afterUrl x survived x messagesAfter x cardsAfter space.
    """
    click = obs.get("click") or {}
    if not click.get("clickedUri"):
        return [CheckResult(
            id="ac3-spa-nav", label="a card was clickable",
            passed=False, detail="no card item with a uri was found to click",
        )]

    after = click.get("afterUrl") or ""
    clicked_uri = (click.get("clickedUri") or "").rstrip("/")

    if not after or not clicked_uri:
        landed = False
    else:
        after_path = urlsplit(after).path.rstrip("/")
        clicked_last = clicked_uri.split("/")[-1]
        after_last = after_path.split("/")[-1] if after_path else ""
        landed = clicked_last and clicked_last == after_last

    survived = bool(click.get("spaProbeSurvived"))
    preserved = (click.get("chatMessagesAfter") or 0) > 0 and \
                (click.get("cardsAfter") or 0) > 0

    return [CheckResult(
        id="ac3-spa-nav",
        label="card click SPA-navigated, chat and prior cards preserved",
        passed=landed and survived and preserved,
        detail=(f"landed={landed} ({after!r}) spaProbeSurvived={survived} "
                f"messagesAfter={click.get('chatMessagesAfter')} "
                f"cardsAfter={click.get('cardsAfter')}"),
    )]


@predicate("ac4-mode")
def check_delivery_mode(obs):
    """AC4: the delivery mode per turn is one of the two known-good ones.

    Reads the whole `modes` list, not just the last mark. A turn rendering two
    cards where the first fails logs ["UNRENDERABLE", "payload-mode"], and an
    assertion on the last entry alone reports payload-mode and passes -- the
    failure path this check exists for, masked by a later success.
    """
    results = []
    for t in _widget_turns(obs):
        modes = t.get("modes") or []
        mode = t.get("mode")
        results.append(CheckResult(
            id=f"ac4-mode[{t['label']}]",
            label="delivery mode is payload-mode or token-mode",
            passed="UNRENDERABLE" not in modes and mode in VALID_MODES,
            detail=f"mode={mode!r} modes={modes} wire={t.get('wire')}",
        ))
    return results


@predicate("ac7-zero-match")
def check_zero_match(obs):
    """AC7: the zero-match control turn degrades to plain text.

    Asserts on cards and tokens, not prose content: the legitimate 'no such
    item, shall I broaden?' reply may name real catalog products, so scanning
    the prose would false-positive.
    """
    controls = [t for t in obs.get("turns", [])
                if t.get("label", "").endswith("zero-match")]
    if not controls:
        return [CheckResult(
            id="ac7-zero-match",
            label="zero-match control turn present",
            passed=False,
            detail="no turn labelled *zero-match was recorded",
        )]
    results = []
    for t in controls:
        cards = t.get("cards") or []
        raw = bool(t.get("rawToken"))
        results.append(CheckResult(
            id=f"ac7-zero-match[{t['label']}]",
            label="degraded to plain text, no invented product",
            passed=not cards and not raw,
            detail=f"{len(cards)} card(s) rendered, rawToken={raw}",
        ))
    return results


@predicate("ac5-console")
def check_console_clean(obs):
    """AC5: zero console errors or warnings across the entire run."""
    console = obs.get("console", {})
    errors = console.get("errors", 0)
    warnings = console.get("warnings", 0)
    return [CheckResult(
        id="ac5-console",
        label="no console errors or warnings",
        passed=errors == 0 and warnings == 0,
        detail=f"{errors} error(s), {warnings} warning(s)",
    )]


@predicate("ac6-collector")
def check_collector_events(obs):
    """AC6a: product_viewed reached the collector, once per product page.

    This is the issue #7 class of bug -- the storefront logs success whether or
    not the tracker actually fired, so only the collector POST body settles it.
    """
    browse = obs.get("browse") or {}
    expected = browse.get("productPages", 0)
    actual = browse.get("productViewed", 0)
    sids = browse.get("sids") or []
    return [CheckResult(
        id="ac6-collector",
        label="product_viewed reached the collector under one session id",
        passed=expected > 0 and actual == expected and len(sids) == 1,
        detail=(f"product_viewed={actual} expected={expected} "
                f"sids={sids} events={browse.get('events')}"),
    )]


@predicate("ac6-signals")
def check_signals_profile(obs):
    """AC6b: getUserContext would return a populated profile.

    The assertion whose absence cost a day: the 2026-07-30 issue #3 runs
    footnoted an empty profile as a curiosity and passed anyway.
    """
    ctx = obs.get("signalsContext") or {}
    if ctx.get("error"):
        return [CheckResult(
            id="ac6-signals", label="/api/agent/context returned a profile",
            passed=False, detail=f"poll failed: {ctx['error']}",
        )]
    profile = ctx.get("profile") or {}
    activity = ctx.get("recent_activity") or ""
    unbuffered = NO_EVENTS_MARKER in activity
    return [CheckResult(
        id="ac6-signals",
        label="Signals returned a populated profile",
        passed=bool(profile) and not unbuffered,
        detail=(f"{len(profile)} profile attribute(s), "
                f"recent_activity={'empty-marker' if unbuffered else 'populated'}: "
                f"{activity[:100]!r}"),
    )]


# --- Fault injection -------------------------------------------------------
#
# --selfcheck proves a predicate can fail when handed a bad observation.
# It cannot prove the predicate is reading the field phase A actually writes.
# These faults corrupt a REAL observation between phases, so a predicate wired
# to the wrong key passes its selfcheck and still fails here.
#
# Each fault corrupts ONE term of its predicate, and wherever that predicate's
# verdict is a conjunction the matching `bad` fixture in selfcheck.py corrupts a
# DIFFERENT one. (ac1-commentary is the one single-term predicate, so its
# fixture and its fault necessarily drive the same thing.) A fault that breaks
# two terms of a conjunction proves only whichever short-circuits first: the
# original _fault_cards emptied `cards` as well as flipping `rawToken`, so
# `bool(cards) and not raw` never reached the token term -- and deleting that
# term outright still passed both mechanisms.
#
# The pairing is verified by gutting: delete any one term and --selfcheck must
# go red. Terms that neither mechanism can isolate get a named case list in
# selfcheck.py instead.

def _fault_turns(obs):
    # Drop a recorded turn, so the expectedTurns half of ac0 fires. The
    # timedOut half is proven by the ac0-turns selfcheck fixture pair.
    obs["turns"] = list(obs.get("turns") or [])[1:]


def _fault_commentary(obs):
    for t in obs.get("turns", []):
        if t.get("isWidgetTurn"):
            t["prose"] = ""


def _fault_cards(obs):
    # rawToken ONLY -- leave the cards in place. This is the issue #1 leak, and
    # it is the term a card-emptying fault could never reach.
    for t in obs.get("turns", []):
        if t.get("isWidgetTurn"):
            t["rawToken"] = True


def _fault_mode(obs):
    # Mask an UNRENDERABLE behind a later success, leaving `mode` valid: the
    # only corruption that proves the predicate reads the whole `modes` list.
    for t in obs.get("turns", []):
        if t.get("isWidgetTurn"):
            t["modes"] = ["UNRENDERABLE"] + list(t.get("modes") or [])


def _fault_zero_match(obs):
    # rawToken ONLY, for the same reason as _fault_cards: `not cards and not
    # raw` short-circuits on the cards term, so an invented-card fault leaves
    # the token term unproven.
    for t in obs.get("turns", []):
        if t.get("label", "").endswith("zero-match"):
            t["rawToken"] = True


def _fault_console(obs):
    # errors ONLY -- the warnings count stays as observed. `errors == 0 and
    # warnings == 0` short-circuits on errors, so the warnings term is the
    # `bad` fixture's job.
    obs.setdefault("console", {})["errors"] = 1


def _fault_collector(obs):
    # A second session id ONLY -- the counts stay correct. `expected > 0 and
    # actual == expected and len(sids) == 1` short-circuits left to right, so a
    # fault that zeroes productViewed (as this one used to) can never reach the
    # session-id term; that is the rotating-session theory probe_rotation.py and
    # probe_session.py chased, and it must not be deletable. The count term is
    # the `bad` fixture's job.
    browse = obs.setdefault("browse", {})
    browse["sids"] = list(browse.get("sids") or []) + ["f00dcafe"]


def _fault_signals(obs):
    # The no-events marker ONLY, leaving the observed profile in place. This is
    # the assertion whose absence cost a day, and `bool(profile) and not
    # unbuffered` short-circuits: the old fault emptied the profile as well, so
    # the marker term was never reached and could have been deleted outright.
    # The empty-profile term is the `bad` fixture's job.
    obs.setdefault("signalsContext", {})["recent_activity"] = (
        "No events buffered. Based on last 100 recorded "
        "events for the last 3600 seconds.")


def _fault_spa_nav(obs):
    # cardsAfter ONLY, leaving spaProbeSurvived and clickedUri as recorded:
    # `landed and survived and preserved` short-circuits, so a fault that also
    # flips spaProbeSurvived stops at the survived term and leaves `preserved`
    # unproven. The survived term is the `bad` fixture's job.
    obs.setdefault("click", {})["cardsAfter"] = 0


FAULTS = {
    "ac0-turns": _fault_turns,
    "ac1-commentary": _fault_commentary,
    "ac2-cards": _fault_cards,
    "ac3-spa-nav": _fault_spa_nav,
    "ac4-mode": _fault_mode,
    "ac5-console": _fault_console,
    "ac6-collector": _fault_collector,
    "ac6-signals": _fault_signals,
    "ac7-zero-match": _fault_zero_match,
}


def apply_fault(obs, check_id):
    """Corrupt the observation so check_id must fail. Raises KeyError if unknown."""
    FAULTS[check_id](obs)
