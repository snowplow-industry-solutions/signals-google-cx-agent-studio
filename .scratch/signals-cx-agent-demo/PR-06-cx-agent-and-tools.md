# PR: 06 — CX Agent Studio agent + OpenAPI tools

**Branch:** sandcastle/06-cx-agent-and-tools
**Issue:** .scratch/signals-cx-agent-demo/issues/06-cx-agent-and-tools.md

## Summary

This PR delivers the agent-doable preparation for the CX Agent Studio concierge agent: two fully-authored OpenAPI schema files (getUserContext and searchCatalog) matching the deployed Vercel endpoints, the concierge persona and tool-use instructions, and a complete runbook section covering agent creation, tool import, session-context variable wiring, and simulator verification. The live agent creation and console verification are human-triggered per the Agent constraint; this branch provides everything the repo side needs to author.

## Changes

**Agent directory structure:**
- `agent/README.md` — overview and index of the agent artifacts
- `agent/instructions.md` — full concierge persona, tool-use contract (one-call-per-turn context fetching, catalog-grounded recommendations), and degraded-session fallback behavior
- `agent/tools/get-user-context.openapi.yaml` — OpenAPI 3.0 schema for the context tool (`GET /api/agent/context`), with session_id parameter and documentation of the session-context variable binding placeholder
- `agent/tools/search-catalog.openapi.yaml` — OpenAPI 3.0 schema for the catalog search tool (`GET /api/agent/catalog`), with category/occasion/color enums pulled from the storefront's commerce types

**Documentation:**
- `docs/runbook.md` new §8 ("CX Agent Studio setup") — API enablement, resource labeling per policy, agent creation, tool import (table mapping each schema file to its console tool), API-key auth setup (reusing the §7 `AGENT_SHARED_SECRET`), session-context variable wiring (documents candidates to try and the verification check), and simulator verification steps for both live-session and degraded-session scenarios. New troubleshooting entries for tool 401s, simulator binding failures, and CX Agent Studio availability.

**Issue updates:**
- `.scratch/signals-cx-agent-demo/issues/06-cx-agent-and-tools.md` ticked one acceptance criterion (setup steps + agent instructions captured) and added comments documenting what was prepared on this branch per the Agent constraint.

## Pipeline review record

- **Implement (3b73119–b981296):** Agent authored three commits preparing OpenAPI schemas, agent instructions, and runbook section 8, then ticked the agent-doable acceptance criterion.

## Manual testing plan

### Prerequisites

- Storefront deployed and publicly reachable per issue 05-public-deploy (§7 complete)
- `AGENT_SHARED_SECRET` minted and configured on the deployed Vercel environment (§7)
- Access to the Snowplow-managed sandbox GCP project with CX Agent Studio console permissions
- A browser capable of accessing the live deployed storefront and the CX Agent Studio simulator

### Verification steps

#### Criterion 1: Agent exists in the sandbox project; required APIs enabled; applicable resources labelled per policy

Run through `docs/runbook.md` §8.1 and §8.2:

1. Open the CX Agent Studio console in the Snowplow sandbox GCP project.
2. Confirm CX Agent Studio (Gemini Enterprise for CX) is available in the project's region; if not available, check the enabled APIs and region settings (this is a flagged verify-at-build risk).
3. Create a new customer-facing agent.
4. Paste the full contents of `agent/instructions.md` into the agent's instructions field.
5. Label the agent and any associated resources with: `system=signals-gecx-demo`, `snowplow-owner=cc017`, `environment=dev`.

**Expected result:** Agent created and labeled. Record the agent's ID/name here for reference: `<PLACEHOLDER>`.

#### Criterion 2: Both tools defined from OpenAPI schemas (schemas stored in the repo's agent directory) and calling the deployed endpoints successfully

Run through `docs/runbook.md` §8.3:

1. In the agent, create a new OpenAPI tool and import `agent/tools/get-user-context.openapi.yaml`.
2. Set the tool's API-key authentication: header name `x-agent-api-key`, value = the exact `AGENT_SHARED_SECRET` from the Vercel deploy (§7), not a local `.env.local` value.
3. Test the tool using the console's test affordance (e.g., tool try-it feature). Provide a valid session id (you'll get a real one in §4 below) in the `session_id` parameter.
4. Confirm the tool returns 200 with a well-formed context payload.
5. Repeat steps 1–4 for `agent/tools/search-catalog.openapi.yaml`, using a test call with a `category` parameter (e.g., `Accessories`) to confirm real catalog results are returned.

**Expected result:** Both tools imported, authenticated, and returning live data from the deployed endpoints. Record tool IDs here: `getUserContext: <PLACEHOLDER>`, `searchCatalog: <PLACEHOLDER>`.

**If it fails:**
- Tool test returns 401: verify the header name is exactly `x-agent-api-key` and the key value matches the Vercel `AGENT_SHARED_SECRET` (not a local one).
- Tool test fails with a network error: confirm the storefront URL in `servers[0].url` in both schema files matches the deployed URL, and the Vercel deployment is publicly reachable (`npm --prefix storefront run verify:deploy` from the repo).

#### Criterion 3: Session id flows from a session context variable into the context tool request

Run through `docs/runbook.md` §8.4:

1. In the `getUserContext` tool's parameter mapping, locate the session-context / conversation-context variable picker (candidates: `$session.params.*`, `$context.*`, or a "session parameters" section tied to widget `setQueryParameters`).
2. Bind `session_id` to the appropriate variable.
3. In the simulator, manually set that session-context variable to a test value (e.g., `test-session-123`).
4. Open the chat and trigger a tool call (e.g., send any message to the agent).
5. In the console's execution trace/log, inspect the `getUserContext` tool's request and confirm the `session_id` query parameter is populated with the value you set (not empty or missing).

**Expected result:** Session-context variable successfully bound; tool request includes the session_id. Record the working variable name here: `<PLACEHOLDER: confirmed session-context variable name>`.

**If it fails:** The tool request trace shows an empty or missing `session_id` — the binding is incorrect. Try the next candidate variable name from §8.4 and repeat until one works.

#### Criterion 4: In the simulator with a freshly browsed session id: agent greets/responds with correct real-time context (favourite designer, cart contents) and recommends real catalog products

Run through `docs/runbook.md` §8.5, steps 1–3:

1. Open the deployed storefront in a fresh browser window/session.
2. Browse at least one product (to populate browsing context) and add an item to the cart.
3. Open the browser's Network tab or Application tab and find the `domain_sessionid` cookie / Snowplow event — record this session id.
4. In the CX Agent Studio simulator, set the session-context variable (from criterion 3) to this real session id.
5. Open the chat and send a message (e.g., "Hi there" or "What do you recommend?").
6. Confirm: the agent's reply references your real session's context without the human stating anything about browsing (e.g., mentions your favorite designer from the profile, acknowledges items in your cart, or references a recent product view).
7. If the agent makes a product recommendation, confirm it's a real product name, designer, and price from the catalog (not invented), and it matches filters from your browsing context (e.g., your favourite designer or category).

**Expected result:** Agent greets with real-time context and grounds recommendations in actual catalog products. Record the result (pass/fail, timestamp, any observed context details) here: `<PLACEHOLDER: live-session verification run log>`.

**If it fails:**
- Agent asks "who are you" or requests browsing details: the session-context variable binding (criterion 3) isn't reaching the tool. Check the tool trace for an empty `session_id`.
- Agent recommends non-existent products: confirm the searchCatalog tool is calling the real deployed endpoint and returning real results (criterion 2).
- Context shows as empty/unknown: the session id may not have been stored yet (Signals may need a few seconds to index the session). Try a second message or refresh the storefront page in the browser and try again.

#### Criterion 5: Agent handles the degraded (unknown session) payload gracefully — generic concierge behaviour, no error talk

Run through `docs/runbook.md` §8.5, steps 4–5:

1. In the simulator, set the session-context variable to a made-up value (e.g., `nonexistent-session-xyz`) or clear it entirely (if the console allows).
2. Open the chat and send a message (e.g., "Hi there").
3. Confirm: the agent does **not** say anything about missing data, errors, or "I don't know you" — instead, it responds with generic, warm concierge behavior (greets the shopper, asks what they're looking for, what occasion, etc.), exactly as if meeting a new customer in-store.
4. If the agent makes a recommendation, confirm it uses `searchCatalog` with filters from what the shopper stated in chat (not from an empty/unknown context).

**Expected result:** Agent falls back gracefully to generic concierge persona. No error messaging, no technical jargon. Record the result (pass/fail, timestamp, sample agent response) here: `<PLACEHOLDER: degraded-session verification run log>`.

**If it fails:**
- Agent says something like "I couldn't find your session" or "Session not found": the agent's instructions are not being used. Re-check that `agent/instructions.md` was pasted verbatim into the agent's instructions field in §1.

## Rollback

On merge, `git revert -m 1 <merge-commit-sha>` to undo, or `git branch -D sandcastle/06-cx-agent-and-tools` to delete the branch.
