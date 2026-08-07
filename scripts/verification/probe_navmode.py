"""Does navigation style decide whether events reach Signals?

Today's five runs correlate perfectly: browsing by full page load (page.goto)
-> Signals has no events; browsing by SPA link click -> events arrive in
seconds. Suspected mechanism: unload cancels in-flight collector POSTs, which a
request-level listener still counts as "sent".

Two fresh sessions, same three products:
  A  every page visited with a full page load
  B  one load, then SPA link clicks

Records collector requests, RESPONSE statuses, and requestfailed (cancelled)
per variant, then asks the agent what it knows. Session ids are written out for
independent polling via /api/agent/context.
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "https://your-storefront.example.com"
OUT = os.environ.get(
    "VERIFY_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
)
os.makedirs(OUT, exist_ok=True)
REPORT = f"{OUT}/probe-navmode-report.json"
SID_FILES = {"A-goto": f"{OUT}/navmode-goto-sid.txt",
             "B-spa": f"{OUT}/navmode-spa-sid.txt"}

PATHS = ["/products/ivory-silk-column-dress",
         "/products/silk-twill-square-scarf",
         "/products/noir-double-breasted-blazer"]


class Recorder:
    def __init__(self, page):
        self.console, self.sessions = [], []
        self.requests, self.responses, self.failed = [], [], []
        self.sids = set()
        page.on("console", self._console)
        page.on("request", self._request)
        page.on("response", self._response)
        page.on("requestfailed", self._failed)

    def _is_collector(self, url):
        return "/com.snowplowanalytics.snowplow/" in url or "/tp2" in url

    def _console(self, msg):
        try:
            t = msg.text[:300]
        except Exception:
            return
        if "[Signals Demo]" in t:
            self.console.append(t)

    def _request(self, req):
        if not self._is_collector(req.url):
            return
        n = 0
        try:
            obj = json.loads(req.post_data or "{}")
            for ev in obj.get("data", []):
                if ev.get("sid"):
                    self.sids.add(ev["sid"])
                    n += 1
        except Exception:
            pass
        self.requests.append({"t": time.time(), "events": n})

    def _response(self, resp):
        if self._is_collector(resp.url):
            self.responses.append({"t": time.time(), "status": resp.status})
            return
        if any(k in resp.url for k in (":runSession", "runSession")):
            try:
                self.sessions.append(resp.text())
            except Exception:
                pass

    def _failed(self, req):
        if self._is_collector(req.url):
            self.failed.append({"t": time.time(),
                                "failure": (req.failure or "")[:80]})

    def forwarded_id(self):
        for c in reversed(self.console):
            if "Passed domain_sessionid" in c:
                return c.split("sessionId: ")[-1].rstrip("}").strip()
        return None

    def lookup(self):
        for body in reversed(self.sessions):
            try:
                obj = json.loads(body)
            except Exception:
                continue
            held, activity, profile = None, None, None
            for o in obj.get("outputs", []):
                for m in (o.get("diagnosticInfo") or {}).get("messages", []):
                    for ch in m.get("chunks", []):
                        for bag in ("updatedVariables", "defaultVariables"):
                            v = (ch.get(bag) or {}).get("snowplow_session_id")
                            if v:
                                held = v
                        tr = ch.get("toolResponse") or {}
                        if tr.get("displayName", "").startswith("getUserContext"):
                            r = tr.get("response") or {}
                            activity = r.get("recent_activity") or ""
                            profile = list((r.get("profile") or {}).keys())
            if activity is not None:
                return {"held": held, "activity": activity,
                        "profileKeys": profile}
        return None


def ask(page, rec, question, timeout_s=110):
    before = len(rec.sessions)
    collapsed = page.locator("ces-messenger div.assistant-collapsed")
    if collapsed.count() and collapsed.is_visible():
        collapsed.click()
        page.wait_for_timeout(3000)
    box = page.locator('ces-messenger textarea[aria-label="Type your message"]')
    box.click()
    box.fill(question)
    page.locator("ces-messenger button.send").click()
    deadline = time.time() + timeout_s
    while time.time() < deadline and len(rec.sessions) == before:
        page.wait_for_timeout(1000)
    page.wait_for_timeout(6000)


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

    sid = rec.forwarded_id()
    with open(SID_FILES[label], "w") as fh:
        fh.write((sid or "NONE") + "\n")

    events_requested = sum(r["events"] for r in rec.requests)
    print(f"\n=== VARIANT {label} ({'SPA clicks' if spa else 'full page loads'}) ===")
    print(f"  session id:            {sid}")
    print(f"  event sids in payloads: {sorted(rec.sids)}")
    print(f"  collector requests:     {len(rec.requests)} ({events_requested} events)")
    print(f"  collector responses:    {len(rec.responses)} "
          f"statuses={sorted({r['status'] for r in rec.responses})}")
    print(f"  requestfailed:          {len(rec.failed)} {rec.failed[:4]}")
    sys.stdout.flush()

    time.sleep(20)  # give Signals the ~12-22s it needed when it worked
    ask(page, rec, "Do you know what I've been looking at recently?")
    look = rec.lookup() or {}
    activity = look.get("activity") or ""
    has_events = bool(activity) and "No events buffered" not in activity
    print(f"  agent held id:          {look.get('held')}")
    print(f"  Signals had events:     {has_events}")
    print(f"  profile attributes:     {len(look.get('profileKeys') or [])}")
    print(f"  activity:               {activity[:150]!r}")
    sys.stdout.flush()

    out = {"label": label, "spa": spa, "sessionId": sid,
           "eventSids": sorted(rec.sids),
           "collectorRequests": len(rec.requests),
           "eventsInPayloads": events_requested,
           "collectorResponses": len(rec.responses),
           "responseStatuses": sorted({r["status"] for r in rec.responses}),
           "requestFailed": rec.failed,
           "agentHeldId": look.get("held"), "hasEvents": has_events,
           "profileAttributes": len(look.get("profileKeys") or []),
           "activity": activity[:200], "console": rec.console}
    ctx.close()
    return out


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        a = run_variant(browser, "A-goto", spa=False)
        b = run_variant(browser, "B-spa", spa=True)
        browser.close()

    verdict = {
        "goto_hasEvents": a["hasEvents"],
        "spa_hasEvents": b["hasEvents"],
        "goto_requests_vs_responses": [a["collectorRequests"], a["collectorResponses"]],
        "spa_requests_vs_responses": [b["collectorRequests"], b["collectorResponses"]],
        "goto_requestFailed": len(a["requestFailed"]),
        "spa_requestFailed": len(b["requestFailed"]),
        "navStyleExplainsIt": a["hasEvents"] is False and b["hasEvents"] is True,
        "gotoSessionId": a["sessionId"], "spaSessionId": b["sessionId"],
    }
    print("\n=== VERDICT ===")
    print(json.dumps(verdict, indent=2))
    with open(REPORT, "w") as fh:
        json.dump({"A": a, "B": b, "verdict": verdict}, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
