# 05 — Public deploy to Vercel

Status: ready-for-agent
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Deploy the storefront to Vercel so the agent-facing endpoints are reachable over public HTTPS (the OpenAPI tool requirement) and the demo site itself is publicly browsable. Signals credentials and the shared secret configured as server-side env vars; tracker pointed at the trial collector in the deployed environment.

**Agent constraint:** prepare everything (Vercel config, env var documentation, deploy scripts, runbook steps) but do **not** execute the public deploy. The deploy itself is human-triggered — the acceptance criteria below are verified by the human after they run the deploy.

## Acceptance criteria

- [ ] Site publicly reachable; browse flow works and events land in the trial pipeline from the deployed site
- [ ] Context and catalog endpoints respond over public HTTPS with correct auth enforcement
- [ ] No Signals credentials or shared secret exposed client-side
- [ ] End-to-end check: browse deployed site → context endpoint returns that session's live attributes
- [ ] Deploy steps documented in the runbook

## Blocked by

- `03-context-endpoint.md`
- `04-catalog-endpoint.md`
