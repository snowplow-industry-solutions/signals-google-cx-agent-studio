"""Why does the agent see no Signals context when Signals holds the data?

Compares three ids for one browsing session:
  1. the domain_sessionid in the tracker's own _sp_id cookie,
  2. the id the widget forwards via setQueryParameters (console mark),
  3. the snowplow_session_id the agent actually received (updatedVariables in
     the runSession diagnosticInfo) plus what Signals answered for it.

Fresh browser context, first-ever page load -- the case a real shopper hits.
"""

import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "https://signals-google-gecx-storefront.vercel.app"
OUT = os.environ.get(
    "VERIFY_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
)
os.makedirs(OUT, exist_ok=True)
REPORT = f"{OUT}/probe-session-report.json"


def cookie_session_id(page):
    """_sp_id.<hash> = domainUserId.createdAt.visitCount.nowTs.lastVisitTs.sessionId"""
    for c in page.context.cookies():
        if c["name"].startswith("_sp_id."):
            parts = c["value"].split(".")
            return {"cookie": c["name"], "value": c["value"],
                    "sessionId": parts[-1] if parts else None,
                    "domainUserId": parts[0] if parts else None}
    return None


def main():
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        # Fresh context: no cookies, no storage -- a brand-new visitor.
        ctx = browser.new_context(viewport={"width": 1500, "height": 1080})
        page = ctx.new_page()
        console, collector, sessions = [], [], []

        page.on("console", lambda m: console.append(m.text[:300]))

        def on_request(req):
            if "/com.snowplowanalytics.snowplow/" in req.url or "/tp2" in req.url:
                collector.append({"url": req.url[:120], "method": req.method})
        page.on("request", on_request)

        def on_response(resp):
            if not any(k in resp.url for k in (":runSession", "runSession")):
                return
            try:
                body = resp.text()
            except Exception:
                return
            sessions.append(body)
        page.on("response", on_response)

        # --- 1. first-ever page load on a product page (fires product_viewed)
        page.goto(f"{BASE}/products/ivory-silk-column-dress",
                  wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(9000)
        out["afterFirstLoad"] = {
            "cookie": cookie_session_id(page),
            "signalsMarks": [c for c in console if "[Signals Demo]" in c],
            "collectorRequests": len(collector),
        }
        print("=== AFTER FIRST LOAD ===")
        print(json.dumps(out["afterFirstLoad"], indent=2)[:1500])

        # --- 2. SPA navigation to a second product (widget is NOT remounted)
        link = page.locator("a[href^='/products/']").first
        if link.count():
            link.click()
            page.wait_for_timeout(6000)
        out["afterSpaNav"] = {
            "url": page.url,
            "cookie": cookie_session_id(page),
            "collectorRequests": len(collector),
            "signalsMarks": [c for c in console if "[Signals Demo]" in c],
        }
        print("\n=== AFTER SPA NAV ===")
        print(json.dumps(out["afterSpaNav"], indent=2)[:1200])

        # --- 3. ask the agent what it knows
        collapsed = page.locator("ces-messenger div.assistant-collapsed")
        if collapsed.count() and collapsed.is_visible():
            collapsed.click()
            page.wait_for_timeout(3000)
        box = page.locator('ces-messenger textarea[aria-label="Type your message"]')
        box.click()
        box.fill("Do you know what I've been looking at recently?")
        page.locator("ces-messenger button.send").click()

        deadline = time.time() + 90
        while time.time() < deadline and not sessions:
            page.wait_for_timeout(1000)
        page.wait_for_timeout(6000)

        reply = page.evaluate("""
          () => {
            const sr = document.querySelector('ces-messenger').shadowRoot;
            const lis = [...sr.querySelectorAll('ul[aria-label="Chat messages"] > li')];
            return lis.map(li => (li.innerText || '').trim().slice(0, 400));
          }
        """)
        out["reply"] = reply

        # --- 4. what did the AGENT get?
        agent_view = []
        for body in sessions:
            try:
                obj = json.loads(body)
            except Exception:
                continue
            for o in obj.get("outputs", []):
                di = o.get("diagnosticInfo")
                if not di:
                    continue
                for m in di.get("messages", []):
                    for ch in m.get("chunks", []):
                        if "updatedVariables" in ch:
                            agent_view.append({"updatedVariables": ch["updatedVariables"]})
                        if "defaultVariables" in ch:
                            agent_view.append({"defaultVariables": ch["defaultVariables"]})
                        tr = ch.get("toolResponse")
                        if tr and tr.get("displayName", "").startswith("getUserContext"):
                            agent_view.append({"getUserContextResponse": tr.get("response")})
        out["agentView"] = agent_view
        print("\n=== WHAT THE AGENT GOT ===")
        print(json.dumps(agent_view, indent=2)[:2500])
        print("\n=== REPLY ===")
        for r in reply:
            print(" -", r[:200].replace("\n", " | "))

        # --- verdict
        cookie_sid = (out["afterSpaNav"]["cookie"] or {}).get("sessionId")
        forwarded = None
        for c in console:
            m = re.search(r'Passed domain_sessionid.*?([0-9a-f-]{36})', c)
            if m:
                forwarded = m.group(1)
        agent_sid = None
        for a in agent_view:
            uv = a.get("updatedVariables") or {}
            if "snowplow_session_id" in uv:
                agent_sid = uv["snowplow_session_id"]
        out["verdict"] = {
            "cookieSessionId": cookie_sid,
            "widgetForwardedId": forwarded,
            "agentReceivedId": agent_sid,
            "cookieMatchesAgent": bool(cookie_sid and agent_sid and cookie_sid == agent_sid),
            "widgetLoggedNoSession": any("no domain_sessionid yet" in c for c in console),
            "collectorRequests": len(collector),
        }
        print("\n=== VERDICT ===")
        print(json.dumps(out["verdict"], indent=2))

        out["console"] = console
        with open(REPORT, "w") as fh:
            json.dump(out, fh, indent=2)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
