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

## Comments

**2026-07-28 (human/assistant):** Overlaps new issue
`11-rich-response-widgets.md` — same wow-beat via the chat channel's *native*
rich response widgets (product carousel / product details) instead of the
`registerClientSideFunction` custom-render path here. Native path is the
simpler, supported route; issue 11 carries a disposition criterion for this
issue (close `wontfix` if superseded, or feed findings back here if native
widgets can't do what we need). Check 11's outcome before starting this.
