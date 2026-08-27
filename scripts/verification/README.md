# `scripts/verification/`

End-to-end checks you run against a deployed storefront + agent. All need
`pip install playwright` and a Chrome install.

| Script | Purpose |
| --- | --- |
| `verify_widgets.py` | The asserting harness: browses to build a Signals profile, opens the chat, runs a scripted conversation, and asserts the nine checks below. Exit code is the verdict. |
| `walkthrough.py` | Exploratory sibling of the above — same flow, prints what it sees, asserts nothing. |
| `commentary.py` | Does every turn that renders product cards also carry a text reply? |
| `probe_full_page_load.py` | Does `product_viewed` reach the collector on a full page load as well as on SPA navigation? `PROBE_BASE` selects the target (default `http://localhost:3000`). |
| `probe_cart_checkout.py` | Do `cart_viewed` / `checkout_started` fire exactly once on full loads of `/cart` and `/checkout`? |
| `probe_reset_chat.py` | After the debug panel's Reset Chat (a full reload), is the next product view still tracked? |

## The harness

```sh
pip install playwright
export VERIFY_BASE=https://your-storefront.example.com
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
| `ac1-commentary` | every widget turn also carried a text bubble |
| `ac2-cards` | cards rendered, and no raw `{@Widget:` token leaked |
| `ac3-spa-nav` | a card click SPA-navigated with chat and prior cards preserved |
| `ac4-mode` | each widget turn's delivery mode was payload-mode or token-mode, with no `UNRENDERABLE` anywhere in the turn's renderer marks |
| `ac5-console` | zero console errors or warnings across the run |
| `ac6-collector` | `product_viewed` reached the collector, once per product page, under one session id |
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
group, stalled ingestion, or a session id that never linked. Both failing
points at a class of bug where the storefront logs tracking success whether or
not the tracker fired.

### Proving the checks can fail

```sh
python3 scripts/verification/verify_widgets.py --selfcheck   # no browser, sub-second
VERIFY_FAULT=ac6-signals python3 scripts/verification/verify_widgets.py
```

`--selfcheck` feeds every predicate a synthetic passing and failing observation,
failing if any predicate cannot fail. It also applies every fault twice: to that
check's own minimal fixture, and to a whole synthetic run, where the fault must
fail **only** its own check — a fault with collateral makes a live
`VERIFY_FAULT` run ambiguous about what it just proved. `VERIFY_FAULT` itself
corrupts a check's input during a live run, which catches a predicate that is
sound but reads a field phase A never writes.

A single fixture pair is not enough for a predicate whose verdict is a
conjunction: `bool(cards) and not raw` short-circuits, so a bad fixture that
empties `cards` *and* sets `rawToken` never reaches the token term — the
raw-token leak assertion could have been deleted outright and both mechanisms
would still have gone green. So for every predicate whose verdict is a
conjunction, the `bad` fixture and its matching fault hook now break
**different** terms. (`ac1-commentary` is the one single-term predicate, so its
fixture and its fault necessarily drive the same thing.) On top of that,
`selfcheck.py` carries named case lists driving one term at a time:
`AC0_TURN_CASES`, `AC2_TOKEN_CASES`, `AC3_URL_CASES`, `AC3_PRESERVE_CASES`,
`AC4_MODE_CASES`, `AC5_CONSOLE_CASES`, `AC6_COLLECTOR_CASES`,
`AC6_SIGNALS_CASES`, `AC7_TOKEN_CASES`, plus `EVALUATE_CASES` and
`REDACT_CASES`.

**The standard is gutting.** Delete any one term of any predicate and
`--selfcheck` must go red. Of the 28 clauses across the nine predicates, 25 meet
it. The three that do not are all in `ac3-spa-nav` — the no-clickable-card early
return, and the two defensive fallbacks inside `landed` — and they are
diagnostics rather than assertions: enumerating the `clickedUri` × `afterUrl` ×
`spaProbeSurvived` × `chatMessagesAfter` × `cardsAfter` space shows every shape
they reject already fails on `landed`, so they change what a failure *says*,
never whether there is one. `check_spa_navigation`'s docstring names them, so a
future sweep does not re-file them as gaps.

## The `harness/` package

Shared by `verify_widgets.py` and the other five scripts, so a selector or a
decoding rule is fixed in one place rather than five.

| Module | Owns |
| --- | --- |
| `config.py` | Environment resolution (`require_base`, `require_secret`, `probe_base`, `out_dir`, `fault`) and the `MIN_PROSE` threshold. The leaf module — imports nothing else of ours. |
| `chat.py` | The widget's shadow DOM: `ChatPanel` (open/send/read_state/quiesce/wait_for_reply/click_last_card_item) and `RendererLog` (console marks, agent response bodies, console error/warning counts). |
| `collector.py` | `Recorder` — collector POST bodies decoded to event level (`ue_px` / `ue_pr` → schema name), plus the session ids seen on the wire. |
| `context.py` | `poll_context` / `fetch_context` / `is_populated` against `/api/agent/context`, the endpoint `getUserContext` calls. Retries because Signals answers 12–33s after an event. |
| `checks.py` | The nine pure predicates, `CheckResult` / `CheckRun`, and the `VERIFY_FAULT` corruptions. Imports no Playwright — that is what makes both fail-proof mechanisms possible. |
| `redact.py` | `TOKEN_PATTERN` / `redact_line` / `redact` / `redact_console` — token-shaped values stripped from anything written to disk. Shared rather than per-script, because three of the live scripts serialise captured console output. |
| `selfcheck.py` | Synthetic passing and failing observations per predicate, the per-term case lists, the fault-isolation sweep, and the fixture-aliasing, URL-matching, `evaluate()` and redaction regression tests. |

## Gotchas baked into these scripts

- Python Playwright's pinned browser build is missing: launch
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

## Not committed, deliberately

Two facts, and the second does not replace the first.

1. **`out/` is gitignored** — the `*-report.json` evidence files, the
   screenshots, and the session-id scratch files stay out of the repo.
2. **Every live script that stores console output redacts token-shaped values**
   from it, via `harness/redact.py`. `verify_widgets.py`, `commentary.py` and
   `walkthrough.py` are the three that capture console at all, and all three run
   it through the redactor, so no report they write carries the CES token
   broker's `chatToken`. The captured line reads `chatToken: <redacted>` with
   **no token material after it** — the rest of the line (`expireTime`, the
   closing brace) survives, which is the point; verified by replaying the real
   console lines from a production run through the redactor and confirming zero
   residual high-entropy characters.

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
