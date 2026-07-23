# 06 — CX Agent Studio agent + OpenAPI tools

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

The Google side: a concierge agent in CX Agent Studio (Snowplow-managed sandbox GCP project) with two OpenAPI tools pointing at the deployed endpoints — get-user-context and search-catalog. Agent instructions establish the luxury concierge persona and direct it to fetch user context at conversation start (session id arrives as a session context variable) and to ground recommendations in both the context payload and catalog results. API-key auth configured on the tools with the shared secret.

Verify in the console simulator by supplying a real session id manually (widget wiring is the next slice). GCP resources labelled `system=signals-gecx-demo`, `snowplow-owner=cc017`, `environment=dev` where labels apply.

Verify-at-build items from the PRD land here: session-context variable naming in tool definitions, CX Agent Studio availability in the sandbox project/region.

## Acceptance criteria

- [ ] Agent exists in the sandbox project; required APIs enabled; applicable resources labelled per policy
- [ ] Both tools defined from OpenAPI schemas (schemas stored in the repo's agent directory) and calling the deployed endpoints successfully
- [ ] Session id flows from a session context variable into the context tool request
- [ ] In the simulator with a freshly browsed session id: agent greets/responds with correct real-time context (favourite designer, cart contents) and recommends real catalog products
- [ ] Agent handles the degraded (unknown session) payload gracefully — generic concierge behaviour, no error talk
- [ ] Setup steps + agent instructions captured in the repo (agent directory + runbook)

## Blocked by

- `05-public-deploy.md`
