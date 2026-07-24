# PR: 04 — Catalog search endpoint

**Branch:** sandcastle/04-catalog-endpoint
**Issue:** .scratch/signals-cx-agent-demo/issues/04-catalog-endpoint.md

## Summary

Implements the agent's second tool: a `GET /api/agent/catalog` endpoint for searching the storefront's product catalog with optional filters (category, designer, occasion, color, max price, free-text query). Results are bounded and shaped for LLM consumption. Auth is enforced via shared-secret header, using a new helper function also intended for the context endpoint.

## Changes

- **New endpoint** `storefront/src/app/api/agent/catalog/route.ts`: Filters products by category, designer, occasion, color, max_price, and free-text query (substring match on name + description). All parameters optional and combinable. Results capped at 25, default 10. Response includes only fields an agent needs: name, designer, category, occasion, color, price, product URL.
- **Auth helper** `storefront/src/utils/agentAuth.ts`: Extracted `isAuthorizedAgentRequest()` to check `X-Agent-Api-Key` header against `AGENT_SHARED_SECRET` env var. Shared between agent-facing endpoints.
- **Tests** `storefront/src/app/api/agent/catalog/route.test.ts`: 17 Vitest cases covering auth (accept/reject/misconfigured), each filter individually, filter combinations, empty matches, free-text query on name and description, limit bounding (default + cap + invalid input), and response shape.
- **Env config** `storefront/.env.example`: Documented `AGENT_SHARED_SECRET` (server-side only, mirrored in CX Agent Studio tool's API-key auth).
- **Issue** `.scratch/signals-cx-agent-demo/issues/04-catalog-endpoint.md`: Ticked all acceptance criteria.

## Pipeline review record

- Implement: 11d4cc4 (auth helper) + 4d926ca (catalog endpoint)
- Review: approved, no fixes needed
- Final: b8357b8 (tick acceptance criteria)

## Manual testing plan

### Prerequisites

1. **Dev server**: Storefront running on `http://localhost:3000`
   ```bash
   npm --prefix storefront run dev
   ```
   (Opens automatically; wait for the server to be ready.)

2. **Env setup**: In `storefront/.env.local` (or `.env.development.local`), ensure:
   ```
   AGENT_SHARED_SECRET=test-secret-key
   ```
   (You can use any value for local testing; the test suite uses `test-shared-secret`.)

3. **Verify setup**: Confirm tests pass
   ```bash
   npm --prefix storefront test
   ```
   Expected: 44/44 tests passing.

### Test steps

#### 1. Auth enforcement
- **No header**: `curl -s http://localhost:3000/api/agent/catalog`
  - Expected: `401 Unauthorized`
- **Wrong header**: `curl -s -H "X-Agent-Api-Key: wrong" http://localhost:3000/api/agent/catalog`
  - Expected: `401 Unauthorized`
- **Correct header**: `curl -s -H "X-Agent-Api-Key: test-secret-key" http://localhost:3000/api/agent/catalog`
  - Expected: `200 OK`, JSON with `results` array

#### 2. Unfiltered results (bounded list)
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" http://localhost:3000/api/agent/catalog | jq '.results | length'
```
Expected: A number between 1 and 10 (the default limit).

#### 3. Filter by category
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?category=Dresses" | jq '.results[] | .category'
```
Expected: All results have `category: "Dresses"`.

#### 4. Filter by designer (case-insensitive)
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?designer=maison%20cendre" | jq '.results[] | .designer'
```
Expected: All results have `designer: "Maison Cendre"` (note: matches case-insensitively, returns canonical case).

#### 5. Filter by occasion
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?occasion=Evening" | jq '.results[] | .occasion'
```
Expected: All results have `occasion: "Evening"`.

#### 6. Filter by color
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?color=Black" | jq '.results[] | .color'
```
Expected: All results have `color: "Black"`.

#### 7. Filter by max price
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?max_price=500" | jq '.results[] | .price'
```
Expected: All prices ≤ 500.

#### 8. Combine multiple filters
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?category=Tailoring&designer=Maison%20Cendre&occasion=Workwear" \
  | jq '.results[]'
```
Expected: Results matching all three filters. Each result has `category: "Tailoring"`, `designer: "Maison Cendre"`, `occasion: "Workwear"`.

#### 9. Free-text query on product name
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?query=Cashmere%20Wrap" | jq '.results[] | .name'
```
Expected: Results include products with "Cashmere Wrap" (case-insensitive substring match) in the name.

#### 10. Free-text query on product description
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?query=gallery-like%20presence" | jq '.results[] | .name'
```
Expected: Results include products with that phrase in their description (case-insensitive substring match).

#### 11. Empty filter combination
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?category=Shoes&color=Ivory&designer=Arc%20Studio" | jq '.results'
```
Expected: Empty array (no products match all three criteria).

#### 12. Invalid filter values (graceful degradation)
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?max_price=not-a-number" | jq '.results | length'
```
Expected: `200 OK`, valid results (invalid max_price is ignored, not an error).

#### 13. Limit bounding
- **Default limit**: `curl -s -H "X-Agent-Api-Key: test-secret-key" http://localhost:3000/api/agent/catalog | jq '.results | length'`
  - Expected: ≤ 10
- **Custom limit (within bounds)**: `curl -s -H "X-Agent-Api-Key: test-secret-key" "http://localhost:3000/api/agent/catalog?limit=5" | jq '.results | length'`
  - Expected: ≤ 5
- **Custom limit (exceeds max)**: `curl -s -H "X-Agent-Api-Key: test-secret-key" "http://localhost:3000/api/agent/catalog?limit=1000" | jq '.results | length'`
  - Expected: ≤ 25 (capped at MAX_LIMIT)
- **Invalid limit**: `curl -s -H "X-Agent-Api-Key: test-secret-key" "http://localhost:3000/api/agent/catalog?limit=not-a-number" | jq '.results | length'`
  - Expected: ≤ 10 (falls back to default)

#### 14. Response shape
```bash
curl -s -H "X-Agent-Api-Key: test-secret-key" \
  "http://localhost:3000/api/agent/catalog?limit=1" | jq '.results[0]'
```
Expected output (sample):
```json
{
  "name": "Camel Cashmere Wrap Coat",
  "designer": "Maison Cendre",
  "category": "Outerwear",
  "occasion": "Everyday",
  "color": "Camel",
  "price": 1200,
  "url": "/products/camel-cashmere-wrap-coat"
}
```
Verify: Each result has exactly these 7 fields, all populated, `url` starts with `/products/`.

### If it fails

- **401 Unauthorized on all requests**: Check that `AGENT_SHARED_SECRET` is set in `.env.local` (or whichever env file the server is reading). Restart the dev server after updating the env.
- **Filter not working**: Verify the filter parameter name is lowercase and spelled correctly (e.g., `max_price`, not `maxPrice`). Check that the product data in `storefront/src/data/products.ts` contains products matching your filter criteria.
- **No results**: Try with `?limit=1` to see if any results exist at all. Then check the filter criteria against the actual product data.
- **Response shape missing fields**: Confirm the endpoint code in `storefront/src/app/api/agent/catalog/route.ts` includes the field in the `toCatalogResult()` function.

## Rollback

To undo this feature:
```bash
git revert -m 1 <merge-commit-hash>
```
(Once merged to main, replace `<merge-commit-hash>` with the merge commit's hash. For now on this branch, simply `git reset --hard main` if needed before merge.)
