# 06 — CX Agent Studio agent + OpenAPI tools

Status: awaiting-human-test
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

The Google side: a concierge agent in CX Agent Studio (Snowplow-managed sandbox GCP project) with two OpenAPI tools pointing at the deployed endpoints — get-user-context and search-catalog. Agent instructions establish the luxury concierge persona and direct it to fetch user context at conversation start (session id arrives as a session context variable) and to ground recommendations in both the context payload and catalog results. API-key auth configured on the tools with the shared secret.

Verify in the console simulator by supplying a real session id manually (widget wiring is the next slice). GCP resources labelled `system=signals-gecx-demo`, `snowplow-owner=cc017`, `environment=dev` where labels apply.

Verify-at-build items from the PRD land here: session-context variable naming in tool definitions, CX Agent Studio availability in the sandbox project/region.

**Agent constraint:** prepare everything that lives in the repo — the two OpenAPI schema files (get-user-context, search-catalog) in the agent directory pointing at `https://signals-google-gecx-storefront.vercel.app/api/agent/*` with `x-agent-api-key` API-key auth (secret value itself never committed), the concierge persona / agent instructions as a repo file, and a runbook section covering console setup (agent creation, tool import, session-context variable wiring, API enablement, resource labels per policy). Do **not** touch the live GCP console — agent creation, tool configuration, and simulator verification are human-triggered; the acceptance criteria needing the live console are verified by the human afterwards. Where the PRD flags verify-at-build unknowns (session-context variable naming), document the options and the check the human should perform rather than guessing.

## Acceptance criteria

- [ ] Agent exists in the sandbox project; required APIs enabled; applicable resources labelled per policy
- [ ] Both tools defined from OpenAPI schemas (schemas stored in the repo's agent directory) and calling the deployed endpoints successfully
- [ ] Session id flows from a session context variable into the context tool request
- [ ] In the simulator with a freshly browsed session id: agent greets/responds with correct real-time context (favourite designer, cart contents) and recommends real catalog products
- [ ] Agent handles the degraded (unknown session) payload gracefully — generic concierge behaviour, no error talk
- [ ] Setup steps + agent instructions captured in the repo (agent directory + runbook)

## Blocked by

- `05-public-deploy.md`

## Parked by pipeline (2026-07-27 17:36)

Implementer flagged a spec conflict / blocker:

I've reviewed the issue, PRD, design doc, and coding standards. This issue is fundamentally blocked by live-resource requirements, not something I can partially route around without an explicit carve-out in the issue text.

## Why this is blocked

Issue `06-cx-agent-and-tools.md` asks for a CX Agent Studio agent to be created and verified inside a live, Snowplow-managed GCP sandbox project. Looking at each acceptance criterion:

1. **"Agent exists in the sandbox project; required APIs enabled; applicable resources labelled"** — requires live GCP console access and credentials to the Snowplow-managed sandbox project. Cannot be done from this sandbox.
2. **"Both tools ... calling the deployed endpoints successfully"** — the schema-authoring half is doable locally, but "calling the deployed endpoints successfully" can only be verified by actually configuring the tool in the live console and exercising it against the real Vercel deployment.
3. **"Session id flows from a session context variable into the context tool request"** — this is a live tool/session-context configuration step inside the CX Agent Studio console; naming is explicitly flagged in the PRD as a verify-at-build risk that can only be resolved by trying it in the actual product.
4. **"In the simulator with a freshly browsed session id: agent greets/responds with correct real-time context"** — requires browser access to the console simulator plus a real, freshly-browsed session id from the live deployed site.
5. **"Agent handles the degraded (unknown session) payload gracefully"** — same simulator/live dependency as above.
6. **"Setup steps + agent instructions captured in the repo"** — the one criterion that's pure repo documentation and would be agent-doable in isolation.

This is the same category of blocker as issue 05 (public deploy) — live credentials plus hands-on-console work this sandbox doesn't have. The difference is that issue 05's file contained an explicit **Agent constraint** section carving out exactly what prep work was authorized versus reserved for the human (and a pre-set `Checkpoint: human-test-required`). Issue 06 has neither: no Agent constraint scoping a prep-only pass, and no checkpoint flag. Per my Step 1 instructions, when an issue's work requires resources this sandbox cannot have (live credentials, browser access to a live console) and there's no such carve-out, I should not write code and should flag the conflict rather than guessing at scope.

**Recommendation:** if partial prep (OpenAPI schema files in `agent/`, concierge persona instructions, runbook setup steps) is wanted from an agent while the live console/simulator work stays with a human, add an explicit **Agent constraint** section to this issue (mirroring issue 05's) plus a `Checkpoint: human-test-required` line, and re-queue it. As written, the issue's core deliverable is live GCP/browser work this sandbox cannot execute.

No code was written and nothing was committed.

<promise>BLOCKED</promise>
**2026-07-27 (human/assistant):** Un-parked. Added the Agent constraint above
(mirroring issue 05's prep-only carve-out) and `Checkpoint: human-test-required`,
per the implementer's recommendation. Re-queued as ready-for-agent.
