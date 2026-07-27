# Runbook: Snowplow trial org → live Signals pipeline

Re-creates the live half of the demo (storefront → Snowplow pipeline → Signals)
after the Free Trial org that powered the original recording has expired, or
when standing up a fresh one. Covers `.scratch/signals-cx-agent-demo/issues/02a-signals-publish-prep.md`
(prep, agent-doable) and `02b-trial-org.md` (execution, human-only — browser
signup and live credentials can't happen in this sandbox).

GCP/CX Agent Studio setup (the agent + OpenAPI tool side) is out of scope here;
see the issue for that stage once it exists.

## 1. Create the Snowplow Free Trial org

1. Sign up for a Snowplow Free Trial at `<PLACEHOLDER: trial signup URL>`.
2. Confirm the trial includes a full pipeline (collector + enrich + Signals)
   and that Signals is enabled for the org — check under the org's Signals
   section in BDP Console.
3. Note the trial's expiry date: `<PLACEHOLDER: trial expiry date>`.

## 2. Capture credentials

From BDP Console (Settings → API Keys or Signals → API access):

| Value | Where to find it | Env var |
|---|---|---|
| Console API key | Console → API keys → create/copy | `SNOWPLOW_CONSOLE_API_KEY` |
| Console API key ID | Same screen, paired with the key | `SNOWPLOW_CONSOLE_API_KEY_ID` |
| Organization ID | Console URL or org settings | `SNOWPLOW_CONSOLE_ORG_ID` |
| Signals API base URL | Signals → API access | `SIGNALS_DEPLOYED_URL` |
| Collector URL | Pipeline → collector endpoint | `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` |

Placeholders — fill in once the trial org exists:

```
SNOWPLOW_CONSOLE_API_KEY=<PLACEHOLDER>
SNOWPLOW_CONSOLE_API_KEY_ID=<PLACEHOLDER>
SNOWPLOW_CONSOLE_ORG_ID=<PLACEHOLDER>
SIGNALS_DEPLOYED_URL=<PLACEHOLDER, e.g. https://signals.<org>.snowplowanalytics.com>
NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL=<PLACEHOLDER, e.g. https://collector.<org>.snowplowanalytics.com>
```

Never commit real values. They live only in `storefront/.env.local`
(gitignored) or the deploy target's secret store.

## 3. Env setup

1. `cp storefront/.env.example storefront/.env.local`
2. Fill in the credentials from step 2, plus:
   - `NEXT_PUBLIC_SNOWPLOW_APP_ID` — use `signals-workshop-fashion-demo-dev`
     for local runs, `signals-workshop-fashion-demo` for anything the trial
     pipeline should treat as the "live" demo app (both are pre-registered in
     `storefront/tracking-assets/tracking-plans/source-applications/fashion_storefront.yml`).
   - `NEXT_PUBLIC_SIGNALS_INTERVENTIONS_ENDPOINT` — Signals interventions
     endpoint, if the trial org exposes one (Signals → API access).
2. Install deps and run locally: `npm --prefix storefront install && npm --prefix storefront run dev`.
3. Browse a few product pages, add something to cart, so the pipeline has
   traffic to publish against.

## 4. Seed the org with the tracking plan (data structures + tracking plans)

A fresh trial org has none of the demo's custom schemas, and the Signals
publish hard-fails without them (404 `Schema for event 'product_viewed'
(vendor: 'com.snowplow_demo.fashion', ...) was not found or not in
production`). The whole tracking plan lives in the repo as config-as-code
under `storefront/tracking-assets/`; seed the org with
[snowplow-cli](https://docs.snowplow.io/docs/data-product-studio/snowplow-cli/)
(`brew install snowplow-product/taps/snowplow-cli` — auth uses the same
`SNOWPLOW_CONSOLE_*` env vars captured in step 2).

From `storefront/`, with `.env.local` populated:

1. Validate first (read-only; also confirms the credentials work):
   ```
   npm run seed:tracking-plans -- --dry-run
   ```
   No credentials required for `--dry-run`; it builds the temp publish tree,
   prints the template→derived UUID mapping, and prints the commands it
   would run without executing anything.
2. Real seed — requires all three credential env vars; the script exits with
   a clear error naming any that are missing:
   ```
   npm run seed:tracking-plans
   ```
   This validates and publishes data structures (dev, then prod — Signals
   only accepts schemas that are **in production**), then publishes the
   tracking plan from a derived-ID build tree, stopping on first failure.

## 5. Publish the Signals config

From `storefront/`, with `.env.local` populated:

1. Install the publish script's Python dependencies (needs Python 3.11+; the
   script imports `snowplow_signals`, declared in `storefront/pyproject.toml`):
   ```
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -e .
   ```
   On later visits just re-activate the venv (`source .venv/bin/activate`).
2. Dry run first — validates the attribute group, service, and intervention
   objects locally without calling the live API. Works even without
   credentials set:
   ```
   npm run signals:publish -- --dry-run
   ```
   Confirm the printed objects look right (attribute group name
   `fashion_ecommerce_session_attributes`, service `fashion_ecommerce_demo`).
3. Real publish — requires all four credential env vars; the script exits
   with a clear error naming any that are missing:
   ```
   set -a; . ./.env.local; set +a; npm run signals:publish
   ```
4. Confirm the command prints the published object names/versions with no
   error.

## 6. End-to-end verification

1. In a browser, load the storefront pointed at the trial collector, browse
   several products across at least one category, and add one to cart.
2. Grab the session's `domain_sessionid` (the on-page Signals debug panel
   shows it, or read the `_sp_id` cookie's second field).
3. Query the Profile Store for that session — either via the storefront's own
   `/api/signals/attributes?identifier=<domain_sessionid>` proxy, or directly
   with the Signals SDK/REST API — within a few seconds of browsing.
4. Confirm the response includes non-empty attributes consistent with the
   browsing just performed (e.g. `favorite_category`, `total_product_views`).
5. Record the result (pass/fail + timestamp) here or in the issue comments:
   `<PLACEHOLDER: verification run log>`.

## 7. Deploy the storefront to Vercel (public)

Covers `.scratch/signals-cx-agent-demo/issues/05-public-deploy.md`: makes the
site and the `/api/agent/*` tool endpoints reachable over public HTTPS for the
CX Agent Studio OpenAPI tool and the webinar recording. Prep (this section,
`storefront/vercel.json`, `npm run verify:deploy`) is agent-doable; **the
deploy itself is human-triggered** — Vercel account access and a public deploy
are outside this sandbox.

1. **Import the repo into Vercel** (dashboard → Add New → Project, or `vercel
   link` from `storefront/` with the Vercel CLI installed). Set **Root
   Directory** to `storefront` — the repo root's `package.json` is unrelated
   pipeline tooling, not the Next.js app. Framework preset auto-detects as
   Next.js once the root directory is set; `storefront/vercel.json` adds
   `Cache-Control: no-store` / `X-Robots-Tag: noindex` headers on
   `/api/agent/*` so tool responses are never cached or indexed.

2. **Configure environment variables** (Project → Settings → Environment
   Variables, Production scope). Same five credential vars as step 2/3 above,
   plus the three `NEXT_PUBLIC_*` vars:

   | Var | Client-exposed? | Notes |
   |---|---|---|
   | `SNOWPLOW_CONSOLE_API_KEY` | No — mark Sensitive | from step 2 |
   | `SNOWPLOW_CONSOLE_API_KEY_ID` | No — mark Sensitive | from step 2 |
   | `SNOWPLOW_CONSOLE_ORG_ID` | No — mark Sensitive | from step 2 |
   | `SIGNALS_DEPLOYED_URL` | No — mark Sensitive | from step 2 |
   | `AGENT_SHARED_SECRET` | No — mark Sensitive | mint a fresh long random value for the deployed environment (don't reuse a local `.env.local` value); mirror this exact value in the CX Agent Studio OpenAPI tool's API-key auth config (issue 06) |
   | `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` | Yes, by design | from step 2 |
   | `NEXT_PUBLIC_SNOWPLOW_APP_ID` | Yes, by design | use `signals-workshop-fashion-demo` (not the `-dev` variant) so the deployed site is treated as the "live" demo app |
   | `NEXT_PUBLIC_SIGNALS_INTERVENTIONS_ENDPOINT` | Yes, by design | from step 2, if set |

   Only `NEXT_PUBLIC_*`-prefixed vars reach the browser bundle — Next.js's own
   build-time convention, not something this app has to enforce. Everything
   else is read with `process.env.*` exclusively inside server-side route
   handlers (`src/app/api/**`) and the shared-secret check
   (`src/utils/agentAuth.ts`) — never in a `"use client"` component.

3. **Deploy** — via the connected git integration (push to the branch Vercel
   tracks) or `vercel --prod` from `storefront/`. Human-triggered; not run
   from this sandbox.

4. **Verify** the deployed environment:
   ```
   cd storefront
   AGENT_SHARED_SECRET=<the value set in Vercel> npm run verify:deploy -- https://<deployed-url>
   ```
   Checks site reachability, that both agent endpoints reject requests
   without the shared-secret header (401), and that authorized requests
   return the expected payload shape (200 with `profile` /
   `recent_activity` / `agent_instructions`, or `results`).

   Then repeat the browser walkthrough from step 6, against the deployed
   URL instead of localhost: browse products, add to cart, grab
   `domain_sessionid`, and confirm `/api/agent/context` reflects that
   session's live attributes within a few seconds.

5. Record the deployed URL and verification result here:
   `<PLACEHOLDER: deployed URL + verification run log>`.

## Troubleshooting

- **Tracking plan IDs are derived per-org automatically** — `npm run
  seed:tracking-plans` derives a stable UUIDv5 per resource from the org ID,
  so a fresh org never collides with IDs published from a previous org, and
  re-running the same org updates the same resources rather than duplicating
  them.
- **Signals publish fails with 404 "Schema for event ... was not found or not
  in production"** — the org's schema registry is missing the tracking plan,
  or the structures were only published to dev. Run step 4, including the
  `publish prod` promotion.
- **Publish script exits with "Missing required environment variable(s)"** —
  one of the four credential vars isn't set in the current shell; re-run with
  `set -a; . ./.env.local; set +a;` prefixed, or export them directly.
- **Attributes stay empty after browsing** — check the collector URL and app
  ID actually match a pipeline/app pair the org is enriching for; the
  storefront tracker silently disables itself (logs a console note) if either
  `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` or `NEXT_PUBLIC_SNOWPLOW_APP_ID` is unset.
- **Trial expired mid-project** — re-run this whole runbook against a fresh
  trial org; nothing here depends on the previous org's identifiers.
- **Vercel build fails or serves the wrong app** — the repo root has its own
  `package.json` (pipeline tooling, not the storefront); confirm the Vercel
  project's Root Directory is set to `storefront`.
- **`verify:deploy` reports FAIL on the authorized context/catalog checks
  only** (unauthorized checks still pass) — the `AGENT_SHARED_SECRET` value
  passed to the script doesn't match the one set in Vercel's environment
  variables; re-check for copy/paste drift, or rotate and redeploy.
- **`verify:deploy` reports FAIL on "Site is publicly reachable"** — deploy
  hasn't finished, the Root Directory isn't set to `storefront`, or the URL
  is wrong; check the Vercel deployment logs.
