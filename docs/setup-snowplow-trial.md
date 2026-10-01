# Setup: Snowplow trial org → live Signals pipeline

Stands up the live half of the demo: the storefront tracking into a Snowplow
pipeline, Signals computing real-time attributes, and the site deployed
publicly so the CX Agent Studio agent can reach its tool endpoints. Pick up
from here once you have a Snowplow account (a Free Trial is enough), then
continue to [`setup-cx-agent-studio.md`](./setup-cx-agent-studio.md) for the
agent side.

> **Fastest path:** `./scripts/setup-trial-org.sh` walks you through every
> step below interactively and runs the commands for you. The sections that
> follow explain what it does and how to do each step by hand.

Real credentials never live in git — they go in `storefront/.env.local`
(gitignored) or your deploy target's secret store. Every secret below is a
`<PLACEHOLDER>` you fill in from your own org.

## 1. Create the Snowplow org

1. Sign up for a Snowplow Free Trial (or use an existing org).
2. Confirm the org includes a full pipeline (collector + enrich + Signals) and
   that Signals is enabled — check under the org's Signals section in BDP
   Console.
3. If it's a trial, note the expiry date; the pipeline stops computing once it
   lapses.

## 2. Capture credentials

From BDP Console (Manage organization → API keys, and Signals → Overview):

| Value | Where to find it | Env var |
|---|---|---|
| Console API key | Manage organization → API keys → Create API key (scope: see below) | `SNOWPLOW_CONSOLE_API_KEY` |
| Console API key ID | Same screen, paired with the key | `SNOWPLOW_CONSOLE_API_KEY_ID` |
| Organization ID | Console URL or org settings | `SNOWPLOW_CONSOLE_ORG_ID` |
| Signals API base URL | Signals → Overview | `SIGNALS_DEPLOYED_URL` |
| Collector URL | Pipeline → collector endpoint | `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` |
| Tracker request path (optional) | Pipelines → (your pipeline) → Tracker request paths | `NEXT_PUBLIC_SNOWPLOW_POST_PATH` |
| Owner email (optional) | your address | `SNOWPLOW_OWNER_EMAIL` |

```
SNOWPLOW_CONSOLE_API_KEY=<PLACEHOLDER>
SNOWPLOW_CONSOLE_API_KEY_ID=<PLACEHOLDER>
SNOWPLOW_CONSOLE_ORG_ID=<PLACEHOLDER>
SIGNALS_DEPLOYED_URL=<PLACEHOLDER, e.g. https://signals.<org>.snowplowanalytics.com>
NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL=<PLACEHOLDER, e.g. https://collector.<org>.snowplowanalytics.com>
NEXT_PUBLIC_SNOWPLOW_POST_PATH=<PLACEHOLDER, optional>
```

**Tracker request path.** Both the browser tracker and the server-side agent
tracking module send events to the collector on this path; left unset, they
use the tracker's own default (`/com.snowplowanalytics.snowplow/tp2`). Some
content blockers (for example uBlock Origin's default EasyPrivacy list) block
any request whose path contains `/com.snowplowanalytics.snowplow/`, so a
shopper with one installed never sees their events reach the collector — the
demo looks broken even though the pipeline is fine. Every trial pipeline is
provisioned with its own custom paths that avoid that pattern; using one
defeats that specific rule.

A custom path only defeats path-based blocking. It does nothing against
domain-level blocking: Firefox's built-in tracking protection (the Disconnect
list) blocks the collector's hostname itself in Strict mode and in private
windows regardless of path, and the only way around that is a custom
collector hostname, which is out of scope for a trial pipeline. If events are
still missing after setting a custom path, check whether the browser's
hostname-level protection is the cause before assuming the path is wrong.

**API key scope.** Console API keys are scoped to the features you tick when
you create them. Tick every feature at its highest level for this guide:
Data structures and Tracking plans cover the seeding and Snowtype in §4,
Signals covers §5. A key without Signals still gets a Console token but is
rejected by the Signals publish in §5 with `401 Unauthorized`. The wizard
checks the key against the Signals API in stage 5, before any seeding.

## 3. Local env setup

1. `cp storefront/.env.example storefront/.env.local`
2. Fill in the credentials from step 2, plus:
   - `NEXT_PUBLIC_SNOWPLOW_POST_PATH` — optional; leave unset to use the
     tracker's default path, or paste the pipeline's custom path from step 2.
   - `NEXT_PUBLIC_SNOWPLOW_APP_ID` — use `atelier-storefront-dev`
     for local runs, `atelier-storefront` for anything the pipeline
     should treat as the "live" demo app (both are pre-registered in
     `storefront/tracking-assets/tracking-plans/source-applications/fashion_storefront.yml`).
   - `NEXT_PUBLIC_SIGNALS_INTERVENTIONS_ENDPOINT` — Signals interventions
     endpoint, if your org exposes one (Signals → API access).
   - `AGENT_SHARED_SECRET` — any local value; only real agent tool calls (and
     the CX Agent Studio side, §7) need it to match a real secret.
   - `NEXT_PUBLIC_CES_DEPLOYMENT_ID` — leave unset for now; it's only known
     once the agent's web-widget deployment exists, see
     [`setup-cx-agent-studio.md`](./setup-cx-agent-studio.md) §6.
3. Optional agent-tracking overrides — every one has a code default, so only
   set these if you need to deviate from it:

   | Env var | Default | Notes |
   |---|---|---|
   | `AGENT_SNOWPLOW_APP_ID` | `${NEXT_PUBLIC_SNOWPLOW_APP_ID}-agent` | App id the server-side agent tracking module (`src/utils/agentTracking.ts`) sends on every `tool_execution`/self-tracking event, so agent traffic (`platform=srv`) filters from browser traffic (`platform=web`) in Console with one predicate. |
   | `AGENT_MODEL_NAME` | the model in `terraform/terraform.tfvars.example` (`gemini-3.0-flash-001`) | Recorded in the `agent_context` entity's `model_name` field on every server-side agent event. Update if the live agent's model changes. |
   | `NEXT_PUBLIC_WIDGET_MESSAGE_PREVIEWS_ENABLED` | enabled (unset) | Whether the widget's `message_sent`/`message_received` tracking includes a capped (100 char) preview of the shopper's/concierge's message text. Set to `false` to omit previews entirely — message length is still tracked either way. Read client-side. |
4. Install deps and run locally:
   `npm --prefix storefront install && npm --prefix storefront run dev`.
5. Browse a few product pages and add something to cart, so the pipeline has
   traffic to publish against.

## 4. Seed the org with the tracking plan

A fresh org has none of the demo's custom schemas, and the Signals publish
hard-fails without them (`404 Schema for event 'product_viewed' ... was not
found or not in production`). The whole tracking plan lives in the repo as
config-as-code under `storefront/tracking-assets/`; seed the org with
[snowplow-cli](https://docs.snowplow.io/docs/data-product-studio/snowplow-cli/)
(`brew install snowplow-product/taps/snowplow-cli` — auth uses the same
`SNOWPLOW_CONSOLE_*` env vars from step 2).

From `storefront/`, with `.env.local` populated:

1. Validate first (read-only; also confirms the credentials work):
   ```
   npm run seed:tracking-plans -- --dry-run
   ```
   No credentials required for `--dry-run`; it builds the temp publish tree,
   prints the template→derived UUID mapping, and prints the commands it would
   run without executing anything.
2. Real seed — requires all three console credential env vars; the script
   exits with a clear error naming any that are missing:
   ```
   npm run seed:tracking-plans
   ```
   This publishes data structures (dev, then prod — Signals only accepts
   schemas that are **in production**), then publishes the tracking plan from a
   derived-ID build tree, stopping on first failure. Among the data structures
   are the repo's three own-schema agent entities (`conversation`,
   `catalog_search`, `context_lookup`); the tracking plan includes event
   specifications for both the storefront's events and the seven agent
   events, and a second source application
   (`fashion_storefront_agent.yml`) registers the server-side agent app ids
   alongside the browser storefront's. The agent event and entity schemas
   themselves (`com.snowplow.agent.tracking`) are never published — they
   resolve from Iglu Central. See
   [`storefront/README.md`](../storefront/README.md) ("Agent event
   specifications") for the full list.

3. Generate the Snowtype tracking helpers against the org you just seeded:
   ```
   npm run snowtype:generate
   ```
   `snowtype.config.json` and `snowtype/` are gitignored because both name
   org-specific IDs; this command writes the config from
   `snowtype.config.example.json` (org ID from `.env.local`, plus the IDs of
   the tracking plan's own-schema event specifications, each derived the same
   way the seed script derives them) and then generates the helpers.
   `storefront/src` imports them, so `npm test`, `npm run lint` and
   `npm run build` all fail until this has run once.

> Tracking-plan IDs are derived per-org (a stable UUIDv5 from the org ID), so a
> fresh org never collides with a previous org's IDs, and re-running against the
> same org updates the same resources rather than duplicating them.

## 5. Publish the Signals config

From `storefront/`, with `.env.local` populated:

1. Install the publish script's Python dependencies (Python 3.11+; it imports
   `snowplow_signals`, declared in `storefront/pyproject.toml`):
   ```
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -e .
   ```
   On later visits just re-activate: `source .venv/bin/activate`.
2. Dry run first — validates the attribute group, service, and intervention
   objects locally without calling the live API (works even without
   credentials):
   ```
   npm run signals:publish -- --dry-run
   ```
   Confirm the printed objects look right (attribute group
   `fashion_ecommerce_session_attributes`, service `fashion_ecommerce_demo`).
3. Real publish — requires all four credential env vars:
   ```
   set -a; . ./.env.local; set +a; npm run signals:publish
   ```
4. Confirm the command prints the published object names/versions with no
   error. A `[Signals API] 401` here means the key's scope is wrong (§2);
   a `404` means the schemas aren't in production yet (§4).

## 6. End-to-end verification

1. Load the storefront pointed at your collector, browse several products
   across at least one category, and add one to cart.
2. Grab the session's `domain_sessionid` (the on-page Signals debug panel shows
   it, or read the `_sp_id` cookie's second field).
3. Query the Profile Store for that session — either via the storefront's own
   `/api/signals/attributes?identifier=<domain_sessionid>` proxy, or directly
   with the Signals SDK/REST API — within a few seconds of browsing.
4. Confirm the response includes non-empty attributes consistent with the
   browsing (e.g. `favorite_category`, `total_product_views`).

## 7. Deploy the storefront to Vercel

Makes the site and the `/api/agent/*` tool endpoints reachable over public
HTTPS, which the CX Agent Studio OpenAPI tools require.

1. **Import the repo into Vercel** (dashboard → Add New → Project, or `vercel
   link` from `storefront/`). Set **Root Directory** to `storefront`. The
   framework preset auto-detects as Next.js once the root directory is set;
   `storefront/vercel.json` adds `Cache-Control: no-store` / `X-Robots-Tag:
   noindex` headers on `/api/agent/*` so tool responses are never cached or
   indexed.

2. **Configure environment variables** (Project → Settings → Environment
   Variables, Production scope):

   | Var | Client-exposed? | Notes |
   |---|---|---|
   | `SNOWPLOW_CONSOLE_API_KEY` | No — mark Sensitive | from step 2 |
   | `SNOWPLOW_CONSOLE_API_KEY_ID` | No — mark Sensitive | from step 2 |
   | `SNOWPLOW_CONSOLE_ORG_ID` | No — mark Sensitive | from step 2 |
   | `SIGNALS_DEPLOYED_URL` | No — mark Sensitive | from step 2 |
   | `AGENT_SHARED_SECRET` | No — mark Sensitive | mint a fresh long random value for the deployed environment (don't reuse a local one); you mirror this exact value into the CX Agent Studio OpenAPI tool's API-key auth ([`setup-cx-agent-studio.md`](./setup-cx-agent-studio.md) §3) |
   | `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` | Yes, by design | from step 2 |
   | `NEXT_PUBLIC_SNOWPLOW_POST_PATH` | Yes, by design | optional; only set if you captured a custom tracker request path in step 2 |
   | `NEXT_PUBLIC_SNOWPLOW_APP_ID` | Yes, by design | use `atelier-storefront` (not `-dev`) so the deployed site is the "live" demo app |
   | `NEXT_PUBLIC_SIGNALS_INTERVENTIONS_ENDPOINT` | Yes, by design | from step 2, if set |
   | `AGENT_SNOWPLOW_APP_ID` | No — not sensitive, but not client-exposed either | optional; only set if you need agent traffic under an app id other than the `${NEXT_PUBLIC_SNOWPLOW_APP_ID}-agent` default (§3) |
   | `AGENT_MODEL_NAME` | No — not sensitive, but not client-exposed either | optional; only set if the live agent's model differs from the `terraform/terraform.tfvars.example` default (§3) |
   | `NEXT_PUBLIC_WIDGET_MESSAGE_PREVIEWS_ENABLED` | Yes, by design | optional; not sensitive, but it is a privacy choice — set to `false` to turn off message-text previews in production (§3) |
   | `NEXT_PUBLIC_CES_DEPLOYMENT_ID` | Yes, by design | set once the agent's web-widget deployment exists — see [`setup-cx-agent-studio.md`](./setup-cx-agent-studio.md) §6, not this guide |

   Only `NEXT_PUBLIC_*`-prefixed vars reach the browser bundle (Next.js's own
   build-time convention). Everything else is read with `process.env.*` only
   inside server-side route handlers (`src/app/api/**`) and the shared-secret
   check (`src/utils/agentAuth.ts`) — never in a `"use client"` component.

3. **Deploy** — via the connected git integration or `vercel --prod` from
   `storefront/`.

4. **Verify** the deployed environment:
   ```
   cd storefront
   AGENT_SHARED_SECRET=<the value set in Vercel> npm run verify:deploy -- https://<your-storefront-url>
   ```
   Checks site reachability, that the business and self-tracking agent
   endpoints reject requests with no shared-secret header (401), and that
   authorized requests return the expected payload shape (200 with `profile`
   / `recent_activity` / `agent_instructions`, or `results`, for the business
   tools; 200 with a minted confirmation id for each self-tracking endpoint).
   Every authorized self-tracking probe sends
   `x-agent-tracking-dry-run: 1`, so it never sends a real event to the
   collector.

   Then repeat the browser walkthrough from step 6 against the deployed URL:
   browse, add to cart, grab `domain_sessionid`, and confirm
   `/api/agent/context` reflects that session's live attributes within a few
   seconds.

Once the storefront is deployed and verified, continue to
[`setup-cx-agent-studio.md`](./setup-cx-agent-studio.md).

## Verify locally with Snowplow Micro

Before seeding a real org, or any time you're changing agent tracking code,
[`storefront/README.md`](../storefront/README.md) ("Local Agent Tracking
Verification (Snowplow Micro)") covers running the whole agent tracking
surface — business tool calls and the three self-tracking calls — against a
local Snowplow Micro instance, so every payload is schema-validated before
any of it reaches a real pipeline.

## Troubleshooting

- **Signals publish fails with `[Signals API] 401: {'detail':
  'Unauthorized'}`** even though Console issued a token for the key — the key
  is valid but not scoped for Signals. Create a new key with every feature
  ticked at its highest level (§2), put it in `.env.local` and re-run
  (`--from 4` in the wizard). If a key with Signals ticked still gets 401,
  check `SIGNALS_DEPLOYED_URL` is this org's URL from Signals → Overview and
  not one copied from another org.
- **Signals publish fails with 404 "Schema for event ... was not found or
  not in production"** — the org's schema registry is missing the tracking
  plan, or the structures were only published to dev. Run step 4, including
  the `publish prod` promotion.
- **Publish script exits with "Missing required environment variable(s)"**
  — one of the four credential vars from §2 isn't set in the current shell;
  re-run with `set -a; . ./.env.local; set +a;` prefixed (as in §5), or
  export them directly.
- **Attributes stay empty after browsing** — check the collector URL and
  app ID actually match a pipeline/app pair the org is enriching for; the
  storefront tracker silently disables itself (logs a console note) if
  either `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` or `NEXT_PUBLIC_SNOWPLOW_APP_ID`
  is unset (§2–§3).
- **Events never reach the collector, but only for some shoppers (often
  Firefox + an ad blocker)** — the browser's Network tab is the reliable
  check for whether a tracking request was actually blocked; a request
  status, not the presence of a request in a tracker-inspection extension, is
  the source of truth. If the request never fires, set
  `NEXT_PUBLIC_SNOWPLOW_POST_PATH` to the pipeline's custom path (§2) so
  path-based content-blocker rules don't match it. If it still doesn't fire
  with a custom path set, that shopper's browser is blocking the collector's
  hostname itself (Firefox Strict mode, private windows), which a custom
  path can't fix — see the note in §2.
- **Trial expired mid-project** — re-run this whole guide against a fresh
  trial org; nothing here depends on the previous org's identifiers.
- **Vercel build fails or serves the wrong app** — confirm the Vercel
  project's Root Directory is set to `storefront` (§7).
- **A Vercel step looks stuck with no output** — the Vercel CLI asks once a
  day, in any interactive terminal, whether to install a Claude Code plugin;
  press `n` then Enter to answer it and continue.
- **`verify:deploy` reports FAIL on the authorized context/catalog checks
  only** (unauthorized checks still pass) — the `AGENT_SHARED_SECRET` value
  passed to the script doesn't match the one set in Vercel's environment
  variables (§7); re-check for copy/paste drift, or rotate and redeploy.
- **`verify:deploy` reports FAIL on "Site is publicly reachable"** —
  deploy hasn't finished, the Root Directory isn't set to `storefront`, or
  the URL is wrong; check the Vercel deployment logs.
