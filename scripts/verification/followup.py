"""Follow-up prod checks: (a) more turns hunting the in-band token mode,
(b) carousel-item click-through, (c) synthetic token-mode probe against the
deployed bundle's shadow-DOM observer."""

import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = "https://your-storefront.example.com"
OUT = os.environ.get(
    "VERIFY_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
)
os.makedirs(OUT, exist_ok=True)

LIVE_TOKEN = (
    '{@Widget: productCarousel(payload: {productDetails: [{imageUris: '
    '["https://images.unsplash.com/photo-1518893063132-36e46dbe2428?auto=format&fit=crop&w=1200&q=80"], '
    'price: "$340", productId: "silk-twill-square-scarf", subtitle: "Atelier Lune", '
    'title: "Silk Twill Square Scarf", uri: "https://your-storefront.example.com/products/silk-twill-square-scarf"}, '
    '{imageUris: ["https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=1200&q=80"], '
    'price: "$680", productId: "hammered-gold-cuff-bracelet", subtitle: "Arc Studio", '
    'title: "Hammered Gold Cuff Bracelet", uri: "https://your-storefront.example.com/products/hammered-gold-cuff-bracelet"}]}, '
    'summary: "A curated selection of accessories.")}'
)

STATE_JS = open(f"{OUT}/state_js.txt").read()


def main():
    log = {"turns": [], "click": None, "tokenProbe": None}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        page = browser.new_page(viewport={"width": 1500, "height": 1080})
        console = []
        page.on("console", lambda m: console.append((time.time(), m.text[:300])))

        def marks(since):
            out = []
            for t, text in console:
                if t < since:
                    continue
                if "Rendered rich-response widget token" in text:
                    out.append("token-mode")
                elif "Rewrote widget payload to rich-message template" in text:
                    out.append("payload-mode")
                elif "unrenderable" in text:
                    out.append("UNRENDERABLE")
            return out

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)
        for path in ("/collections/city-after-dark", "/products/ivory-silk-column-dress",
                     "/collections/accessory-atelier"):
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)

        page.locator("ces-messenger div.assistant-collapsed").click()
        page.wait_for_timeout(3000)

        prompts = [
            "Show me two or three pieces that would finish an evening look.",
            "Which bags would you recommend for a gala?",
            "Suggest a few winter pieces I should look at.",
            "What jewellery pairs with the ivory silk column dress?",
        ]
        for i, prompt in enumerate(prompts):
            before = page.evaluate(STATE_JS)["count"]
            since = time.time()
            page.locator('ces-messenger textarea[aria-label="Type your message"]').fill(prompt)
            page.locator("ces-messenger button.send").click()
            deadline = time.time() + 90
            last_sig, stable = None, None
            state = None
            while time.time() < deadline:
                state = page.evaluate(STATE_JS)
                if state["count"] > before + 1:
                    sig = json.dumps(state["messages"][-1])
                    if sig == last_sig and stable and time.time() - stable > 3.5:
                        break
                    if sig != last_sig:
                        last_sig, stable = sig, time.time()
                page.wait_for_timeout(1000)
            last = state["messages"][-1]
            entry = {"prompt": prompt, "modes": marks(since), "rawToken": last["rawToken"],
                     "cards": [(c["kind"], len(c["items"])) for c in last["cards"]],
                     "text": last["text"][:200]}
            log["turns"].append(entry)
            print(f"TURN {i}: {entry['modes']} cards={entry['cards']} rawToken={entry['rawToken']}")
            print("   ", entry["text"].replace("\n", " | ")[:180])

        # --- Carousel-item click-through ---
        page.evaluate("() => { window.__spaProbe = 'alive'; }")
        before_url = page.url
        clicked = page.evaluate("""
          () => {
            const sr = document.querySelector('ces-messenger').shadowRoot;
            const rails = [...sr.querySelectorAll('[data-widget-card="productCarousel"]')];
            const rail = rails[rails.length - 1];
            if (!rail) return null;
            const items = [...rail.querySelectorAll('[data-uri], a[href]')];
            const el = items[1] || items[0];
            if (!el) return null;
            const uri = el.getAttribute('data-uri') || el.getAttribute('href');
            el.click();
            return uri;
          }
        """)
        page.wait_for_timeout(4000)
        after = page.evaluate(STATE_JS)
        log["click"] = {
            "clickedUri": clicked,
            "beforeUrl": before_url,
            "afterUrl": page.url,
            "spaProbeSurvived": page.evaluate("() => window.__spaProbe || null") == "alive",
            "chatOpen": bool(after.get("ok")),
            "messagesAfter": after.get("count"),
            "cardsStillRendered": sum(len(m["cards"]) for m in after.get("messages", [])),
        }
        print("CAROUSEL CLICK:", json.dumps(log["click"], indent=2))
        page.screenshot(path=f"{OUT}/widget-renderer-carousel-click-prod-20260730.png")

        # --- Synthetic token-mode probe against the deployed bundle ---
        since = time.time()
        probe = page.evaluate("""
          (token) => {
            const sr = document.querySelector('ces-messenger').shadowRoot;
            const ul = sr.querySelector('ul[aria-label="Chat messages"]');
            if (!ul) return {injected: false};
            const li = document.createElement('li');
            li.setAttribute('data-synthetic-token-probe', '1');
            const bubble = document.createElement('div');
            bubble.textContent = token;
            li.appendChild(bubble);
            ul.appendChild(li);
            return {injected: true};
          }
        """, LIVE_TOKEN)
        page.wait_for_timeout(3000)
        probe_state = page.evaluate("""
          () => {
            const sr = document.querySelector('ces-messenger').shadowRoot;
            const li = sr.querySelector('li[data-synthetic-token-probe]');
            if (!li) return {found: false};
            return {
              found: true,
              rawTokenStillVisible: (li.textContent || '').includes('{@Widget:'),
              cards: [...li.querySelectorAll('[data-widget-card]')].map(c => ({
                kind: c.getAttribute('data-widget-card'),
                items: [...c.querySelectorAll('[data-uri], a[href]')].map(i => ({
                  tag: i.tagName.toLowerCase(),
                  uri: i.getAttribute('data-uri') || i.getAttribute('href'),
                  text: (i.innerText || '').trim().split('\\n').map(s => s.trim()).filter(Boolean),
                })),
              })),
            };
          }
        """)
        probe_state["consoleMarks"] = marks(since)
        log["tokenProbe"] = {**probe, **probe_state}
        print("TOKEN PROBE:", json.dumps(log["tokenProbe"], indent=2)[:1200])
        page.screenshot(path=f"{OUT}/widget-renderer-tokenmode-probe-prod-20260730.png")

        with open(f"{OUT}/followup-report.json", "w") as fh:
            json.dump({**log, "console": [[t, x] for t, x in console]}, fh, indent=2)
        browser.close()


if __name__ == "__main__":
    main()
