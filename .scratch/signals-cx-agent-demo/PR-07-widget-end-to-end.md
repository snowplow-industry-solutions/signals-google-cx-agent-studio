# PR: 07 — Chat widget end-to-end

**Branch:** sandcastle/07-widget-end-to-end
**Issue:** .scratch/signals-cx-agent-demo/issues/07-widget-end-to-end.md

## Summary

Embeds the `ces-messenger` web component in the deployed storefront and wires the visitor's `domain_sessionid` into the agent session automatically, closing the loop from browse to chat. The tracker is bumped to ^4.10.0 to use the `getDomainSessionId()` getter, the widget component handles session context injection and graceful cookieless fallback, and the runbook documents the widget deployment, console configuration, and end-to-end verification steps.

## Changes

**Package upgrade:**
- Bumped `@snowplow/browser-tracker` to ^4.10.0 (package.json + lockfile); all 90 tests + lint pass

**Widget component & types:**
- Added `storefront/src/components/Widget/CesMessengerWidget.tsx`: renders `ces-messenger` web component, reads `getDomainSessionId()` on load, calls `setQueryParameters()` to inject `snowplow_session_id` into agent session; gracefully handles `undefined` (tracker not yet initialized or cookieless visitor) by skipping the call and letting agent's degraded-session fallback apply; disables completely if `NEXT_PUBLIC_CES_DEPLOYMENT_ID` unset
- Added `storefront/src/types/ces-messenger.d.ts`: JSX intrinsic-element typing for the custom element (no upstream npm types exist)
- Wired component into `storefront/src/app/layout.tsx`; added unit tests covering happy path, cookieless fallback, and unset env var

**Deployment verification:**
- Extended `storefront/scripts/verify-deploy.ts` to check that deployed homepage HTML includes both the `ces-messenger.js` script and a `<ces-messenger>` element; added corresponding tests (runs read-only GET against deployed site when executed)

**Environment & runbook:**
- Added `NEXT_PUBLIC_CES_DEPLOYMENT_ID` entry to `storefront/.env.example`
- Added `docs/runbook.md` §9: widget-generation pin findings (`ces-messenger` vs `chat-messenger`) with official sources, exact human-runnable verification command, console steps for web-widget deployment + public-access/token-broker config, embed snippet, and verification walkthrough covering all live acceptance criteria

## Pipeline review record

- **Implement cycle 1 (2026-07-28 11:26):** Blocked — implementer correctly flagged missing Agent constraint scope carve-out (identical to issue 06's pre-unblock shape)
- **Implement cycle 2 (2026-07-28 12:06):** Parked — requeue hit stale branch from cycle 1; branch deleted, guard added to pipeline, requeued
- **Implement cycle 3 (2026-07-28 15:43):** Completed in scope — tracker bump + widget component + runbook §9; acceptance criteria requiring live widget/agent/browser reserved for human verification checkpoint

## Manual testing plan

### Prerequisites

- The storefront must be deployed to Vercel (per issue 05 / runbook §7); current live URL is `https://signals-google-gecx-storefront.vercel.app`
- The CX Agent Studio agent from issue 06 must exist and have the `snowplow_session_id` variable + `x-ces-session-context` binding (confirmed per runbook §8.4/§8.5)
- A trial Snowplow org with a live pipeline (collector + enrich + Signals) must be running (per runbook §2)
- Local env vars filled in per runbook §3 (for running verification script below)

### 9.2 — Create web-widget deployment and enable public access (console)

This is a **manual console step** — must be done in CX Agent Studio before testing the widget:

1. In CX Agent Studio, on the agent from issue 06, create a Web Widget deployment/channel.
2. Configure the deployment's security settings for public, unauthenticated access:
   - Enable public access
   - Enable origin checking and add `https://signals-google-gecx-storefront.vercel.app` to allowed origins (or the current deployed storefront URL from issue 05)
   - Enable reCAPTCHA if offered (recommended for public demo)
3. Confirm "managed token broker" is selected — no separate broker infrastructure needed; `token-broker-url="MANAGED"` in the embed is backed by Google's own `sessions.generateChatToken`
4. Record the deployment's full resource name (format: `projects/<project>/locations/<location>/apps/<app>/deployments/<deployment>`); this becomes the `NEXT_PUBLIC_CES_DEPLOYMENT_ID` value for the next step

### 9.3 — Configure the storefront and redeploy

This is a **manual Vercel/deployment step**:

1. In Vercel → Project → Settings → Environment Variables (Production scope), add:
   - **`NEXT_PUBLIC_CES_DEPLOYMENT_ID`** = the deployment resource name from 9.2 step 4
2. Trigger a redeploy of the storefront (visit the Vercel project's Deployments tab and redeploy the current branch, or push a dummy commit to trigger CI)
3. Wait for the deploy to complete and reach production
4. Verify the widget-embed check passes:
   ```bash
   # From repo root, with AGENT_SHARED_SECRET set (required for agent-endpoint checks)
   npm run verify:deploy -- https://signals-google-gecx-storefront.vercel.app
   ```
   Expected: script passes all checks including the new `ces-messenger.js` script and `<ces-messenger>` element assertions

### 9.5 — Verification walkthrough (browser)

Once 9.2 and 9.3 are complete, run these steps in a real browser:

1. **Widget embed check:**
   - Open `https://signals-google-gecx-storefront.vercel.app` (the deployed storefront)
   - In DevTools Console, wait a few seconds for the widget to load, then confirm no errors from the ces-messenger script
   - Confirm you see a chat bubble in the bottom-right corner styled with the dark theme

2. **Session context injection (widget pin check):**
   - In DevTools Console, run:
     ```js
     document.querySelector("ces-messenger").setQueryParameters({ snowplow_session_id: "widget-pin-check-123" });
     ```
   - Open the chat bubble and send any message (e.g., "test")
   - In CX Agent Studio console, open the execution trace for that turn
   - Confirm the `getUserContext` tool request's `session_id` parameter equals `widget-pin-check-123`
   - **If the value never reaches the tool:** check Network tab to confirm which script loaded; if the console's "copy embed snippet" generated `chat-messenger` instead of `ces-messenger`, manually redeploy using the exact markup from runbook §9.4

3. **Live session flow (browse → chat with context):**
   - Same browser, **clear DevTools override** (or run a fresh session without the manual test above)
   - Browse 2–3 products on the storefront (just click through product pages; add at least one item to cart)
   - Open the chat bubble
   - Send a message to the agent (e.g., "What products have I looked at?")
   - **Expected:** agent reply references your actual browsing history and cart contents unprompted (e.g., "I see you've been looking at our luxury watches, and you have one in your cart")
   - In DevTools, confirm no console errors and Network tab shows a successful token-broker request

4. **Context freshness check:**
   - While still in the same chat, browse a specific product page (e.g., a particular watch or handbag)
   - **Within 5 seconds**, send a new message to the agent (e.g., "Tell me more about what I just looked at")
   - **Expected:** agent references the just-viewed product with fresh context (not stale or absent)
   - Check runbook §9 "Troubleshooting" if freshness is slow (verify Signals pipeline is processing events on time)

5. **Cookieless visitor fallback (graceful generic behaviour):**
   - Open the storefront in a **fresh private/incognito window** (no `_sp_id` cookie, no tracker initialization)
   - Do **not** browse any products; go straight to opening the chat bubble
   - Send a message (e.g., "Hello")
   - **Expected:** agent gives generic, warm concierge behaviour without referencing any browsing context (e.g., "Welcome to Atelier Concierge! How can I help you today?")
   - In DevTools Console, confirm the message `ces-messenger loaded with no domain_sessionid yet...` appears (from CesMessengerWidget.tsx logging)

### If testing fails

- **Chat bubble doesn't appear or has errors:** Check NEXT_PUBLIC_CES_DEPLOYMENT_ID is set in Vercel production env vars and redeploy completed; check browser console for script errors
- **Token-broker request fails (Network tab shows 4xx/5xx):** Confirm origin check in §9.2 includes the exact deployed storefront URL; confirm managed token broker is selected, not a custom URL
- **Agent doesn't receive session_id:** Run the widget-pin-check command in step 2 to isolate whether `setQueryParameters` is working; if it reaches the tool via that test but not via normal browsing, check that tracker initialization completed before widget loaded (DevTools Console should log a message about `domain_sessionid`)
- **Agent gives context but from wrong session:** Check that only one storefront tab/window is open and session ID is consistent; try clearing browser storage and refreshing

## Rollback

If this branch is merged and needs to be reverted: revert the merge commit (`git revert -m 1 <merge-commit-hash>`) or delete the branch and deploy the previous main commit to Vercel. To undo the Vercel env var added in 9.3, remove `NEXT_PUBLIC_CES_DEPLOYMENT_ID` from the production environment variables in Vercel console.
