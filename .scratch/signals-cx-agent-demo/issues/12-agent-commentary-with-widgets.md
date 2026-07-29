# 12 — Agent commentary alongside widget cards

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

When the agent responds with rich-response widget cards in **structured
payload mode** (`outputs[].payload`, `type: product_detail_carousel` /
`base_product_detail`), the turn currently carries **no text output at all**
(runbook §11.5 addendum) — the shopper gets cards with zero conversational
framing, which reads abrupt. This is agent-side turn shape, not a renderer
limitation: in token mode the same agent already emits "grounded prose plus
the widget invocation" in one message, and the storefront renderer displays
text bubbles and payload cards independently — if a turn carried both, both
would render today.

Fix at the agent layer:

1. Update the live agent's widget instructions (CES REST with ADC — §11.2
   discovery notes) to direct a 1–2 sentence conversational message
   accompanying **every** widget invocation, in both delivery modes.
2. Publish a new agent version and verify live across several turns —
   the wire format is nondeterministically bimodal (§11.5), so check both
   token-mode and structured-payload turns include commentary text.
3. **Fallback investigation** (if instructions can't force a text output in
   structured mode): capture a live structured payload and record in the
   runbook whether it carries an agent-authored summary-style text field
   (token mode volunteers a `summary:` argument — the parser currently
   discards it; a structured equivalent may exist). If present, rendering it
   above the card rail is legitimate (agent's own words) and becomes a small
   storefront change; if absent, record the finding and stop — never
   synthesise commentary client-side (no words in the agent's mouth).

Timeline: polish — skip without ceremony if the 7 August recording is at
risk. Sequencing: an instruction edit publishes a new agent version, which
is the same lever as the runbook §11.6 prod-path decision and re-triggers
branch 10's `terraform.tfvars` `app_version_id` re-pin — fold this change
into whichever version publish §11.6 lands on rather than publishing twice.

## Acceptance criteria

- [ ] Agent instructions direct short conversational commentary with every
      widget invocation; no other instruction behaviour changed
- [ ] New agent version published; live verification over several turns
      shows a text bubble alongside the cards in structured-payload turns
      (and prose still intact in token-mode turns)
- [ ] Structured payload captured and recorded in runbook §11.5: does it
      carry an agent-authored summary text field? (record either way)
- [ ] Branch 10 `app_version_id` re-pinned to the published version
- [ ] Existing widget renderer tests still green (no storefront change
      expected unless the fallback path is taken)

## Blocked by

- `09-product-cards-stretch.md` (renderer merge + §11.6 prod-path decision
  resolve there; publishing a new version before that decision would repeat
  the §11.5 in-between state)

## Comments

**2026-07-29 (human/assistant):** Raised from local testing of issue 09's
renderer (branch verified: carousel + details cards render, links work).
Observed: structured-payload turns render cards only, no commentary.
Wire-format evidence in runbook §11.5 confirms no text output on those
turns — agent-side fix, not renderer.
