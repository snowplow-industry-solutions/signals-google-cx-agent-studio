# Agent Notes

## Architecture Summary

- `src/components/Analytics/SnowplowProvider.tsx`
  Initializes the Snowplow tracker, sets up the Signals browser plugin, and subscribes to interventions keyed by `domain_sessionid`.

- `src/components/Signals/SignalsProvider.tsx`
  Provides fetched Signals attributes and exposes single/batch fetch helpers.

- `src/components/Signals/SignalsBootstrap.tsx`
  Fetches Signals attributes for the current session and refreshes them on session change.

- `src/components/Demo/DemoModeProvider.tsx`
  Controls presenter-oriented UI affordances such as highlight mode and panel visibility.

- `src/components/Demo/SignalsDebugPanel.tsx`
  Shows the top fetched attributes and the currently active personalization workflows.

- `src/components/Cart/CartProvider.tsx`
  Holds in-memory demo cart state and emits tracked cart updates.

- `src/components/Widget/CesMessengerWidget.tsx`
  Embeds the ces-messenger chat element; `useWidgetTokenRenderer.ts` renders
  its CX Agent Studio rich-response widget tokens/payloads as product cards
  (`widgetCards.ts`) and hides still-streaming partial tokens
  (`widgetTokenVisibility.ts`). `useWidgetConversationTracking.ts` tracks
  `message_sent`/`message_received` per turn and fires the product-list-click
  event for concierge card clicks.

- `src/utils/agentTracking.ts` / `src/utils/agentSelfTracking.ts`
  The server-side agent tracking module: `agentTracking.ts` builds the Node
  tracker and emits `tool_execution` events from `/api/agent/context` and
  `/api/agent/catalog`; `agentSelfTracking.ts` validates the bodies for the
  three self-tracking endpoints (`/api/agent/track-intent`,
  `/track-decision`, `/track-constraint`) before `agentTracking.ts` emits
  their events. `src/utils/agentAuth.ts` holds the shared-secret check both
  endpoint families use.

## Where To Change Things

- Product catalog: `src/data/products.ts`
- Collections and routing inputs: `src/data/collections.ts`
- Personalization rules: `src/utils/personalization.ts`
- Tracking payloads: `src/utils/tracking.ts`
- Signals attribute typing: `src/types/signals.ts`
- UI copy and layout: route page components in `src/components`

## Snowplow Assets

- Tracking plan YAML:
  - `tracking-assets/data-structures`
  - `tracking-assets/tracking-plans`

- Signals Python SDK config:
  - `signals/config/attribute_keys.py`
  - `signals/config/attribute_groups.py`
  - `signals/config/event_logs.py`
  - `signals/config/services.py`
  - `signals/config/publish.py`

- Snowtype config:
  - `snowtype.config.example.json` — the committed template; edit this one
  - `snowtype.config.json` and `snowtype/` — generated per-org and gitignored,
    written by `npm run snowtype:generate`. Never edit by hand.

## Agent Analytics

- Local, pre-org verification: `scripts/render-iglu-schemas.ts`
  (`npm run micro:schemas`) renders this repo's data structures for Snowplow
  Micro; `scripts/verify-micro.ts` (`npm run verify:micro`) then fires every
  agent endpoint against a dev server and checks Micro's good/bad counts.
  Both need a live dev server (and Micro) running, so neither is run from
  here — see `../README.md` "Local Agent Tracking Verification (Snowplow
  Micro)".
- Post-deploy smoke test: `scripts/verify-deploy.ts` (`npm run
  verify:deploy`) — checks the same endpoints' auth and shape against a
  deployed storefront. Needs a live deployment; not run from here either.
- BigQuery queries over the events these endpoints emit:
  `../../analytics/agent-self-tracking.sql` (agent tool/reasoning events) and
  `../../analytics/ecommerce-web-analytics.sql` (storefront web/ecommerce
  events, including the concierge card placement — note its browser-impression
  branch is untested on real data; only the searchCatalog fallback has run
  against real events).

## Verification Commands

```bash
npm test
npm run lint
npm run build
python -m signals.config.publish --dry-run
```

## Demo Notes

- Use `?demo=plain` to hide visible personalization cues while keeping the same underlying logic.
- Use the floating panel to re-enable highlight mode live.
- The console prefix `[Signals Demo]` is intentionally demo-friendly and can be narrated during walkthroughs.
