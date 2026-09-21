# `agent/` — CX Agent Studio agent + tools

Repo-side artifacts for the customer-facing concierge agent built in Google
Gemini Enterprise for CX (CX Agent Studio). Everything here is prep: config
this sandbox can author, but not apply -- the live agent, tool wiring, and
simulator verification happen in the console, by a human. See
`docs/setup-cx-agent-studio.md` for the console steps and the acceptance
criteria.

- `instructions.console.widgets.txt` -- the **live console copy**: the
  persona and tool-use contract in CX Agent Studio's structured format,
  including the rich-response-widget constraint, with `{@TOOL: ...}` /
  `{@Widget: ...}` references resolving to the attached tools and widgets
  (`getUserContext_getUserContext` / `searchCatalog_searchCatalog` /
  `selfTracking_trackUserIntent` / `selfTracking_trackAgentDecision` /
  `selfTracking_trackConstraintViolation` — the toolset-qualified names;
  `productCarousel` / `productDetails` for the widgets). Paste this
  verbatim into the **Root Agent node's instructions field** (not
  Settings → Advanced; that's the app-wide `globalInstruction`). If the
  console flags a tool reference, re-insert it with the editor's `@`
  picker rather than hand-typing -- **after importing the self-tracking
  toolset, a human must confirm with the picker that all three
  `selfTracking_*` references resolve**, the same check already done for
  the two existing references.
- `instructions.console.txt` -- the text-only revert target, kept only as
  a contingency for when the widget renderer isn't available; mirrors the
  same contract minus the widget constraint and taskflow branches. Same
  `@` picker confirmation applies to its `selfTracking_*` references.
- `instructions.md` -- the human-readable source for the same contract,
  including the self-tracking protocol (when to call each of the three
  self-tracking tools, the once-per-purpose-per-turn limit, and why
  tracking must never delay or replace the reply). Behavioural changes
  start here, then get mirrored into both console copies (reformatting via
  the console's Gemini assistant is fine — diff the result against this
  file before accepting; a diff between this file and either console copy
  should show only formatting differences, not content differences).
- `tools/get-user-context.openapi.yaml` -- OpenAPI schema for the
  `getUserContext` tool (`GET /api/agent/context`), imported as an OpenAPI
  tool in CX Agent Studio.
- `tools/search-catalog.openapi.yaml` -- OpenAPI schema for the
  `searchCatalog` tool (`GET /api/agent/catalog`), imported the same way.
- `tools/self-tracking.openapi.yaml` -- OpenAPI schema for the three
  self-tracking tools (`trackUserIntent`, `trackAgentDecision`,
  `trackConstraintViolation`; `POST /api/agent/track-intent`,
  `/track-decision`, `/track-constraint`), imported as a single toolset
  (console display name `selfTracking`, so the toolset-qualified tool
  references are `selfTracking_trackUserIntent`,
  `selfTracking_trackAgentDecision`, and
  `selfTracking_trackConstraintViolation`). Each operation declares the
  four platform-injected identity headers: the chat session id from the
  built-in session context, and the shopper session id, user id, and turn
  id from the `snowplow_session_id`, `snowplow_user_id`, and
  `snowplow_turn_id` agent variables. These tools log what the agent
  thinks -- detected intent, decisions, and unsatisfiable constraints -- as
  Snowplow events; they never change the reply. The instructions'
  self-tracking protocol (see `instructions.md`) governs when the agent
  calls them: once per turn for intent, right before a catalog search or
  widget choice for a decision, and whenever the catalog can't satisfy a
  shopper requirement for a constraint -- never more than once per tool per
  turn for the same purpose, and never mentioned to the shopper.

- `tools/product-carousel.widget.json` / `tools/product-details.widget.json`
  -- **captured copies of Google's fixed Parameters schemas** for the two
  rich response widget tools (`productCarousel`, Widget Type
  `PRODUCT_CAROUSEL`; `productDetails`, Widget Type `PRODUCT_DETAILS`)
  covering issue `11-rich-response-widgets.md`, read verbatim from the
  live tools via the CES REST API on 2026-07-29. Nothing in them is
  entered into the console: creating a typed widget tool from its console
  template auto-fills this schema and the editor is read-only (only the
  `CUSTOM` widget type takes an author-defined schema). The files exist so
  the instruction mapping (`title`←`name`, `subtitle`←`designer`,
  `price`←dollar string, `productId`←`url` slug, `uri`←base URL + `url`,
  `imageUris`←`[image]`) has a checked-in contract to be verified
  against. See agent/instructions.md 'Rich response widgets' for the
  corrected schema finding and for the open question on whether the
  pinned `ces-messenger` component (as opposed to the hosted
  `chat-messenger` build) actually renders
  these -- unresolved without a live check, hence this issue's
  `human-test-required` checkpoint.

All three schemas point at the deployed storefront through the committed
placeholder `https://your-storefront.example.com` and declare an
`apiKey` security scheme on the `x-agent-api-key` header. Terraform
(`terraform/toolsets.tf`) replaces the placeholder with its `storefront_url`
variable at plan time, so the files are never edited for a Terraform-managed
app; only a manual console import needs the URL swapped in a local copy. The key's actual
value (`AGENT_SHARED_SECRET` from the Vercel deploy, see
`docs/setup-snowplow-trial.md` §7) is never committed -- it's entered
directly into each tool's API-key auth config in the console.

`get-user-context.openapi.yaml` and `search-catalog.openapi.yaml` also
declare the same four platform-injected identity headers as
`self-tracking.openapi.yaml` above (chat session id, shopper session id,
user id, turn id). The context tool keeps its pre-existing `session_id`
query parameter alongside them, as a fallback for an agent still running the
old schema.

## Spike: identity headers and per-turn id propagation (issue 22)

The schema changes above, and `CesMessengerWidget.tsx` now passing
`snowplow_user_id` alongside the existing `snowplow_session_id`, plus a
`setSnowplowTurnId(element, turnId)` export the conversation hook (issue 25)
will call before each send, are repo prep only. None of it proves the
platform actually delivers a per-turn id to a tool call in time -- that
depends on widget timing nobody has verified. This is a human checkpoint: it
needs a deployed agent and cannot run from the pipeline.

Run it against **the duplicate agent app and second storefront deployment
from issue #28 only.** Never the production agent or the production
storefront -- a colleague is using that pair for a separate demo during the
week of 21 September 2026.

### Checklist

1. Deploy this branch to the second storefront deployment and re-import both
   `get-user-context.openapi.yaml` and `search-catalog.openapi.yaml` into the
   duplicate agent's existing `getUserContext` / `searchCatalog` tools,
   replacing their current schemas (see `docs/setup-cx-agent-studio.md` §3).
2. Declare two new agent variables on the duplicate agent, same pattern as
   the existing `snowplow_session_id` (`docs/setup-cx-agent-studio.md` §4):
   `snowplow_user_id` and `snowplow_turn_id`, both type Text, no default
   value.
3. Load the second storefront deployment, open the browser devtools console,
   and manually run
   `document.querySelector("ces-messenger").setQueryParameters({ snowplow_session_id: "<domain_sessionid>", snowplow_user_id: "<domain_userid>", snowplow_turn_id: "spike-test-turn-1" })`
   (copy the two ids from the `Passed Snowplow identity variables` console
   line; `setQueryParameters` replaces the whole set, so passing the turn id
   alone would drop them) immediately before sending a chat message that
   triggers a tool call (e.g. ask something that requires a catalog search).
   This simulates what the conversation hook (issue 25) will do automatically
   at send time.
4. In Snowplow Micro (`http://localhost:9090/micro/good`, see the storefront
   README's Micro section) or Console, find the `tool_execution` event(s)
   emitted for that turn (`getUserContext` and/or `searchCatalog`,
   `storefront/src/utils/agentTracking.ts`) and check:
   - **(a) all four headers arrived:** the event's atomic `domain_sessionid`
     and `domain_userid` columns are both populated (not just
     `domain_sessionid`, which already worked via the context tool's old
     `session_id` query parameter); the `agent_context` entity's `user_id`
     field is present; the `conversation` entity's `chat_session_id` field is
     non-null (this one only ever worked through the injected header --
     these two tools had no built-in-session-id binding before this issue).
   - **(b) the turn id specifically propagated:** the `conversation`
     entity's `turn_id` field, and the `tool_execution` event's own
     `invocation_id`, both equal `spike-test-turn-1` from step 3.
5. Record the outcome below and in issue #22: which of (a) and (b) held.
   If (b) fails, no code change is needed here -- issue #18 already documents
   the fallback (the conversation hook still tracks the turn id on browser
   `message_sent`/`message_received` events, and turns are reconstructed
   downstream by ordering within the chat session).

### Result

Run 21 September 2026 against the issue #28 duplicate agent and storefront,
by driving the deployed widget with Playwright and reading the `runSession`
request body plus the CX Insights trace, rather than steps 3--4 as written.

- **(a) did not hold, because of a storefront bug, not the platform.**
  `setQueryParameters()` replaces the whole variable set on every call, and
  `CesMessengerWidget.tsx` was calling it once per key, so only the
  last-set variable (`snowplow_user_id`) reached the agent and
  `getUserContext` ran with an empty input. Fixed by sending all ids in one
  call and resending the full set with each turn id; (a) still needs
  re-checking once the fix is deployed to the duplicate storefront.
- **(b) did not hold for the current widget timing.** The conversation hook
  sets `snowplow_turn_id` only after the widget has already opened its
  stream (console order: `Initializing WebStream...`, then
  `Setting query parameters: {snowplow_turn_id: ...}`), and the
  `runSession` body carried no turn id. No code change here: issue #18's
  fallback applies -- browser `message_sent`/`message_received` events carry
  the turn id and turns are reconstructed downstream by ordering within
  the chat session.
