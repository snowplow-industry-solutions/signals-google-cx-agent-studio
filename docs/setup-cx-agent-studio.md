# Setup: CX Agent Studio agent, tools, and widget

Builds the customer-facing concierge agent in Google Gemini Enterprise for CX
(CX Agent Studio), wires it to the storefront's two tool endpoints, and embeds
the chat widget so a visitor's live Snowplow session flows into the
conversation automatically.

Prerequisites: the storefront deployed and verified over public HTTPS with a
minted `AGENT_SHARED_SECRET` — see
[`setup-snowplow-trial.md`](./setup-snowplow-trial.md) §7. The repo-side
artifacts (`agent/instructions*.txt`, `agent/tools/*.openapi.yaml`) are the
source of truth; you paste/import them into the console. To back the console
build with Terraform afterwards, see [`../terraform/README.md`](../terraform/README.md).

Throughout, replace `<your-gcp-project>` and `<your-storefront-url>` with your
own values.

## 1. Enable APIs and label resources

1. In your GCP project, confirm CX Agent Studio (Gemini Enterprise for CX) is
   available/allowlisted for the project's region. If the console doesn't offer
   agent creation, check enabled APIs / region settings first.
2. Enable any APIs the console prompts for during agent creation (Gemini
   Enterprise / Discovery Engine / Dialogflow CX-family APIs, depending on what
   the console calls the product at the time).
3. Label the resources this creates (agent, associated app/data store) per your
   own tagging policy, where the resource type supports labels. Note that
   neither `google_ces_app` nor `google_ces_agent` exposes a `labels` field —
   see [`../terraform/README.md`](../terraform/README.md).

## 2. Create the agent

1. In CX Agent Studio, create a new customer-facing agent in your project.
2. Paste the full contents of `agent/instructions.console.widgets.txt` into
   the **Root Agent node's own instructions field** (on the canvas),
   verbatim — it defines the concierge persona, the one-call-per-turn tool
   contract, the rich-response widgets, and the degraded-session fallback,
   in the console's structured format with `{@TOOL: ...}` and
   `{@Widget: ...}` references. Do **not** use Settings → Advanced: that is
   the app-wide `globalInstruction`, which would leak the persona into any
   later-added agent. (`agent/instructions.console.txt` is the text-only
   revert target if you skip the widget tools in §3.)

   The `{@TOOL: ...}` and `{@Widget: ...}` references must resolve against
   the attached tools (do §3 first). If the editor flags "tool not found",
   delete the reference and re-insert it with the editor's `@` picker — the
   resolvable names are toolset-qualified (`getUserContext_getUserContext`,
   `searchCatalog_searchCatalog`) or the widget names (`productCarousel`,
   `productDetails`). `agent/instructions.md` is the human-readable source
   for the same contract; edit there first and mirror changes into the
   console copy.

## 3. Import the two OpenAPI tools

For each schema file, create a new OpenAPI tool in the agent and import the file
directly (the console supports upload or paste):

| Tool | Schema file | Operation |
|---|---|---|
| `getUserContext` | `agent/tools/get-user-context.openapi.yaml` | `GET /api/agent/context` |
| `searchCatalog` | `agent/tools/search-catalog.openapi.yaml` | `GET /api/agent/catalog` |

Both schemas declare `servers[0].url` as your deployed storefront URL and an
`apiKey` security scheme on the `x-agent-api-key` header. If the deployed URL
changes, update `servers[0].url` in both files and re-import rather than
overriding it only in the console.

For each tool's authentication config, choose **API key** auth and set:
- Header name: `x-agent-api-key`
- Value: the exact `AGENT_SHARED_SECRET` value configured on the Vercel
  deployment (not a local value — they may differ).

Then add the two **rich response widget tools** on the same agent: create a
widget tool from the console's template, once with type `PRODUCT_CAROUSEL`
named `productCarousel` and once with type `PRODUCT_DETAILS` named
`productDetails`. The template auto-fills the (read-only) parameter schema,
so there is nothing to import — `agent/tools/*.widget.json` are captured
copies of those fixed schemas, checked in so
`scripts/verification/verify_widgets.py` and `terraform/tools.tf` can verify
the contract. Without these two tools the `{@Widget: ...}` references from §2
won't resolve.

Confirm each tool calls the deployed endpoint successfully (the console's
try-it affordance, or a test turn in the simulator) before moving on.

## 4. Wire the session-context variable

There is **no console UI setting** for this — the binding lives in the tool's
OpenAPI schema, via the `x-ces-session-context` extension on the parameter
([OpenAPI tools docs](https://docs.cloud.google.com/gemini-enterprise-cx/cx-agent-studio/tool/open-api)).

**Do not bind to the built-in `$context.session_id`** — that is CX Agent
Studio's own conversation session id, not the Snowplow `domain_sessionid`; it
would always produce degraded payloads. Use a custom agent variable referenced
as `$context.variables.<name>`.

1. In the agent's Variables section, declare a variable `snowplow_session_id`,
   type Text.
2. The `session_id` parameter in `agent/tools/get-user-context.openapi.yaml`
   already carries the binding (re-paste the schema if the console copy
   predates it):
   ```yaml
   x-ces-session-context: $context.variables.snowplow_session_id
   ```
   With the extension present, the model no longer produces the value; it is
   injected from the variable at call time.
3. **Check**: in the simulator, set `snowplow_session_id` to a real,
   freshly-browsed session id (see §5) and confirm the tool actually receives it
   — inspect the tool's request in the console's execution trace, not just the
   agent's reply.

## 5. Verify in the simulator

1. Browse the deployed storefront to get a real, freshly-browsed
   `domain_sessionid`.
2. In the simulator, set the `snowplow_session_id` variable to that session id,
   then open the chat.
3. Confirm the agent's first response reflects that session's real context
   (correct favourite designer, cart contents) without the user stating
   anything, and any recommendation is a real, matching catalog item.
4. Repeat with an unknown/made-up session id (or the variable unset). Confirm
   the agent falls back to generic warm concierge behaviour per
   `agent/instructions.md` — no mention of errors, missing data, or anything
   technical.

> Two setup gotchas worth pre-empting: the CES service agent needs
> `secretmanager.secretAccessor` on the shared secret, and re-importing an
> OpenAPI schema can detach the tools from the Root agent node (symptom: the
> agent "calls" the right tool per its reasoning but the trace shows
> `end_session` with placeholder args and the conversation silently ends).

## 6. Embed the chat widget

Embeds the widget in the storefront and wires the visitor's `domain_sessionid`
into the agent session automatically, closing the loop from browse to chat.

### Which widget component

This repo pins the open-source
[`ces-messenger`](https://github.com/GoogleCloudPlatform/ces-messenger) web
component, **not** the gstatic-hosted `chat-messenger` build. Only
`ces-messenger` documents `setQueryParameters({ key: value })`, where each key
becomes readable in the agent session as `$context.variables.<key>` — the exact
mechanism §4's `x-ces-session-context: $context.variables.snowplow_session_id`
binding depends on. The two builds are related but not kept in sync, so don't
mix them.

### Create the web-widget deployment

1. On the agent, create a Web Widget deployment/channel.
2. Configure it for public, unauthenticated access:
   - Enable public access.
   - Enable origin checking, and add your deployed storefront's exact origin
     (`https://<your-storefront-url>`) to the allowed-origins list.
   - Leave **Recaptcha OFF**. `ces-messenger` has no reCAPTCHA support; with the
     toggle on, the widget calls `generateChatToken` without a `recaptcha_token`
     and the broker rejects every session with `400 INVALID_ARGUMENT:
     "Recaptcha token is missing."` Public access + origin verification is the
     protection level for a short-lived demo. (The `enableRecaptcha` option in
     Google's docs belongs to the other, `chat-messenger`, build.)
3. Confirm the managed token broker option is selected — no separate broker
   infrastructure is needed; `token-broker-url="MANAGED"` is backed by Google's
   own `sessions.generateChatToken`.
4. Note the deployment's full resource name (format
   `projects/<project>/locations/<location>/apps/<app>/deployments/<deployment>`)
   — this is the `NEXT_PUBLIC_CES_DEPLOYMENT_ID` value below.

### Configure the storefront and redeploy

1. In Vercel → Settings → Environment Variables (Production), add:

   | Var | Client-exposed? | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_CES_DEPLOYMENT_ID` | Yes, by design | the deployment resource name above |

2. Redeploy.
3. Re-run `npm run verify:deploy -- https://<your-storefront-url>`
   (`AGENT_SHARED_SECRET` still required for the agent-endpoint checks) — it now
   also asserts the homepage HTML includes both the `ces-messenger.js` script
   and a `<ces-messenger>` element.

### Embed snippet (reference)

Nothing to hand-author —
`storefront/src/components/Widget/CesMessengerWidget.tsx` renders this
client-side when `NEXT_PUBLIC_CES_DEPLOYMENT_ID` is set (and renders nothing if
it's unset). For reference, the equivalent static markup:

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

Once the widget is ready (the `ces-messenger-loaded` event, dispatched on
`window`), the component calls the equivalent of:

```js
const sessionId = getDomainSessionId(); // @snowplow/browser-tracker >= 4.9.0
if (sessionId) {
  document.querySelector("ces-messenger").setQueryParameters({ snowplow_session_id: sessionId });
}
```

`getDomainSessionId()` returns `undefined` for a brand-new or cookieless
visitor; in that case the component leaves `snowplow_session_id` unset rather
than passing an empty value, so the agent's degraded-session instructions apply
— the graceful cookieless fallback.

### Verify end-to-end

1. Confirm `verify:deploy` passes the widget-embed check (script/element served
   in the HTML — not proof the widget renders; that needs a browser).
2. Open the deployed storefront, browse a couple of products, add one to cart.
3. Open the chat bubble; confirm no console errors and that the token-broker
   request succeeds.
4. Send a message. Confirm the reply references your real browsing/cart
   behaviour unprompted.
5. Freshness check: browse a product, then within a few seconds ask about it;
   confirm the answer reflects that just-viewed product.
6. In a fresh incognito window (no `_sp_id` cookie), open chat before browsing.
   Confirm generic warm concierge behaviour — the cookieless-visitor path,
   end-to-end.

## Troubleshooting

- **CX Agent Studio tool test returns 401** — the API-key header name
  isn't exactly `x-agent-api-key`, or the key value doesn't match the
  deployed `AGENT_SHARED_SECRET` (the Vercel value from
  [`setup-snowplow-trial.md`](./setup-snowplow-trial.md) §7, not a local
  one).
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
  the node's **+** (§3); if the re-import created duplicate tool entries,
  attach the copy whose schema carries the `x-ces-session-context` line and
  delete the orphan.
- **Tool tester returns the blank/degraded payload despite a session id in
  the test input** — the tester only feeds model-produced parameters; with
  `x-ces-session-context` present, `session_id` is context-injected and the
  tester has no conversation context, so the request goes out without it.
  Test injection in the simulator instead (§5), presetting the variable via
  its "Set a default value at the start of the conversation" option (untick
  it once verified — in production the widget populates the variable, and a
  leftover default masks broken widget wiring).
- **Simulator shows the agent asking the shopper who they are / to repeat
  browsing** — the session-context variable binding from §4 isn't reaching
  the tool; check the tool's request trace in the console for an empty
  `session_id`. Confirm the console copy of the schema carries the
  `x-ces-session-context: $context.variables.snowplow_session_id` line and
  that the `snowplow_session_id` variable is declared on the agent and set
  for the session.
- **Widget renders but the chat never connects / token-broker errors in
  the console** — check that §6's origin-check config includes the
  deployed storefront's exact origin in `allowed_origins`.
- **`verify:deploy`'s widget-embed check fails post-deploy** — confirms the
  `<ces-messenger>` element or its script isn't in the served HTML; check
  `NEXT_PUBLIC_CES_DEPLOYMENT_ID` is set in the Vercel environment (§6) and
  that the deploy actually picked it up (the component renders nothing when
  that var is unset, by design).
- **Widget loads and authorizes but no chat bubble is visible** — check
  for another `position: fixed` element occupying the bottom-right corner.
  The launcher pins itself bottom-right via the widget's own shadow-DOM
  styles (host-element classes don't move it); anything later in the DOM
  at the same corner and z-index paints over it. Diagnose with
  `document.querySelector("ces-messenger").shadowRoot` (launcher present?)
  vs `document.elementFromPoint(...)` at the corner (who's on top?).
- **"Start conversation" fails; console shows `No token received from
  token broker` with `400 INVALID_ARGUMENT: "Recaptcha token is missing."`**
  — the channel's Recaptcha toggle is on. Turn it off (§6); `ces-messenger`
  cannot mint reCAPTCHA tokens. Takes effect without a redeploy.
- **Agent replies with spoken audio / mic prompt appears despite the
  channel's "Interaction type: Text"** — that console setting doesn't reach
  a hand-authored embed; the component itself defaults to
  `audio-output-mode="ALWAYS_ON"` and `audio-input-mode="DEFAULT_ON"`. The
  embed in §6 (and `CesMessengerWidget.tsx`) pins both off
  (`NONE`/`DISABLED`) for the text-only demo.
- **Agent describes a different user's journey (wrong cart/browsing)** —
  the agent is not receiving your real session id, and is reading whatever
  the `snowplow_session_id` variable falls back to. Check three things in
  order: (1) the browser console must log `[Signals Demo] Passed
  domain_sessionid to ces-messenger` — if missing, `setQueryParameters` was
  never called (the loaded event fires on `window`, not the element; fixed
  in `CesMessengerWidget.tsx`, and §6's verification steps isolate this);
  (2) the agent variable must have **no default value** in CX Agent Studio
  (§4) — a default silently masks a missing session id with another
  session's data; (3) the channel's pinned **Agent Version** must postdate
  any console edits (§6) — the channel serves a version snapshot, not the
  draft, so removing a default (or any agent edit) only reaches the widget
  after you add a new version and point the channel at it. The simulator
  (§5) tests the draft, the widget (§6) tests the pinned version — they can
  disagree.
