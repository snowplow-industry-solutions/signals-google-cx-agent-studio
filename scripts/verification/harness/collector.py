"""Collector-payload decoding: what actually reached the Snowplow collector.

Request counts hide a whole class of bug -- a silent zero product_viewed while
the storefront console logs success either way. These helpers decode each POST
body down to the event level so a check can assert a *named* event arrived. The
session ground truth is data[].sid in the POST body, not the _sp_id cookie,
whose last field is a visit counter.
"""

import base64
import json
import time


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
