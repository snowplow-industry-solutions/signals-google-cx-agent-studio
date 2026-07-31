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
    run = CheckRun()
    for check_id in CHECK_ORDER:
        fn = PREDICATES.get(check_id)
        if fn is None:
            continue
        for result in fn(obs):
            run.record(result)
    return run


def _widget_turns(obs):
    return [t for t in obs.get("turns", []) if t.get("isWidgetTurn")]


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

    Recording the mode alone would not catch 'Widget payload unrenderable',
    which is the failure path.
    """
    results = []
    for t in _widget_turns(obs):
        mode = t.get("mode")
        results.append(CheckResult(
            id=f"ac4-mode[{t['label']}]",
            label="delivery mode is payload-mode or token-mode",
            passed=mode in VALID_MODES,
            detail=f"mode={mode!r} wire={t.get('wire')}",
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

def _fault_commentary(obs):
    for t in obs.get("turns", []):
        if t.get("isWidgetTurn"):
            t["prose"] = ""


def _fault_cards(obs):
    for t in obs.get("turns", []):
        if t.get("isWidgetTurn"):
            t["cards"] = []
            t["rawToken"] = True


def _fault_mode(obs):
    for t in obs.get("turns", []):
        if t.get("isWidgetTurn"):
            t["mode"] = "UNRENDERABLE"


def _fault_zero_match(obs):
    for t in obs.get("turns", []):
        if t.get("label", "").endswith("zero-match"):
            t["cards"] = [{"kind": "base_product_detail",
                           "items": [{"uri": "/products/invented", "img": None,
                                      "text": ["Invented Product"]}]}]


def _fault_console(obs):
    obs.setdefault("console", {})["errors"] = 1


def _fault_collector(obs):
    obs.setdefault("browse", {})["productViewed"] = 0


def _fault_signals(obs):
    obs["signalsContext"] = {
        "profile": {},
        "recent_activity": "No events buffered. Based on last 100 recorded "
                           "events for the last 3600 seconds.",
        "agent_instructions": "",
    }


def _fault_spa_nav(obs):
    click = obs.setdefault("click", {})
    click["spaProbeSurvived"] = False
    click["cardsAfter"] = 0


FAULTS = {
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
