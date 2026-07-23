# 01 — Storefront foundation

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Bring the Atelier Signals luxury-fashion storefront into this repo as the demo's frontend. Copy the existing site from the field-resources demo-sites collection into the storefront directory, sweep all catalog data and copy for real trademarks (designer names, brand references — this ships in a public webinar), and confirm the app runs locally with its existing test suite passing. The original field-resources asset must remain untouched.

## Acceptance criteria

- [ ] Storefront app lives in this repo and installs/runs locally (dev server up, pages render: home, collection, product, cart, checkout)
- [ ] Existing vitest suite, lint, and build all pass
- [ ] Catalog data and site copy contain no real-world trademarks or brand names (fictional designers only)
- [ ] Env var template documents required Snowplow/Signals configuration
- [ ] Original site in field-resources unchanged

## Blocked by

None - can start immediately
