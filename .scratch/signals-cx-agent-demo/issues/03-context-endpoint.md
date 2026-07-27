# 03 — Agent context endpoint (core tracer)

Status: awaiting-human-test
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
- [ ] Requests without the correct shared-secret header are rejected
- [ ] Missing/unknown session id returns a well-formed degraded payload with 200-family semantics the agent can consume
- [ ] Upstream Signals failure returns a degraded payload, not a 5xx with an opaque body
- [ ] Vitest suite covers auth, validation, merge/flattening, and degraded shapes at the route seam with the SDK mocked
- [ ] Response values are LLM-friendly (flat keys, human-readable values, no columnar arrays)

## Blocked by

- `01-storefront-foundation.md`
- `02b-trial-org.md`
