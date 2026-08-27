"""The widget's shadow DOM, in one place.

Every selector and every wait in here was paid for once already; see
scripts/verification/README.md. The two that bite hardest:

  - ces-messenger inserts an EMPTY placeholder <li> the moment you send, so "a
    new bubble exists" is not evidence a reply arrived. Waiting on it attributes
    each reply to the FOLLOWING turn.
  - wait_until="networkidle" never fires on this site; the widget and the
    Signals subscription hold connections open.
"""

import json
import re
import time

from harness.config import MIN_PROSE

LAUNCHER = "ces-messenger div.assistant-collapsed"
INPUT = 'ces-messenger textarea[aria-label="Type your message"]'
SEND = "ces-messenger button.send"

# Playwright CSS selectors pierce the open shadow root, but page.evaluate does
# not, so the transcript is read through an explicit shadowRoot walk.
STATE_JS = """
() => {
  const el = document.querySelector('ces-messenger');
  const sr = el && el.shadowRoot;
  if (!sr) return {ok: false};
  const lis = [...sr.querySelectorAll('ul[aria-label="Chat messages"] > li')];
  const readCard = (c) => ({
    kind: c.getAttribute('data-widget-card'),
    items: [...c.querySelectorAll('[data-uri], a[href]')].map((item) => ({
      uri: item.getAttribute('data-uri') || item.getAttribute('href'),
      img: (item.querySelector('img') || {}).src || null,
      text: (item.innerText || '').trim().split('\\n').map(s => s.trim()).filter(Boolean),
    })),
  });
  return {
    ok: true,
    count: lis.length,
    messages: lis.map((li) => {
      // Prose = the bubble's text with any rendered widget cards cut out, so
      // card text cannot be mistaken for agent commentary.
      const clone = li.cloneNode(true);
      [...clone.querySelectorAll('[data-widget-card]')].forEach(n => n.remove());
      return {
        prose: (clone.innerText || '').trim(),
        fullText: (li.innerText || '').trim().slice(0, 1200),
        rawToken: (li.textContent || '').includes('{@Widget:'),
        cards: [...li.querySelectorAll('[data-widget-card]')].map(readCard),
      };
    }),
  };
}
"""

CLICK_LAST_CARD_JS = """
() => {
  const sr = document.querySelector('ces-messenger').shadowRoot;
  const items = [...sr.querySelectorAll('[data-widget-card] [data-uri], [data-widget-card] a[href]')];
  const el = items[items.length - 1];
  if (!el) return null;
  el.click();
  return el.getAttribute('data-uri') || el.getAttribute('href');
}
"""


def _norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


class RendererLog:
    """Console marks and agent-response bodies, which is how delivery mode is read."""

    AGENT_URL_KEYS = (":runSession", "runSession", ":run", "geminidataconnect",
                      "cloud.google.com")

    def __init__(self, page):
        self.console = []
        self.network = []
        page.on("console", self._on_console)
        page.on("response", self._on_response)

    def _on_console(self, msg):
        try:
            self.console.append((time.time(), msg.type, msg.text[:400]))
        except Exception:
            pass

    def _on_response(self, resp):
        if not any(k in resp.url for k in self.AGENT_URL_KEYS):
            return
        entry = {"t": time.time(), "url": resp.url[:160], "status": resp.status}
        try:
            body = resp.text()
            entry["hasToken"] = "@Widget:" in body
            entry["hasPayloadType"] = (("product_detail_carousel" in body)
                                       or ("base_product_detail" in body))
            entry["len"] = len(body)
        except Exception as exc:  # streaming bodies may be unavailable
            entry["bodyError"] = str(exc)[:80]
        self.network.append(entry)

    def marks_since(self, since):
        out = []
        for t, _type, text in self.console:
            if t < since:
                continue
            if "Rendered rich-response widget token" in text:
                out.append("token-mode")
            elif "Rewrote widget payload to rich-message template" in text:
                out.append("payload-mode")
            elif "unrenderable" in text:
                out.append("UNRENDERABLE")
        return out

    def net_since(self, since):
        return [n for n in self.network if n["t"] >= since]

    def console_counts(self):
        errors = sum(1 for _t, typ, _x in self.console if typ == "error")
        warnings = sum(1 for _t, typ, _x in self.console if typ == "warning")
        return {"errors": errors, "warnings": warnings,
                "lines": [text for _t, _typ, text in self.console]}


class ChatPanel:
    def __init__(self, page):
        self.page = page

    def read_state(self):
        return self.page.evaluate(STATE_JS)

    def open(self):
        collapsed = self.page.locator(LAUNCHER)
        if collapsed.count() and collapsed.is_visible():
            collapsed.click()
            self.page.wait_for_timeout(3000)

    def send(self, text):
        box = self.page.locator(INPUT)
        box.click()
        box.fill(text)
        self.page.locator(SEND).click()

    def agent_bubbles(self, state, before_count, prompt):
        """New bubbles for this turn, minus the user's own echoed message."""
        new = state.get("messages", [])[before_count:]
        return [m for m in new if _norm(m["prose"]) != _norm(prompt)]

    def quiesce(self, quiet_s=3.0, timeout_s=45):
        """Wait for the transcript to stop changing before sending the next turn."""
        deadline = time.time() + timeout_s
        last_sig, stable_since = None, None
        while time.time() < deadline:
            sig = json.dumps(self.read_state())
            if sig == last_sig:
                if stable_since and time.time() - stable_since > quiet_s:
                    return
            else:
                last_sig, stable_since = sig, time.time()
            self.page.wait_for_timeout(1000)

    def wait_for_reply(self, before_count, prompt, timeout_s=180, settle_s=8.0):
        """Wait for real reply content, then for it to stop changing.

        A turn can deliver prose and cards as separate bubbles arriving seconds
        apart, so the settle window is deliberately generous. Returns
        (state, timed_out).
        """
        deadline = time.time() + timeout_s
        stable_since = None
        last_sig = None
        while time.time() < deadline:
            state = self.read_state()
            if state.get("ok"):
                bubbles = self.agent_bubbles(state, before_count, prompt)
                sig = json.dumps(bubbles)
                if sig != last_sig:
                    last_sig, stable_since = sig, time.time()
                has_content = any(
                    len(m["prose"].strip()) >= MIN_PROSE or m["cards"]
                    for m in bubbles)
                if (has_content and stable_since
                        and time.time() - stable_since > settle_s):
                    return state, False
            self.page.wait_for_timeout(1000)
        return self.read_state(), True

    def click_last_card_item(self):
        """Click the most recent card item. Returns its uri, or None."""
        return self.page.evaluate(CLICK_LAST_CARD_JS)
