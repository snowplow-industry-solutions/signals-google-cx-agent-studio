# 03 — Agent context endpoint (core tracer)

Status: ready-for-agent
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

The money slice: the merged real-time context contract the CX agent will depend on.

Define and publish a new Signals Agentic Context (EventLog) covering product-view, cart-update, and checkout events with product name/designer/category/occasion/price properties, keyed by `domain_sessionid`, carrying a concierge interpretation prompt. Then build the agent-facing context endpoint: given a session identifier, return one merged payload —

```json
{
  "profile": { "<attribute>": "<value>" },
  "recent_activity": "<agentic context narrative>",
  "agent_instructions": "<prompt from the EventLog definition>"
}
```

`profile` is the flattened Profile Store service attributes; `recent_activity` is the narrative-format agentic context. The endpoint requires a shared-secret header and returns well-formed degraded payloads (empty profile / absent narrative) for unknown sessions or upstream failures — never a raw error mid-demo.

Test at the route-handler seam (Request in, Response out) with the Signals SDK mocked, per the PRD's testing decisions.

## Acceptance criteria

- [ ] EventLog definition lives in the Signals config-as-code alongside the attribute group and publishes successfully
- [ ] Endpoint returns merged payload for a real browsed session against the live trial org (manual verification)
- [x] Requests without the correct shared-secret header are rejected
- [x] Missing/unknown session id returns a well-formed degraded payload with 200-family semantics the agent can consume
- [x] Upstream Signals failure returns a degraded payload, not a 5xx with an opaque body
- [x] Vitest suite covers auth, validation, merge/flattening, and degraded shapes at the route seam with the SDK mocked
- [x] Response values are LLM-friendly (flat keys, human-readable values, no columnar arrays)

## Blocked by

- `01-storefront-foundation.md`
- `02b-trial-org.md`

## Comments

**2026-07-27 (agent):** Implemented on branch `sandcastle/03-context-endpoint`.

- New EventLog definition `storefront/signals/config/event_logs.py` (`fashion_session_activity`, keyed `domain_sessionid`, `max_events=100` / `max_age_seconds=3600`): projects product name/designer/category/occasion/price from `product_viewed` and `cart_updated` (plus cart `action`), and `checkout_step` from `checkout_started`. Carries the concierge interpretation prompt via the `prompt` field. Wired into `signals/config/publish.py`'s `build_objects()`, plus a new `--only event_log` option to re-publish just this addition. Verified by constructing the object and dry-running the publish script against the installed `snowplow-signals` SDK (0.4.6, within the existing `pyproject.toml` pin) — no validation errors, matches the config-as-code style of `attribute_groups.py`. Live publish to the trial org is the human checkpoint (first two criteria left unchecked).
- New endpoint `storefront/src/app/api/agent/context/route.ts` (`GET /api/agent/context?session_id=...`): merges `getServiceAttributes` (profile) and `getAgenticContext` (agentic context, default JSON format) from `@snowplow/signals-node`. Bumped that package `^0.3.0` → `^0.4.0` — the installed 0.3.0 line had no agentic-context support at all; 0.4.0 adds `getAgenticContext`. Its response type omits `summary`, but the wire format (shared with the Python SDK's `AgenticContextResponse`, which declares `summary` as required) includes it — noted in a code comment since it's an easy-to-miss SDK typing gap.
- Auth reuses `isAuthorizedAgentRequest` from the catalog endpoint (issue 04). Both upstream calls run via `Promise.allSettled`; a missing `session_id`, missing Signals credentials, an empty/unknown-session response, or either upstream call rejecting all degrade to the same 200 payload (`{ profile: {}, recent_activity: "", agent_instructions: "" }`) — never a 4xx/5xx beyond the auth check.
- Profile flattening: arrays join into comma-separated strings, dict-valued attributes (e.g. `category_interest_counts`) flatten into `"key: value, ..."` strings, null/undefined attributes are dropped — no nested arrays/objects reach the agent.
- Tests: `storefront/src/app/api/agent/context/route.test.ts`, 13 cases covering auth accept/reject/misconfigured-secret, missing-session-id and no-credentials degradation, merge/flattening (arrays, dicts, null-dropping), and degraded shapes for unknown session and upstream failure (profile call, context call, both).
- `npm --prefix storefront test` (75/75 passed) and `npm --prefix storefront run lint` (clean) both green.
