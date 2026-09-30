# Signals × Google CX Agent Studio

A reference integration between **Google Gemini Enterprise for CX** (CX Agent
Studio) and **Snowplow**, combining two halves:

- **Agentic personalisation** — a customer-facing concierge agent reads
  **real-time behavioural context from Snowplow Signals** to personalise a
  live conversation. A visitor browses a luxury-fashion storefront; their
  in-session behaviour is tracked into a Snowplow pipeline and computed into
  Signals attributes keyed by `domain_sessionid`. When they open the embedded
  chat widget, the agent reads those attributes through a tool endpoint and
  greets them already knowing their taste — favourite designer, browsed
  categories, cart contents — with no prompting, degrading gracefully to a
  generic concierge for unknown or cookieless visitors.
- **Agentic analytics** — the agent's own tool calls, reasoning, and the
  conversation itself are tracked back into the same Snowplow pipeline, as
  events: what the agent called, what it decided and why, what intent it
  detected, and when the catalog couldn't satisfy a shopper's request. The
  BigQuery queries in [`analytics/`](./analytics/) turn that into answers —
  which intents shoppers bring, how often the catalog fails a request, how
  long tool calls take, whether shoppers click what the agent recommended.

## How it fits together

```
                          ┌─────────────────────────────────────────────┐
                          │              Snowplow pipeline               │
                          └─────────────────────────────────────────────┘
                             ▲        ▲                    │
             browsing events │        │ tool + reasoning   │ Signals reads
             message_sent/   │        │ + conversation      │ (attributes)
             received        │        │ events (server)     │
                             │        │                     ▼
    Storefront (Next.js) ────┘        └──── /api/agent/context, /api/agent/catalog,
    ces-messenger widget                    /track-intent, /track-decision, /track-constraint
          │                                                        ▲
          │ setQueryParameters(session + user + turn id)           │ OpenAPI tools:
          ▼                                                        │ getUserContext, searchCatalog,
    CX Agent Studio agent ─────────────────────────────────────────┘ selfTracking_*
```

The storefront exposes two shared-secret-protected business tool endpoints
(`/api/agent/context`, `/api/agent/catalog`) and three self-tracking endpoints
(`/api/agent/track-intent`, `/track-decision`, `/track-constraint`); the agent
calls all five as OpenAPI tools, and every call emits a Snowplow event from
the server. The chat widget injects the visitor's live `domain_sessionid`,
`domain_userid`, and a per-turn id into the agent session, so every tool call
and self-tracking event is keyed to the right person and turn, and also
tracks the conversation itself (`message_sent` / `message_received`) from the
browser. See [`agent/README.md`](./agent/README.md) ("Identity headers and
per-turn ids") for how that id threading works.

## Repository layout

| Path | What it is |
|---|---|
| [`storefront/`](./storefront/) | The Next.js storefront: tracking, Signals proxies, the agent tool endpoints, and the chat-widget embed. Has its own [README](./storefront/README.md). |
| [`agent/`](./agent/) | Repo-side source of truth for the CX Agent Studio agent — persona instructions and the OpenAPI tool schemas you import into the console. See its [README](./agent/README.md). |
| [`terraform/`](./terraform/) | Optional Terraform to codify the console-built agent/tools/deployment with the `google_ces_*` resources. See its [README](./terraform/README.md). |
| [`docs/`](./docs/) | Setup guides (below). |
| [`analytics/`](./analytics/) | BigQuery queries over the atomic events table: agent self-tracking (`agent-self-tracking.sql`) and storefront web analytics and ecommerce (`ecommerce-web-analytics.sql`). |
| [`scripts/`](./scripts/) | `setup-trial-org.sh` (interactive setup), `get-info-from-signals.sh` (prints what Signals holds for one shopper session) and `verification/` (end-to-end checks against a live deployment). |

## Quick start

1. Sign up for a [Snowplow free trial](https://snowplow.io/get-started/snowplow-free-trial)
   and confirm Signals is enabled in Console.
2. Clone this repo and run the interactive setup — it captures your credentials,
   seeds the tracking plan, publishes the Signals config, and (optionally)
   deploys the storefront:
   ```
   ./scripts/setup-trial-org.sh
   ```
3. Build the agent in CX Agent Studio by following
   [docs/setup-cx-agent-studio.md](./docs/setup-cx-agent-studio.md).

Prefer to do it by hand, or want to know what the script does? The two guides
under **Setup** cover every step.

## Setup

Two guides, run in order:

1. **[docs/setup-snowplow-trial.md](./docs/setup-snowplow-trial.md)** — stand up
   the live pipeline: capture credentials, seed the tracking plan, publish the
   Signals config, verify end-to-end, and deploy the storefront to Vercel.
2. **[docs/setup-cx-agent-studio.md](./docs/setup-cx-agent-studio.md)** — build
   the agent in CX Agent Studio, import the OpenAPI tools (the two business
   tools and the `selfTracking` toolset), wire the session variables, and
   embed the chat widget.

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
- Node.js ≥ 20.9 and npm (storefront; CI uses Node 22).
- Python 3.11+ (Signals publish script).
- `snowplow-cli` (required — the setup wizard and the tracking-plan seeder
  both call it) and `openssl` (the wizard uses it to mint the agent shared
  secret).
- Optional: Vercel CLI, Terraform, and gitleaks (secret scanning).

## What this is — and isn't

A reference integration for demos and evaluation. It runs against demo data,
keeps a deliberately simple auth model (one shared secret on the agent tool
endpoints; an unauthenticated attributes proxy for the on-page debug panel),
and is not hardened for production traffic. See [SECURITY.md](./SECURITY.md).

## License

[Apache-2.0](./LICENSE).
