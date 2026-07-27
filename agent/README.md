# `agent/` — CX Agent Studio agent + tools

Repo-side artifacts for the customer-facing concierge agent built in Google
Gemini Enterprise for CX (CX Agent Studio). Everything here is prep: config
this sandbox can author, but not apply -- the live agent, tool wiring, and
simulator verification happen in the console, by a human. See
`docs/runbook.md` ("CX Agent Studio setup") for the console steps and
`.scratch/signals-cx-agent-demo/issues/06-cx-agent-and-tools.md` for the
acceptance criteria.

- `instructions.md` -- the concierge persona and tool-use instructions,
  pasted verbatim into the agent's instructions field in the console.
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
