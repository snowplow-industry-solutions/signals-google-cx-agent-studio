# 05 — Public deploy to Vercel

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Deploy the storefront to Vercel so the agent-facing endpoints are reachable over public HTTPS (the OpenAPI tool requirement) and the demo site itself is publicly browsable. Signals credentials and the shared secret configured as server-side env vars; tracker pointed at the trial collector in the deployed environment.

## Acceptance criteria

- [ ] Site publicly reachable; browse flow works and events land in the trial pipeline from the deployed site
- [ ] Context and catalog endpoints respond over public HTTPS with correct auth enforcement
- [ ] No Signals credentials or shared secret exposed client-side
- [ ] End-to-end check: browse deployed site → context endpoint returns that session's live attributes
- [ ] Deploy steps documented in the runbook

## Blocked by

- `03-context-endpoint.md`
- `04-catalog-endpoint.md`
