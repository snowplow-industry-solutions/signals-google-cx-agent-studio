# 09 — Product cards in chat (stretch)

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Stretch goal — only after 07 is solid and before recording lock. Register a client-side function with the chat widget (`registerClientSideFunction`) that the agent can call to render rich product cards (image, name, designer, price, link) directly in the chat window when making recommendations. Visual wow-beat for the webinar.

Skip without ceremony if the timeline to the 7 August recording is at risk.

## Acceptance criteria

- [ ] Agent tool defined for card rendering; agent instructions direct when to use it
- [ ] Cards render in-chat with image, name, designer, price, and working product link
- [ ] Degrades safely: if the client-side function is unavailable, agent falls back to text recommendations
- [ ] Demo script updated with the card moment (if shipped)

## Blocked by

- `07-widget-end-to-end.md`
- `11-rich-response-widgets.md` (disposition decides whether this issue runs at all)

## Comments

**2026-07-28 (human/assistant):** Overlaps new issue
`11-rich-response-widgets.md` — same wow-beat via the chat channel's *native*
rich response widgets (product carousel / product details) instead of the
`registerClientSideFunction` custom-render path here. Native path is the
simpler, supported route; issue 11 carries a disposition criterion for this
issue (close `wontfix` if superseded, or feed findings back here if native
widgets can't do what we need). Check 11's outcome before starting this.

## Parked by pipeline (2026-07-28 16:08) — resolved, see comment below

Implementer flagged a spec conflict / blocker:

Confirmed: issue 11 is newly added, still `Status: ready-for-agent` / `Checkpoint: human-test-required` — it has not been implemented, tested, or dispositioned yet. There's no PR file for it, and no other record resolving the "09 vs 11" question.

Issue 09's own Comments section is explicit: *"issue 11 carries a disposition criterion for this issue (close `wontfix` if superseded, or feed findings back here if native widgets can't do what we need). Check 11's outcome before starting this."* That outcome doesn't exist yet — 11 hasn't been built or verified against the live ces-messenger widget, so there's no way to know whether native rich-response widgets can satisfy the wow-beat (making 09 redundant) or whether they can't (making 09 the fallback). Implementing 09 now risks duplicating work that 11 will supersede, which is exactly what the issue tells the agent to avoid pending that decision.

This is a human-decision dependency, not something resolvable by reading more code — so per Step 1 I'm stopping without writing code.

**Blocker:** Issue 09 explicitly requires checking issue 11's disposition before starting, and issue 11 has not yet been implemented or checkpointed (still `ready-for-agent` / `human-test-required`, added in the immediately preceding commit with no PR file). There is no recorded outcome to check — 11 may supersede 09 entirely (`wontfix`) or may feed back findings requiring a different scope for 09. Proceeding would risk building the `registerClientSideFunction` card-rendering path that gets thrown away if native rich response widgets (issue 11) turn out sufficient.

<promise>BLOCKED</promise>

**2026-07-28 (human/assistant):** Un-parked — the implementer's reading is
correct, and the dependency is now encoded structurally: `11-rich-response-widgets.md`
added to **Blocked by**, so the pipeline won't pick this up until 11 reaches
`done` (which includes its 09-disposition criterion: `wontfix` here if native
widgets suffice, or findings fed back here if they don't). No scope change to
this issue. Re-queued as ready-for-agent behind that gate.