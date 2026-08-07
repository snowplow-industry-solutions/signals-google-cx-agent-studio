# `agent/` — CX Agent Studio agent + tools

Repo-side artifacts for the customer-facing concierge agent built in Google
Gemini Enterprise for CX (CX Agent Studio). Everything here is prep: config
this sandbox can author, but not apply -- the live agent, tool wiring, and
simulator verification happen in the console, by a human. See
`docs/setup-cx-agent-studio.md` for the console steps and the acceptance
criteria.

- `instructions.console.txt` -- the **live console copy**: the persona and
  tool-use contract in CX Agent Studio's structured format, with
  `{@TOOL: ...}` references resolving to the attached tools
  (`getUserContext_getUserContext` / `searchCatalog_searchCatalog` — the
  toolset-qualified names). Paste this verbatim into the **Root Agent
  node's instructions field** (not Settings → Advanced; that's the
  app-wide `globalInstruction`). If the console flags the tool references,
  re-insert them with the editor's `@` picker rather than hand-typing.
- `instructions.md` -- the human-readable source for the same contract.
  Behavioural changes start here, then get mirrored into
  `instructions.console.txt` (reformatting via the console's Gemini
  assistant is fine — diff the result against this file before accepting).
- `tools/get-user-context.openapi.yaml` -- OpenAPI schema for the
  `getUserContext` tool (`GET /api/agent/context`), imported as an OpenAPI
  tool in CX Agent Studio.
- `tools/search-catalog.openapi.yaml` -- OpenAPI schema for the
  `searchCatalog` tool (`GET /api/agent/catalog`), imported the same way.

Both schemas point at the deployed storefront
(`https://your-storefront.example.com`) and declare an
`apiKey` security scheme on the `x-agent-api-key` header. The key's actual
value (`AGENT_SHARED_SECRET` from the Vercel deploy, see
`docs/setup-snowplow-trial.md` §7) is never committed -- it's entered
directly into each tool's API-key auth config in the console.

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
