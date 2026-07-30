# PR: 09 — Client-side rich-response widget renderer

**Branch:** sandcastle/09-widget-token-renderer (merged to `main`, `eca007c`)
**Issue:** GitHub issue #1 (migrated from
.scratch/signals-cx-agent-demo/issues/09-product-cards-stretch.md)
**Status:** live in production; §11.5 verified against the deployed site
on 2026-07-30

## Summary

Renders the CX Agent Studio rich-response widgets (product carousel /
product details) inside the pinned open-source ces-messenger component,
which cannot render them natively. Handles both live-observed delivery
modes — in-band `{@Widget: …}` text tokens and structured
`outputs[].payload` objects (`product_detail_carousel` /
`base_product_detail`) that the stock component drops as blank replies.
Zero agent/console changes: everything lives in the storefront wrapper.

## Changes

- `storefront/src/utils/widgetTokens.ts` (+ tests) — tolerant token
  parser (JS-object-literal args, schema-extraneous `summary:` argument,
  incomplete/streaming tokens deferred until complete).
- `storefront/src/components/Widget/widgetCards.ts` (+ tests) — payload
  normalisation shared by both modes; inline-styled card builders (CSS
  custom properties inherit into the shadow root, so the luxury palette
  comes via var() with hex fallbacks); DOM path for token replacement,
  HTML-string path for the rich-message template; invented
  `rating`/`review` fields discarded.
- `storefront/src/components/Widget/useWidgetTokenRenderer.ts` — hook
  wiring both modes into CesMessengerWidget: shadow-DOM MutationObserver
  (token mode); `payload-received` hook + `registerTemplate` +
  `registerRichMessageHandler` (payload mode, ces-messenger's sanctioned
  extension surface). SPA-routes storefront card clicks (full page load
  would remount the widget and lose the conversation).
- `storefront/src/types/ces-messenger.d.ts` — declarations for
  registerTemplate / registerHook / registerRichMessageHandler.
- `storefront/src/components/Widget/CesMessengerWidget.tsx` — mounts the
  hook; `CesMessengerWidget.test.tsx` gains a next/navigation mock.
- `docs/runbook.md` — §11.5 addendum (bimodal wire format, payload type
  discriminators, blank-reply failure mode, hallucinated rating/review
  quirk) and §11.6 rewrite (renderer status + prod-path decision).
- Issue 09 build/verification record; evidence screenshots.

## Test record (2026-07-29)

- Unit: 31 widget tests green (parser incl. live-captured token verbatim;
  normalisation; card building; token replacement idempotence; click
  delegation). Full suite 120/122 — the 2 failures are the pre-existing
  `userTracking.test.ts` localStorage env issue, untouched by this
  branch.
- `tsc --noEmit`: no errors in files this branch touches (pre-existing
  errors in unrelated test files remain).
- Live (localhost dev server against the live widget-enabled agent):
  carousel rendered from a structured payload (2 grounded session
  products); details card rendered (`base_product_detail`); card click
  SPA-navigated to /products/silk-twill-square-scarf with the
  conversation intact; cards re-rendered from restored session history
  after a full reload. Screenshots committed alongside this file.

## Production verification (2026-07-30)

Runbook §11.5 steps 2–6 re-run against
`https://signals-google-gecx-storefront.vercel.app` with the live
widget-enabled agent: **PASS on all five.** Carousel and details cards
render with image/designer/name/price; card clicks SPA-navigate to the
right `/products/<slug>` with the conversation intact; a zero-match query
degrades to plain text with no invented fields; card styling matches the
dark luxury palette with no `custom-css` change needed; no console
errors. Full log, including the agent-side "couple of accessories →
single card" composition quirk, in runbook §11.5. Evidence:
`widget-renderer-{carousel,details,carousel-click,tokenmode-probe}-prod-20260730.png`.

## Not covered / follow-ups

- All 8 live widget turns in the production run used the **structured
  payload** mode; the in-band `{@Widget: …}` token mode has not been
  emitted by the live agent since the renderer shipped. The token path
  was confirmed working in the deployed bundle by injecting the verbatim
  2026-07-29 token into the widget's shadow DOM (raw token suppressed,
  cards drawn) — synthetic, not agent-emitted.
- Structured-payload turns carry no commentary text of their own — that
  is issue #3 (12 — agent commentary), not a defect here.
