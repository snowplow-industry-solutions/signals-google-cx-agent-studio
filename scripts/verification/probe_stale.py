"""Does a restored conversation keep a STALE snowplow_session_id?

Hypothesis (human, 2026-07-30): the agent variable is captured when the
conversation starts, and the widget restores that conversation across a page
reload -- so if the Snowplow session rotates after the conversation began, the
agent keeps querying the OLD session id until the chat is reset.

  1  fresh visitor, browse -> session A, conversation started under A
  2  clear Snowplow cookies + storage AND reload -> session B, browse new items
  3  reopen the RESTORED conversation, ask again -> which id does the agent hold?
  4  reset the chat, ask again                   -> does it pick up B?

Ground truth for event->session mapping comes from collector POST bodies.
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
REPORT = f"{OUT}/probe-stale-report.json"

PHASE1 = ["/products/ivory-silk-column-dress", "/products/silk-twill-square-scarf"]
# Deliberately different pieces after the rotation, so a stale lookup is obvious
# in the agent's own words (evening dress/scarf vs winter coat/boot).
PHASE2 = ["/products/camel-cashmere-wrap-coat", "/products/suede-chelsea-ankle-boot"]


class Recorder:
    def __init__(self, page):
        self.console, self.events, self.sessions = [], [], []
        self.phase = "1"
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
            obj = json.loads(req.post_data or "{}")
        except Exception:
            return
        for ev in obj.get("data", []):
            if ev.get("sid"):
                self.events.append({"phase": self.phase, "sid": ev["sid"], "e": ev.get("e")})

    def _response(self, resp):
        if not any(k in resp.url for k in (":runSession", "runSession")):
            return
        try:
            self.sessions.append({"phase": self.phase, "body": resp.text()})
        except Exception:
            pass

    def sids(self, phase):
        return sorted({e["sid"] for e in self.events if e["phase"] == phase})

    def forwarded(self, phase):
        return [c["text"].split("sessionId: ")[-1].rstrip("}")
                for c in self.console
                if c["phase"] == phase and "Passed domain_sessionid" in c["text"]]

    def agent_ids(self, phase):
        ids, activity = [], None
        for s in self.sessions:
            if s["phase"] != phase:
                continue
            try:
                obj = json.loads(s["body"])
            except Exception:
                continue
            for o in obj.get("outputs", []):
                for m in (o.get("diagnosticInfo") or {}).get("messages", []):
                    for ch in m.get("chunks", []):
                        for bag in ("updatedVariables", "defaultVariables"):
                            v = (ch.get(bag) or {}).get("snowplow_session_id")
                            if v:
                                ids.append(v)
                        tr = ch.get("toolResponse") or {}
                        if tr.get("displayName", "").startswith("getUserContext"):
                            r = tr.get("response") or {}
                            activity = (r.get("recent_activity") or "")[:300]
        return sorted(set(ids)), activity


def browse(page, paths, first_load=False):
    for i, path in enumerate(paths):
        if first_load and i == 0:
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(9000)
        else:
            page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(6000)


def open_chat(page):
    collapsed = page.locator("ces-messenger div.assistant-collapsed")
    if collapsed.count() and collapsed.is_visible():
        collapsed.click()
        page.wait_for_timeout(3000)


def ask(page, rec, question, timeout_s=110):
    before = len(rec.sessions)
    open_chat(page)
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
        return {
          count: lis.length,
          last: (lis[lis.length - 1].innerText || '').trim().slice(0, 500),
        };
      }
    """)


def clear_snowplow(page, ctx):
    keep = [c for c in ctx.cookies() if not c["name"].startswith(("_sp_id", "_sp_ses"))]
    ctx.clear_cookies()
    if keep:
        ctx.add_cookies(keep)
    page.evaluate("""
      () => {
        [localStorage, sessionStorage].forEach(store => {
          Object.keys(store)
            .filter(k => k.startsWith('_sp_') || k.toLowerCase().includes('snowplow'))
            .forEach(k => store.removeItem(k));
        });
      }
    """)


def find_reset(page):
    """Locate a reset/new-conversation control inside the widget shadow DOM."""
    return page.evaluate("""
      () => {
        const sr = document.querySelector('ces-messenger').shadowRoot;
        const nodes = [...sr.querySelectorAll('button, [role=button], a')];
        return nodes.map(n => ({
          text: (n.innerText || '').trim().slice(0, 40),
          aria: n.getAttribute('aria-label'),
          cls: (n.className || '').toString().slice(0, 60),
        })).filter(n => n.text || n.aria);
      }
    """)


def main():
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        ctx = browser.new_context(viewport={"width": 1500, "height": 1080})
        page = ctx.new_page()
        rec = Recorder(page)

        # ---- phase 1: session A, start a conversation under it
        browse(page, PHASE1, first_load=True)
        r1 = ask(page, rec, "Do you know what I've been looking at recently?")
        out["1"] = {"eventSids": rec.sids("1"), "forwarded": rec.forwarded("1"),
                    "reply": r1, "agent": rec.agent_ids("1")}
        print("=== PHASE 1 (session A, conversation started) ===")
        print(json.dumps(out["1"], indent=2)[:1600])

        # ---- phase 2: rotate the session (clear + reload), browse different items
        rec.phase = "2"
        clear_snowplow(page, ctx)
        page.reload(wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(9000)
        browse(page, PHASE2)
        out["2"] = {"eventSids": rec.sids("2"), "forwarded": rec.forwarded("2")}
        print("\n=== PHASE 2 (cleared + reloaded, browsed winter items) ===")
        print(json.dumps(out["2"], indent=2))

        # ---- phase 3: restored conversation — stale or fresh id?
        rec.phase = "3"
        r3 = ask(page, rec, "What am I looking at now, and what would go with it?")
        out["3"] = {"reply": r3, "agent": rec.agent_ids("3"),
                    "forwarded": rec.forwarded("3")}
        print("\n=== PHASE 3 (restored conversation) ===")
        print(json.dumps(out["3"], indent=2)[:2000])

        # ---- phase 4: reset the chat, ask again
        rec.phase = "4"
        out["4"] = {"controls": find_reset(page)}
        print("\n=== PHASE 4 widget controls ===")
        print(json.dumps(out["4"]["controls"], indent=2)[:900])
        clicked = page.evaluate("""
          () => {
            const sr = document.querySelector('ces-messenger').shadowRoot;
            const nodes = [...sr.querySelectorAll('button, [role=button]')];
            const hit = nodes.find(n => /reset|new chat|new conversation|clear/i
              .test(((n.innerText || '') + ' ' + (n.getAttribute('aria-label') || ''))));
            if (!hit) return null;
            hit.click();
            return (hit.innerText || hit.getAttribute('aria-label') || '').trim();
          }
        """)
        out["4"]["clicked"] = clicked
        print("clicked reset control:", clicked)
        if clicked:
            page.wait_for_timeout(6000)
            r4 = ask(page, rec, "Do you know what I've been looking at recently?")
            out["4"].update({"reply": r4, "agent": rec.agent_ids("4"),
                             "forwarded": rec.forwarded("4")})
            print(json.dumps({k: v for k, v in out["4"].items() if k != "controls"},
                             indent=2)[:1800])

        a_ids = out["1"]["agent"][0]
        b_sids = out["2"]["eventSids"]
        c_ids = out["3"]["agent"][0]
        out["verdict"] = {
            "sessionA": a_ids,
            "sessionB_events": b_sids,
            "restoredConversationHeld": c_ids,
            "STALE_CONFIRMED": bool(c_ids and a_ids and set(c_ids) == set(a_ids)
                                    and b_sids and not set(c_ids) & set(b_sids)),
            "phase2_forwardedNewId": out["2"]["forwarded"],
            "phase3_signalsAnswer": out["3"]["agent"][1],
            "afterResetHeld": out["4"].get("agent", [None])[0] if out["4"].get("agent") else None,
        }
        print("\n=== VERDICT ===")
        print(json.dumps(out["verdict"], indent=2))

        out["allMarks"] = rec.console
        out["allEvents"] = rec.events
        with open(REPORT, "w") as fh:
            json.dump(out, fh, indent=2)
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
