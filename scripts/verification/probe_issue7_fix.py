"""Issue #7 acceptance check: does product_viewed reach the collector on a full
page load?

Adapted from scripts/verification/probe_navmode.py (PR #11). Differences:
  - BASE is configurable (PROBE_BASE), defaults to the local production build,
    because the repo is not linked to Vercel so there is no preview deploy.
  - Decodes each collector POST body down to the event level and counts
    product_viewed / product_list_viewed / pv per variant, instead of only
    counting requests. Collector payloads are the ground truth; the console
    logs success either way (that silence is issue #7).
  - Does not open the chat widget, so no CES chatToken is ever captured.

Variant A browses three products with full page loads (the #7 repro), variant B
by SPA link clicks (the control that always worked).
"""

import base64
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("PROBE_BASE", "http://localhost:3000")
OUT = os.environ.get(
    "VERIFY_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
)
os.makedirs(OUT, exist_ok=True)
REPORT = f"{OUT}/probe-issue7-report.json"

PATHS = ["/products/ivory-silk-column-dress",
         "/products/silk-twill-square-scarf",
         "/products/noir-double-breasted-blazer"]


def event_name(ev):
    """Event name for one collector payload entry."""
    if ev.get("e") == "pv":
        return "pv"
    raw = ev.get("ue_pr")
    if not raw:
        encoded = ev.get("ue_px")
        if not encoded:
            return ev.get("e") or "unknown"
        try:
            raw = base64.urlsafe_b64decode(encoded + "==").decode("utf-8")
        except Exception:
            return "undecodable"
    try:
        schema = json.loads(raw)["data"]["schema"]
    except Exception:
        return "unparseable"
    # iglu:com.snowplow_demo.fashion/product_viewed/jsonschema/1-0-0
    return schema.split("/")[1] if "/" in schema else schema


class Recorder:
    def __init__(self, page):
        self.console, self.events, self.responses, self.failed = [], [], [], []
        self.sids = set()
        page.on("console", self._console)
        page.on("request", self._request)
        page.on("response", self._response)
        page.on("requestfailed", self._failed)

    def _is_collector(self, url):
        return "/com.snowplowanalytics.snowplow/" in url or "/tp2" in url

    def _console(self, msg):
        try:
            text = msg.text[:300]
        except Exception:
            return
        if "[Signals Demo]" in text:
            self.console.append(text)

    def _request(self, req):
        if not self._is_collector(req.url):
            return
        try:
            body = json.loads(req.post_data or "{}")
        except Exception:
            return
        for ev in body.get("data", []):
            if ev.get("sid"):
                self.sids.add(ev["sid"])
            self.events.append({"t": time.time(), "name": event_name(ev),
                                "sid": ev.get("sid")})

    def _response(self, resp):
        if self._is_collector(resp.url):
            self.responses.append({"t": time.time(), "status": resp.status})

    def _failed(self, req):
        if self._is_collector(req.url):
            self.failed.append({"t": time.time(),
                                "failure": (req.failure or "")[:80]})

    def counts(self):
        tally = {}
        for ev in self.events:
            tally[ev["name"]] = tally.get(ev["name"], 0) + 1
        return tally

    def forwarded_id(self):
        for line in reversed(self.console):
            if "Passed domain_sessionid" in line:
                return line.split("sessionId: ")[-1].rstrip("}").strip()
        return None


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
