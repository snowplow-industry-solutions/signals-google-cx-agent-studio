"""Asserting E2E harness for the runbook §11.5 widget walkthrough (issue #9).

Phase A drives one browser session and records an Observation; phase B runs
pure predicates over it. The scripts this replaces printed and let a human
judge, which is how the 2026-07-30 issue #3 runs reported PASS while carrying
the empty Signals profile that turned out to be issue #7.

Usage:
  VERIFY_BASE=https://... AGENT_SHARED_SECRET=... python3 scripts/verification/verify_widgets.py
  python3 scripts/verification/verify_widgets.py --selfcheck
  VERIFY_FAULT=ac6-signals VERIFY_BASE=... AGENT_SHARED_SECRET=... python3 scripts/verification/verify_widgets.py

Exit codes: 0 all checks passed, 1 one or more failed, 2 misconfigured.
"""

import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from playwright.sync_api import sync_playwright  # noqa: E402

from harness import checks, config, selfcheck  # noqa: E402
from harness.chat import ChatPanel, RendererLog  # noqa: E402
from harness.collector import Recorder  # noqa: E402
from harness.context import poll_context  # noqa: E402
from harness.redact import redact  # noqa: E402

# Browse plan. SPA clicks where possible, mirroring docs/demo-script.md;
# probe_issue7_fix.py remains the dedicated full-load-vs-SPA regression check.
BROWSE = [
    "/",
    "/collections/city-after-dark",
    "/products/ivory-silk-column-dress",
    "/collections/city-after-dark",
    "/products/noir-double-breasted-blazer",
    "/collections/accessory-atelier",
]
PRODUCT_PAGES = len([p for p in BROWSE if p.startswith("/products/")])

TURNS = [
    ("2a-carousel", "Can you recommend a couple of accessories to go with an evening look?"),
    ("3-details", "Tell me more about the {product}."),
    ("2b-carousel", "What else from the evening edit would work with that?"),
    ("3b-details", "Show me the Noir Double-Breasted Blazer."),
    ("5-zero-match", "Do you have any neon orange swimwear under $15?"),
]

# Redaction of the CES token broker's chatToken lives in harness/redact.py so
# that the probes writing their own reports get it too.


def _browse(page, base, out):
    """Home, then the browse plan by SPA click where a matching link exists."""
    page.goto(base + BROWSE[0], wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(4000)
    for path in BROWSE[1:]:
        link = page.locator(f"a[href='{path}']").first
        if link.count():
            link.click()
        else:
            page.goto(base + path, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(6000)
    page.screenshot(path=f"{out}/verify-00-browsed.png")


def _catalog_product(page):
    """A real product name for the 'ask by name' turn."""
    cards = page.locator("a[href^='/products/']")
    for i in range(min(cards.count(), 10)):
        text = (cards.nth(i).inner_text() or "").strip()
        if text:
            return text.split("\n")[0]
    return "Silk Twill Square Scarf"


def _run_turn(chat, log, page, out, label, prompt):
    chat.quiesce()
    state0 = chat.read_state()
    before = state0["count"] if state0.get("ok") else 0
    since = time.time()
    print(f"\n  turn {label}: {prompt}")

    chat.send(prompt)
    state, timed_out = chat.wait_for_reply(before, prompt)
    bubbles = chat.agent_bubbles(state, before, prompt)

    cards = [c for m in bubbles for c in m["cards"]]
    prose = "\n".join(m["prose"].strip() for m in bubbles if m["prose"].strip())
    raw_token = any(m["rawToken"] for m in bubbles)
    modes = log.marks_since(since)
    wire = set()
    for n in log.net_since(since):
        if n.get("hasToken"):
            wire.add("wire:text-token")
        if n.get("hasPayloadType"):
            wire.add("wire:structured-payload")

    shot = f"verify-turn-{label}.png"
    page.screenshot(path=f"{out}/{shot}")

    print(f"    cards={[c['kind'] for c in cards]} mode={modes[-1] if modes else None} "
          f"prose={len(prose)}ch timed_out={timed_out}")

    return {
        "label": label,
        "prompt": prompt,
        "prose": prose,
        "cards": cards,
        "rawToken": raw_token,
        "mode": modes[-1] if modes else None,
        "wire": sorted(wire),
        "isWidgetTurn": bool(cards),
        "timedOut": timed_out,
        "screenshot": shot,
    }


def _click_card(chat, page, out):
    """Click the last rendered card item and check what survived."""
    page.evaluate("() => { window.__spaProbe = 'alive'; }")
    before_url = page.url
    clicked = chat.click_last_card_item()
    if not clicked:
        return {"clickedUri": None}
    page.wait_for_timeout(5000)
    after = chat.read_state()
    page.screenshot(path=f"{out}/verify-cardclick.png")
    return {
        "clickedUri": clicked,
        "beforeUrl": before_url,
        "afterUrl": page.url,
        "spaProbeSurvived": page.evaluate("() => window.__spaProbe || null") == "alive",
        "chatMessagesAfter": after.get("count", 0),
        "cardsAfter": sum(len(m["cards"]) for m in after.get("messages", [])),
    }


def observe(base, secret, observation):
    """Populate `observation` in place with the walkthrough evidence.

    Takes the dict to fill rather than building and returning a fresh one:
    the walkthrough runs for minutes against a live agent, and the caller
    (main) keeps its own reference to this same dict, so a crash partway
    through still leaves whatever was captured so far available to write out
    before the exception propagates.
    """
    out = config.out_dir()
    observation.setdefault("browse", {})
    observation.setdefault("signalsContext", {})
    observation.setdefault("turns", [])
    observation.setdefault("click", {})
    observation.setdefault("console", {"errors": 0, "warnings": 0, "lines": []})

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        page = browser.new_page(viewport={"width": 1500, "height": 1080})
        recorder = Recorder(page)
        log = RendererLog(page)
        chat = ChatPanel(page)

        try:
            print("  browsing to build Signals context...")
            _browse(page, base, out)
            counts = recorder.counts()
            sids = sorted(recorder.sids)
            observation["browse"] = {
                "paths": BROWSE,
                "events": counts,
                "sids": sids,
                "productViewed": counts.get("product_viewed", 0),
                "productPages": PRODUCT_PAGES,
            }
            print(f"    events on the wire: {counts}  sids={sids}")

            session_id = recorder.forwarded_id() or (sids[0] if sids else None)
            if session_id:
                print(f"  polling /api/agent/context for session {session_id}...")
                observation["signalsContext"] = poll_context(base, secret, session_id)
                ctx = observation["signalsContext"]
                print(f"    {len(ctx.get('profile') or {})} profile attribute(s) "
                      f"after {ctx.get('polledAfterSeconds', 0):.0f}s "
                      f"({ctx.get('attempts')} attempt(s))")
            else:
                observation["signalsContext"] = {
                    "profile": {}, "recent_activity": "", "agent_instructions": "",
                    "error": "no session id appeared in any collector POST body",
                }

            product = _catalog_product(page)
            chat.open()
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{out}/verify-01-chat-open.png")

            for label, template in TURNS:
                observation["turns"].append(
                    _run_turn(chat, log, page, out, label,
                              template.format(product=product)))

            observation["click"] = _click_card(chat, page, out)
            page.screenshot(path=f"{out}/verify-99-styling.png")
        finally:
            counts = log.console_counts()
            observation["console"] = {
                "errors": counts["errors"],
                "warnings": counts["warnings"],
                "lines": redact(counts["lines"]),
            }
            browser.close()

    return observation


def main(argv):
    if "--selfcheck" in argv:
        return selfcheck.run()

    try:
        base = config.require_base()
        secret = config.require_secret()
    except config.ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    out = config.out_dir()
    fault = config.fault()
    print(f"base: {base}")
    if fault:
        print(f"  !! fault injected: {fault}")

    # main() owns the observation dict and passes it into observe() to be
    # filled in place (rather than observe() building and returning one), so
    # that if observe() raises partway through, this reference still holds
    # whatever was captured -- the finally block below writes it out before
    # the exception propagates, instead of discarding it.
    observation = {
        "base": base,
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "complete": False,
        "browse": {}, "signalsContext": {}, "turns": [], "click": {},
        "console": {"errors": 0, "warnings": 0, "lines": []},
    }

    fault_error = None
    try:
        observe(base, secret, observation)
        observation["complete"] = True
    finally:
        # No `return` in this block: a return inside `finally` would silently
        # discard an in-flight exception from observe(), which is exactly the
        # failure mode a crash mid-walkthrough must not trigger. Whatever
        # happens here, the original exception (if any) resumes propagating
        # once this block finishes.
        if fault:
            try:
                checks.apply_fault(observation, fault)
            except KeyError:
                fault_error = fault
        run = checks.evaluate(observation)
        report = f"{out}/verify-widgets-report.json"
        with open(report, "w") as fh:
            json.dump({"observation": observation,
                       "fault": fault,
                       "checks": [vars(r) for r in run.results]}, fh, indent=2)
        print("\n" + run.render())
        print(f"\n  report: {report}")

    if fault_error:
        print(f"unknown VERIFY_FAULT id: {fault_error}. Known ids: "
              f"{', '.join(checks.CHECK_ORDER)}", file=sys.stderr)
        return 2

    return run.exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
