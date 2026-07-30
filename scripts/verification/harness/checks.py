"""Pure assertions over a recorded Observation.

Nothing in this module imports Playwright. Every predicate takes the plain dict
produced by phase A and returns CheckResults, which is what makes both
--selfcheck (synthetic observations) and VERIFY_FAULT (a corrupted real
observation) possible.
"""

from dataclasses import dataclass

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
