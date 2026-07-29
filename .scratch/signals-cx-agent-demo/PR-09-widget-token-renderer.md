# PR: 09 — Client-side rich-response widget renderer

**Branch:** sandcastle/09-widget-token-renderer (unmerged by request)
**Issue:** .scratch/signals-cx-agent-demo/issues/09-product-cards-stretch.md

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

## Not covered / follow-ups

- Production verification: deploy the renderer-equipped storefront, then
  re-run runbook §11.5 against the deployed site (decision pending —
  §11.6; console revert remains the fallback).
- Token mode verified live only pre-renderer (deployed-site test) and via
  unit tests locally; the model has since favoured structured payloads.
  Both paths ship regardless.
- Demo-script widget moment (issue 09 criterion) — only after the prod
  decision.
