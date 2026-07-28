# 11 — Rich response widgets in chat (polish)

Status: ready-for-agent
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Polish on top of the working demo: use the chat channel's **native rich
response widgets** — CX Agent Studio's UI supports rich payloads that the
ces-messenger widget renders in-chat, including product carousels and product
details — so the agent's recommendations appear as visual product widgets
instead of plain text. Multi-product recommendation → product carousel;
single-product deep-dive → product details widget (image, name, designer,
price, link into the storefront).

Relation to 09: `09-product-cards-stretch.md` targets the same wow-beat via
`registerClientSideFunction` (custom client-rendered cards). Native rich
responses are the simpler, supported path — if this ships, 09 is likely
redundant (close it `wontfix` with a pointer here). If the native widgets
turn out not to support what we need (e.g. no arbitrary product link, image
constraints), record the findings here and fall back to 09.

Timeline: polish only — after the 07/08 fundamentals are solid, before
recording lock. Skip without ceremony if the 7 August recording is at risk.

**Verify at build:** the exact rich response widget types and payload schemas
the ces-messenger widget renders for this channel (carousel + product-details
shapes, image/link/price field names) — confirm against the ces-messenger
docs (`https://github.com/GoogleCloudPlatform/ces-messenger`) and current
CX Agent Studio documentation. Don't guess field names; cite sources.

**Agent constraint:** prepare everything that lives in the repo — the
confirmed payload schemas for the carousel and product-details widgets
(cited from official docs, with worked examples using real catalog
products), updates to `agent/instructions.md` directing when the agent
should emit each widget versus plain text (including the text fallback
behaviour), any storefront/widget-side styling hooks needed for acceptable
rendering against the luxury theme, unit tests where repo wiring code
changes, and a runbook section (console/agent-config steps + a verification
walkthrough for the live criteria). **Permitted live access — outbound,
read-only:** unauthenticated HTTP GETs (fetching official docs/READMEs,
checking the deployed site). Do **not** modify the live Vercel project or
the CX Agent Studio console — agent-config changes and live rendering
checks are human-verified afterwards, per the checkpoint.

## Acceptance criteria

- [ ] Supported rich response widget types + payload schemas confirmed against official docs and documented in the runbook (no guessed field names)
- [ ] Agent emits a product carousel for multi-product recommendations; renders correctly in the live widget
- [ ] Agent emits a product details widget for a single-product deep-dive: image, name, designer, price, working storefront link
- [ ] Widgets styled acceptably against the luxury theme
- [ ] Degrades safely to text recommendations when a rich payload can't be used
- [ ] Demo script updated with the rich-widget moment (if shipped before recording lock)
- [ ] 09 dispositioned: closed `wontfix` as superseded, or kept with findings noted there

## Blocked by

- `07-widget-end-to-end.md`
