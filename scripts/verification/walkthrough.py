"""Runbook §11.5 steps 2-6 against production (issue #1 verification).

Drives the deployed storefront + live widget-enabled agent, records which
wire-format mode each turn used (in-band {@Widget: …} token vs structured
outputs[].payload), and captures screenshots.
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness.chat import ChatPanel, RendererLog  # noqa: E402
from harness.config import ConfigError, out_dir, require_base  # noqa: E402
from harness.redact import redact_console  # noqa: E402

try:
    BASE = require_base()
except ConfigError as exc:
    print(f"config error: {exc}", file=sys.stderr)
    sys.exit(2)

OUT = out_dir()


def turn(chat, log, page, label, prompt, shot=None):
    page_state = chat.read_state()
    before = page_state["count"] if page_state.get("ok") else 0
    since = time.time()
    print(f"\n=== TURN {label}: {prompt}")
    chat.send(prompt)
    state, _timed_out = chat.wait_for_reply(before, prompt)
    last = state["messages"][-1] if state.get("messages") else {}
    modes = log.marks_since(since)
    net = log.net_since(since)
    net_modes = set()
    for n in net:
        if n.get("hasToken"):
            net_modes.add("wire:text-token")
        if n.get("hasPayloadType"):
            net_modes.add("wire:structured-payload")
    print("  reply text:", (last.get("fullText") or "")[:400].replace("\n", " | "))
    print("  raw {@Widget: token visible:", last.get("rawToken"))
    print("  cards:", json.dumps(last.get("cards"), indent=2)[:1500])
    print("  renderer marks:", modes)
    print("  network:", sorted(net_modes), [f"{n['status']} {n.get('len')}" for n in net][:6])
    if shot:
        page.screenshot(path=f"{OUT}/{shot}")
        print("  shot:", shot)
    return {"label": label, "prompt": prompt, "reply": last, "modes": modes,
            "wire": sorted(net_modes)}


def main():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        page = browser.new_page(viewport={"width": 1500, "height": 1080})
        log = RendererLog(page)
        chat = ChatPanel(page)

        # --- Build behavioural context: browse a category with 2+ products ---
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)
        for path in ("/collections/city-after-dark",
                     "/products/ivory-silk-column-dress",
                     "/collections/city-after-dark",
                     "/products/noir-double-breasted-blazer",
                     "/collections/accessory-atelier"):
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
        # Catalogue names for the "specific product" turn.
        names = [t.strip() for t in page.locator("a[href^='/products/'] >> nth=0").all_inner_texts()]
        cards = page.locator("a[href^='/products/']")
        catalog = []
        for i in range(min(cards.count(), 10)):
            href = cards.nth(i).get_attribute("href")
            txt = (cards.nth(i).inner_text() or "").strip()
            if txt and href:
                catalog.append((txt.split("\n")[0], href))
        print("catalog sample:", catalog[:6])

        chat.open()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT}/prod-00-chat-open.png")

        # Step 2 — multi-product recommendation (expect carousel)
        results.append(turn(chat, log, page, "2a-carousel",
                            "Can you recommend a couple of accessories to go with an evening look?",
                            shot="widget-renderer-carousel-prod-20260730.png"))

        # Step 3 — one specific product by name (expect details card)
        product_name = catalog[0][0] if catalog else "Silk Twill Square Scarf"
        results.append(turn(chat, log, page, "3-details",
                            f"Tell me more about the {product_name}.",
                            shot="widget-renderer-details-prod-20260730.png"))

        # Extra turns — the wire format is bimodal, so exercise several
        results.append(turn(chat, log, page, "2b-carousel",
                            "What else from the evening edit would work with that?",
                            shot="prod-turn-2b.png"))
        results.append(turn(chat, log, page, "3b-details",
                            "Show me the Noir Double-Breasted Blazer.",
                            shot="prod-turn-3b.png"))

        # Step 5 — zero-match query (expect graceful plain text, no invented card)
        results.append(turn(chat, log, page, "5-zero-match",
                            "Do you have any neon orange swimwear under $15?",
                            shot="prod-turn-5-zero-match.png"))

        # Step 4 — click a card link, expect SPA navigation
        page.evaluate("() => { window.__spaProbe = 'alive'; }")
        state = chat.read_state()
        target = None
        for msg in state["messages"]:
            for card in msg.get("cards", []):
                for item in card.get("items", []):
                    if item.get("uri"):
                        target = (card["kind"], item["uri"])
        print("\n=== STEP 4: click card ->", target)
        click_result = {"target": target}
        if target:
            before_url = page.url
            clicked = chat.click_last_card_item()
            page.wait_for_timeout(4000)
            probe = page.evaluate("() => window.__spaProbe || null")
            after = chat.read_state()
            click_result.update({
                "clickedUri": clicked,
                "beforeUrl": before_url,
                "afterUrl": page.url,
                "spaProbeSurvived": probe == "alive",
                "chatMessagesAfter": after.get("count"),
            })
            print("  ", json.dumps(click_result, indent=2))
            page.screenshot(path=f"{OUT}/widget-renderer-cardclick-prod-20260730.png")

        # Step 6 — styling capture at the end (chat + storefront in one frame)
        page.screenshot(path=f"{OUT}/prod-99-styling.png", full_page=False)

        final = chat.read_state()
        with open(f"{OUT}/walkthrough-report.json", "w") as fh:
            json.dump({"turns": results, "click": click_result,
                       "final": final, "network": log.network,
                       # The CES chatToken shows up in a console debug line on
                       # every run that opens the chat; it does not belong in a
                       # file anyone might attach to an issue.
                       "console": redact_console(log.console)}, fh, indent=2)
        print("\n=== FINAL TRANSCRIPT ===")
        for i, m in enumerate(final.get("messages", [])):
            print(f"[{i}] rawToken={m['rawToken']} cards={[c['kind'] for c in m['cards']]}")
            print("    ", m["fullText"][:300].replace("\n", " | "))
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
