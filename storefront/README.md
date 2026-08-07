# Atelier Signals

Atelier Signals is a high-end fashion retail ecommerce demo built to showcase Snowplow Signals in a live storefront experience. The app mirrors the publishing demo's provider pattern while shifting the domain to luxury fashion merchandising, product discovery, cart styling, and checkout reassurance.

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

The dev server runs on [http://localhost:3001](http://localhost:3001).

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

- Standard personalized mode: `http://localhost:3001/`
- Quiet comparison mode: `http://localhost:3001/?demo=plain`

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
- Source application: `tracking-assets/tracking-plans/source-applications/fashion_storefront.yml`
- Tracking plan: `tracking-assets/tracking-plans/fashion_ecommerce.yml`

To validate them with the Snowplow MCP/CLI, use the configured validation workflow from the workspace tooling. The implementation in this repo was validated against:

- `tracking-assets/data-structures`
- `tracking-assets/tracking-plans/fashion_ecommerce.yml`
- `tracking-assets/tracking-plans/source-applications/fashion_storefront.yml`

## Signals Configuration In Python

Signals configuration is stored in code under `signals/config/`.

- `attribute_keys.py`: attribute key definitions
- `attribute_groups.py`: stream attribute group and attribute definitions
- `services.py`: service definition
- `publish.py`: publish or dry-run entrypoint

Install Python dependencies and dry-run the config:

```bash
python -m pip install -e .
python -m signals.config.publish --dry-run
```

To publish to a real Signals deployment:

```bash
npm run signals:publish
```

## Snowtype

The storefront uses generated Snowtype helpers from `snowtype/snowplow.ts` for its ecommerce self-describing events and event-specification wrappers.

Do not edit generated files in `snowtype/` manually. Regenerate them whenever the BDP data product changes:

```bash
npm run snowtype:generate
```

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
