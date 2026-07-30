"""Issue #3 verification: does every widget turn also carry agent commentary text?

Adapted from walkthrough.py (runbook §11.5 steps 2-6, issue #1 production run).
Differences:
  - prose is extracted with the [data-widget-card] subtrees REMOVED, so card
    text can never be mistaken for a conversational message;
  - every new assistant <li> in a turn is inspected, not just the last one
    (a turn may deliver prose and cards as separate bubbles);
  - runSession response bodies are retained so the structured payload's own
    fields can be recorded for issue #3 AC3;
  - the script asserts and exits nonzero on failure.
"""

import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "https://signals-google-gecx-storefront.vercel.app"
OUT = os.environ.get(
    "VERIFY_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
)
os.makedirs(OUT, exist_ok=True)
REPORT = f"{OUT}/commentary-report.json"

# Minimum prose length (chars) that counts as a conversational message rather
# than a stray label or timestamp.
MIN_PROSE = 20

STATE_JS = """
() => {
  const el = document.querySelector('ces-messenger');
  const sr = el && el.shadowRoot;
  if (!sr) return {ok: false};
  const lis = [...sr.querySelectorAll('ul[aria-label="Chat messages"] > li')];
  const readCard = (c) => ({
    kind: c.getAttribute('data-widget-card'),
    items: [...c.querySelectorAll('[data-uri], a[href]')].map((item) => ({
      uri: item.getAttribute('data-uri') || item.getAttribute('href'),
      img: (item.querySelector('img') || {}).src || null,
      text: (item.innerText || '').trim().split('\\n').map(s => s.trim()).filter(Boolean),
    })),
  });
  return {
    ok: true,
    count: lis.length,
    messages: lis.map((li) => {
      // Prose = the bubble's text with any rendered widget cards cut out.
      const clone = li.cloneNode(true);
      [...clone.querySelectorAll('[data-widget-card]')].forEach(n => n.remove());
      return {
        cls: li.className || '',
        aria: li.getAttribute('aria-label') || '',
        prose: (clone.innerText || '').trim(),
        fullText: (li.innerText || '').trim().slice(0, 1200),
        rawToken: (li.textContent || '').includes('{@Widget:'),
        cards: [...li.querySelectorAll('[data-widget-card]')].map(readCard),
      };
    }),
  };
}
"""


class Run:
    def __init__(self, page):
        self.page = page
        self.console = []
        self.network = []
        page.on("console", self._on_console)
        page.on("response", self._on_response)

    def _on_console(self, msg):
        try:
            self.console.append((time.time(), msg.type, msg.text[:400]))
        except Exception:
            pass

    def _on_response(self, resp):
        url = resp.url
        if not any(k in url for k in (":runSession", "runSession", ":run",
                                      "geminidataconnect", "cloud.google.com")):
            return
        entry = {"t": time.time(), "url": url[:160], "status": resp.status}
        try:
            body = resp.text()
            entry["hasToken"] = "@Widget:" in body
            entry["hasPayloadType"] = (("product_detail_carousel" in body)
                                       or ("base_product_detail" in body))
            entry["len"] = len(body)
            if entry["hasPayloadType"] or entry["hasToken"]:
                # Retained for issue #3 AC3: what fields does the structured
                # payload actually carry (any agent-authored summary text?).
                entry["body"] = body[:60000]
        except Exception as exc:  # streaming bodies may be unavailable
            entry["bodyError"] = str(exc)[:80]
        self.network.append(entry)

    def marks_since(self, since):
        out = []
        for t, _typ, text in self.console:
            if t < since:
                continue
            if "Rendered rich-response widget token" in text:
                out.append("token-mode")
            elif "Rewrote widget payload to rich-message template" in text:
                out.append("payload-mode")
            elif "unrenderable" in text:
                out.append("UNRENDERABLE")
        return out

    def net_since(self, since):
        return [n for n in self.network if n["t"] >= since]


def open_chat(page):
    collapsed = page.locator("ces-messenger div.assistant-collapsed")
    if collapsed.count() and collapsed.is_visible():
        collapsed.click()
        page.wait_for_timeout(3000)


def send(page, text):
    box = page.locator('ces-messenger textarea[aria-label="Type your message"]')
    box.click()
    box.fill(text)
    page.locator("ces-messenger button.send").click()


def norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


def agent_bubbles(state, before_count, prompt):
    """New bubbles for this turn, minus the user's own echoed message."""
    new = state.get("messages", [])[before_count:]
    return [m for m in new if norm(m["prose"]) != norm(prompt)]


def has_content(bubbles):
    """True once a bubble carries real prose or a rendered card.

    ces-messenger inserts an EMPTY placeholder <li> the moment you send, so
    'a new bubble exists' is not evidence a reply arrived. Waiting on that
    placeholder attributes each reply to the following turn.
    """
    return any(len(m["prose"].strip()) >= MIN_PROSE or m["cards"] for m in bubbles)


def quiesce(page, quiet_s=3.0, timeout_s=45):
    """Wait for the transcript to stop changing before sending the next turn."""
    deadline = time.time() + timeout_s
    last_sig, stable_since = None, None
    while time.time() < deadline:
        sig = json.dumps(page.evaluate(STATE_JS))
        if sig == last_sig:
            if stable_since and time.time() - stable_since > quiet_s:
                return
        else:
            last_sig, stable_since = sig, time.time()
        page.wait_for_timeout(1000)


def wait_for_reply(page, before_count, prompt, timeout_s=180, settle_s=8.0):
    """Wait for real reply content, then for it to stop changing.

    A turn can deliver prose and cards as separate bubbles arriving seconds
    apart, so the settle window is deliberately generous.
    """
    deadline = time.time() + timeout_s
    stable_since = None
    last_sig = None
    while time.time() < deadline:
        state = page.evaluate(STATE_JS)
        if state.get("ok"):
            bubbles = agent_bubbles(state, before_count, prompt)
            sig = json.dumps(bubbles)
            if sig != last_sig:
                last_sig, stable_since = sig, time.time()
            if (has_content(bubbles) and stable_since
                    and time.time() - stable_since > settle_s):
                return state, False
        page.wait_for_timeout(1000)
    return page.evaluate(STATE_JS), True


def turn(run, page, label, prompt, expect_cards, shot=None):
    quiesce(page)
    state0 = page.evaluate(STATE_JS)
    before = state0["count"] if state0.get("ok") else 0
    since = time.time()
    print(f"\n=== TURN {label}: {prompt}")
    send(page, prompt)
    state, timed_out = wait_for_reply(page, before, prompt)

    agent = agent_bubbles(state, before, prompt)

    cards = [c for m in agent for c in m["cards"]]
    prose_bits = [m["prose"].strip() for m in agent
                  if len(m["prose"].strip()) >= MIN_PROSE]
    modes = run.marks_since(since)
    net = run.net_since(since)
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
        run = Run(page)

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

        open_chat(page)
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
            results.append(turn(run, page, label, prompt, expect, shot))

        # Issue #1 regression guard: a card click must still SPA-navigate.
        page.evaluate("() => { window.__spaProbe = 'alive'; }")
        click_result = {}
        clicked = page.evaluate("""
          () => {
            const sr = document.querySelector('ces-messenger').shadowRoot;
            const cards = [...sr.querySelectorAll('[data-widget-card] [data-uri], [data-widget-card] a[href]')];
            const el = cards[cards.length - 1];
            if (!el) return null;
            el.click();
            return el.getAttribute('data-uri') || el.getAttribute('href');
          }
        """)
        if clicked:
            page.wait_for_timeout(4000)
            after = page.evaluate(STATE_JS)
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
            "consoleErrors": [c for c in run.console if c[1] in ("error", "warning")],
        }
        print("\n=== SUMMARY ===")
        print(json.dumps(summary, indent=2)[:2000])

        with open(REPORT, "w") as fh:
            json.dump({"summary": summary, "turns": results,
                       "click": click_result, "network": run.network,
                       "console": [[t, ty, tx] for t, ty, tx in run.console]},
                      fh, indent=2)
        browser.close()

    return 1 if (failures or not widget_turns) else 0


if __name__ == "__main__":
    sys.exit(main())
