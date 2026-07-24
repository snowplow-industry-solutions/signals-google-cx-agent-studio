# 07 — Chat widget end-to-end

Status: ready-for-agent
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Close the loop in the browser: embed the ces-messenger web component in the deployed storefront, wire the page script to read `domain_sessionid` from the Snowplow `_sp_id` cookie and pass it via `setQueryParameters` when the widget loads, and configure the managed token broker for public access. Result: a visitor browses, opens chat, and the agent already knows their session — no identification step.

Verify-at-build item from the PRD lands here: pin the widget generation (`ces-messenger` vs `chat-messenger`) to whichever supports query-parameter passing against our agent deployment.

## Acceptance criteria

- [ ] Widget renders on the deployed site, styled acceptably against the luxury theme
- [ ] Session id read from the Snowplow cookie and delivered to the agent session automatically
- [ ] Full flow works on the deployed site: browse products → add to cart → open chat → agent references actual browsing/cart behaviour unprompted
- [ ] Context freshness acceptable: activity seconds old is reflected in the conversation
- [ ] New/cookieless visitor gets graceful generic concierge behaviour
- [ ] Embed + wiring steps documented in the runbook

## Blocked by

- `06-cx-agent-and-tools.md`
