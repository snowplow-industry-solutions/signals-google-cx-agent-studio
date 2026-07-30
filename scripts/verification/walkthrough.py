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

BASE = "https://signals-google-gecx-storefront.vercel.app"
OUT = os.environ.get(
    "VERIFY_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
)
os.makedirs(OUT, exist_ok=True)

STATE_JS = """
() => {
  const el = document.querySelector('ces-messenger');
  const sr = el && el.shadowRoot;
  if (!sr) return {ok: false};
  const lis = [...sr.querySelectorAll('ul[aria-label="Chat messages"] > li')];
  const readCard = (c) => ({
    kind: c.getAttribute('data-widget-card'),
    items: [...c.querySelectorAll('[data-uri], a[href]')].map((item) => ({
      tag: item.tagName.toLowerCase(),
      uri: item.getAttribute('data-uri') || item.getAttribute('href'),
      img: (item.querySelector('img') || {}).src || null,
      text: (item.innerText || '').trim().split('\\n').map(s => s.trim()).filter(Boolean),
    })),
  });
  return {
    ok: true,
    count: lis.length,
    messages: lis.map((li) => ({
      text: (li.innerText || '').trim().slice(0, 800),
      rawToken: (li.textContent || '').includes('{@Widget:'),
      cards: [...li.querySelectorAll('[data-widget-card]')].map(readCard),
    })),
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
        if not any(k in url for k in (":runSession", "runSession", ":run", "geminidataconnect", "cloud.google.com")):
            return
        entry = {"t": time.time(), "url": url[:160], "status": resp.status}
        try:
            body = resp.text()
            entry["hasToken"] = "@Widget:" in body
            entry["hasPayloadType"] = ("product_detail_carousel" in body) or ("base_product_detail" in body)
            entry["len"] = len(body)
        except Exception as exc:  # streaming bodies may be unavailable
            entry["bodyError"] = str(exc)[:80]
        self.network.append(entry)

    def marks_since(self, since):
        out = []
        for t, typ, text in self.console:
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


def wait_for_reply(page, before_count, timeout_s=100):
    """Wait for a new assistant message and for its content to settle."""
    deadline = time.time() + timeout_s
    stable_since = None
    last_sig = None
    while time.time() < deadline:
        state = page.evaluate(STATE_JS)
        if state.get("ok") and state["count"] > before_count + 1:
            sig = json.dumps(state["messages"][-1])
            if sig == last_sig:
                if stable_since and time.time() - stable_since > 3.5:
                    return state
            else:
                last_sig = sig
                stable_since = time.time()
        page.wait_for_timeout(1000)
    return page.evaluate(STATE_JS)


def turn(run, page, label, prompt, shot=None):
    page_state = page.evaluate(STATE_JS)
    before = page_state["count"] if page_state.get("ok") else 0
    since = time.time()
    print(f"\n=== TURN {label}: {prompt}")
    send(page, prompt)
    state = wait_for_reply(page, before)
    last = state["messages"][-1] if state.get("messages") else {}
    modes = run.marks_since(since)
    net = run.net_since(since)
    net_modes = set()
    for n in net:
        if n.get("hasToken"):
            net_modes.add("wire:text-token")
        if n.get("hasPayloadType"):
            net_modes.add("wire:structured-payload")
    print("  reply text:", (last.get("text") or "")[:400].replace("\n", " | "))
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
        run = Run(page)

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

        open_chat(page)
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT}/prod-00-chat-open.png")

        # Step 2 — multi-product recommendation (expect carousel)
        results.append(turn(run, page, "2a-carousel",
                            "Can you recommend a couple of accessories to go with an evening look?",
                            shot="widget-renderer-carousel-prod-20260730.png"))

        # Step 3 — one specific product by name (expect details card)
        product_name = catalog[0][0] if catalog else "Silk Twill Square Scarf"
        results.append(turn(run, page, "3-details",
                            f"Tell me more about the {product_name}.",
                            shot="widget-renderer-details-prod-20260730.png"))

        # Extra turns — the wire format is bimodal, so exercise several
        results.append(turn(run, page, "2b-carousel",
                            "What else from the evening edit would work with that?",
                            shot="prod-turn-2b.png"))
        results.append(turn(run, page, "3b-details",
                            "Show me the Noir Double-Breasted Blazer.",
                            shot="prod-turn-3b.png"))

        # Step 5 — zero-match query (expect graceful plain text, no invented card)
        results.append(turn(run, page, "5-zero-match",
                            "Do you have any neon orange swimwear under $15?",
                            shot="prod-turn-5-zero-match.png"))

        # Step 4 — click a card link, expect SPA navigation
        page.evaluate("() => { window.__spaProbe = 'alive'; }")
        state = page.evaluate(STATE_JS)
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
            page.wait_for_timeout(4000)
            probe = page.evaluate("() => window.__spaProbe || null")
            after = page.evaluate(STATE_JS)
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

        final = page.evaluate(STATE_JS)
        with open(f"{OUT}/walkthrough-report.json", "w") as fh:
            json.dump({"turns": results, "click": click_result,
                       "final": final, "network": run.network,
                       "console": [[t, ty, tx] for t, ty, tx in run.console]}, fh, indent=2)
        print("\n=== FINAL TRANSCRIPT ===")
        for i, m in enumerate(final.get("messages", [])):
            print(f"[{i}] rawToken={m['rawToken']} cards={[c['kind'] for c in m['cards']]}")
            print("    ", m["text"][:300].replace("\n", " | "))
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
