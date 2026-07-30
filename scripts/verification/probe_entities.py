"""Compare the context entities on a first-load event vs a post-SPA-nav event.

SnowplowProvider attaches a global user context built from Signals attributes,
which are null on a fresh page load. If the events sent during that window
carry a different (or invalid) entity set, that explains why full-page-load
browsing produces nothing queryable in Signals while SPA browsing works.
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = "https://signals-google-gecx-storefront.vercel.app"
OUT = os.environ.get(
    "VERIFY_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
)
os.makedirs(OUT, exist_ok=True)
REPORT = f"{OUT}/probe-entities-report.json"


def summarise(event):
    """Entity schemas + the unstructured event schema for one tracked event."""
    out = {"e": event.get("eventName") or event.get("e"), "sid": event.get("sid")}
    ue = event.get("ue_pr") or event.get("ue_px")
    if isinstance(ue, str):
        try:
            ue = json.loads(ue)
        except Exception:
            ue = None
    if isinstance(ue, dict):
        data = ue.get("data") or {}
        out["ueSchema"] = data.get("schema")
        out["ueFields"] = sorted((data.get("data") or {}).keys())
    co = event.get("co") or event.get("cx")
    if isinstance(co, str):
        try:
            co = json.loads(co)
        except Exception:
            co = None
    entities = []
    if isinstance(co, dict):
        for ent in co.get("data", []):
            entities.append({
                "schema": ent.get("schema"),
                "fields": sorted((ent.get("data") or {}).keys()),
                "nullFields": sorted(k for k, v in (ent.get("data") or {}).items()
                                     if v is None),
                "data": ent.get("data") if "user" in (ent.get("schema") or "") else None,
            })
    out["entities"] = entities
    return out


def main():
    captured = {"firstLoad": [], "afterSpaNav": []}
    phase = {"now": "firstLoad"}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        ctx = browser.new_context(viewport={"width": 1500, "height": 1080})
        page = ctx.new_page()

        def on_request(req):
            if "/com.snowplowanalytics.snowplow/" not in req.url and "/tp2" not in req.url:
                return
            try:
                obj = json.loads(req.post_data or "{}")
            except Exception:
                return
            for ev in obj.get("data", []):
                captured[phase["now"]].append(summarise(ev))
        page.on("request", on_request)

        page.goto(f"{BASE}/products/ivory-silk-column-dress",
                  wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(10000)

        phase["now"] = "afterSpaNav"
        link = page.locator("a[href^='/products/']").first
        if link.count():
            link.click()
            page.wait_for_timeout(8000)

        browser.close()

    for label in ("firstLoad", "afterSpaNav"):
        print(f"\n=========== {label}: {len(captured[label])} events ===========")
        for ev in captured[label]:
            print(f"\n  event: {ev.get('e')}  ueSchema={ev.get('ueSchema')}")
            if ev.get("ueFields"):
                print(f"    ue fields: {ev['ueFields']}")
            for ent in ev["entities"]:
                schema = (ent["schema"] or "").replace(
                    "iglu:com.snowplowanalytics.snowplow/", "sp/")
                line = f"    entity {schema}"
                if ent["nullFields"]:
                    line += f"  NULL FIELDS: {ent['nullFields']}"
                print(line)
                if ent.get("data") is not None:
                    print(f"      user entity data: {json.dumps(ent['data'])[:300]}")

    # Which entity schemas appear in one phase but not the other?
    def schemas(label):
        return {e["schema"] for ev in captured[label] for e in ev["entities"]}
    only_first = schemas("firstLoad") - schemas("afterSpaNav")
    only_spa = schemas("afterSpaNav") - schemas("firstLoad")
    print("\n=== ENTITY SCHEMA DIFF ===")
    print("only on first load:", json.dumps(sorted(only_first), indent=2))
    print("only after SPA nav:", json.dumps(sorted(only_spa), indent=2))

    with open(REPORT, "w") as fh:
        json.dump(captured, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
