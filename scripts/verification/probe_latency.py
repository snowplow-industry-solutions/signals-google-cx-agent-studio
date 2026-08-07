"""How long until Signals can answer for a freshly-browsed session -- if ever?

Browses as a new visitor, then asks the agent the same question on a timer.
Every turn re-calls getUserContext (constraint 1), so each poll is a fresh
Signals lookup. Records, per poll: seconds since the last tracked event, the
session id the agent held, whether the event log returned events, and whether
the profile attributes came back.

Writes the session id to current-session-id.txt as soon as it is known so the
same session can be polled from outside with the shared secret.
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
REPORT = f"{OUT}/probe-latency-report.json"
SID_FILE = f"{OUT}/current-session-id.txt"

PATHS = ["/products/ivory-silk-column-dress",
         "/products/silk-twill-square-scarf",
         "/products/noir-double-breasted-blazer"]

POLL_INTERVAL_S = 40
MAX_POLLS = 9


class Recorder:
    def __init__(self, page):
        self.console, self.event_times, self.sessions = [], [], []
        self.sids = set()
        page.on("console", self._console)
        page.on("request", self._request)
        page.on("response", self._response)

    def _console(self, msg):
        try:
            t = msg.text[:300]
        except Exception:
            return
        if "[Signals Demo]" in t:
            self.console.append(t)

    def _request(self, req):
        if "/com.snowplowanalytics.snowplow/" not in req.url and "/tp2" not in req.url:
            return
        try:
            obj = json.loads(req.post_data or "{}")
        except Exception:
            return
        for ev in obj.get("data", []):
            if ev.get("sid"):
                self.sids.add(ev["sid"])
                self.event_times.append(time.time())

    def _response(self, resp):
        if not any(k in resp.url for k in (":runSession", "runSession")):
            return
        try:
            self.sessions.append(resp.text())
        except Exception:
            pass

    def forwarded_id(self):
        for c in reversed(self.console):
            if "Passed domain_sessionid" in c:
                return c.split("sessionId: ")[-1].rstrip("}").strip()
        return None

    def latest_lookup(self):
        """Parse the most recent runSession body for the agent's Signals view."""
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
                return {"held": held, "activity": activity, "profileKeys": profile}
        return None


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        ctx = browser.new_context(viewport={"width": 1500, "height": 1080})
        page = ctx.new_page()
        rec = Recorder(page)

        # --- browse as a brand-new visitor: one page load, then SPA clicks
        page.goto(BASE + PATHS[0], wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(9000)
        for _ in range(2):
            link = page.locator("a[href^='/products/']").first
            if link.count():
                link.click()
                page.wait_for_timeout(5000)

        sid = rec.forwarded_id()
        with open(SID_FILE, "w") as fh:
            fh.write((sid or "NONE") + "\n")
        last_event = max(rec.event_times) if rec.event_times else time.time()
        print(f"forwarded session id: {sid}")
        print(f"event sids seen in collector payloads: {sorted(rec.sids)}")
        print(f"events posted: {len(rec.event_times)}")
        sys.stdout.flush()

        collapsed = page.locator("ces-messenger div.assistant-collapsed")
        if collapsed.count() and collapsed.is_visible():
            collapsed.click()
            page.wait_for_timeout(3000)

        polls = []
        for i in range(MAX_POLLS):
            before = len(rec.sessions)
            box = page.locator('ces-messenger textarea[aria-label="Type your message"]')
            box.click()
            box.fill("Do you know what I've been looking at recently?")
            page.locator("ces-messenger button.send").click()

            deadline = time.time() + 100
            while time.time() < deadline and len(rec.sessions) == before:
                page.wait_for_timeout(1000)
            page.wait_for_timeout(6000)

            look = rec.latest_lookup() or {}
            activity = look.get("activity") or ""
            has_events = bool(activity) and "No events buffered" not in activity
            entry = {
                "poll": i + 1,
                "secondsSinceLastEvent": round(time.time() - last_event, 1),
                "agentHeldId": look.get("held"),
                "hasEvents": has_events,
                "profileAttributes": len(look.get("profileKeys") or []),
                "activity": activity[:180],
            }
            polls.append(entry)
            print(f"poll {entry['poll']:>2}  t+{entry['secondsSinceLastEvent']:>6}s  "
                  f"events={entry['hasEvents']}  profileAttrs={entry['profileAttributes']}  "
                  f"{entry['activity'][:100]!r}")
            sys.stdout.flush()

            if has_events:
                print(f"\n=== APPEARED after ~{entry['secondsSinceLastEvent']}s ===")
                break
            if i < MAX_POLLS - 1:
                page.wait_for_timeout(POLL_INTERVAL_S * 1000)

        out = {"forwardedId": sid, "eventSids": sorted(rec.sids),
               "eventsPosted": len(rec.event_times), "polls": polls,
               "console": rec.console}
        with open(REPORT, "w") as fh:
            json.dump(out, fh, indent=2)
        print("\n=== SUMMARY ===")
        print(json.dumps({"forwardedId": sid, "eventSids": sorted(rec.sids),
                          "appeared": any(p["hasEvents"] for p in polls),
                          "polls": [{k: p[k] for k in
                                     ("poll", "secondsSinceLastEvent", "hasEvents",
                                      "profileAttributes")} for p in polls]},
                         indent=2))
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
