# 04 — Catalog search endpoint

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

The agent's second tool: catalog search over the storefront's product data. Given optional filters — category, designer, occasion, colour, max price, free-text query — return matching products with the fields an agent needs to make a recommendation (name, designer, category, occasion, colour, price, product URL). Same shared-secret header auth as the context endpoint. Empty filter set returns a sensible bounded list, not the whole catalog unpaged.

Test at the route-handler seam alongside the context endpoint tests.

## Acceptance criteria

- [ ] Endpoint filters correctly by each parameter individually and in combination
- [ ] Free-text query matches against product name/description
- [ ] Results bounded (limit) and shaped for LLM consumption
- [ ] Shared-secret header enforced
- [ ] Vitest coverage of filter semantics, bounds, and auth at the route seam

## Blocked by

- `01-storefront-foundation.md`
