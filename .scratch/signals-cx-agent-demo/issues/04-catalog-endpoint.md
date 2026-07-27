# 04 — Catalog search endpoint

Status: done

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

The agent's second tool: catalog search over the storefront's product data. Given optional filters — category, designer, occasion, colour, max price, free-text query — return matching products with the fields an agent needs to make a recommendation (name, designer, category, occasion, colour, price, product URL). Same shared-secret header auth as the context endpoint. Empty filter set returns a sensible bounded list, not the whole catalog unpaged.

Test at the route-handler seam alongside the context endpoint tests.

## Acceptance criteria

- [x] Endpoint filters correctly by each parameter individually and in combination
- [x] Free-text query matches against product name/description
- [x] Results bounded (limit) and shaped for LLM consumption
- [x] Shared-secret header enforced
- [x] Vitest coverage of filter semantics, bounds, and auth at the route seam

## Blocked by

- `01-storefront-foundation.md`

## Comments

**2026-07-24 (agent):** Implemented on branch `sandcastle/04-catalog-endpoint`.

- New route: `storefront/src/app/api/agent/catalog/route.ts` (`GET /api/agent/catalog`), filters: `category`, `designer`, `occasion`, `color`, `max_price`, `query`, `limit` — all optional, combinable, case-insensitive exact match except `query` (substring match against product name + description).
- Auth extracted to `storefront/src/utils/agentAuth.ts` (`isAuthorizedAgentRequest`), checking the `X-Agent-Api-Key` header against a new `AGENT_SHARED_SECRET` env var (documented in `.env.example`). The context endpoint (issue 03, not yet implemented in this checkout) should reuse this helper for the "same shared-secret header auth" the issue calls for.
- Default result limit 10, hard cap 25 regardless of requested `limit`; invalid/non-numeric `limit` or `max_price` values are ignored rather than erroring (graceful degradation, consistent with the PRD's tool-endpoint philosophy).
- Result shape per product: `{ name, designer, category, occasion, color, price, url }`, `url` built from the product slug (`/products/<slug>`).
- Tests: `storefront/src/app/api/agent/catalog/route.test.ts`, 17 cases covering auth accept/reject/misconfigured-secret, each filter individually, filter combinations, empty-match combination, free-text match on name and on description, limit bounding (default + cap + invalid), and result shape.
- `npm --prefix storefront test` (44/44 passed) and `npm --prefix storefront run lint` (clean) both green.
