# Runbook: Snowplow trial org → live Signals pipeline

Re-creates the live half of the demo (storefront → Snowplow pipeline → Signals)
after the Free Trial org that powered the original recording has expired, or
when standing up a fresh one. Covers `.scratch/signals-cx-agent-demo/issues/02a-signals-publish-prep.md`
(prep, agent-doable) and `02b-trial-org.md` (execution, human-only — browser
signup and live credentials can't happen in this sandbox).

GCP/CX Agent Studio setup (the agent + OpenAPI tool side) is covered in §8
below, once the storefront is deployed (§7).

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
   - Deployed URL: https://signals-google-gecx-storefront.vercel.app (deployed 2026-07-27 via Vercel CLI, no git integration yet)
   - 2026-07-27 secret-free checks: `/` 200; `/api/agent/context` and
     `/api/agent/catalog` both 401 without auth header; `Cache-Control:
     no-store` + `X-Robots-Tag: noindex` present on agent routes. PASS.
   - 2026-07-27 `npm run verify:deploy` (with shared secret): all 5 checks
     PASS — site 200, both agent endpoints 401 unauthorized, context and
     catalog 200 with expected payload shape for authorized requests.
   - 2026-07-27 browser walkthrough: browsed deployed site (4 product views,
     2 add-to-carts), queried `/api/agent/context` with the live
     `domain_sessionid` (via Paw) — 200 with populated profile attributes
     matching the session and fresh `recent_activity` events. PASS.
     Note: `active_cart_line_count` returned 0 despite `total_add_to_cart: 2`
     — check that attribute's definition if the demo narrates cart contents.

## 8. CX Agent Studio setup (agent + OpenAPI tools)

Covers `.scratch/signals-cx-agent-demo/issues/06-cx-agent-and-tools.md`:
creates the customer-facing concierge agent in CX Agent Studio and wires it
to the two deployed tool endpoints. The OpenAPI schema files
(`agent/tools/*.openapi.yaml`) and the persona (`agent/instructions.md`)
are prepared in the repo; **everything below is human-triggered** — agent
creation, tool import, session-context wiring, and simulator verification
all require the live console and are outside this sandbox. Requires the
storefront already deployed per §7 (a public HTTPS URL and a minted
`AGENT_SHARED_SECRET`).

### 8.1 Enable APIs and label resources

1. In the Snowplow-managed sandbox GCP project, confirm CX Agent Studio
   (Gemini Enterprise for CX) is available/allowlisted for the project's
   region — this is a verify-at-build unknown (design doc risk #3); if the
   console doesn't offer agent creation, check the project's enabled APIs
   / region settings before assuming it's a wider outage.
2. Enable any APIs the console prompts for during agent creation (Gemini
   Enterprise / Discovery Engine / Dialogflow CX-family APIs, depending on
   what CX Agent Studio calls itself in the console at the time).
3. Label every resource this creates (agent, any associated data
   store/app) with the project's standard tags, where the resource type
   supports labels:
   ```
   system=signals-gecx-demo
   snowplow-owner=cc017
   environment=dev
   ```

### 8.2 Create the agent

1. In CX Agent Studio, create a new customer-facing agent in the sandbox
   project.
2. Paste the full contents of `agent/instructions.console.txt` into the
   **Root Agent node's own instructions field** (on the canvas), verbatim
   — it defines the concierge persona, the one-call-per-turn tool
   contract, and the degraded-session fallback behaviour, in the console's
   structured format with `{@TOOL: ...}` references. Not Settings →
   Advanced: that is the app-wide `globalInstruction`, which applies to
   every agent in the app — it works while the app has a single agent,
   but the persona would leak into any later-added agent. Reserve it for
   genuinely app-wide policy.

   The `{@TOOL: ...}` references must resolve against the attached tools
   (do §8.3 first). If the editor flags "tool not found", delete the
   reference and re-insert it with the editor's `@` picker — the
   resolvable names are toolset-qualified
   (`getUserContext_getUserContext`, `searchCatalog_searchCatalog`).
   `agent/instructions.md` is the human-readable source for the same
   contract; edit there first and mirror changes into the console copy.

### 8.3 Import the two OpenAPI tools

For each schema file, create a new OpenAPI tool in the agent and import
the file directly (console supports upload or paste):

| Tool | Schema file | Operation |
|---|---|---|
| `getUserContext` | `agent/tools/get-user-context.openapi.yaml` | `GET /api/agent/context` |
| `searchCatalog` | `agent/tools/search-catalog.openapi.yaml` | `GET /api/agent/catalog` |

Both schemas already declare `servers[0].url` as the deployed storefront
URL (`https://signals-google-gecx-storefront.vercel.app`) and an `apiKey`
security scheme on the `x-agent-api-key` header — if the deployed URL
changes, update `servers[0].url` in both files and re-import rather than
overriding it only in the console.

For each tool's authentication config, choose **API key** auth and set:
- Header name: `x-agent-api-key`
- Value: the exact `AGENT_SHARED_SECRET` value configured on the Vercel
  deployment in §7 (not a local `.env.local` value — they may differ).

Confirm each tool calls the deployed endpoint successfully once configured
— e.g. the console's tool-test/try-it affordance, or a manual test turn in
the simulator — before moving on.

### 8.4 Wire the session-context variable

Resolved 2026-07-27 (was the PRD's flagged verify-at-build unknown, design
doc risk #1). There is **no console UI setting** for this — the binding
lives in the tool's OpenAPI schema itself, via the `x-ces-session-context`
extension on the parameter
([OpenAPI tools docs](https://docs.cloud.google.com/gemini-enterprise-cx/cx-agent-studio/tool/open-api)).

**Do not bind to the built-in `$context.session_id`** — that is CX Agent
Studio's own conversation session id, not the Snowplow `domain_sessionid`;
it would always produce degraded payloads. Use a custom agent variable
referenced as `$context.variables.<name>`.

1. In the agent's Variables section, declare a variable
   `snowplow_session_id`, type Text.
2. In the `getUserContext` tool's schema, the `session_id` parameter
   carries (already present in the repo copy
   `agent/tools/get-user-context.openapi.yaml` — re-paste the schema if
   the console copy predates it):
   ```yaml
   x-ces-session-context: $context.variables.snowplow_session_id
   ```
   With the extension present the model no longer produces the value; it
   is injected from the variable at call time.
3. **Check to perform**: in the simulator, set `snowplow_session_id` to a
   real freshly-browsed session id (see §8.5) and confirm the tool
   actually receives it — inspect the tool's request in the console's
   execution trace/log, not just the agent's reply. If the simulator has
   no way to preset the variable, verify in two stages: temporarily
   remove the extension so the model passes a session id pasted into the
   chat (proves the live-context path), then restore it and verify the
   variable injection end-to-end during issue 07's widget wiring.
4. Confirmed binding: `x-ces-session-context:
   $context.variables.snowplow_session_id` (schema-level extension;
   console-UI picker does not exist). Widget-side population of the
   variable remains issue 07's verify-at-build item.

Widget wiring itself (the storefront calling `setQueryParameters` with the
real `domain_sessionid`) is issue `07-widget-end-to-end.md`, not this
stage — for now, the human supplies a session id manually in the
simulator.

### 8.5 Verify in the simulator

1. Browse the deployed storefront (§7 step 4's walkthrough) to get a real,
   freshly-browsed `domain_sessionid`.
2. In the CX Agent Studio simulator, set the session-context variable from
   §8.4 to that session id, then open the chat.
3. Confirm: the agent's first response reflects that session's real
   context (correct favourite designer, cart contents) without the human
   needing to state anything about their browsing, and any product
   recommendation is a real, matching catalog item (not invented).
4. Repeat with an unknown/made-up session id (or the variable unset).
   Confirm: the agent falls back to generic warm concierge behaviour per
   `agent/instructions.md`'s degraded-session section — no mention of
   errors, missing data, or anything technical.
5. Record the result (pass/fail + timestamp) here:
   - 2026-07-27 ~23:00 UTC, live-context run: variable set (via its
     temporary default value) to a freshly-browsed session id. Trace shows
     `getUserContext` called with `args: {}` (session id injected, not
     model-produced), endpoint returned the session's real profile
     (favourite designer Maison Cendre, Camel Cashmere Wrap Coat added to
     cart), and the agent's reply reflected it in persona. PASS.
   - 2026-07-27 ~23:03 UTC, degraded run: variable unset. Endpoint
     returned the empty payload; agent fell back to generic warm concierge
     behaviour ("still getting to know your style"), no error talk. PASS.
   - 2026-07-27 ~23:11 UTC, recommendation run: follow-up turn asking for
     matching accessories. Agent called `searchCatalog` scoped to the
     shopper's profile (designer + category + occasion), got zero results,
     then recovered by broadening (dropped the designer filter) and
     recommended two real catalog products with correct names, prices, and
     designers — no invented items. PASS.
   - Setup gotchas hit on the way (both now in Troubleshooting): the CES
     service agent needed `secretmanager.secretAccessor` on the shared
     secret, and re-importing the OpenAPI schema detached the tools from
     the Root agent node, leaving only the built-in `end_session`
     (symptom: agent "calls" the right tool per its reasoning but the
     trace shows `end_session` with placeholder args, and the
     conversation silently ends).

## 9. Widget embed and session-context wiring

Covers `.scratch/signals-cx-agent-demo/issues/07-widget-end-to-end.md`: embeds
the chat widget in the deployed storefront and wires the visitor's
`domain_sessionid` into the agent session automatically, closing the loop
from browse to chat. The widget component and wiring code
(`storefront/src/components/Widget/CesMessengerWidget.tsx`), the
`NEXT_PUBLIC_CES_DEPLOYMENT_ID` env var, and the `verify:deploy` widget-embed
check are prepared in the repo; **the widget deployment/channel creation and
token-broker public-access config in CX Agent Studio, and all live-browser /
live-agent verification below, are human-triggered** — outside this sandbox.
Requires the agent from §8 (specifically the `snowplow_session_id` variable
and `x-ces-session-context` binding confirmed in §8.4) and the storefront
already deployed per §7.

### 9.1 Widget-generation pin: ces-messenger vs chat-messenger (resolved)

Design doc risk #2 / PRD verify-at-build item. Findings, from official
sources (not guessed):

- The **open-source `ces-messenger` web component**
  ([GoogleCloudPlatform/ces-messenger](https://github.com/GoogleCloudPlatform/ces-messenger)),
  loaded via `<script src="https://www.gstatic.com/ces-console/fast/ces-messenger/ces-messenger.js">`
  and embedded as `<ces-messenger deployment-id="..." token-broker-url="MANAGED">`,
  documents a JS method `setQueryParameters({ key: value })` — each key
  becomes readable in the agent session as `$context.variables.<key>`. This
  is exactly the mechanism issue 06's tool schema already targets
  (`x-ces-session-context: $context.variables.snowplow_session_id`, §8.4).
- Google's official **CX Agent Studio "web widget" deploy docs**
  ([docs.cloud.google.com](https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/deploy/web-widget))
  describe a *different* element, `chat-messenger`, hosted at
  `https://www.gstatic.com/ces-console/fast/chat-messenger/prod/v1/chat-messenger.js`,
  initialised via a `chatSdk.prebuilts.ces.createContext({ deploymentName, tokenBroker: { enableTokenBroker, enableRecaptcha } })`
  JS call rather than an HTML-attribute + method pair. That surface's docs
  do **not** mention `setQueryParameters`, session-context variables, or any
  equivalent parameter-passing hook.
- A Google developer-forum thread
  ([discuss.google.dev](https://discuss.google.dev/t/hosted-versus-open-source-ces-messenger-web-component/334696))
  confirms the gstatic-hosted `chat-messenger` build and the open-source
  `ces-messenger` repo are related but **not kept in sync** on separate
  release cycles — the hosted build ships rich-message templates (e.g.
  Product Carousel) the open-source repo lacks, and some config in the
  open-source repo's spec isn't in the hosted build.

Since the demo's entire "browse → chat already knows" mechanism depends on
`setQueryParameters` populating `$context.variables.snowplow_session_id`, and
only `ces-messenger` documents that method, this repo pins to **ces-messenger**
— matching `docs/design.md` decision #6 and the issue text. `chat-messenger`
is not used anywhere in this repo.

**Exact check the human should run before trusting this pin**, once the
widget deployment exists (§9.2) and the storefront is embedding it (§9.3):

1. Open the deployed storefront in a browser; wait for the `ces-messenger-loaded`
   event to have fired (a few seconds after page load).
2. In devtools console, run:
   ```js
   document.querySelector("ces-messenger").setQueryParameters({ snowplow_session_id: "widget-pin-check-123" });
   ```
3. Open the chat and send any message.
4. In the CX Agent Studio console's execution trace for that turn, confirm
   the `getUserContext` tool request's `session_id` equals
   `widget-pin-check-123` (mirrors the §8.4/§8.5 trace-inspection check, now
   against the real widget instead of the simulator).
5. If the value never reaches the tool: check the Network tab for which
   script actually loaded — if the console's own "copy embed snippet"
   affordance emitted the gstatic `chat-messenger` build instead of
   `ces-messenger`, switch to the exact `<script>`/`<ces-messenger>` markup
   in §9.4 rather than whatever the console generated.

### 9.2 Create the web-widget deployment and enable public access (console)

1. In CX Agent Studio, on the agent from §8, create a Web Widget
   deployment/channel.
2. Configure the deployment's security settings for public, unauthenticated
   access (the console fields correspond to `google_ces_deployment.security_settings`
   documented in `docs/research/cx-agent-studio-terraform.md`, even though
   this pass is done in the console, not Terraform):
   - Enable public access.
   - Enable origin checking, and add the deployed storefront's exact origin
     (`https://signals-google-gecx-storefront.vercel.app`, or the current
     deployed URL from §7) to the allowed-origins list.
   - Leave **Recaptcha OFF**. The `ces-messenger` component has no reCAPTCHA
     support (no `recaptcha-site-key`-style attribute; verified against its
     README 2026-07-28) — with the channel toggle on, the widget calls
     `generateChatToken` without a `recaptcha_token` and the broker rejects
     every session with `400 INVALID_ARGUMENT: "Recaptcha token is missing."`.
     (The `enableRecaptcha` option in Google's web-widget docs belongs to the
     other widget generation, `chat-messenger`, which we can't use — §9.1.)
     Public access + origin verification is the protection level for this
     short-lived demo deployment.
3. Confirm the managed token broker option is selected — no separate broker
   infrastructure is needed; `token-broker-url="MANAGED"` in the embed
   (§9.4) is backed by Google's own `sessions.generateChatToken`.
4. Record the deployment's full resource name here (the format is
   `projects/<project>/locations/<location>/apps/<app>/deployments/<deployment>`):
   `<PLACEHOLDER: deployment resource name>` — this is the `deployment-id`
   value and the `NEXT_PUBLIC_CES_DEPLOYMENT_ID` env var in §9.3.
5. Label the deployment per the project's tagging policy if the console
   exposes labels for it (per the Terraform research note, the `ces_*`
   app/agent resources have no `labels` field at all as of that research —
   confirm whether the deployment resource is an exception before assuming
   it can't be labelled).

### 9.3 Configure the storefront and redeploy

1. In Vercel → Project → Settings → Environment Variables (Production
   scope), add:

   | Var | Client-exposed? | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_CES_DEPLOYMENT_ID` | Yes, by design | the deployment resource name from §9.2 step 4 |

2. Redeploy (§7 step 3).
3. Re-run `npm run verify:deploy -- https://<deployed-url>` (§7 step 4,
   `AGENT_SHARED_SECRET` still required for the agent-endpoint checks) — it
   now also asserts the homepage HTML includes both the `ces-messenger.js`
   script and a `<ces-messenger>` element.

### 9.4 Embed snippet (reference)

Nothing to hand-author here — `storefront/src/components/Widget/CesMessengerWidget.tsx`
renders this client-side once `NEXT_PUBLIC_CES_DEPLOYMENT_ID` is set (and
renders nothing if it's unset). For reference, the equivalent static markup:

```html
<script src="https://www.gstatic.com/ces-console/fast/ces-messenger/ces-messenger.js"></script>
<ces-messenger
  deployment-id="<NEXT_PUBLIC_CES_DEPLOYMENT_ID>"
  chat-title="Atelier Concierge"
  token-broker-url="MANAGED"
  theme-id="dark"
  audio-input-mode="NONE"
  audio-output-mode="DISABLED"
></ces-messenger>
```

Once the widget is ready — the `ces-messenger-loaded` event, which the widget
dispatches on **`window`** (not on the element), or immediately if
`setQueryParameters` is already callable at mount — the component calls the
equivalent of:

```js
const sessionId = getDomainSessionId(); // @snowplow/browser-tracker, >= 4.9.0
if (sessionId) {
  document.querySelector("ces-messenger").setQueryParameters({ snowplow_session_id: sessionId });
}
```

`getDomainSessionId()` returns `undefined` for a brand-new visitor (tracker
not yet initialised) or a cookieless one (no `_sp_id` cookie yet); in either
case the component leaves `snowplow_session_id` unset rather than passing an
empty/invalid value, so the agent's degraded-session instructions
(`agent/instructions.md`) apply — the graceful cookieless-fallback criterion.

**Styling**: only the documented attributes (`theme-id`, `chat-title`,
`size`) and a `custom-css` attribute are available for theming per the
`ces-messenger` GitHub docs; no specific CSS custom properties or shadow-DOM
parts for fine-grained theming were found documented anywhere. `theme-id="dark"`
is set to align with the storefront's dark luxury theme (`--background:
#0c0b0c`, `--accent: #b79559` in `storefront/src/app/globals.css`), but
matching the exact palette/typography is a **verify-at-build item for the
human**: inspect the live widget's shadow DOM in a real browser and adjust
via `custom-css` from there.

### 9.5 Verification walkthrough

1. Post-redeploy, confirm `npm run verify:deploy` (§9.3 step 3) passes the
   widget-embed check — this only confirms the script/element are served in
   the HTML, not that the widget renders or functions; that needs a browser.
2. Open the deployed storefront in a real browser, browse a couple of
   products, add one to cart.
3. Open the chat bubble. In devtools, confirm no console errors from the
   widget script and that the token-broker request succeeds.
4. Send a message. Confirm the agent's reply references your real
   browsing/cart behaviour unprompted — same substantive criterion as
   §8.5's live-session pass, now exercised through the real widget instead
   of a manually-set simulator variable.
5. Freshness check: browse a product, then within a few seconds open chat
   and ask about it; confirm the agent's answer reflects that just-viewed
   product rather than stale or absent context.
6. Open the same page in a fresh private/incognito window (no `_sp_id`
   cookie yet) and open chat immediately, before any browsing. Confirm the
   agent gives generic warm concierge behaviour — the cookieless-visitor
   criterion, now exercised end-to-end via the real widget rather than an
   unset simulator variable.
7. Record the result (pass/fail + timestamp) here:
   `<PLACEHOLDER: widget end-to-end verification run log>`.

## 10. Demo script, seeded fallback session, and rehearsal

Covers `.scratch/signals-cx-agent-demo/issues/08-demo-polish-and-recording.md`:
turns the working, human-verified integration (§7–9) into the recorded
webinar deliverable. The demo script and the fallback-session/rehearsal
procedures below are prepared in the repo; **rehearsing, recording,
delivering, and the console allowed-origins cleanup in §10.3 are
human-triggered** — outside this sandbox.

### 10.1 Demo script

`docs/demo-script.md` — scene-by-scene choreography, talking points, and the
"prove it's real-time" beat. Written against the real product catalog
(`storefront/src/data/products.ts`) so the browsing described there is
exactly reproducible against the live deployed site.

### 10.2 Seeded fallback session

Purpose: a known-good `domain_sessionid` with rich, verified attributes,
ready to substitute live during the recording if the pipeline hasn't
propagated attributes in time (Signals ingestion lag, a dropped event, a
flaky trial-org call) — so a hiccup doesn't ruin the take.

**Preparation** (human-runnable; requires the deployed site and, for the
verification step, the `AGENT_SHARED_SECRET` value from §7):

1. Open the deployed storefront in a fresh/incognito browser window (no
   prior `_sp_id` cookie), default demo mode so the debug panel is visible.
2. Run the exact browse sequence from `docs/demo-script.md` Scene 1: view
   the Noir Double-Breasted Blazer, Burgundy Silk Evening Gown, and Camel
   Cashmere Wrap Coat product pages, then add the Camel Cashmere Wrap Coat
   to cart. Using the same sequence as the script means the seeded
   session's attributes match what the script narrates even if it's
   substituted mid-take.
3. Wait ~15 seconds for the pipeline to propagate events into the Profile
   Store, then confirm the debug panel shows a non-empty "Favorite
   designer" (Maison Cendre) and "Favorite category" before continuing.
4. Capture the session's `domain_sessionid` from devtools (Application →
   Cookies → `_sp_id.<hash>`, or the console one-liner):
   ```js
   document.cookie.split("; ").find((c) => c.startsWith("_sp_id.")).split("=")[1].split(".")[5]
   ```
5. Verify retrievability — confirm the agent-facing context endpoint
   actually returns that session's attributes, the same contract the live
   agent calls:
   ```
   curl -s -H "x-agent-api-key: $AGENT_SHARED_SECRET" \
     "https://<deployed-url>/api/agent/context?session_id=<captured-domain_sessionid>"
   ```
   Confirm the response's `profile` is non-empty (e.g. `favorite_designer:
   "Maison Cendre"`) and `recent_activity` lists the product views/cart-add
   just performed. An empty/degraded payload (`{"profile":{},...}`) means
   the seed didn't take — wait longer and re-check, or repeat step 2.

   **Before blaming ingestion lag, check the navigation style.** Issue #7:
   until the fix on `sandcastle/issue-7` is deployed, a product page reached
   by a **full page load** (typing/pasting the URL, a hard refresh, or the
   debug panel's Reset Chat, which reloads by design) never sends
   `product_viewed` — the tracker isn't registered yet, the event is dropped
   silently, and the console still logs success. A session browsed entirely
   that way yields `{"profile":{}}` no matter how long you wait. Until the
   fix is live, seed by starting on the home page or a collection and
   **clicking** through to each product; after it is live, an empty profile
   is once again a real ingestion signal.
6. Record the seeded session id and verification result here so it's
   ready to hand during rehearsal/recording:
   - Seeded `domain_sessionid`: `<PLACEHOLDER: fill in during human prep>`
   - Verification result (pass/fail + timestamp):
     `<PLACEHOLDER: fill in during human prep>`

**Live substitution procedure** (if the pipeline hiccups during rehearsal
or recording): the widget always reads the *real* browser session id via
`getDomainSessionId()` (`storefront/src/components/Widget/CesMessengerWidget.tsx`),
so forcing the seeded id means overriding what's passed to the agent, the
same `setQueryParameters` mechanism §9.1's widget-pin check already
exercises:

```js
document.querySelector("ces-messenger").setQueryParameters({ snowplow_session_id: "<seeded-domain_sessionid>" });
```

Run this in devtools before opening (or continuing) the chat, then proceed
with the scripted conversation as normal — the agent's tool calls now
resolve against the seeded session's known-good attributes instead of the
live one.

### 10.3 Rehearsal checklist

Run through before recording. All console/live steps are human-only.

- [ ] **Remove the temporary `http://localhost:3000` entry** from the
      chat channel's allowed-origins list in the CX Agent Studio console
      (§9.2) — added for local testing only, must not ship in the
      recording or the public webinar.
- [ ] `npm run verify:deploy -- https://<deployed-url>` passes all checks
      (§7 step 4 / §9.3 step 3) against the current deployed URL.
- [ ] Seeded fallback session (§10.2) prepared and verified retrievable
      today, not from a stale prior run — Signals trial-org state and
      agentic-context windows (max 3600s) can go stale between sessions.
- [ ] Fresh/incognito browser window ready, no leftover `_sp_id` cookie
      from earlier testing.
- [ ] Debug panel visible (default demo mode) and showing live values as
      you browse the Scene 1 sequence from `docs/demo-script.md`.
- [ ] Chat widget renders correctly themed, no console errors, "Start
      conversation" succeeds (no Recaptcha-token error — §9.2's toggle).
- [ ] "Reset Chat" control (`SignalsDebugPanel`) confirmed to actually
      start a clean conversation, so retakes don't carry over prior chat
      history.
- [ ] Do at least one full run-through of `docs/demo-script.md` end to end
      with no manual intervention required (no swapping to the fallback
      session, no restarting the widget) before treating the setup as
      recording-ready.

### 10.4 Recording and delivery

Human-only, after rehearsal passes: record the take following
`docs/demo-script.md`, then deliver per marketing's request. Target date:
**Thursday 7 August 2026** (`docs/design.md`, PRD).

## 11. Rich response widgets (product carousel / product details)

Covers `.scratch/signals-cx-agent-demo/issues/11-rich-response-widgets.md`:
polish so the agent's recommendations render as visual product widgets in
chat instead of plain text. The widget-tool Parameters schemas
(`agent/tools/product-carousel.widget.json`,
`agent/tools/product-details.widget.json`), the `image` field added to the
`searchCatalog` tool, and the agent-instructions updates are prepared in
the repo; **creating the two widget tools in the console, attaching them
to the Root agent node, and all live rendering verification below are
human-triggered** — outside this sandbox. Requires the agent from §8 and
the widget embed from §9.

### 11.1 Confirmed against official docs (not guessed)

- **The mechanism exists and is called "rich response widgets."** CX Agent
  Studio's dedicated docs page
  ([docs.cloud.google.com](https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/rich-response-widget))
  confirms: "You can use rich response widgets to create rich, interactive
  UI elements for your user interface," built on **widget tools**,
  referenced in agent instructions with `{@Widget: widget_name}` syntax
  (parallel to this agent's existing `{@TOOL: ...}` references). The page
  notes: "The current implementation of rich response widgets is built on
  widget tools. A future implementation will be stand alone."
- **Widget Type names, confirmed from the widget tools docs page**
  ([docs.cloud.google.com](https://docs.cloud.google.com/gemini-enterprise-cx/cx-agent-studio/tool/widget)):
  `PRODUCT_CAROUSEL` ("Displays a scrollable carousel of products"),
  `PRODUCT_DETAILS` ("Shows detailed information about a single product"),
  plus `QUICK_ACTIONS`, `PRODUCT_COMPARISON`, `ORDER_SUMMARY` (not used by
  this issue). This is exactly the carousel / product-details split the
  issue asks for.
- **The Parameters schema is author-defined ONLY for the `CUSTOM` widget
  type — typed widgets carry a fixed Google contract.** (Corrected
  2026-07-29 against the live console; the earlier reading of the docs'
  generic "Parameters: The input schema for the widget data..." wording
  as author-defined-for-all-types was wrong.) Creating a
  `PRODUCT_CAROUSEL` or `PRODUCT_DETAILS` tool from the console template
  auto-fills a Google-defined schema and the schema editor is
  **read-only** ("Cannot edit in read-only editor"); only a `CUSTOM`
  widget tool offers a writable schema ("You can write your own schema
  here."). The fixed contracts are captured verbatim (via the CES REST
  API `tools` endpoint) in `agent/tools/product-carousel.widget.json`
  and `product-details.widget.json`: the carousel takes a
  `productDetails[]` array (Google's property name, despite belonging to
  the *carousel*) of `{title, subtitle, price (string), productId, uri,
  imageUris[]}`; the details widget takes the same fields flat, plus
  optional `rating`/`review` (always omitted — the catalog has neither).
  The agent instructions map `searchCatalog`'s `CatalogResult` fields
  onto them: `title`←`name`, `subtitle`←`designer`, `price`←`price` as a
  dollar string, `productId`←the `url` slug, `uri`←storefront base URL +
  `url`, `imageUris`←`[image]`. A fixed contract is also the good case
  for rendering: it's the shape a widget-aware messenger build knows how
  to draw natively.

### 11.2 Risk: does the pinned `ces-messenger` render these? (RESOLVED 2026-07-29: NO — see §11.5 log)

Live verification confirmed the risk: `ces-messenger` prints widget
invocations as literal text (the token arrives in-band in the response
text; rendering is a hosted-`chat-messenger` client-side feature). The
original risk analysis below is kept as written — it called the mechanism
correctly — and §11.5's log carries the evidence and the demo-impact
warning. Issue 09's custom-render fallback is the path forward.

This was the reason this issue kept `Checkpoint: human-test-required` and
the acceptance criteria below stayed unchecked rather than assumed:

- Neither rich-response-widget docs page states which web-widget component
  generation renders the output — both just say "your client... presents
  the widget," matching the generic "web widget deployment option."
- Issue 07 (`docs/runbook.md` §9.1) already pinned this repo to the
  **open-source `ces-messenger`** component specifically because it's the
  only one documenting `setQueryParameters()`, the mechanism the entire
  "browse → chat already knows" demo depends on. The **hosted
  `chat-messenger`** build (Google's console-generated embed snippet,
  loaded from a different gstatic path) does *not* document that method.
- A Google developer-forum thread cited in that same section
  ([discuss.google.dev](https://discuss.google.dev/t/hosted-versus-open-source-ces-messenger-web-component/334696))
  states, in a Feb–Mar 2026 exchange with a Google representative: the
  hosted build ships "a few other Rich Message Templates (fex. the Product
  Carousel) that are not available on Github" (i.e. not in the open-source
  `ces-messenger` repo), and "the hosted CES Messenger script and the
  open-source GitHub component are not necessarily kept fully in sync." As
  of that thread there was no confirmation that these built-in widgets had
  reached, or would reach, the open-source library. The open-source
  repo's own rich-message docs
  (`ces-messenger` GitHub, `doc/message_templates.md`) describe a
  Handlebars-based custom-template system with generic built-ins (buttons,
  lists, forms) and do not mention `PRODUCT_CAROUSEL`, `PRODUCT_DETAILS`,
  "widget tools," or CX Agent Studio's rich-response-widget feature at
  all — suggesting these are two different rendering mechanisms that may
  not be the same feature, and the forum's "Product Carousel" gap may
  apply directly to what this issue needs.
- **Net finding**: the specific rich message template named "Product
  Carousel" is documented as hosted-`chat-messenger`-only as of that
  thread (five months stale relative to this build; no newer public source
  confirming or denying parity was found). This repo cannot switch to
  `chat-messenger` without losing `setQueryParameters` (breaking the
  session-context mechanism issues 06/07 depend on), and this sandbox has
  no browser/console access to test rendering directly. **This is a
  genuine, undecided compatibility question, not a guessed field name** —
  it can only be resolved by the human running §11.5 below against the
  live deployment.
- If §11.5 shows the widgets don't render on `ces-messenger` (raw JSON,
  plain text, or a console/widget error instead of a card), treat this
  issue as **not shippable as specified** for the carousel/details visual
  criteria below, and feed the finding back into
  `.scratch/signals-cx-agent-demo/issues/09-product-cards-stretch.md`
  (already kept open pending this finding, not closed `wontfix`) — 09's
  `registerClientSideFunction` custom-render path becomes the fallback.

### 11.3 Create the two widget tools (console)

1. In CX Agent Studio, on the agent from §8, open the rich response
   widgets builder (rich response widgets icon in the agent builder, per
   §11.1's citation).
2. Create a widget tool named `productCarousel` from the
   `PRODUCT_CAROUSEL` template. **Do not attempt to edit the Parameters
   schema** — for typed widgets the console auto-fills Google's fixed
   contract and the editor is read-only (§11.1). Verify it matches the
   captured copy in `agent/tools/product-carousel.widget.json`; a
   mismatch means Google changed the contract — re-capture the schema
   (CES REST `GET .../apps/<app_id>/tools`) and update the repo file and
   the instruction mapping instead of fighting the console.
3. Create a second widget tool named `productDetails` from the
   `PRODUCT_DETAILS` template — same deal: accept the fixed schema,
   verify against `agent/tools/product-details.widget.json`.
4. Attach both to the Root agent node (same **+** affordance used for the
   OpenAPI tools in §8.3) — watch for the same detachment gotcha noted in
   Troubleshooting for the OpenAPI tools if you re-import anything later.
5. Re-paste `agent/instructions.console.txt` into the Root agent node's
   instructions field (it now includes constraint 5, Rich Response
   Widgets, and the updated taskflow step referencing
   `{@Widget: productCarousel}` / `{@Widget: productDetails}`) — use the
   editor's `@` picker to (re-)resolve the `{@Widget: ...}` references if
   the console flags them as unresolved, same as the `{@TOOL: ...}`
   guidance in §8.2.

### 11.4 Styling against the luxury theme

No documented CSS custom properties or shadow-DOM parts specific to rich
response widgets were found in any source checked (mirroring the same gap
noted for the base widget chrome in §9.4) — the `custom-css` attribute
already set in `CesMessengerWidget.tsx` is the only confirmed hook. This is
a **verify-at-build item for the human**: once §11.3 is done and a widget
actually renders (contingent on §11.2), inspect it in the live browser's
shadow DOM and extend `WIDGET_CUSTOM_CSS` in
`storefront/src/components/Widget/CesMessengerWidget.tsx` if any
widget-specific selectors are found; otherwise the carousel/details card
renders with whatever default styling `ces-messenger` ships, which may or
may not read as "acceptable" against the dark luxury palette (`--accent:
#b79559` etc.) without further work.

**Resolved 2026-07-30:** moot in the end — `ces-messenger` never renders
these widgets itself (§11.5), so the cards are drawn by the storefront's
own renderer with inline styles that inherit the palette's custom
properties. Checked on production: no clashing default styling, no
`WIDGET_CUSTOM_CSS` change required.

### 11.5 Verification walkthrough

1. Confirm §11.3's two widget tools show up correctly in a simulator turn
   before testing live: ask for "a couple of accessories to go with an
   evening look" and confirm the trace shows a `productCarousel` widget
   call with real catalog data (not model-invented fields).
2. On the deployed site (real browser, real widget): browse a category
   with 2+ products, open chat, and ask for recommendations from that
   category. **Expected:** the reply renders as an actual visual carousel
   card (image, name, designer, price, clickable link), not raw JSON or
   plain text. **If it renders as plain text/JSON instead**: this is the
   §11.2 risk materializing — record it as a finding in this section and
   in issue 09, rather than retrying.
3. Ask about one specific product by name. **Expected:** the reply renders
   as a single product-details card with a working link back into the
   storefront (clicking it lands on that product's page).
4. Click the link in a rendered carousel item. **Expected:** navigates to
   the correct `/products/<slug>` page on the deployed storefront (proves
   the `uri` = base URL + `searchCatalog`'s `url` construction is
   correct end-to-end).
5. Ask a question that would normally trigger a recommendation, but for a
   filter combination with zero catalog matches (e.g. an out-of-stock
   combination). **Expected:** the agent falls back to a plain-text
   response (or broadens the search per the existing grounding
   instructions) — no widget rendered with invented data, no error talk.
6. Visually compare the rendered widget(s) against the storefront's dark
   luxury palette. Note any clashing default styling (e.g. the same
   Vue-green default noted for buttons in §9.4) for a `custom-css` fix.
7. Record the result (pass/fail + timestamp, and the §11.2 finding either
   way) here:

   **Verification run, 2026-07-29 ~15:10 UTC (Playwright walkthrough
   against the deployed storefront + live agent, new deployment version
   `a8c48c30…` published minutes earlier): FAIL on rendering — the §11.2
   risk is CONFIRMED.**

   - **Agent side: fully correct.** Both queries behaved exactly as
     instructed. Accessories query → grounded prose plus a
     `productCarousel` invocation whose `productDetails[]` payload
     carried three real catalog items *from the live session's own
     browsing* (Silk Twill Square Scarf $340 / Atelier Lune,
     Hammered Gold Cuff Bracelet $680 / Arc Studio, Felt Cloche Hat
     $410 / Arc Studio), every field matching the fixed schema —
     `title`, `subtitle`, dollar-string `price`, slug `productId`,
     absolute `uri`, single-element `imageUris`. Single-product query →
     equivalent correct `productDetails` invocation. (One benign quirk:
     the model appends a `summary:` argument that isn't in the schema.)
   - **Rendering: the pinned open-source `ces-messenger` printed the
     entire `{@Widget: productCarousel(payload: …)}` token as literal
     text inside the chat bubble.** No carousel, no card, no console
     error — and visibly *worse* than plain text for a shopper.
   - **Wire-format root cause (decisive for the fallback):** the
     `runSession` response delivers the widget invocation **in-band in
     `outputs[].text`** — there is no structured widget/richContent
     field in the payload at all. So the token→card transformation is
     purely a client-side text-parsing feature of the hosted
     `chat-messenger`, absent from the open-source component. This also
     means issue 09's custom-render fallback is *feasible without any
     agent-side change*: parse the `{@Widget: name(payload: {…})}`
     token out of the message text, render a custom card, suppress the
     raw string (note the payload uses unquoted JS-object keys, not
     strict JSON).
   - Steps 4–6 (link click-through, zero-result degradation, styling)
     were not reachable — nothing rendered to click or style.
   - **Demo impact: the live agent now emits raw widget tokens in chat.**
     Until either issue 09's client-side renderer exists or the console
     instructions are reverted to the pre-widget text-only version (and
     the widget tools detached + a new version published), live
     conversations look broken. Do not record the demo in this state.

   **Addendum, 2026-07-29 ~15:45 UTC (issue 09 renderer, local dev):**
   further live turns showed the wire format is **bimodal** — the same
   agent/version sometimes ships the widget as (1) the in-band text token
   above, and sometimes as (2) a **structured `outputs[].payload`** with a
   `type` discriminator (`product_detail_carousel` for the carousel,
   `base_product_detail` for the details widget) and **no text output at
   all** — which stock `ces-messenger` drops as a completely **blank
   reply** (arguably worse than the raw token). Issue 09's renderer
   (`sandcastle/09-widget-token-renderer`, storefront-side) handles both:
   mode 1 via a shadow-DOM observer that swaps complete tokens for cards,
   mode 2 via the component's own extension surface (`payload-received`
   hook rewriting the payload onto a registered card template, plus
   `registerRichMessageHandler` for clicks). Verified live against
   localhost with the widget-enabled agent: carousel and details cards
   render with image/designer/title/price, card clicks route through the
   SPA router (conversation preserved — a full page load would remount
   the widget), and cards re-render from restored session history after a
   reload. One more model quirk for the record: a structured details
   payload arrived with **invented** `rating`/`review` values (4.5 stars,
   12 reviews, a nonexistent `/reviews` URL) despite instructions to omit
   them — the renderer discards both fields unconditionally.

   **Verification run, 2026-07-30 ~10:40–10:55 UTC (Playwright walkthrough
   against the deployed storefront + live widget-enabled agent, with the
   merged renderer live in production): PASS on steps 2–6.** Re-run of the
   2026-07-29 FAIL above; the §11.2 risk is now neutralised client-side
   rather than resolved upstream.

   - **Deployment precondition confirmed first:** the production bundle
     carries the renderer — `/_next/static/chunks/3f112757ff33e01b.js`
     contains `@Widget:`, `data-widget-card`, `payload-received`,
     `registerTemplate`, `registerRichMessageHandler` and the
     `product_detail` type check.
   - **Step 2 (multi-product recommendation): PASS.** Carousels rendered
     with image, designer, name, price and a working link per card — e.g.
     Satin Evening Pouch $760 / Atelier Lune + Patent Slingback Heel $860
     / Arc Studio + Quilted Chain Shoulder Bag $1,120 / Arc Studio, and a
     winter set (Camel Cashmere Wrap Coat $2,380, Chunky Mohair Pullover
     $720, Suede Chelsea Ankle Boot $780). Every item was a real catalog
     product, grounded in that session's own browsing. Agent-side quirk
     worth knowing for the demo: a *"couple of accessories"* phrasing came
     back as prose promising a selection plus a **single** details card —
     a composition choice by the model, not a rendering fault; follow-up
     asks ("what else would work with that?") produced carousels.
   - **Step 3 (single named product): PASS.** Details cards rendered for
     Sculpted Silver Cuff Watch $980 / Arc Studio and Noir
     Double-Breasted Blazer $1,480 / Maison Cendre.
   - **Step 4 (card click): PASS.** A carousel item click landed on
     `/products/chunky-mohair-pullover`; a details-card click landed on
     `/products/noir-double-breasted-blazer`. Both navigated **via the SPA
     router** — an in-page probe variable survived the navigation (so no
     full page load), the chat panel stayed open, and all prior messages
     and rendered cards were still present afterwards.
   - **Step 5 (zero-match query): PASS.** *"Do you have any neon orange
     swimwear under $15?"* → plain-text reply stating the catalog has no
     such item plus an offer to broaden. No widget, no invented product,
     no error talk.
   - **Step 6 (styling): PASS, no `custom-css` work needed.** Cards read as
     part of the dark luxury palette — panel-dark card background,
     uppercase muted designer line, `--accent` (#b79559) price, image
     flush at the card top, carousel as a horizontal rail. None of the
     Vue-green default noted in §9.4 appears anywhere on the cards.
   - **No console errors or warnings** across both sessions (117 console
     lines captured, zero error/warn).
   - **Delivery mode: all 8 live widget turns arrived as structured
     `outputs[].payload`** (console mark *"Rewrote widget payload to
     rich-message template"*; response bodies carrying
     `product_detail_carousel` / `base_product_detail`). The in-band
     `{@Widget: …}` token mode **did not occur live in this run**. Since a
     single-mode pass proves only one path, the token path was exercised
     against the *deployed* bundle directly: injecting the verbatim
     2026-07-29 live token into the widget's shadow-DOM message list made
     the observer swap it for a two-card carousel (correct title,
     designer, price, `uri`) and suppress the raw token (console mark
     *"Rendered rich-response widget token(s) in chat"*). That is a
     **synthetic injection, not an agent-emitted token** — the live-agent
     token mode remains unobserved in production since the renderer
     shipped, and would only matter if the model reverted to it mid-demo,
     which this probe shows the deployed code handles.
   - Evidence: `.scratch/signals-cx-agent-demo/widget-renderer-{carousel,
     details,carousel-click,tokenmode-probe}-prod-20260730.png`.

### 11.6 Current state: renderer live in production (revert kept as fallback)

Resolved 2026-07-30: **the renderer path won; no console revert.** The
client-side renderer is merged to `main` (`eca007c`), deployed to the
production storefront, and the §11.5 walkthrough re-run against
production passed steps 2–6 (see the 2026-07-30 entry above). The live
console agent keeps its widget-enabled instructions, and the widget
moment ships in the demo.

The two instruction variants still live side by side in the repo:

- `agent/instructions.console.widgets.txt` — the widget-enabled variant,
  **what the live agent runs**, and what `terraform/agent.tf` references
  (byte-identical to the live instructions as of 2026-07-29).
- `agent/instructions.console.txt` — the **text-only** version, kept only
  as the revert target below. If the revert is ever performed,
  Terraform's instruction reference must be swapped to track it, since
  that file has to keep mirroring whatever is actually live.

**Fallback only:** the procedures below are now contingency, not plan.
Reach for the revert if widgets regress before the recording (e.g. the
model starts emitting a shape the renderer can't draw, or the deployed
storefront has to be rolled back to a pre-`eca007c` build, which would
put the live agent back in the state where it emits widgets nothing
renders).

**Revert procedure (console):**

1. Root agent node → Instructions → paste the full contents of
   `agent/instructions.console.txt` (re-resolve any flagged `{@TOOL: …}`
   references with the `@` picker, per §8.2).
2. Detach `productCarousel` and `productDetails` from the Root agent node
   (leave the widget *tools* in place in the app — only the attachment
   goes; re-enabling is then a re-attach, not a re-create).
3. Publish a new deployment version and confirm a live chat recommendation
   comes back as clean prose with no `{@Widget:` text.

**Re-enable procedure (undo a revert — the renderer is already verified):**

1. Re-attach both widget tools to the Root agent node.
2. Paste `agent/instructions.console.widgets.txt` into the Root agent
   node's instructions (re-resolve `{@TOOL: …}`/`{@Widget: …}` refs).
3. Publish a new version and re-run the §11.5 walkthrough end-to-end —
   this time expecting the storefront's own renderer (not
   `ces-messenger`) to draw the cards.
4. Swap the contents of `agent/instructions.console.txt` and update
   Terraform state/plan accordingly (the file must keep mirroring live).

## 12. Terraform: codify, import, and re-apply

Covers `.scratch/signals-cx-agent-demo/issues/10-terraform-agent-config.md`:
backs the console-built app/agent/toolsets/deployment from §8–9 with
Terraform (`terraform/`, `google_ces_*` resources,
`docs/research/cx-agent-studio-terraform.md`), so the demo survives console
drift and can be re-created after the trial expires. The `.tf` files, the
`agent/instructions.md`/`agent/tools/*.openapi.yaml` references, and the
ownership-boundary documentation are prepared in the repo (see
`terraform/README.md`); **everything below that touches the live project —
import, `terraform plan`, the `apps.exportApp` snapshot call, and applying
labels to the live project — is human-triggered**, outside this sandbox.
Requires the console-built resources from §8 and §9 to already exist.

### 12.1 Ownership boundary

See `terraform/README.md` for the full breakdown. Summary: Terraform owns
the app, root agent (instructions from file), the app/root-agent
association, both OpenAPI toolsets (schemas from file), the app version,
the web-widget deployment's public-access settings, and a labelled Secret
Manager secret for the shared API key. Stays manual permanently: Gemini
Enterprise for CX enablement/licensing/allowlisting, and
`google_ces_security_settings` (beta-provider-only — this repo pins the GA
`google` provider). Neither `google_ces_app` nor `google_ces_agent` exposes
a `labels` field, so the baseline tagging policy
(`system=signals-gecx-demo`, `snowplow-owner=cc017`, `environment=dev`)
reaches only the Secret Manager secret Terraform introduces; project-level
labels are applied out-of-band (12.6).

### 12.2 Finding the real resource IDs

Every ID below is a required `terraform/variables.tf` input with no
default — fill in `terraform/terraform.tfvars` (gitignored; copy from
`terraform/terraform.tfvars.example`) before running anything.

| Variable | Where to find it |
|---|---|
| `project_id` | Snowplow-managed sandbox GCP project ID (IAM & Admin → Settings) |
| `location` | The app's resource-name location segment — console URL when viewing the app, or the `name` field in an `apps.exportApp` response (12.5) |
| `app_id` | Console → app settings, or the `name` field's `apps/{app_id}` segment |
| `agent_id` | Console → Root Agent node settings, or the agent's resource name |
| `context_toolset_id` | Console → the `getUserContext` toolset's settings |
| `catalog_toolset_id` | Console → the `searchCatalog` toolset's settings |
| `app_version_id` | The version currently pinned to the live deployment's channel — console → deployment → pinned Agent Version (see §9's note that the channel serves a version snapshot, not the draft) |
| `deployment_display_name` | Console → the web-widget deployment's display name |
| `app_display_name` | Console → the app's display name (whatever was chosen at §8.2 creation; not prescribed) |
| `model_name` | Console → the **app's** model settings — the console sets model/temperature at the app level and the root agent inherits them (confirmed live 2026-07-29: the agent resource carries no `modelSettings`). Read the live value, don't guess |

Everything above is also discoverable without console access via the CES
REST API using ADC credentials (`gcloud auth application-default
print-access-token`), e.g. `GET
https://ces.googleapis.com/v1/projects/<project>/locations/<location>/apps/<app_id>`
and its `/agents`, `/toolsets`, `/versions`, `/deployments` children — the
2026-07-29 discovery run used this path when the gcloud CLI token had gone
stale but ADC still worked.

`terraform/secrets.tf`'s `agent_shared_secret_id`/`agent_shared_secret_value`
are a separate decision — see 12.4 before importing anything toolset-related.

### 12.3 Import sequence

From `terraform/`, with `terraform.tfvars` filled in and
`terraform init` run once:

```
PROJECT_ID=<project_id>
LOCATION=<location>
APP_ID=<app_id>
AGENT_ID=<agent_id>
CONTEXT_TOOLSET_ID=<context_toolset_id>
CATALOG_TOOLSET_ID=<catalog_toolset_id>
APP_VERSION_ID=<app_version_id>
DEPLOYMENT_ID=<deployment_id, from NEXT_PUBLIC_CES_DEPLOYMENT_ID's final path segment>

terraform import google_ces_app.this \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}"

terraform import google_ces_toolset.context \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/toolsets/${CONTEXT_TOOLSET_ID}"

terraform import google_ces_toolset.catalog \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/toolsets/${CATALOG_TOOLSET_ID}"

terraform import google_ces_agent.root \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/agents/${AGENT_ID}"

terraform import google_ces_app_root_agent_association.this \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/agents/${AGENT_ID}"

terraform import google_ces_app_version.current \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/versions/${APP_VERSION_ID}"

terraform import google_ces_deployment.web_widget \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/deployments/${DEPLOYMENT_ID}"

# Widget tools (issue 09). Their UUIDs appear in the agent's `tools` list
# (REST GET on the agent, or console → root agent → tools).
PRODUCT_DETAILS_TOOL_ID=<product_details_tool_id>
PRODUCT_CAROUSEL_TOOL_ID=<product_carousel_tool_id>

terraform import google_ces_tool.product_details \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/tools/${PRODUCT_DETAILS_TOOL_ID}"

terraform import google_ces_tool.product_carousel \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/tools/${PRODUCT_CAROUSEL_TOOL_ID}"
```

Import the shared secret too. The 2026-07-29 run resolved the
`terraform/README.md` "Secret reconciliation" decision in favour of
importing: the console-era secret
(`signals-agent-studio-agent-shared-secret`) turned out to already carry
the full baseline label set and the CES service-agent IAM grant, and its
payload matched the deployed `AGENT_SHARED_SECRET` — so Terraform adopts
it rather than creating a duplicate. Set `agent_shared_secret_id` to the
live secret's ID in `terraform.tfvars`, then:

```
SECRET_ID=<the secret backing the console tools' API-key auth>
SECRET_VERSION=<its live version number, e.g. 1>

terraform import google_secret_manager_secret.agent_shared_secret \
  "projects/${PROJECT_ID}/secrets/${SECRET_ID}"

terraform import google_secret_manager_secret_version.agent_shared_secret \
  "projects/${PROJECT_ID}/secrets/${SECRET_ID}/versions/${SECRET_VERSION}"

terraform import google_secret_manager_secret_iam_member.ces_service_agent_accessor \
  "projects/${PROJECT_ID}/secrets/${SECRET_ID} roles/secretmanager.secretAccessor serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-ces.iam.gserviceaccount.com"
```

Find the secret's ID in the live toolsets' `apiKeyConfig.apiKeySecretVersion`
(console or REST), its version numbers via
`https://secretmanager.googleapis.com/v1/projects/<project>/secrets/<secret>/versions`,
and the project number for the IAM member via `gcloud projects describe`
or the app's REST payload.

**Provider import gap (google provider v7.41.0):** `terraform import`
leaves the create-only, ForceNew ID fields (`app_id` on the app,
`agent_id` on the agent, `app_version_id` on the version) null in state,
so a naive first plan wants to **destroy and recreate** all three. The
config works around this with `lifecycle.ignore_changes` on those fields
(see `terraform/app.tf`, `agent.tf`, `deployment.tf`) and by having child
resources reference `google_ces_app.this.name` (populated by import)
rather than `.app_id` (null). If a plan ever shows `must be replaced` on
these resources, check those guards before touching anything live.

Import run log, 2026-07-29: all 7 CES imports + the 3 Secret Manager
imports above succeeded first try against
`projects/engineering-sandbox/locations/us/apps/83a964e4-…0024`. Later
the same day, the QA plan surfaced the issue 09 widget work (console-built
`productDetails`/`productCarousel` tools, 14:46Z) as drift; both were
imported as `google_ces_tool.*` — 12 imports total.

### 12.4 Confirm a clean plan

```
TF_VAR_agent_shared_secret_value=<the live AGENT_SHARED_SECRET value> \
  terraform plan
```

**Expected result:** no changes, or only the accepted secret-reconciliation
diff from `terraform/README.md` if the fresh-secret path was chosen. Any
other diff means a variable value or a `.tf` argument doesn't match live
state — reconcile before treating this config as authoritative.

Verification run, 2026-07-29: `Plan: 0 to add, 9 to change, 0 to destroy`,
where every remaining "change" is a documented provider/import artifact,
not config↔live drift (see `terraform/README.md` "Known plan diffs after
import"): `deletion_policy DELETE → PREVENT` on all seven `google_ces_*`
resources (provider-side virtual field; import defaults it to DELETE),
the deployment's `app_version` being backfilled with exactly the live
value (import leaves it null in state), and the secret's `labels` map
being backfilled (import puts live labels in `effective_labels` only —
the live values already matched the baseline set). The secret *version*
showed an update with zero changed fields, and comparing the plan JSON
confirmed `secret_data` in live state equals the `TF_VAR` value — i.e.
the console secret's payload is byte-identical to the deployed
`AGENT_SHARED_SECRET`. Reaching this required reconciling the `.tf`
sources to live console reality first: model settings moved from the
agent to the app (where the console actually stores them), agent
instruction repointed at `agent/instructions.console.txt` (the format
the live agent runs, per §8.2), display names/descriptions aligned with
console values, `tool_ids` and the built-in `end_session` tool declared
on the agent, and the toolsets' `api_key_secret_version` built as the
console's `…/versions/latest` alias (a version-resource reference can
only render a pinned `versions/N`).

Second verification run, 2026-07-29 (QA pass): the plan surfaced real
drift — the issue 09 widget work had updated the live agent after the
first reconcile (instruction gained the widget constraints; two
console-built widget tools attached). Reconciled by repointing the agent
instruction at `agent/instructions.console.widgets.txt` (verified
byte-identical to live) and adopting both widget tools as
`google_ces_tool` resources (`terraform/tools.tf`, parameter schemas
mirrored from live). Final plan: `Plan: 0 to add, 11 to change, 0 to
destroy` — same artifact classes as above, now with `deletion_policy`
on nine `google_ces_*` resources. Lesson for future QA passes: any
console change to the agent (instructions, tools, widgets) lands as
plan drift; reconcile config to live, never the reverse, when the live
behaviour is the verified one.

Belt-and-braces drift/backup artefact, independent of the Terraform state.
Host confirmed live 2026-07-29: `https://ces.googleapis.com`. Two things
the API reference's shape implies but are easy to miss:

1. `:exportApp` returns a **long-running operation**, not the export —
   poll `GET /v1/projects/${PROJECT_ID}/locations/${LOCATION}/operations/<op>`
   until `"done": true`.
2. The finished operation's `response.appContent` is a **base64-encoded
   ZIP**, not JSON, regardless of `"exportFormat": "JSON"` — the zip holds
   per-resource JSON/YAML/text files (`app.json`, `agents/…/instruction.txt`,
   `toolsets/…/open_api_schema.yaml`, `environment.json`, guardrails).

```
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
  -H "Content-Type: application/json" \
  "https://ces.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}:exportApp" \
  -d '{"exportFormat": "JSON"}'
# poll the returned operation name until done, then decode:
#   response.appContent | base64 -d > export.zip
```

Extract the zip into a dated directory under `agent/export/` (pretty-print
the JSON members for stable diffs) and commit it — same treatment as
`agent/instructions.console.txt`: a checked-in snapshot of live console
state, not something the app reads at runtime.

Capture log, 2026-07-29: snapshot committed at
`agent/export/app-export-20260729/`. Drift check against the repo sources:
the exported `instruction.txt` is byte-identical to
`agent/instructions.console.txt`, and both exported OpenAPI schemas match
`agent/tools/*.openapi.yaml` except that the export substitutes the server
`url` with the literal `$env_var`, externalizing the real URL (and the
tools' secret references) into `environment.json` — an export-format
artifact, not drift (`terraform plan` showed no schema diff). Checked the
extracted files for the shared-secret value before committing: not present.

### 12.6 Tagging: apply at the project level

`google_ces_app`/`google_ces_agent` have no `labels` field (12.1), so the
baseline policy would have to be applied directly to the project, not
through Terraform:

```
gcloud projects update "${PROJECT_ID}" \
  --update-labels=system=signals-gecx-demo,snowplow-owner=cc017,environment=dev
```

**Do not run this against `engineering-sandbox`.** Checked live 2026-07-29:
the demo lives in a *shared* sandbox project ("Snowplow Development Env")
that already carries org-managed labels (`team=engineering`,
`cost-allocation=r-d`, `service_type=engineering_sandbox`, …) and hosts
other teams' workloads — stamping this demo's `system`/`snowplow-owner`
labels on the whole project would mislabel everyone's resources. This
section's assumption of a dedicated project only holds after a §12.7
re-create into one. As deployed, the baseline label set reaches the one
labellable resource the config manages — the Secret Manager secret, whose
live labels were confirmed compliant (`system=signals-gecx-demo`,
`snowplow-owner=cc017`, `environment=dev`) — and project-level labelling
is deliberately skipped.

### 12.7 Re-apply after trial expiry / re-publish a change

1. Re-run §1–9 against the fresh trial org/project to get new console-built
   resources (Terraform doesn't create these greenfield — see
   `terraform/README.md`; it manages what already exists).
2. Update `terraform.tfvars` with the new project/app/agent/toolset/version/
   deployment IDs, re-run 12.3–12.4 against the new project.
3. **For a content-only change** (e.g. edited `agent/instructions.md`) on an
   already-imported project: don't edit `google_ces_app_version.current` in
   place — app versions are immutable. Add a new
   `google_ces_app_version` resource with a new `app_version_id`, point
   `google_ces_deployment.web_widget.app_version` at it, `apply`, then
   remove the old version resource once the deployment's cutover is
   confirmed in the console.
## Troubleshooting

- **First `terraform plan` after §10.3 import wants to destroy and
  recreate the app/agent/app version** — the google provider (v7.41.0)
  import leaves the create-only ForceNew ID fields (`app_id`, `agent_id`,
  `app_version_id`) null in state, and null → value on a ForceNew field
  reads as a replacement. The config guards against this with
  `lifecycle.ignore_changes` on those fields and by referencing
  `google_ces_app.this.name` (populated) instead of `.app_id` (null) from
  child resources; if replacements still appear, one of those guards has
  been removed. Never apply a plan showing `must be replaced` on live
  demo resources.
- **`terraform plan` after import shows `deletion_policy = "DELETE" ->
  "PREVENT"` on every `google_ces_*` resource** — expected: it's a
  provider-side virtual field (no API call behind it) that import
  defaults to `DELETE` while `terraform/locals.tf` pins `PREVENT`. It
  clears on first apply and is an accepted diff for the §10.4 check.
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
- **CX Agent Studio tool test returns 401** — the API-key header name isn't
  exactly `x-agent-api-key`, or the key value doesn't match the deployed
  `AGENT_SHARED_SECRET` (§7's Vercel value, not a local one).
- **Tool test fails with "Failed to get secret ... please check that the
  service account has the Secret Manager Secret Accessor role"** — the
  Customer Engagement Suite service agent can't read the secret backing
  the tool's API key. Grant it on that one secret (project *number*, not
  ID, in the member):
  ```
  gcloud secrets add-iam-policy-binding <secret-name> \
    --project=<project-id> \
    --member="serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-ces.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
  ```
- **Agent reasons about calling a tool but the trace shows `end_session`
  with placeholder args, then the conversation silently ends** — the
  OpenAPI tools are no longer attached to the Root agent node (re-importing
  a tool schema can detach them, leaving only the built-in `end_session`).
  On the agent canvas, re-attach `getUserContext` and `searchCatalog` via
  the node's **+**; if the re-import created duplicate tool entries, attach
  the copy whose schema carries the `x-ces-session-context` line and delete
  the orphan.
- **Tool tester returns the blank/degraded payload despite a session id in
  the test input** — the tester only feeds model-produced parameters; with
  `x-ces-session-context` present, `session_id` is context-injected and the
  tester has no conversation context, so the request goes out without it.
  Test injection in the simulator instead, presetting the variable via its
  "Set a default value at the start of the conversation" option (untick it
  once verified — in production the widget populates the variable, and a
  leftover default masks broken widget wiring).
- **Simulator shows the agent asking the shopper who they are / to repeat
  browsing** — the session-context variable binding from §8.4 isn't
  reaching the tool; check the tool's request trace in the console for an
  empty `session_id`. Confirm the console copy of the schema carries the
  `x-ces-session-context: $context.variables.snowplow_session_id` line and
  that the `snowplow_session_id` variable is declared on the agent and set
  for the session.
- **CX Agent Studio isn't offered / agent creation fails in the sandbox
  project** — check the project's region and enabled-API list (§8.1);
  this was flagged as a verify-at-build availability risk before the
  agent existed.
- **Widget renders but the chat never connects / token-broker errors in the
  console** — check that §9.2's origin-check config includes the deployed
  storefront's exact origin in `allowed_origins`.
- **Real widget never delivers the session id (agent asks who you are even
  after browsing, though §8's simulator pass worked)** — check the Network
  tab for which script actually loaded; confirm it's
  `ces-messenger.js`, not the gstatic `chat-messenger` build (§9.1). If the
  console's own embed-snippet affordance was copy-pasted instead of the
  markup in §9.4, it may have emitted the wrong widget generation.
- **`verify:deploy`'s widget-embed check fails post-deploy** — confirms the
  `<ces-messenger>` element or its script isn't in the served HTML; check
  `NEXT_PUBLIC_CES_DEPLOYMENT_ID` is set in the Vercel environment (§9.3)
  and that the deploy actually picked it up (the component renders nothing
  when that var is unset, by design).
- **Widget loads and authorizes but no chat bubble is visible** — check for
  another `position: fixed` element occupying the bottom-right corner. The
  launcher pins itself bottom-right via the widget's own shadow-DOM styles
  (host-element classes don't move it); anything later in the DOM at the
  same corner and z-index paints over it. This is why `SignalsDebugPanel`
  sits bottom-*left*. Diagnose with
  `document.querySelector("ces-messenger").shadowRoot` (launcher present?)
  vs `document.elementFromPoint(...)` at the corner (who's on top?).
- **"Start conversation" fails; console shows `No token received from token
  broker` with `400 INVALID_ARGUMENT: "Recaptcha token is missing."`** —
  the channel's Recaptcha toggle is on. Turn it off (§9.2); `ces-messenger`
  cannot mint reCAPTCHA tokens. Takes effect without a redeploy.
- **Agent replies with spoken audio / mic prompt appears despite the
  channel's "Interaction type: Text"** — that console setting doesn't reach
  a hand-authored embed; the component itself defaults to
  `audio-output-mode="ALWAYS_ON"` and `audio-input-mode="DEFAULT_ON"`. The
  embed in §9.4 (and `CesMessengerWidget.tsx`) pins both off
  (`NONE`/`DISABLED`) for the text-only demo.
- **Agent describes a different user's journey (wrong cart/browsing)** —
  the agent is not receiving your real session id, and is reading whatever
  the `snowplow_session_id` variable falls back to. Check three things in
  order: (1) the browser console must log `[Signals Demo] Passed
  domain_sessionid to ces-messenger` — if missing, `setQueryParameters` was
  never called (the loaded event fires on `window`, not the element; fixed
  in `CesMessengerWidget.tsx`, and the §9.5 pin-check isolates this); (2)
  the agent variable must have **no default value** in CX Agent Studio — a
  default silently masks a missing session id with another session's data;
  (3) the channel's pinned **Agent Version** must postdate any console
  edits — the channel serves a version snapshot, not the draft, so removing
  a default (or any agent edit) only reaches the widget after you add a new
  version and point the channel at it. The simulator tests the draft, the
  widget tests the pinned version — they can disagree.
- **Chat history survives refresh / no way to start a new conversation** —
  intended widget behaviour: the conversation lives in per-tab session
  storage and "Start conversation" reconnects to it. The component's reset
  is `clearStorage()`; the demo panel's **Reset Chat** button wraps
  `endSession()` + `clearStorage()` + reload for a clean take between
  rehearsals. A new tab or incognito window is also always fresh.
- **Widget buttons render Vue-green instead of the theme accent** — the
  shadow styles default `--host-primary-color` to `#42b883`; the embed sets
  that variable to the site's `--accent` on the host element, and the
  `custom-css` attribute is the hook for any further shadow-DOM styling.
- **Agent recommends products but the reply is plain text / raw JSON
  instead of a carousel or product card** — this is the §11.2 risk: the
  pinned `ces-messenger` component may not implement the specific rich
  message templates CX Agent Studio's widget-tool feature relies on (a
  Google forum thread documents this gap for the hosted vs. open-source
  builds, unresolved as of that thread). Confirm the widget tools are
  actually attached to the Root agent node (§11.3 step 4, same detachment
  gotcha as the OpenAPI tools) before concluding it's this risk rather than
  a wiring mistake. If confirmed, record the finding in
  `docs/runbook.md` §11.2/§11.5 and in issue
  `09-product-cards-stretch.md`, and fall back to that issue's
  `registerClientSideFunction` approach.
- **Widget tool call shows in the trace but the console flags `{@Widget:
  ...}` as unresolved in the instructions editor** — same fix as the
  `{@TOOL: ...}` case (§8.2): delete the reference and re-insert it with
  the editor's `@` picker rather than hand-typing.
- **Carousel/details card renders but the product link 404s or points at
  the wrong product** — check the widget's `uri` field was built as the
  deployed base URL literally prefixed to `searchCatalog`'s `url` field
  (§11.1); a common mistake is the model using the site-relative `url`
  value alone, which won't navigate correctly from inside the chat widget.
- **`terraform plan` shows a diff on the toolsets' `api_authentication`
  after import** — expected if the fresh-secret path in `terraform/README.md`
  ("Secret reconciliation") was chosen instead of importing the console's
  hidden secret; clears after applying and re-pointing both tools' console
  auth config at the new Secret Manager secret version.
- **`terraform apply` on `google_ces_app` 400s with a model-availability
  error** — check provider issue
  [#26231](https://github.com/hashicorp/terraform-provider-google/issues/26231)
  (open as of 2026-07-28): `gemini-3-flash` + `temperature` in the `us`
  location. After the 2026-07-29 reconciliation this config sets
  `model_settings` on `google_ces_app` (the console stores it there; the
  agent inherits) — the exact shape the issue reports. Import and `plan`
  are unaffected; the risk is confined to an `apply` that has to send
  those fields (see `terraform/README.md` "Known risk to check before
  relying on apply").
- **Import fails with "resource already managed" or a format error on the
  resource ID** — double-check the ID format against the specific
  resource's accepted forms (they differ slightly — e.g. `google_ces_app`
  takes `projects/{project}/locations/{location}/apps/{name}`, `google_ces_agent`
  adds an `/agents/{name}` suffix); the provider doc source files under
  `website/docs/r/ces_*.html.markdown` in the `terraform-provider-google`
  repo list every accepted format per resource.
