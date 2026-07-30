"""Reset Chat is endSession() + clearStorage() + location.reload(), so every
reset is a full page load — the #7 repro the demo hits between takes. Does the
post-reset session get its own product_viewed?
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_issue7_fix import BASE, Recorder  # noqa: E402

PATH = "/products/ivory-silk-column-dress"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        ctx = browser.new_context(viewport={"width": 1500, "height": 1080})
        page = ctx.new_page()
        rec = Recorder(page)

        page.goto(BASE + PATH, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(9000)
        before = [e for e in rec.events if e["name"] == "product_viewed"]

        page.get_by_role("button", name="Reset Chat").click()
        page.wait_for_timeout(12000)
        after = [e for e in rec.events if e["name"] == "product_viewed"]
        post_reset = after[len(before):]

        print(f"base: {BASE}")
        print(f"product_viewed before reset: {len(before)} sids={[e['sid'] for e in before]}")
        print(f"product_viewed after reset:  {len(post_reset)} sids={[e['sid'] for e in post_reset]}")
        print(f"all events: {json.dumps(rec.counts())}")
        print(f"verdict: {json.dumps({'tracked_after_reset': len(post_reset) >= 1})}")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
