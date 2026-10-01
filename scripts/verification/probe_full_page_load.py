"""Does product_viewed reach the collector on a full page load (not just SPA
navigation)?

  - BASE is configurable (PROBE_BASE), defaults to the local production build,
    so a branch can be checked without a hosted preview deploy.
  - Decodes each collector POST body down to the event level and counts
    product_viewed / product_list_viewed / pv per variant, instead of only
    counting requests, because collector payloads are the ground truth even
    when the console logs success either way.
  - Does not open the chat widget, so no CES chatToken is ever captured.

Variant A browses three products with full page loads, variant B by SPA link
clicks (the control that always worked).
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness.collector import Recorder  # noqa: E402
from harness.config import out_dir, probe_base  # noqa: E402

BASE = probe_base()
OUT = out_dir()
REPORT = f"{OUT}/probe-full-page-load-report.json"

PATHS = ["/products/ivory-silk-column-dress",
         "/products/silk-twill-square-scarf",
         "/products/noir-double-breasted-blazer"]


def run_variant(browser, label, spa):
    ctx = browser.new_context(viewport={"width": 1500, "height": 1080})
    page = ctx.new_page()
    rec = Recorder(page)

    page.goto(BASE + PATHS[0], wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(9000)
    if spa:
        for _ in range(2):
            link = page.locator("a[href^='/products/']").first
            if link.count():
                link.click()
                page.wait_for_timeout(6000)
    else:
        for path in PATHS[1:]:
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(6000)

    counts = rec.counts()
    sid = rec.forwarded_id() or (sorted(rec.sids)[0] if rec.sids else None)

    print(f"\n=== VARIANT {label} ({'SPA clicks' if spa else 'full page loads'}) ===")
    print(f"  session ids in payloads: {sorted(rec.sids)}")
    print(f"  events on the wire:      {counts}")
    print(f"  product_viewed:          {counts.get('product_viewed', 0)}")
    print(f"  collector responses:     {len(rec.responses)} "
          f"statuses={sorted({r['status'] for r in rec.responses})}")
    print(f"  requestfailed:           {len(rec.failed)} {rec.failed[:4]}")
    sys.stdout.flush()

    out = {"label": label, "spa": spa, "sessionId": sid,
           "sessionIds": sorted(rec.sids), "eventCounts": counts,
           "productViewed": counts.get("product_viewed", 0),
           "collectorResponses": len(rec.responses),
           "responseStatuses": sorted({r["status"] for r in rec.responses}),
           "requestFailed": rec.failed}
    ctx.close()
    return out


def main():
    print(f"base: {BASE}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        a = run_variant(browser, "A-goto", spa=False)
        b = run_variant(browser, "B-spa", spa=True)
        browser.close()

    verdict = {
        "goto_productViewed": a["productViewed"],
        "spa_productViewed": b["productViewed"],
        "goto_expects_3": a["productViewed"] == 3,
        "spa_expects_3": b["productViewed"] == 3,
        "no_double_tracking": a["productViewed"] == 3 and b["productViewed"] == 3,
        "gotoSessionId": a["sessionId"], "spaSessionId": b["sessionId"],
    }
    print("\n=== VERDICT ===")
    print(json.dumps(verdict, indent=2))
    with open(REPORT, "w") as fh:
        json.dump({"A": a, "B": b, "verdict": verdict}, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
