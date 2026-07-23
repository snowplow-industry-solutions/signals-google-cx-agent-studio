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

## Where To Change Things

- Product catalog: `src/data/products.ts`
- Collections and routing inputs: `src/data/collections.ts`
- Personalization rules: `src/utils/personalization.ts`
- Tracking payloads: `src/utils/tracking.ts`
- Signals attribute typing: `src/types/signals.ts`
- UI copy and layout: route page components in `src/components`

## Snowplow Assets

- Tracking plan YAML:
  - `tracking-plan/data-structures`
  - `tracking-plan/data-products`

- Signals Python SDK config:
  - `signals/config/attribute_keys.py`
  - `signals/config/attribute_groups.py`
  - `signals/config/services.py`
  - `signals/config/publish.py`

- Snowtype config:
  - `snowtype.config.json`

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
