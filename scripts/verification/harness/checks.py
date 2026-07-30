"""Pure assertions over a recorded Observation.

Nothing in this module imports Playwright. Every predicate takes the plain dict
produced by phase A and returns CheckResults, which is what makes both
--selfcheck (synthetic observations) and VERIFY_FAULT (a corrupted real
observation) possible.
"""

from dataclasses import dataclass

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
