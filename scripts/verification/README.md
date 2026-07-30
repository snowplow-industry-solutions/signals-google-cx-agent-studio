# `scripts/verification/` — production verification scripts (raw, unrefactored)

Playwright scripts written against production during the 2026-07-30 issue #1 /
#3 / #7 sessions. They are preserved here **as raw material**, not as a
maintained harness: they hardcode the storefront URL, assert nothing, and
duplicate a lot between files. Turning them into a real asserting harness is
issue #9.

Committed because they lived in a temp directory that dies with the session, and
they are the only scripted form of the runbook §11.5 walkthrough — each earlier
session rebuilt them from scratch and re-paid the same discovery cost.

## What each one does

| Script | Purpose |
| --- | --- |
| `walkthrough.py` | Runbook §11.5 steps 2–6: browses to build Signals context, opens chat, sends turns, extracts rendered cards from the shadow DOM, flags the delivery mode per turn, screenshots, writes a JSON report. **The one to adapt for issue #9.** |
| `commentary.py` | Issue #3 check: does every widget turn also carry a text bubble? Extracts prose with `[data-widget-card]` subtrees removed so card text cannot be mistaken for commentary. |
| `followup.py` | Extra turns hunting in-band token mode, carousel-item click-through, and a synthetic token-mode probe (injects a verbatim token into the shadow DOM when the live agent won't emit one). |
| `probe_navmode.py` | **The issue #7 reproduction.** Two fresh sessions, full-page-load vs SPA-click browsing; records collector requests, response statuses, `requestfailed`, then asks the agent. |
| `probe_entities.py` | Dumps context entities per event; shows `product_viewed` missing entirely on first load. Rules out validation/entity causes. |
| `probe_latency.py` | Polls the agent on a timer; showed Signals answers 12–33s after an event, killing the "ingestion lag" theory. |
| `probe_rotation.py`, `probe_stale.py`, `probe_session.py` | Disproved stale/rotating session-id theories. Kept for context. |
| `recon2.py` | Dumps the widget's expanded shadow DOM. Use if selectors move. |
| `state_js.txt` | Shared shadow-DOM extraction snippet that `followup.py` reads. |

## Running them

```sh
pip install playwright
python3 scripts/verification/walkthrough.py
```

Reports and screenshots go to `scripts/verification/out/` (gitignored); override
with `VERIFY_OUT=/some/dir`. That output path is the **only** edit made to the
scripts as they came out of the temp directory — they previously hardcoded a
scratchpad path that no longer exists.

## Gotchas baked into these scripts

- Python Playwright's pinned browser build is missing on the dev machine: launch
  with `p.chromium.launch(headless=True, channel="chrome")`.
- **`wait_until="networkidle"` never fires** on this site — the widget and the
  Signals subscription hold connections open. Use `domcontentloaded` plus
  explicit waits.
- `ces-messenger` inserts an **empty placeholder `<li>` on send**. Waiting on "a
  new bubble exists" attributes each reply to the *following* turn — wait for
  real content, then settle. Replies take 5–20s.
- Selectors pierce the open shadow root: launcher
  `ces-messenger div.assistant-collapsed`, input
  `ces-messenger textarea[aria-label="Type your message"]`, send
  `ces-messenger button.send`, messages `ul[aria-label="Chat messages"] > li`,
  cards `[data-widget-card]`, items `[data-uri]` / `a[href]`.
- Delivery mode reads off the storefront's own console marks: `Rewrote widget
  payload to rich-message template` = structured payload; `Rendered
  rich-response widget token(s) in chat` = in-band token; `Widget payload
  unrenderable` = failure path.
- Ground truth for "which session did an event go to" is the collector POST body
  (`data[].sid`), not cookies — the `_sp_id` cookie's last field is a visit
  counter, not the session id.
- Browsing by full page load drops `product_viewed` (issue #7), so a script that
  browses that way sees an empty Signals profile. That cost a day of chasing
  latency theories.

## Not committed, deliberately

The matching `*-report.json` evidence files stay out of the repo: each contains
a `chatToken` from the CES token broker, captured in a console debug line. The
run logs and session-id scratch files are omitted for the same reason. Issue #9
generates fresh reports.
