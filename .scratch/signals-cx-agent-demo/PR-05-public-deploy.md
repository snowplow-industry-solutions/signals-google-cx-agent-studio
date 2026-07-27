# PR: 05 — Public deploy to Vercel

**Branch:** sandcastle/05-public-deploy
**Issue:** .scratch/signals-cx-agent-demo/issues/05-public-deploy.md

## Summary

Prepares the storefront for public deployment to Vercel so the agent-facing endpoints (`/api/agent/context` and `/api/agent/catalog`) are reachable over public HTTPS and the demo site itself is publicly browsable. Per the agent constraint, the deploy itself is human-triggered; this work includes the Vercel configuration, a post-deploy verification script, and comprehensive runbook documentation with environment variable setup, deploy steps, and troubleshooting guidance.

## Changes

- **Vercel configuration** (`storefront/vercel.json`): Sets Next.js framework preset and adds `Cache-Control: no-store` / `X-Robots-Tag: noindex` headers to `/api/agent/*` routes to prevent caching and indexing of tool responses.

- **Post-deploy verification script** (`storefront/scripts/verify-deploy.ts` + test suite `verify-deploy.test.ts`): A smoke-test CLI that runs after the human deploys to Vercel. Checks five acceptance criteria: site reachability (200 on `/`), context endpoint rejects unauthenticated requests (401 without header), context endpoint authorized access returns correct payload shape (200 with `profile`, `recent_activity`, `agent_instructions`), catalog endpoint rejects unauthenticated requests (401 without header), and catalog endpoint authorized access returns correct payload shape (200 with `results` array). All five checks pass when the shared secret is set; auth checks correctly flip to FAIL when the header is missing or wrong.

- **Runbook section 7** (`docs/runbook.md`): New "Deploy the storefront to Vercel (public)" section with step-by-step instructions: (1) import repo to Vercel with Root Directory set to `storefront`; (2) configure environment variables (Snowplow credentials, shared secret, and `NEXT_PUBLIC_*` vars split into a clear table); (3) deploy via git integration or CLI; (4) run post-deploy verification script; (5) repeat browser walkthrough against live URL. Also added four new troubleshooting entries for deploy-specific issues (wrong root directory, secret mismatch, deployment in progress, reachability errors).

- **npm script** (`storefront/package.json`): Added `verify:deploy` target pointing to the verification script.

- **Issue update** (`.scratch/signals-cx-agent-demo/issues/05-public-deploy.md`): Ticked two agent-verifiable criteria (no client-side exposure of credentials, deploy steps documented); left three criteria unchecked pending live deploy verification by the human (site reachability + live traffic, endpoints over HTTPS, end-to-end session check).

## Pipeline review record

- `6c74774 Add Vercel config for the storefront deploy`
- `9015a4d Add post-deploy verification script for agent endpoints`
- `8fe5c29 Document Vercel deploy steps in the runbook`
- `1439ea5 Tick agent-verifiable acceptance criteria for issue 05`

## Manual testing plan

### Prerequisites

- Vercel account with the GitHub repo linked (or `vercel` CLI installed for manual linking).
- Access to the Snowplow trial org created in issue 02 (org ID, collector URL, API key, key ID).
- Fresh random value to use as `AGENT_SHARED_SECRET` for the deployed environment (do not reuse a local `.env.local` value).
- The URL Vercel assigns after the deploy is complete (e.g., `https://signals-storefront.vercel.app`).

### Step 1: Import the repo into Vercel and configure environment variables

1. Log into Vercel and create a new project: **Add New → Project**.
2. Select the GitHub repo (`snowplow-industry-solutions/signals-google-cx-agent-studio`).
3. **Critical:** Set **Root Directory** to `storefront` (not the repo root). The repo root's `package.json` is unrelated pipeline tooling; Next.js framework preset will auto-detect once the root directory is correct.
4. Navigate to **Project → Settings → Environment Variables** (Production scope) and add the following variables:

   | Variable Name | Client-exposed? | Value | Notes |
   |---|---|---|---|
   | `SNOWPLOW_CONSOLE_API_KEY` | No — mark Sensitive | From step 2 of the runbook | Snowplow API key |
   | `SNOWPLOW_CONSOLE_API_KEY_ID` | No — mark Sensitive | From step 2 of the runbook | Snowplow API key ID |
   | `SNOWPLOW_CONSOLE_ORG_ID` | No — mark Sensitive | From step 2 of the runbook | Snowplow org ID |
   | `SIGNALS_DEPLOYED_URL` | No — mark Sensitive | From step 2 of the runbook | Signals URL |
   | `AGENT_SHARED_SECRET` | No — mark Sensitive | Mint a fresh long random value (e.g., `openssl rand -base64 32`) | **Do not reuse** a local value; this will be shared with the CX Agent Studio tool config in issue 06 |
   | `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` | Yes, by design | From step 2 of the runbook | Snowplow collector URL |
   | `NEXT_PUBLIC_SNOWPLOW_APP_ID` | Yes, by design | `signals-workshop-fashion-demo` | Use the non-dev variant so deployed site is treated as the "live" demo (not `signals-workshop-fashion-demo-dev`) |
   | `NEXT_PUBLIC_SIGNALS_INTERVENTIONS_ENDPOINT` | Yes, by design | From step 2 of the runbook (if set) | Optional; Signals interventions endpoint |

5. Verify that each `NEXT_PUBLIC_*` var is NOT marked Sensitive (they're meant to be in the browser bundle); all others should be marked Sensitive.

### Step 2: Trigger the deploy

1. **Via git integration** (recommended): Push a commit to the branch Vercel tracks (typically `main` or the PR's branch). Vercel will automatically build and deploy.
2. **Alternatively, via CLI**: From the repo root or `storefront/`, run `vercel --prod` (requires Vercel CLI and authentication).
3. Wait for the Vercel deployment to complete. Note the public URL assigned (e.g., `https://signals-storefront.vercel.app`).

### Step 3: Run the post-deploy verification script

From the repo root (with `storefront/` as a subdirectory):

```bash
cd storefront
AGENT_SHARED_SECRET="<the exact value you set in Vercel's environment variables>" \
npm run verify:deploy -- https://<deployed-url>
```

Example:
```bash
cd storefront
AGENT_SHARED_SECRET="abc123xyz..." npm run verify:deploy -- https://signals-storefront.vercel.app
```

**Expected output:**
```
PASS — Site is publicly reachable (status 200)
PASS — Context endpoint rejects requests without the shared secret (status 401)
PASS — Context endpoint responds for an authorized request (status 200)
PASS — Catalog endpoint rejects requests without the shared secret (status 401)
PASS — Catalog endpoint responds for an authorized request (status 200)
```

All five checks must PASS. If any fail, see the **Troubleshooting** section below.

### Step 4: Browser walkthrough — confirm live session tracking

1. Open the deployed URL in a browser (e.g., `https://signals-storefront.vercel.app`).
2. Browse the product catalog, add a few items to the cart.
3. Open the browser's Developer Tools (F12) → **Network** tab.
4. Reload the page and find the `/api/agent/context?session_id=...` request.
5. Extract the `session_id` query parameter value (e.g., `session-abc123def456`).
6. Call the context endpoint directly with that session ID and the shared secret header:
   ```bash
   curl -H "x-agent-api-key: <AGENT_SHARED_SECRET>" \
     "https://<deployed-url>/api/agent/context?session_id=<session-id>"
   ```
7. **Expected result:** The response should include a JSON object with:
   - `profile`: user profile attributes for that session
   - `recent_activity`: recent browsing activity
   - `agent_instructions`: instructions for the CX Agent to use
   
   The values should reflect the products you just browsed and the current session time (within a few seconds of when you loaded the page).

### Step 5: Record the deployment

Update the issue or this runbook with:
- Deployed URL (e.g., `https://signals-storefront.vercel.app`).
- Timestamp of the deploy.
- Output of the `verify:deploy` script (five PASS results).
- Confirmation that the browser walkthrough showed live session attributes in the context endpoint response.

### If it fails

**`verify:deploy` reports FAIL on the authorized context/catalog checks only** (unauthorized checks still PASS):
- The `AGENT_SHARED_SECRET` value you passed to the script does not match the one in Vercel's environment variables.
- Re-check for copy/paste errors, spaces, or character differences.
- If uncertain, rotate the secret: generate a new random value, update it in Vercel's environment variables, wait for the deploy to rebuild, and run the script again with the new value.

**`verify:deploy` reports FAIL on "Site is publicly reachable"**:
- The deploy has not finished yet — check the Vercel deployment logs.
- The Root Directory in Vercel project settings is not set to `storefront` — fix it and re-deploy.
- The URL you passed to the script is wrong or unreachable — confirm it matches the Vercel-assigned URL exactly and that any firewall rules allow HTTPS access.

**Browser walkthrough shows no session attributes or empty profile**:
- The session ID in the context endpoint request may be from a cached page load. Reload the page again and extract a fresh session ID from a new network request.
- The deployed site may not be sending events to the Snowplow collector yet — check that `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` and `NEXT_PUBLIC_SNOWPLOW_APP_ID` are both set and use the "live" app ID (`signals-workshop-fashion-demo`, not the `-dev` variant).
- Wait a few seconds after browsing products and adding to cart before checking the context endpoint — events may take a moment to propagate.

## Rollback

If the deployment needs to be undone: delete the project from the Vercel dashboard (Project → Settings → Danger Zone → Delete Project), or do not promote the branch to production (if this was deployed from a feature branch, the rollback is automatic when the branch is closed).
