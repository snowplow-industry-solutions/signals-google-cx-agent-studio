"""Audit check for the same defect class: do cart_viewed and checkout_started
survive a full page load? Reuses the Recorder from probe_issue7_fix.py.
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness.collector import Recorder  # noqa: E402
from harness.config import probe_base  # noqa: E402

BASE = probe_base()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        ctx = browser.new_context(viewport={"width": 1500, "height": 1080})
        page = ctx.new_page()
        rec = Recorder(page)

        page.goto(f"{BASE}/products/ivory-silk-column-dress",
                  wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(6000)
        page.get_by_role("button", name="Add To Cart").first.click()
        page.wait_for_timeout(3000)

        for path in ("/cart", "/checkout"):
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(7000)

        counts = rec.counts()
        print(f"base: {BASE}")
        print(f"events on the wire: {json.dumps(counts, indent=2)}")
        verdict = {"cart_viewed": counts.get("cart_viewed", 0),
                   "checkout_started": counts.get("checkout_started", 0),
                   "product_viewed": counts.get("product_viewed", 0)}
        print(f"verdict: {json.dumps(verdict)}")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
