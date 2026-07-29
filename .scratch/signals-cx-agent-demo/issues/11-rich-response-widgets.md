# 11 — Rich response widgets in chat (polish)

Status: done
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

- [x] Supported rich response widget types + payload schemas confirmed against official docs and documented in the runbook (no guessed field names)
- [ ] Agent emits a product carousel for multi-product recommendations; renders correctly in the live widget
- [ ] Agent emits a product details widget for a single-product deep-dive: image, name, designer, price, working storefront link
- [ ] Widgets styled acceptably against the luxury theme
- [ ] Degrades safely to text recommendations when a rich payload can't be used
- [ ] Demo script updated with the rich-widget moment (if shipped before recording lock)
- [x] 09 dispositioned: closed `wontfix` as superseded, or kept with findings noted there

## Blocked by

- `07-widget-end-to-end.md`

## Comments

**2026-07-28 (agent):** Prepared everything in scope of the Agent
constraint (no live GCP console/widget/browser work from this sandbox):

- **Research (cited, not guessed):** confirmed against official CX Agent
  Studio docs that "rich response widgets" (built on widget tools,
  referenced via `{@Widget: widget_name}`) support Widget Types
  `PRODUCT_CAROUSEL` and `PRODUCT_DETAILS` exactly as this issue needs.
  Confirmed the Parameters schema for each widget tool is **author-defined**
  (no Google-fixed field-name table exists to guess at) — full citation
  trail in `docs/runbook.md` §11.1.
  - Also surfaced a real, unresolved compatibility risk: a Google
    developer-forum thread documents the hosted `chat-messenger` build
    shipping a "Product Carousel" rich message template **not available**
    in the open-source `ces-messenger` repo this demo is pinned to (for
    `setQueryParameters`/session-context reasons, per issue 07). No newer
    source confirms or denies parity since that thread. This can't be
    resolved without a live check — see `docs/runbook.md` §11.2 for the
    full citation trail and §11.5 for the exact human-runnable check.
- **Widget-tool schemas:** `agent/tools/product-carousel.widget.json` and
  `agent/tools/product-details.widget.json` — Parameters JSON for the two
  widget tools, field names mirroring the `searchCatalog` tool's own
  `CatalogResult` fields one-to-one (grounding, not invention).
- **Catalog endpoint:** added an `image` field to `searchCatalog`'s
  `CatalogResult` (`storefront/src/app/api/agent/catalog/route.ts` +
  `agent/tools/search-catalog.openapi.yaml`) — the widgets need a real
  product image and none was previously exposed. Updated/added tests in
  `route.test.ts`; full suite + lint green.
- **Agent instructions:** `agent/instructions.md` (new "Rich response
  widgets" section, worked example with real catalog products, degrade-to-
  text rule) mirrored into `agent/instructions.console.txt` (new
  constraint 5 + updated taskflow step, `{@Widget: ...}` syntax).
- **Runbook:** new `docs/runbook.md` §11 — citations, the open
  `ces-messenger`/`chat-messenger` risk, console steps to create and
  attach the two widget tools, a styling note (no widget-specific CSS
  hooks found anywhere, same gap as the base widget chrome in §9.4), and a
  verification walkthrough with a `<PLACEHOLDER: ...>` log line for the
  human's live run. New troubleshooting entries added.
- **09 dispositioned:** kept, not `wontfix` — the compatibility question
  above is genuinely unresolved from this sandbox, so closing 09 as
  superseded would risk being wrong in either direction. Added findings
  and the explicit re-disposition trigger (§11.5's live check) to 09's own
  Comments.

Left unchecked, as they require the live widget tools, live agent, a real
browser, and (per §11.2) resolution of the `ces-messenger` compatibility
question: "Agent emits a product carousel... renders correctly in the live
widget", "Agent emits a product details widget...", "Widgets styled
acceptably against the luxury theme", and "Degrades safely to text
recommendations when a rich payload can't be used" (the instructions/logic
are written and mirror the pattern already accepted for issue 06's
degraded-session handling, but confirming the agent's actual behaviour
needs the live simulator, same distinction drawn there). "Demo script
updated with the rich-widget moment" is also left unchecked: no
`docs/`-level demo-script file exists yet in this repo (issue 08, which
owns writing it, is still parked) and the criterion is explicitly
conditional on the feature having shipped, which is exactly what §11.2/10.5
haven't yet confirmed either way — the presenter-usable moment (ask for a
couple of accessories → expect a carousel; ask about one product → expect
a details card) is already written into runbook §11.5 for issue 08 to pull
from once it exists and once §11.5 has run.

**2026-07-29 (agent + human, live console):** Correction to the 28/07
research note above: the "Parameters schema is author-defined" reading was
**wrong for typed widgets**. Live console behaviour (hit while creating
the tools): `PRODUCT_CAROUSEL`/`PRODUCT_DETAILS` templates auto-fill a
Google-fixed schema and the editor is read-only ("Cannot edit in
read-only editor"); only the `CUSTOM` widget type takes an author-defined
schema (its parameters read "You can write your own schema here.").
Confirmed via CES REST `GET .../tools`. Console work done: both tools
created from templates as-is (`productCarousel` ecd09e09…,
`productDetails` 0527261b…, after deleting an earlier duplicate carousel)
and attached to the Root agent alongside `end_session` + the two OpenAPI
toolsets (attachment verified via REST). Repo reconciled to the fixed
contract: `agent/tools/*.widget.json` replaced with the captured schemas
(documentation now, nothing is pasted), instruction mapping rewritten
(`title`←`name`, `subtitle`←`designer`, `price`←dollar string,
`productId`←`url` slug, `uri`←base URL+`url`, `imageUris`←`[image]`;
`rating`/`review` always omitted) in both `instructions.md` and
`instructions.console.txt`, runbook §11.1/§11.3/§11.5/Troubleshooting and
PR-11 test plan updated. The fixed contract slightly *derisks* §11.2
(a Google-defined shape is what a widget-aware messenger renders
natively), but rendering on the pinned open-source `ces-messenger` is
still unresolved — §11.5 walkthrough remains the deciding test.
Remaining console step: re-paste the updated
`agent/instructions.console.txt` into the Root agent node and publish a
new deployment version.

**2026-07-29 (agent, live §11.5 result):** Rendering walkthrough run
against the freshly published version (`a8c48c30…`): **agent-side PASS,
rendering FAIL — §11.2 risk confirmed.** Perfect fixed-schema widget
invocations, grounded in the live session's real browsing, printed as
literal `{@Widget: …}` text by `ces-messenger`. Wire evidence: payload
arrives in-band in `runSession` `outputs[].text`; rendering is a hosted
`chat-messenger` client feature. Visual acceptance criteria stay
unchecked and cannot pass on the pinned component; everything
agent/API/docs-side is verified correct. Escalated to issue 09 (fallback
renderer now known-feasible, details there) with a demo-hazard warning:
live agent currently emits raw tokens in chat until 09 ships or the
console instructions are reverted to text-only.
