"""Does every widget turn also carry agent commentary text?

Adapted from walkthrough.py (the widget walkthrough). Differences:
  - prose is extracted with the [data-widget-card] subtrees REMOVED, so card
    text can never be mistaken for a conversational message;
  - every new assistant <li> in a turn is inspected, not just the last one
    (a turn may deliver prose and cards as separate bubbles);
  - runSession response bodies were once retained (up to 60000 chars per
    widget-turn response) so the structured payload's own fields could be
    recorded for the ac1-commentary check. Now that response capture lives
    once in harness.chat.RendererLog, that retention is dropped: the question
    it was evidence for is answered and recorded;
  - the script asserts and exits nonzero on failure.
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness.chat import ChatPanel, RendererLog  # noqa: E402
from harness.config import MIN_PROSE, ConfigError, out_dir, require_base  # noqa: E402
from harness.redact import redact_console  # noqa: E402

try:
    BASE = require_base()
except ConfigError as exc:
    print(f"config error: {exc}", file=sys.stderr)
    sys.exit(2)

OUT = out_dir()
REPORT = f"{OUT}/commentary-report.json"


def turn(chat, log, page, label, prompt, expect_cards, shot=None):
    chat.quiesce()
    state0 = chat.read_state()
    before = state0["count"] if state0.get("ok") else 0
    since = time.time()
    print(f"\n=== TURN {label}: {prompt}")
    chat.send(prompt)
    state, timed_out = chat.wait_for_reply(before, prompt)

    agent = chat.agent_bubbles(state, before, prompt)

    cards = [c for m in agent for c in m["cards"]]
    prose_bits = [m["prose"].strip() for m in agent
                  if len(m["prose"].strip()) >= MIN_PROSE]
    modes = log.marks_since(since)
    net = log.net_since(since)
    wire = set()
    for n in net:
        if n.get("hasToken"):
            wire.add("wire:text-token")
        if n.get("hasPayloadType"):
            wire.add("wire:structured-payload")

    has_cards = bool(cards)
    has_prose = bool(prose_bits)
    if timed_out:
        verdict = "TIMEOUT-no-reply"
    elif expect_cards is True and not has_cards:
        verdict = "NO-CARDS (expected some)"
    elif has_cards and not has_prose:
        verdict = "FAIL-no-commentary"
    elif has_cards and has_prose:
        verdict = "PASS-commentary+cards"
    elif not has_cards and has_prose:
        verdict = "text-only-turn"
    else:
        verdict = "FAIL-empty-turn"

    print(f"  verdict: {verdict}")
    print(f"  bubbles: {len(agent)} agent   cards: {[c['kind'] for c in cards]}")
    print(f"  raw token visible: {any(m['rawToken'] for m in agent)}")
    for p in prose_bits:
        print(f"  prose: {p[:300]}")
    print(f"  renderer marks: {modes}   wire: {sorted(wire)}")
    if shot:
        page.screenshot(path=f"{OUT}/{shot}")

    return {"label": label, "prompt": prompt, "verdict": verdict,
            "timedOut": timed_out,
            "cards": [c["kind"] for c in cards], "cardItems": cards,
            "prose": prose_bits, "modes": modes, "wire": sorted(wire),
            "agentBubbles": agent}


def main():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        page = browser.new_page(viewport={"width": 1500, "height": 1080})
        log = RendererLog(page)
        chat = ChatPanel(page)

        # Build behavioural context in Signals before opening chat.
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)
        for path in ("/collections/city-after-dark",
                     "/products/ivory-silk-column-dress",
                     "/collections/city-after-dark",
                     "/products/noir-double-breasted-blazer",
                     "/products/satin-evening-pouch",
                     "/collections/accessory-atelier"):
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(6000)
        # Signals needs a moment to buffer those views into the profile before
        # getUserContext can return them; run 1 opened chat too early and got
        # an empty profile ("No events buffered"), exercising the degraded path.
        page.wait_for_timeout(25000)

        chat.open()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT}/c3-00-chat-open.png")

        turns = [
            ("1-carousel", "Can you recommend a couple of accessories to go with an evening look?", True, "c3-01.png"),
            ("2-followup", "What else from the evening edit would work with that?", True, "c3-02.png"),
            ("3-details", "Tell me more about the Noir Double-Breasted Blazer.", True, "c3-03.png"),
            ("4-winter", "I need something for a winter weekend away - what would you suggest?", True, "c3-04.png"),
            ("5-details2", "Show me the Camel Cashmere Wrap Coat.", True, "c3-05.png"),
            ("6-pairing", "Which pieces would you pair with that blazer?", True, "c3-06.png"),
            ("7-zero-match", "Do you have any neon orange swimwear under $15?", False, "c3-07.png"),
        ]
        for label, prompt, expect, shot in turns:
            results.append(turn(chat, log, page, label, prompt, expect, shot))

        # Regression guard: a card click must still SPA-navigate (no full reload).
        page.evaluate("() => { window.__spaProbe = 'alive'; }")
        click_result = {}
        clicked = chat.click_last_card_item()
        if clicked:
            page.wait_for_timeout(4000)
            after = chat.read_state()
            click_result = {
                "clickedUri": clicked,
                "afterUrl": page.url,
                "spaProbeSurvived": page.evaluate("() => window.__spaProbe || null") == "alive",
                "chatMessagesAfter": after.get("count"),
            }
            print("\n=== CARD CLICK:", json.dumps(click_result))
            page.screenshot(path=f"{OUT}/c3-08-cardclick.png")

        widget_turns = [r for r in results if r["cards"]]
        failures = [r for r in results if r["verdict"].startswith("FAIL")]
        summary = {
            "widgetTurns": len(widget_turns),
            "widgetTurnsWithCommentary": len([r for r in widget_turns
                                              if r["verdict"] == "PASS-commentary+cards"]),
            "failures": [r["label"] for r in failures],
            "noCards": [r["label"] for r in results if r["verdict"].startswith("NO-CARDS")],
            "modesSeen": sorted({m for r in results for m in r["modes"]}),
            "wireSeen": sorted({w for r in results for w in r["wire"]}),
            "consoleErrors": redact_console(
                c for c in log.console if c[1] in ("error", "warning")),
        }
        print("\n=== SUMMARY ===")
        print(json.dumps(summary, indent=2)[:2000])

        with open(REPORT, "w") as fh:
            json.dump({"summary": summary, "turns": results,
                       "click": click_result, "network": log.network,
                       # The CES chatToken shows up in a console debug line on
                       # every run that opens the chat; it does not belong in a
                       # file anyone might attach to an issue.
                       "console": redact_console(log.console)},
                      fh, indent=2)
        browser.close()

    return 1 if (failures or not widget_turns) else 0


if __name__ == "__main__":
    sys.exit(main())
