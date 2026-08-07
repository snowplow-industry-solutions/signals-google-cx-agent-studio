"""Reproduce the human's 2026-07-30 finding: clearing Snowplow cookies mid-visit
(without a reload) leaves the agent on a stale/absent snowplow_session_id.

Ground truth for "which session did the events go to" comes from the collector
POST bodies (each event carries `sid`), not from cookies -- the tracker keeps
session state in memory and in localStorage as well as the cookie.

Phases:
  A  fresh visitor, load a product page, browse via SPA        -> session A
  B  delete Snowplow cookies + localStorage, NO reload, browse -> session ?
  C  ask the agent what it knows                               -> which id did it get?
  D  reload, ask again                                         -> does it recover?
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
REPORT = f"{OUT}/probe-rotation-report.json"


class Recorder:
    def __init__(self, page):
        self.console = []
        self.events = []          # {sid, e, url, phase}
        self.sessions = []        # runSession response bodies
        self.phase = "A"
        page.on("console", self._console)
        page.on("request", self._request)
        page.on("response", self._response)

    def _console(self, msg):
        try:
            t = msg.text[:300]
        except Exception:
            return
        if "[Signals Demo]" in t:
            self.console.append({"phase": self.phase, "text": t})

    def _request(self, req):
        if "/com.snowplowanalytics.snowplow/" not in req.url and "/tp2" not in req.url:
            return
        try:
            body = req.post_data
            if not body:
                return
            obj = json.loads(body)
        except Exception:
            return
        for ev in obj.get("data", []):
            self.events.append({
                "phase": self.phase,
                "sid": ev.get("sid"),
                "e": ev.get("e"),
                "url": (ev.get("url") or "")[-60:],
                "duid": ev.get("duid"),
            })

    def _response(self, resp):
        if not any(k in resp.url for k in (":runSession", "runSession")):
            return
        try:
            self.sessions.append({"phase": self.phase, "body": resp.text()})
        except Exception:
            pass

    def sids(self, phase):
        return sorted({e["sid"] for e in self.events if e["phase"] == phase and e["sid"]})

    def marks(self, phase):
        return [c["text"] for c in self.console if c["phase"] == phase]


def sp_cookie_sid(ctx):
    for c in ctx.cookies():
        if c["name"].startswith("_sp_id."):
            return c["value"].split(".")[-1]
    return None


def ask(page, question, rec, timeout_s=100):
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
    page.wait_for_timeout(8000)
    return page.evaluate("""
      () => {
        const sr = document.querySelector('ces-messenger').shadowRoot;
        const lis = [...sr.querySelectorAll('ul[aria-label="Chat messages"] > li')];
        return (lis[lis.length - 1].innerText || '').trim().slice(0, 500);
      }
    """)


def agent_saw(rec, phase):
    """The snowplow_session_id the agent held, and Signals' answer for it."""
    got = {"variableIds": [], "recentActivity": None, "profileKeys": None}
    for s in rec.sessions:
        if s["phase"] != phase:
            continue
        try:
            obj = json.loads(s["body"])
        except Exception:
            continue
        for o in obj.get("outputs", []):
            di = o.get("diagnosticInfo") or {}
            for m in di.get("messages", []):
                for ch in m.get("chunks", []):
                    uv = ch.get("updatedVariables") or {}
                    if "snowplow_session_id" in uv:
                        got["variableIds"].append(uv["snowplow_session_id"])
                    dv = (ch.get("defaultVariables") or {})
                    if "snowplow_session_id" in dv:
                        got["variableIds"].append(dv["snowplow_session_id"])
                    tr = ch.get("toolResponse") or {}
                    if tr.get("displayName", "").startswith("getUserContext"):
                        resp = tr.get("response") or {}
                        got["recentActivity"] = (resp.get("recent_activity") or "")[:200]
                        got["profileKeys"] = list((resp.get("profile") or {}).keys())
    return got


def main():
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        ctx = browser.new_context(viewport={"width": 1500, "height": 1080})
        page = ctx.new_page()
        rec = Recorder(page)

        # ---------- PHASE A: fresh visitor ----------
        page.goto(f"{BASE}/products/ivory-silk-column-dress",
                  wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(9000)
        for _ in range(2):
            link = page.locator("a[href^='/products/']").first
            if link.count():
                link.click()
                page.wait_for_timeout(5000)
        out["A"] = {"cookieSid": sp_cookie_sid(ctx), "eventSids": rec.sids("A"),
                    "marks": rec.marks("A"), "eventCount": len(rec.events)}
        print("=== PHASE A (fresh visitor) ===")
        print(json.dumps(out["A"], indent=2))

        # ---------- PHASE B: nuke Snowplow state, NO reload ----------
        rec.phase = "B"
        keep = [c for c in ctx.cookies() if not c["name"].startswith(("_sp_id", "_sp_ses"))]
        ctx.clear_cookies()
        if keep:
            ctx.add_cookies(keep)
        page.evaluate("""
          () => {
            Object.keys(localStorage)
              .filter(k => k.startsWith('_sp_') || k.toLowerCase().includes('snowplow'))
              .forEach(k => localStorage.removeItem(k));
            Object.keys(sessionStorage)
              .filter(k => k.startsWith('_sp_') || k.toLowerCase().includes('snowplow'))
              .forEach(k => sessionStorage.removeItem(k));
          }
        """)
        print("\n(cleared Snowplow cookies + storage; NO reload)")
        for _ in range(2):
            link = page.locator("a[href^='/products/']").first
            if link.count():
                link.click()
                page.wait_for_timeout(6000)
        out["B"] = {"cookieSid": sp_cookie_sid(ctx), "eventSids": rec.sids("B"),
                    "marks": rec.marks("B")}
        print("=== PHASE B (after clearing, no reload) ===")
        print(json.dumps(out["B"], indent=2))

        # ---------- PHASE C: what does the agent know now? ----------
        rec.phase = "C"
        reply_c = ask(page, "Do you know what I've been looking at recently?", rec)
        out["C"] = {"reply": reply_c, "agent": agent_saw(rec, "C"),
                    "marks": rec.marks("C")}
        print("\n=== PHASE C (agent, no reload) ===")
        print(json.dumps(out["C"], indent=2)[:2000])

        # ---------- PHASE D: reload, ask again ----------
        rec.phase = "D"
        page.reload(wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(9000)
        reply_d = ask(page, "Do you know what I've been looking at recently?", rec)
        out["D"] = {"cookieSid": sp_cookie_sid(ctx), "eventSids": rec.sids("D"),
                    "reply": reply_d, "agent": agent_saw(rec, "D"),
                    "marks": rec.marks("D")}
        print("\n=== PHASE D (after reload) ===")
        print(json.dumps(out["D"], indent=2)[:2200])

        # ---------- verdict ----------
        a_sids, b_sids = out["A"]["eventSids"], out["B"]["eventSids"]
        c_ids = out["C"]["agent"]["variableIds"]
        d_ids = out["D"]["agent"]["variableIds"]
        out["verdict"] = {
            "sessionRotatedWithoutReload": bool(b_sids and b_sids != a_sids),
            "eventsAfterClearWentTo": b_sids,
            "agentHeldDuringPhaseC": sorted(set(c_ids)),
            "phaseC_agentIdIsStale": bool(c_ids and a_sids and set(c_ids) & set(a_sids)
                                          and b_sids and not set(c_ids) & set(b_sids)),
            "phaseC_agentHadNoId": not c_ids,
            "phaseC_signalsAnswer": out["C"]["agent"]["recentActivity"],
            "reforwardMarkOnlyAfterReload": (not any("Passed domain_sessionid" in m
                                                     for m in rec.marks("B") + rec.marks("C"))
                                             and any("Passed domain_sessionid" in m
                                                     for m in rec.marks("D"))),
            "agentHeldAfterReload": sorted(set(d_ids)),
            "phaseD_profileKeys": out["D"]["agent"]["profileKeys"],
        }
        print("\n=== VERDICT ===")
        print(json.dumps(out["verdict"], indent=2))

        out["allEvents"] = rec.events
        out["allMarks"] = rec.console
        with open(REPORT, "w") as fh:
            json.dump(out, fh, indent=2)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
