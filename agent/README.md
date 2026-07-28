# `agent/` — CX Agent Studio agent + tools

Repo-side artifacts for the customer-facing concierge agent built in Google
Gemini Enterprise for CX (CX Agent Studio). Everything here is prep: config
this sandbox can author, but not apply -- the live agent, tool wiring, and
simulator verification happen in the console, by a human. See
`docs/runbook.md` ("CX Agent Studio setup") for the console steps and
`.scratch/signals-cx-agent-demo/issues/06-cx-agent-and-tools.md` for the
acceptance criteria.

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
(`https://signals-google-gecx-storefront.vercel.app`) and declare an
`apiKey` security scheme on the `x-agent-api-key` header. The key's actual
value (`AGENT_SHARED_SECRET` from the Vercel deploy, see `docs/runbook.md`
§7) is never committed -- it's entered directly into each tool's API-key
auth config in the console.

- `tools/product-carousel.widget.json` / `tools/product-details.widget.json`
  -- **Parameters** schemas for the two rich response widget tools
  (`productCarousel`, Widget Type `PRODUCT_CAROUSEL`; `productDetails`,
  Widget Type `PRODUCT_DETAILS`) covering issue
  `11-rich-response-widgets.md`. Unlike the OpenAPI tools above, these
  aren't imported from a file -- create each widget tool in the console
  (rich response widgets icon in the agent builder), set its Widget Type,
  and paste the JSON object (everything except the `$comment` key) into
  the Parameters editor. See `docs/runbook.md` §10 for citations
  confirming the widget-tool mechanism and widget-type names against
  official docs, and for the open question on whether the pinned
  `ces-messenger` component (as opposed to the hosted `chat-messenger`
  build) actually renders these -- unresolved without a live check, hence
  this issue's `human-test-required` checkpoint.
