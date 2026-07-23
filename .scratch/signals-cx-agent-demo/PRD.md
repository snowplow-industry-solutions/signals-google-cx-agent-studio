# PRD: Signals × Gemini Enterprise CX Concierge Demo

Status: ready-for-agent

## Problem Statement

Snowplow needs to show prospective customers and partners that a customer-facing agent built in Google Gemini Enterprise for CX (CX Agent Studio) can be grounded in real-time behavioural context from Snowplow Signals. Today no demo exists: AI agents in chat widgets greet every visitor identically, blind to what the visitor was just doing on the site. Marketing has committed to a public webinar (possibly Google co-branded) and requested a session recording by 7 August 2026.

## Solution

A luxury-fashion storefront ("Atelier Signals") instrumented with Snowplow tracking, with a CX Agent Studio concierge agent embedded via the ces-messenger chat widget. As the shopper browses, events stream through a Snowplow pipeline into Signals. When the shopper opens the chat, the widget passes their Snowplow session ID into the agent session; on each turn the agent's OpenAPI tool fetches a merged context payload — Profile Store attributes (aggregate taste profile) plus the Agentic Context narrative (live session story) — and a catalog search tool lets the agent act on that context with concrete product recommendations. The demo visibly proves: browse → chat → the agent already knows.

## User Stories

1. As a webinar viewer, I want to see the agent greet a shopper with awareness of what they just browsed, so that the real-time value of Signals is immediately obvious.
2. As a webinar viewer, I want to see the shopper's browsing happen live before the chat opens, so that I trust the context is computed in real time rather than staged.
3. As a shopper, I want the concierge to know my favourite designer, category, and colour preferences from my current session, so that its advice feels personal without me repeating myself.
4. As a shopper, I want the concierge to know which products I added to my cart, so that it can answer questions about them and suggest complements.
5. As a shopper, I want the concierge to know how far I progressed through checkout, so that it can reassure or assist me at the right step.
6. As a shopper, I want the concierge to recommend concrete products from the catalog that match my in-session taste, so that the conversation leads somewhere actionable.
7. As a shopper, I want my chat session to link to my browsing session automatically, so that I never have to identify myself or paste an ID.
8. As the demo presenter, I want a scripted browse-then-chat choreography, so that stream attributes are already in the Profile Store when the chat opens and there is no dead air.
9. As the demo presenter, I want an on-page debug panel showing the live attribute values, so that I can prove to the audience the context is real.
10. As the demo presenter, I want a seeded fallback session with known-good attributes, so that a pipeline hiccup does not ruin the recording.
11. As the demo presenter, I want the agent's tool calls to return quickly (single merged context call per turn), so that conversation latency stays demo-friendly.
12. As a field team member, I want a runbook covering Snowplow trial-org setup, Signals publishing, GCP agent setup, widget wiring, and hosting deployment, so that I can re-create the demo after the trial org expires.
13. As a field team member, I want the Signals configuration (attribute groups, service, agentic context) defined as code with a publish script, so that re-provisioning is a command, not console clicking.
14. As a marketing stakeholder, I want the storefront free of real trademarks and the Google product names used correctly, so that the public webinar carries no legal or credibility risk.
15. As the agent, I want a single context tool returning structured profile attributes, a plain-language recent-activity narrative, and interpretation instructions, so that I can ground every response in one round trip.
16. As the agent, I want a catalog search tool filterable by category, designer, occasion, colour, and price, so that I can turn behavioural context into specific recommendations.
17. As a developer, I want the agent-facing endpoints protected by a shared-secret header, so that only the configured agent tool can query shopper context.
18. As a developer, I want the context endpoint to degrade gracefully (empty profile, missing narrative, unknown session), so that the agent receives a well-formed payload rather than an error mid-demo.
19. As a developer, I want automated tests on the agent-facing HTTP contract, so that refactors before the recording date cannot silently break the tool integration.
20. As a Snowplow platform owner, I want all GCP resources labelled per the internal tagging policy, so that the sandbox project stays compliant.
21. As a future maintainer, I want the demo repo self-contained with design decisions and ADR-ready documentation, so that the eventual public GitHub repo is usable by others.

## Implementation Decisions

- **Integration mechanism is an agent tool, not a data connector.** Gemini Enterprise custom connectors are synced search indexes (3-hour minimum incremental sync, semantic retrieval); they cannot serve keyed real-time profile lookups. The agent calls a REST endpoint at conversation time via a CX Agent Studio OpenAPI tool.
- **Product surface is CX Agent Studio** (Gemini Enterprise for CX), not the knowledge-worker Gemini Enterprise app — the demo is customer-facing.
- **Storefront is a copy of the existing Atelier Signals fashion demo site** (Next.js), placed in the storefront directory of this repo; the original field-resources asset stays untouched. Deployed to Vercel — the OpenAPI tool only needs a public HTTPS endpoint.
- **The storefront's own server-side API routes serve as the tool endpoint.** Two agent-facing operations:
  - Context: takes a session identifier; returns `{ profile, recent_activity, agent_instructions }` — flattened Profile Store service attributes, the Agentic Context narrative, and the prompt from the agentic context definition.
  - Catalog: takes optional category / designer / occasion / colour / max-price / free-text query filters; returns matching products from the site's catalog data.
  - Both check a shared-secret header configured in the OpenAPI tool's API-key auth. Both return well-formed degraded payloads on unknown sessions or upstream failure.
- **Signals payload merges two retrieval flavours in one call**: existing `fashion_ecommerce_session_attributes` stream attribute group (v1, keyed `domain_sessionid`, served via the `fashion_ecommerce_demo` service) plus a new Agentic Context `EventLog` definition covering product-view, cart-update, and checkout events with product name/designer/category/occasion/price properties and a concierge interpretation prompt. Agentic contexts are unversioned with a max 3600-second window — acceptable for the demo.
- **Identity flows through the widget**: page script reads `domain_sessionid` from the Snowplow `_sp_id` cookie and calls the ces-messenger `setQueryParameters` API; the tool definition injects it into requests via the session-context extension. Exact parameter-to-context variable naming is a verify-at-build item.
- **Chat widget is ces-messenger** (Google's open-source CES Next-Gen web component) embedded in the storefront layout, using the managed token broker with public access for the demo.
- **Snowplow environment is a Free Trial org** (full pipeline + Signals). All Signals definitions publish from code so the environment is reproducible when the trial expires.
- **The CX agent lives in the Snowplow-managed sandbox GCP project**, resources labelled `system=signals-gecx-demo`, `snowplow-owner=cc017`, `environment=dev`.
- **Agent scope is concierge tier**: context tool + catalog tool. Client-side product-card rendering in chat (`registerClientSideFunction`) is a stretch goal, not core.
- **Webinar constraints are requirements**: trademark sweep of catalog data, current official Google product naming throughout, browse-before-chat demo choreography, seeded fallback session, recording delivered by 7 August 2026.

## Testing Decisions

- Tests assert external behaviour at the highest seam: the agent-facing HTTP route handlers, invoked as functions (Request in, Response out), with the Signals SDK mocked at the module boundary. This seam is the exact contract the CX Agent Studio tool depends on.
- Covered through that one seam: shared-secret auth acceptance/rejection, session-identifier validation, profile + narrative merge and flattening, catalog filter semantics, degraded-payload shapes on unknown session and upstream failure.
- No tests of implementation details (no asserting on internal function calls beyond the mocked SDK boundary); no separate seam for payload-flattening helpers unless route-level testing proves awkward.
- Prior art: the storefront copy ships with vitest and existing util/component tests (tracking and personalization suites) — new route tests follow the same vitest conventions.
- Everything outside the codebase (widget wiring, agent + tool configuration, Signals publishing, end-to-end freshness) is verified via runbook checklist steps and the recorded demo run, not automated tests.

## Out of Scope

- Live-audience failover beyond the seeded fallback session (deliverable is a recording, not a live stage demo).
- The knowledge-worker Gemini Enterprise path (ADK agent registration, Agent Engine) — documented as an alternative in the design doc only.
- Custom connector / data store integration of any kind.
- Signals Interventions (the site contains intervention scaffolding; the demo does not showcase it).
- Warehouse-sourced (batch) attributes — stream attributes only.
- Production-grade auth (OAuth end-user flows, token brokers beyond the managed public one), rate limiting, or multi-tenant concerns.
- Porting the demo to other agent platforms (Bedrock AgentCore accelerator already exists separately).
- Publishing the repo to GitHub (pending IT provisioning of `snowplow-industry-solutions/signals-google-cx-agent-studio`; migration steps recorded in the issue tracker doc).

## Further Notes

- Full decision log with verification citations: `docs/design.md`.
- Verify-at-build risks: widget query-parameter → tool context variable naming; two widget generations (`chat-messenger` vs `ces-messenger`) — pin whichever supports `setQueryParameters` against our agent; CX Agent Studio availability/allowlisting in the sandbox project region; free-trial limits vs the 7 August date; Signals SDK version support for the `EventLog` (Agentic Context) API.
- Target phasing lands core integration by ~4 August, leaving rehearsal/recording buffer.

## Comments
