# Atelier Signals

Atelier Signals is a high-end fashion retail ecommerce demo built to showcase Snowplow Signals in a live storefront experience. The domain is luxury fashion merchandising, product discovery, cart styling, and checkout reassurance.

## What This Demo Shows

- Real-time Signals attribute fetching keyed by `domain_sessionid`
- A luxury storefront with homepage, collection pages, product detail, cart, and checkout
- Personalization workflows such as look completion, accessory pairing, and collection reordering
- Demo-safe observability via `[Signals Demo]` console logs and an in-app debug panel
- A "highlight personalization" mode for before/after presentations
- Local tracking-assets YAML plus repo-managed Signals Python SDK configuration

## App Structure

- `src/app`: App Router routes and Signals API proxies
- `src/components/Analytics`: Snowplow tracker initialization
- `src/components/Signals`: Signals context and bootstrap logic
- `src/components/Demo`: highlight mode and debug panel
- `src/components/Cart`: cart state and interactions
- `src/data`: mock catalog and collection data
- `src/utils`: tracking helpers, session utilities, and personalization logic
- `tracking-assets`: local Snowplow data structures, source application, and tracking plan
- `signals/config`: Python SDK definitions for attribute keys, attribute groups, and services

## Run The App

```bash
npm install
npm run dev
```

The dev server runs on [http://localhost:3000](http://localhost:3000).

## Verification Commands

```bash
npm test
npm run lint
npm run build
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values for your Snowplow
deployment (see [`../docs/setup-snowplow-trial.md`](../docs/setup-snowplow-trial.md)
for where each value comes from):

```bash
NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL=https://your-collector.example.com
NEXT_PUBLIC_SIGNALS_INTERVENTIONS_ENDPOINT=https://your-signals-endpoint.example.com

SIGNALS_DEPLOYED_URL=https://your-signals-api.example.com
SNOWPLOW_CONSOLE_API_KEY=your-api-key
SNOWPLOW_CONSOLE_API_KEY_ID=your-api-key-id
SNOWPLOW_CONSOLE_ORG_ID=your-org-id
```

Without valid server-side credentials, the storefront still renders, but `/api/signals/attributes` returns a configuration error instead of live Signals attributes.

## Demo Modes

By default the site loads with personalization highlighting enabled.

- Standard personalized mode: `http://localhost:3000/`
- Quiet comparison mode: `http://localhost:3000/?demo=plain`

The floating Signals demo panel lets you:

- toggle personalization highlighting on and off
- inspect the top fetched attributes
- see which demo workflows are currently active

## Console Logging

The app emits presenter-friendly logs prefixed with:

```text
[Signals Demo]
```

These logs call out:

- tracker initialization
- session changes
- Signals attribute fetches
- tracked ecommerce events
- intervention subscriptions and payloads
- personalization highlight toggles

## Tracking Plan Workflow

Local tracking assets live under `tracking-assets/`.

- Data structures: `tracking-assets/data-structures`
- Source applications:
  - `tracking-assets/tracking-plans/source-applications/fashion_storefront.yml`
    — the browser-tracked storefront (`atelier-storefront[-dev]`),
    requiring the `WebPage` and `user` entities on every event.
  - `tracking-assets/tracking-plans/source-applications/fashion_storefront_agent.yml`
    — the server-side agent tool endpoints (`/api/agent/*`,
    `atelier-storefront-agent` / `-dev-agent`). No required
    entities: server events carry neither the web page nor the shopper user
    entity the storefront application requires.
- Tracking plan: `tracking-assets/tracking-plans/fashion_ecommerce.yml`

To validate them with the Snowplow MCP/CLI, see Snowplow's own docs for the
validation workflow. The implementation in this repo was validated against:

- `tracking-assets/data-structures`
- `tracking-assets/tracking-plans/fashion_ecommerce.yml`
- `tracking-assets/tracking-plans/source-applications/fashion_storefront.yml`
- `tracking-assets/tracking-plans/source-applications/fashion_storefront_agent.yml`

### Agent event specifications

The tracking plan's event specifications describe the agent events already
emitted in code (`src/utils/agentTracking.ts`, `src/utils/agentSelfTracking.ts`,
`src/components/Widget/useWidgetConversationTracking.ts`) so Console shows
them as part of the data product:

| Event | Source application | Schema | Entities |
|---|---|---|---|
| Tool execution: search catalog | agent | `iglu:com.snowplow.agent.tracking/tool_execution/jsonschema/1-0-0` | `tool_context`, `agent_context`, `conversation`, `catalog_search` |
| Tool execution: get user context | agent | `iglu:com.snowplow.agent.tracking/tool_execution/jsonschema/1-0-0` | `tool_context`, `agent_context`, `conversation`, `context_lookup` |
| User intent detected | agent | `iglu:com.snowplow.agent.tracking/user_intent_detected/jsonschema/1-0-0` | `tool_context`, `agent_context`, `conversation` |
| Agent decision logged | agent | `iglu:com.snowplow.agent.tracking/agent_decision_logged/jsonschema/1-0-0` | `tool_context`, `agent_context`, `conversation` |
| Constraint violation | agent | `iglu:com.snowplow.agent.tracking/constraint_violation/jsonschema/1-0-0` | `tool_context`, `agent_context`, `conversation` |
| Message sent | storefront | `iglu:com.snowplow.agent.tracking/message_sent/jsonschema/1-0-0` | `message_context`, `conversation` |
| Message received | storefront | `iglu:com.snowplow.agent.tracking/message_received/jsonschema/1-0-0` | `message_context`, `conversation` |

The event schemas resolve from Iglu Central (`com.snowplow.agent.tracking`,
unchanged, never published to the org); the entity schemas are the repo's
own `com.snowplow_demo.fashion` data structures alongside the Iglu Central
`agent_context`/`tool_context`/`message_context` entities. The "Product list
clicked" event specification also has a trigger for clicks on
concierge-rendered product cards (list id `concierge_recommendations`).

Publishing event specifications that reference Iglu Central event/entity
schemas works: seeding the tracking plan with the agent specifications above
succeeds, and Console shows them correctly. Snowtype generates helpers for
the tracking plan's own-schema event specifications only — see "Snowtype"
below for these seven.

## Local Agent Tracking Verification (Snowplow Micro)

[Snowplow Micro](https://docs.snowplow.io/docs/testing-debugging/snowplow-micro/) is a
local pipeline that validates every tracked payload against its schema, so agent
events can be checked before any traffic reaches a live org. `micro/` holds a pinned
compose file and an Iglu resolver; the repo's own `com.snowplow_demo.fashion` schemas
resolve from a generated local directory, and the `com.snowplow.agent.tracking` Iglu
Central vendor still resolves over the network.

```bash
npm run micro:schemas   # scripts/render-iglu-schemas.ts: render tracking-assets/data-structures into micro/iglu-client-embedded/ (gitignored)
npm run micro:up        # start Micro on http://localhost:9090 (requires Docker)
```

Point the dev server at Micro (`.env.local`) and start it in another terminal:

```bash
NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL=http://localhost:9090
NEXT_PUBLIC_SNOWPLOW_APP_ID=atelier-storefront-dev
AGENT_SHARED_SECRET=<any local value>
```

```bash
npm run dev
```

Then, with both running, fire the agent tool endpoints and check Micro's good/bad
counts in one command:

```bash
AGENT_SHARED_SECRET=<same value as .env.local> npm run verify:micro
```

`micro:schemas` must be re-run (and Micro restarted) whenever a data structure under
`tracking-assets/data-structures` changes. `verify:micro`'s endpoint list
(`scripts/verify-micro.ts`) is written to be extended as more agent endpoints are
instrumented. `scripts/verify-deploy.ts` runs the equivalent shared-secret and
shape checks against a deployed storefront (`npm run verify:deploy`) rather
than Micro — see [`../docs/setup-snowplow-trial.md`](../docs/setup-snowplow-trial.md) §7.

Once agent events are flowing into a real pipeline and loaded into BigQuery,
[`../analytics/agent-self-tracking.sql`](../analytics/agent-self-tracking.sql)
has ready-made queries over them (tool usage, detected intents, decisions,
constraint violations); [`../analytics/ecommerce-web-analytics.sql`](../analytics/ecommerce-web-analytics.sql)
covers the storefront's own web and ecommerce events.

## Signals Configuration In Python

Signals configuration is stored in code under `signals/config/`.

- `attribute_keys.py`: attribute key definitions
- `attribute_groups.py`: stream attribute group and attribute definitions
- `services.py`: service definition
- `publish.py`: publish or dry-run entrypoint

Install Python dependencies into the venv the npm scripts expect
(`signals:publish` runs `.venv/bin/python`), then dry-run the config:

```bash
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/python -m signals.config.publish --dry-run
```

To publish to a real Signals deployment:

```bash
npm run signals:publish
```

## Snowtype

The storefront uses generated Snowtype helpers from `snowtype/snowplow.ts` for its ecommerce self-describing events and event-specification wrappers.

Neither `snowtype/` nor `snowtype.config.json` is committed — both are specific to
one Snowplow org. The config names an organization ID and a list of event
specification IDs, and the generated helpers embed those IDs, so committing
either would mean re-pointing the repo at a different org produced a diff every
time. `snowtype.config.example.json` is the committed template.

**On a fresh clone, generate them before running `npm test`, `npm run lint` or
`npm run build`** — `src/` imports `@/snowtype/snowplow`, so those all fail
without it. Regenerate the same way whenever the BDP data product changes, or
after pointing `.env.local` at a new org:

```bash
npm run snowtype:generate
```

That runs `npm run snowtype:config` first, which writes `snowtype.config.json`
from the example: the organization ID comes from `.env.local`, and
`scripts/write-snowtype-config.ts` lists the tracking plan's own-schema event
specifications — Snowtype resolves each specification's event schema against
the org's own registry, so it can only generate from a specification whose
event schema lives in this repo's own `tracking-assets/data-structures` (today
the `com.snowplow_demo.fashion` vendor). Each listed ID is derived from the
org ID with the same UUIDv5 rule `scripts/seed-tracking-plans.ts` uses to
publish the tracking plan, so the list always names the same specifications
the seed created. The org's tracking plan must already be seeded (see
[`docs/setup-snowplow-trial.md`](../docs/setup-snowplow-trial.md) §4) or
generation has nothing to read.

Do not edit `snowtype/` or `snowtype.config.json` by hand — regenerate instead.

**Agent events:** Snowtype cannot generate helpers for the seven agent event
specifications (see "Agent event specifications" above) — it does not resolve
Iglu Central event schemas, only this repo's own. Those events
(`message_sent`, `message_received`, and the server-side agent events) keep
their hardcoded schema constants in
`src/components/Widget/useWidgetConversationTracking.ts`,
`src/utils/agentTracking.ts`, and `src/utils/agentSelfTracking.ts`.

## Personalization Workflows

The current storefront is designed around a luxury tone:

- Look completion on product detail pages
- Accessory pairing based on in-session taste
- Editorial hero/module reordering on the homepage
- Collection page merchandising callouts
- Cart styling companion recommendations
- Checkout confidence messaging

This is a [Next.js](https://nextjs.org) App Router project. Deployment to Vercel
is covered in [`../docs/setup-snowplow-trial.md`](../docs/setup-snowplow-trial.md) §7.
