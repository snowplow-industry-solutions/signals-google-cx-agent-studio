# `agent/` — CX Agent Studio agent + tools

Repo-side artifacts for the customer-facing concierge agent built in Google
Gemini Enterprise for CX (CX Agent Studio). These files are the source of
truth you paste or import into the console; the live agent, tool wiring, and
simulator checks happen there. See `docs/setup-cx-agent-studio.md` for the
console steps.

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
  `PRODUCT_CAROUSEL`; `productDetails`, Widget Type `PRODUCT_DETAILS`),
  read verbatim from the live tools via the CES REST API. Nothing in them is
  entered into the console: creating a typed widget tool from its console
  template auto-fills this schema and the editor is read-only (only the
  `CUSTOM` widget type takes an author-defined schema). The files exist so
  the instruction mapping (`title`←`name`, `subtitle`←`designer`,
  `price`←dollar string, `productId`←`url` slug, `uri`←base URL + `url`,
  `imageUris`←`[image]`) has a checked-in contract to be verified
  against. See agent/instructions.md 'Rich response widgets' for the
  field-mapping contract. The pinned `ces-messenger` component (as opposed
  to the hosted `chat-messenger` build) renders these widgets; the console
  copy of the instructions that invokes them is
  `agent/instructions.console.widgets.txt`.

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

## Identity headers and per-turn ids

The shopper's identity reaches the tool calls once the widget sends every id
in a single `setQueryParameters` call. `setQueryParameters` replaces the
whole variable set rather than merging into it, so `CesMessengerWidget.tsx`
sends `snowplow_session_id` and `snowplow_user_id` together, and resends the
full set whenever it adds a turn id. With that in place the tool events carry
`domain_sessionid`, `domain_userid`, the `agent_context` user id and the
`conversation` entity's chat session id.

A per-turn id set at send time does not reach the tool call. By the time the
widget dispatches its send event it has already opened the stream, so the
`runSession` request carries no turn id: the tool events'
`conversation.turn_id` stays null and `invocation_id` falls back to a random
UUID. The conversation hook therefore arms each turn's id ahead of time (once
at mount, then again after every send), but tool events are not relied on to
carry it. Turns are reconstructed downstream instead: the browser
`message_sent` / `message_received` events carry the turn id, and ordering
the tool events within the chat session places each one in its turn.
