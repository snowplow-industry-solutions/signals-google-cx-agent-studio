# Signals × Gemini Enterprise CX — Demo Integration Design

**Goal:** Public marketing webinar demo (possibly Google co-branded) showing a customer-facing agent built in Google Gemini Enterprise for CX (CX Agent Studio) pulling real-time behavioural context from Snowplow Signals.

**Deliverable:** Session recording by **Thursday 7 August 2026**.

## Architecture

```
Atelier Signals storefront (Next.js, Vercel)
 ├─ Snowplow browser tracker → Snowplow free-trial pipeline → Signals
 ├─ ces-messenger chat widget ──────────────┐
 │    setQueryParameters({domain_sessionid})│
 └─ /api/agent/* routes (server-side)       │
      ▲                                     ▼
      │  OpenAPI tool call         CX Agent Studio agent
      │  (API-key header,          (Snowplow sandbox GCP project)
      │   session id via
      │   x-ces-session-context)
      ▼
 Snowplow Signals API (Profile Store attributes + Agentic Context event log)
```

## Decisions (grilling session, 23 Jul 2026)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Integration mechanism | CX Agent Studio agent + OpenAPI tool calling REST at query time — **not** a custom connector/data store | Connectors are synced search indexes: 3-hour minimum incremental sync, semantic retrieval not keyed lookup. Kills the real-time story. Verified: [connectors intro](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/introduction-to-connectors-and-data-stores), [OpenAPI tools](https://docs.cloud.google.com/gemini-enterprise-cx/cx-agent-studio/tool/open-api) |
| 2 | Product surface | Gemini Enterprise **CX** (CX Agent Studio), not the knowledge-worker Gemini Enterprise app | Demo is a customer-facing agent. Knowledge-worker path (ADK agent registration) is employee-facing |
| 3 | Snowplow environment | Snowplow Free Trial org (full pipeline + Signals). Fallback: existing dev/sandbox pipeline | Fastest path; trial is time-boxed so all setup must be scripted/documented for re-creation |
| 4 | Frontend | Copy of existing **Atelier Signals** demo site (`field-resources/demo-sites/fashion-retailer-signals`) | Luxury fashion storefront purpose-built for Signals demos: snowtype tracking, Signals config-as-code, session util, working `/api/signals/attributes` proxy already in place |
| 5 | Tool endpoint hosting | Extend the site's own Next.js API routes; deploy whole site to **Vercel** | Auth/SDK plumbing exists; one deployable; OpenAPI tool only needs a public HTTPS endpoint — provider irrelevant |
| 6 | Chat widget | **ces-messenger** web component ([GoogleCloudPlatform/ces-messenger](https://github.com/GoogleCloudPlatform/ces-messenger)) | Official CES Next-Gen widget. `setQueryParameters()` passes `domain_sessionid` from the `_sp_id` cookie into the agent session; `x-ces-session-context` injects it into tool calls. Verified |
| 7 | GCP project | Snowplow-managed sandbox GCP project | Labels on all resources: `system=signals-gecx-demo`, `snowplow-owner=cc017`, `environment=dev` |
| 8 | Agent scope | **Concierge tier**: `get_user_context` (Signals) + `search_catalog` (site catalog) tools | Context drives visible action, not just flavour text. Stretch: client-side function rendering product cards in chat |
| 9 | Signals payload | **Single merged tool response**: Profile Store service attributes (structured) + **Agentic Context** narrative ([docs](https://docs.snowplow.io/docs/signals/agentic-contexts/)) | One round trip per turn; shows both aggregate taste profile and live session story. New `EventLog` definition added beside existing attribute group |
| 10 | Repo layout | This repo: `storefront/` (site copy), `agent/` (OpenAPI spec, agent instructions, CX setup), `docs/` (runbook, demo script) | Self-contained; original field-resources asset untouched |

## Tool contract (draft)

`GET /api/agent/context?session_id=...` → 
```json
{
  "profile": { "favorite_designer": "…", "favorite_category": "…", "high_intent_product_ids": [], "cart_value_band": "…", "checkout_stage": "…" },
  "recent_activity": "<agentic context narrative>",
  "agent_instructions": "<prompt from EventLog definition>"
}
```

`GET /api/agent/catalog?category=&designer=&occasion=&color=&max_price=&query=` → product list from `src/data` catalog.

Both routes: shared-secret header (`X-Agent-Api-Key`) checked server-side; key configured in the OpenAPI tool's API-key auth (Secret Manager-backed if supported).

## Signals additions

- New `EventLog` (agentic context), e.g. `fashion_session_activity`: events `product_viewed`, `cart_updated`, `checkout_started`; properties: product name, designer, category, occasion, price, cart action, checkout step. `attribute_key=domain_sessionid`. `prompt`: concierge interpretation instructions. Note: unversioned — publish replaces live; max window 3600s / 100 events.
- Existing `fashion_ecommerce_session_attributes` v1 + `fashion_ecommerce_demo` service published unchanged to the trial org.

## Webinar-driven requirements

- **Brand sweep**: catalog/copy must contain no real trademarks (public webinar). Check `storefront/src/data`.
- **Naming correctness**: use current official Google product names (Gemini Enterprise for CX / CX Agent Studio / CES) in all materials.
- **Choreography**: browse products *before* opening chat so stream attributes are already in the Profile Store.
- **Fallback**: seeded session with known-good attributes; site debug panel to show live attribute state to the audience.

## Known risks / verify-at-build

1. Exact mapping of widget query parameters → `$context.*` variable names in tool config (mechanism verified, naming not).
2. Two widget generations exist (`chat-messenger` on gstatic docs vs `ces-messenger` on GitHub) — pin whichever supports `setQueryParameters` against our agent.
3. CX Agent Studio availability/allowlisting in the sandbox GCP project region.
4. Free-trial limits (event volume, Signals features enabled, trial duration vs Aug 7).
5. Agentic Contexts is new — SDK version in `pyproject.toml` may need bumping for `EventLog`.

## Timeline (target)

| Dates | Phase |
|-------|-------|
| Jul 23–25 | Repo setup, copy site, brand sweep, run locally |
| Jul 25–29 | Trial org: pipeline + publish Signals config (attributes + EventLog), verify attributes flow |
| Jul 28–30 | Agent API routes + Vercel deploy |
| Jul 30–Aug 4 | CX agent, OpenAPI tool, widget embed, session-param wiring (most unknowns) |
| Aug 4–6 | Demo script, rehearse, record |
| Aug 7 | Deliver recording |
