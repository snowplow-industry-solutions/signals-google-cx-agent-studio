# `scripts/verification/`

`verify_widgets.py` is the asserting harness for the runbook §11.5 widget
walkthrough (issue #9). Everything else here is a probe: a script written
against a specific question during the 2026-07-30 issue #1 / #3 / #7 sessions.
Five are live and share the `harness/` package; the rest are archaeology, kept
because they record what was tried and disproved.

## The harness

```sh
pip install playwright
export VERIFY_BASE=https://signals-google-gecx-storefront.vercel.app
export AGENT_SHARED_SECRET=...        # storefront/.env.local, never echo it
python3 scripts/verification/verify_widgets.py
```

Exit codes: `0` all checks passed, `1` one or more failed, `2` misconfigured.

| Variable | Required | Meaning |
| --- | --- | --- |
| `VERIFY_BASE` | yes | Storefront under test. No default — an unset value is a usage error, so a run can never silently target the wrong place. |
| `AGENT_SHARED_SECRET` | yes | Used for the AC6 `/api/agent/context` poll. Unset is an error, never a skip. |
| `VERIFY_OUT` | no | Report and screenshot directory. Defaults to the gitignored `scripts/verification/out/`. |
| `VERIFY_FAULT` | no | A check id whose observed input is corrupted, to prove that check can fail. |

### The nine checks

| id | asserts |
| --- | --- |
| `ac0-turns` | every planned turn ran and returned a reply — `len(turns) == expectedTurns` and no turn timed out |
| `ac1-commentary` | every widget turn also carried a text bubble (issue #3) |
| `ac2-cards` | cards rendered, and no raw `{@Widget:` token leaked (issue #1) |
| `ac3-spa-nav` | a card click SPA-navigated with chat and prior cards preserved |
| `ac4-mode` | each widget turn's delivery mode was payload-mode or token-mode, with no `UNRENDERABLE` anywhere in the turn's renderer marks |
| `ac5-console` | zero console errors or warnings across the run |
| `ac6-collector` | `product_viewed` reached the collector, once per product page, under one session id (issue #7) |
| `ac6-signals` | Signals returned a populated profile |
| `ac7-zero-match` | the zero-match control turn degraded to plain text |

Per-turn checks report one result per turn: `ac1-commentary[2a-carousel]`. The
summary line counts **results, not ids** — nine check ids over a run with four
widget turns and one zero-match control render as `18/18 checks passed`, so the
total moves with how many widget turns the agent happens to produce. Do not read
a fixed denominator as a health signal; read the exit code.

`ac0-turns` is the gate in front of the per-turn checks. A turn that times out
has no cards, so it is not a widget turn, so `ac1`/`ac2`/`ac4` would have
nothing to say about it. For the same reason **a check that produces no results
at all is recorded as a failure**, not skipped: `evaluate()` emits
`no instances to evaluate` rather than letting silence read as a pass.

### Reading a failure

Each failing line carries a detail string with the observed values. The full
Observation is in `out/verify-widgets-report.json` under `observation`, with the
per-check verdicts under `checks`. Screenshots for every turn are alongside it.

`ac6-collector` failing while `ac6-signals` passes is impossible; the reverse
means tracking worked and the Signals side did not — an unpublished attribute
group, stalled ingestion, or a session id that never linked. Both failing points
at the issue #7 class of bug: the storefront logs tracking success whether or
not the tracker fired.

### Proving the checks can fail

```sh
python3 scripts/verification/verify_widgets.py --selfcheck   # no browser, sub-second
VERIFY_FAULT=ac6-signals python3 scripts/verification/verify_widgets.py
```

`--selfcheck` feeds every predicate a synthetic passing and failing observation,
and every fault a real one, failing if any predicate cannot fail. `VERIFY_FAULT`
corrupts a check's input during a live run, which catches a predicate that is
sound but reads a field phase A never writes.

A single fixture pair is not enough for a predicate whose verdict is a
conjunction: `bool(cards) and not raw` short-circuits, so a bad fixture that
empties `cards` *and* sets `rawToken` never reaches the token term — the issue
#1 leak assertion could have been deleted outright and both mechanisms would
still have gone green. So each `bad` fixture and its matching fault hook now
break **different** terms, and `selfcheck.py` carries named case lists
(`AC0_TURN_CASES`, `AC2_TOKEN_CASES`, `AC3_URL_CASES`, `AC4_MODE_CASES`,
`AC7_TOKEN_CASES`, `EVALUATE_CASES`, `REDACT_CASES`) driving one term at a time.

## The `harness/` package

Shared by `verify_widgets.py` and the five live probes, so a selector or a
decoding rule is fixed in one place rather than five.

| Module | Owns |
| --- | --- |
| `config.py` | Environment resolution (`require_base`, `require_secret`, `probe_base`, `out_dir`, `fault`) and the `MIN_PROSE` threshold. The leaf module — imports nothing else of ours. |
| `chat.py` | The widget's shadow DOM: `ChatPanel` (open/send/read_state/quiesce/wait_for_reply/click_last_card_item) and `RendererLog` (console marks, agent response bodies, console error/warning counts). |
| `collector.py` | `Recorder` — collector POST bodies decoded to event level (`ue_px` / `ue_pr` → schema name), plus the session ids seen on the wire. |
| `context.py` | `poll_context` / `fetch_context` / `is_populated` against `/api/agent/context`, the endpoint `getUserContext` calls. Retries because Signals answers 12–33s after an event. |
| `checks.py` | The nine pure predicates, `CheckResult` / `CheckRun`, and the `VERIFY_FAULT` corruptions. Imports no Playwright — that is what makes both fail-proof mechanisms possible. |
| `redact.py` | `TOKEN_PATTERN` / `redact_line` / `redact` / `redact_console` — token-shaped values stripped from anything written to disk. Shared, because every script here serialises captured console output. |
| `selfcheck.py` | Synthetic passing and failing observations per predicate, the per-term case lists, and the fixture-aliasing, URL-matching, `evaluate()` and redaction regression tests. |

## The scripts

### Live, sharing `harness/`

| Script | Purpose |
| --- | --- |
| `walkthrough.py` | Runbook §11.5 steps 2–6: browses to build Signals context, opens chat, sends turns, extracts rendered cards from the shadow DOM, flags the delivery mode per turn, screenshots, writes a JSON report. The exploratory sibling of `verify_widgets.py` — it prints, it does not assert. |
| `commentary.py` | Issue #3 check: does every widget turn also carry a text bubble? Extracts prose with `[data-widget-card]` subtrees removed so card text cannot be mistaken for commentary. |
| `probe_issue7_fix.py` | **The issue #7 acceptance check** (runbook §10.2.1). Two variants, full-page-load vs SPA-click, decoding each collector payload to event level and counting `product_viewed` per variant, so it asserts a *specific event* reached the collector rather than counting requests. `PROBE_BASE` selects the target (defaults to `http://localhost:3000`), which is how a branch gets checked before deploy — the repo has no Vercel preview. Never opens the chat, so no CES token is captured. |
| `probe_cart_checkout.py` | Audit companion to the above: adds an item, then full-loads `/cart` and `/checkout`, checking `cart_viewed` / `checkout_started` fire **exactly once** each. Catches the double-track that gating on tracker readiness alone introduced (the cart hydrates after mount). |
| `probe_reset_chat.py` | Clicks the debug panel's Reset Chat (a full reload by design) and checks the post-reload product view is still tracked — the between-takes path in §10.2.1. |

### Archaeology — frozen

These keep their **own copies of the selectors and helpers on purpose**. They
are a record of what was tried and disproved on 2026-07-30, and rewriting them
onto `harness/` would silently restate their findings in today's terms. Do not
migrate them; write a new script instead.

| Script | Purpose |
| --- | --- |
| `followup.py` | Extra turns hunting in-band token mode, carousel-item click-through, and **the synthetic token-mode probe** — it injects a verbatim `{@Widget: …}` token into the widget's shadow DOM when the live agent will not emit one. That probe is the only exercise of the token delivery path, which no live run has produced since the renderer shipped. |
| `probe_navmode.py` | **The issue #7 reproduction.** Two fresh sessions, full-page-load vs SPA-click browsing; records collector requests, response statuses, `requestfailed`, then asks the agent. |
| `probe_entities.py` | Dumps context entities per event; shows `product_viewed` missing entirely on first load. Rules out validation/entity causes. |
| `probe_latency.py` | Polls the agent on a timer; showed Signals answers 12–33s after an event, killing the "ingestion lag" theory. |
| `probe_rotation.py`, `probe_stale.py`, `probe_session.py` | Disproved stale/rotating session-id theories. Kept for context. |
| `recon2.py` | Dumps the widget's expanded shadow DOM. Use if selectors move. |
| `state_js.txt` | Shared shadow-DOM extraction snippet that `followup.py` reads. |

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
- Browsing by full page load used to drop `product_viewed` (issue #7), so a
  script that browsed that way saw an empty Signals profile. That cost a day of
  chasing latency theories. **Fixed and verified in production 2026-07-30**, so
  either browsing style is now safe — but any script written before that date
  may still carry a click-only workaround.

## Not committed, deliberately

Two facts, and the second does not replace the first.

1. **`out/` is gitignored** — the `*-report.json` evidence files, the
   screenshots, and the session-id scratch files stay out of the repo.
2. **Every script here redacts token-shaped values** from the console lines it
   stores, via `harness/redact.py`. `verify_widgets.py`, `commentary.py` and
   `walkthrough.py` all run their captured console through it, so no report
   carries the CES token broker's `chatToken`. The captured line reads
   `chatToken: <redacted>` with **nothing after it** — verified by replaying the
   real console lines from a production run through the redactor and confirming
   zero residual high-entropy characters.

Two things the redactor gets right that the first version did not, both worth
knowing before trusting it:

- The storefront logs the token **already truncated with a Unicode ellipsis**
  (`<head>…<tail>`). The value class includes `…`, so the tail goes with the
  head. The first version stopped dead at the ellipsis and left ~49 characters
  behind.
- It is **shared, not per-script**. `commentary.py` and `walkthrough.py` used to
  write the console line exactly as captured; only `verify_widgets.py` had a
  filter, and it was defined in the entry script rather than the package.

What it deliberately does **not** touch: `[Signals Demo] Passed
domain_sessionid to widget {sessionId: …}`. `collector.Recorder.forwarded_id()`
parses that line to pick the session to poll Signals for, so over-redaction
would break session detection. `selfcheck.REDACT_CASES` holds it as a standing
negative case, alongside the token shapes that must be caught.

Redaction is still a second line of defence, not a licence to commit a report:
`out/` stays gitignored, and screenshots are not redacted at all.
