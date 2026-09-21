# Signals × Google CX Agent Studio

A reference integration: a customer-facing concierge agent built in **Google
Gemini Enterprise for CX** (CX Agent Studio) that pulls **real-time behavioural
context from Snowplow Signals** to personalise a live conversation.

A visitor browses a luxury-fashion storefront; their in-session behaviour is
tracked into a Snowplow pipeline and computed into Signals attributes keyed by
`domain_sessionid`. When they open the embedded chat widget, the agent reads
those attributes through a tool endpoint and greets them already knowing their
taste — favourite designer, browsed categories, cart contents — with no
prompting, degrading gracefully to a generic concierge for unknown or
cookieless visitors.

## How it fits together

```
Storefront (Next.js)  ──tracking──▶  Snowplow pipeline  ──▶  Signals (attributes)
       │                                                          │
       │  /api/agent/context, /api/agent/catalog  ◀──── reads ────┘
       ▼
  ces-messenger widget  ──setQueryParameters(session + user id)──▶  CX Agent Studio agent
                                                                        │
                                              getUserContext / searchCatalog (OpenAPI tools)
```

The storefront exposes two shared-secret-protected tool endpoints
(`/api/agent/context`, `/api/agent/catalog`); the agent calls them as OpenAPI
tools, and the chat widget injects the visitor's live `domain_sessionid` into
the agent session so the context lookup is keyed to the right person.

## Repository layout

| Path | What it is |
|---|---|
| [`storefront/`](./storefront/) | The Next.js storefront: tracking, Signals proxies, the agent tool endpoints, and the chat-widget embed. Has its own [README](./storefront/README.md). |
| [`agent/`](./agent/) | Repo-side source of truth for the CX Agent Studio agent — persona instructions and the OpenAPI tool schemas you import into the console. See its [README](./agent/README.md). |
| [`terraform/`](./terraform/) | Optional Terraform to codify the console-built agent/tools/deployment with the `google_ces_*` resources. See its [README](./terraform/README.md). |
| [`docs/`](./docs/) | Setup guides (below). |
| [`scripts/`](./scripts/) | Verification probes used to validate a live deployment. |

## Setup

Two guides, run in order:

1. **[docs/setup-snowplow-trial.md](./docs/setup-snowplow-trial.md)** — stand up
   the live pipeline: capture credentials, seed the tracking plan, publish the
   Signals config, verify end-to-end, and deploy the storefront to Vercel.
2. **[docs/setup-cx-agent-studio.md](./docs/setup-cx-agent-studio.md)** — build
   the agent in CX Agent Studio, import the two OpenAPI tools, wire the
   session-context variable, and embed the chat widget.

Then, optionally, back the console build with Terraform:
**[terraform/README.md](./terraform/README.md)**.

## Configuration & secrets

No real credentials or resource IDs are committed. They live only in gitignored
local files or your deploy target's secret store:

- `storefront/.env.local` — copy from
  [`storefront/.env.example`](./storefront/.env.example).
- `terraform/terraform.tfvars` — copy from
  [`terraform/terraform.tfvars.example`](./terraform/terraform.tfvars.example).
- CX Agent Studio tool auth and Vercel env vars — set in their respective
  consoles.

Every credential or infra identifier in the docs appears as a `<PLACEHOLDER>`
(e.g. `<your-gcp-project>`, `<your-storefront-url>`) for you to fill in.

## Prerequisites

- A Snowplow account with Signals enabled (a Free Trial suffices).
- A Google Cloud project with Gemini Enterprise for CX (CX Agent Studio)
  available.
- Node.js and npm (storefront); Python 3.11+ (Signals publish script);
  optionally the Snowplow CLI, Vercel CLI, and Terraform.
