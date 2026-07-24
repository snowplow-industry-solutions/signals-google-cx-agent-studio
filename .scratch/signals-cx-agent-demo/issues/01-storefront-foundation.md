# 01 — Storefront foundation

Status: done

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Bring the Atelier Signals luxury-fashion storefront into this repo as the demo's frontend. Copy the existing site from the field-resources demo-sites collection into the storefront directory, sweep all catalog data and copy for real trademarks (designer names, brand references — this ships in a public webinar), and confirm the app runs locally with its existing test suite passing. The original field-resources asset must remain untouched.

## Acceptance criteria

- [x] Storefront app lives in this repo and installs/runs locally (dev server up, pages render: home, collection, product, cart, checkout)
- [x] Existing vitest suite, lint, and build all pass
- [x] Catalog data and site copy contain no real-world trademarks or brand names (fictional designers only)
- [x] Env var template documents required Snowplow/Signals configuration
- [x] Original site in field-resources unchanged

## Blocked by

None - can start immediately

## Comments

**2026-07-23 (agent):** Implemented on branch `worktree-issue-01-storefront-foundation`.

- Copied site into `storefront/` (excluded `node_modules`, `.next`, `.env.local`, `.git`). Original verified untouched via `git status` in field-resources.
- Fixed 2 pre-existing vitest failures in `personalization.test.ts`: expectations assumed a smaller catalog; scoring logic is correct, p18/p24 legitimately outrank the old expected ids. Updated assertions.
- Text copy was already trademark-free (fictional designers: Maison Cendre, Arc Studio, Atelier Lune), but images were not: 30 product-image URLs hotlinked real retailer sites (Holland Cooper, Ravel, Dents, LilySilk, Zalando CDN, etc.) and several "stock" photos showed real branded goods (Gucci Marmont bag, Omega-style chronograph, MYKU watch dial, Michael Kors tote, Goyard-pattern bag, Burberry-style check). All 26 product images + 4 collection heroes + homepage hero replaced with verified logo-free Unsplash photos matched to each product; every URL HEAD-checked 200 (the old city-uniform hero was already a dead 404).
- Removed hardcoded fallback to the internal sales prod collector in `SnowplowProvider.tsx`; tracker now no-ops with a console note when `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL` is unset (tests stub the env var).
- Documented all six env vars in `storefront/.env.example`.
- Verified: 25/25 tests, lint clean, build green, all five page types render 200 with graceful Signals-degradation (503 + console warning, no crash) when creds absent.

**2026-07-24 (agent, after manual review feedback):**

- Fixed cart hydration error: `CartProvider` read `localStorage` in its `useState` initializer, so SSR markup said `Cart (0)` while a client with a stored cart hydrated to a different count. Cart now starts empty and loads from storage after hydration (first persist skipped so the stored cart isn't wiped). Verified in browser: add item → reload → zero console errors, count persists.
- p5 (Sculpted Silver Cuff Watch) image was a plain cuff, not a watch; replaced with a logo-free silver watch-dial macro (quadrant-inspected at full res).
- p16 renamed Rose-Toned Chronograph → Rose-Toned Dress Watch (image has no sub-dials); slug, description, longDescription, and tags updated to dress-watch copy. No references outside `products.ts`.
