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
- [x] No Signals credentials or shared secret exposed client-side
- [ ] End-to-end check: browse deployed site → context endpoint returns that session's live attributes
- [x] Deploy steps documented in the runbook

## Blocked by

- `03-context-endpoint.md`
- `04-catalog-endpoint.md`

## Comments

**2026-07-27 (agent):** Prepped on branch `sandcastle/05-public-deploy`, per the agent constraint (no live deploy from this sandbox).

- `storefront/vercel.json`: sets the Next.js framework preset and `Cache-Control: no-store` / `X-Robots-Tag: noindex` headers on `/api/agent/*` so tool responses are never cached or indexed.
- `storefront/scripts/verify-deploy.ts` (+ `npm run verify:deploy`, tested in `verify-deploy.test.ts`): a post-deploy smoke test a human runs against the live URL — checks site reachability, that both agent endpoints reject unauthenticated requests (401), and that authorized requests return the expected payload shape (200). Manually verified against a local `next dev` server with `AGENT_SHARED_SECRET` set — all five checks pass; unset the header/secret and the two auth checks correctly flip to FAIL.
- `docs/runbook.md` new "§7 Deploy the storefront to Vercel" section: Root Directory setting (`storefront`, since the repo root's `package.json` is unrelated pipeline tooling), the full env var table split into Sensitive (credentials + `AGENT_SHARED_SECRET`, with a note to mint a fresh secret rather than reuse the local one and mirror it in the CX Agent Studio tool config from issue 06) vs `NEXT_PUBLIC_*` (client-exposed by design), deploy step, and post-deploy verification (`verify:deploy` plus the browser walkthrough). Added matching troubleshooting entries.
- No-client-side-exposure criterion ticked by inspection, not just assumption: grepped the five sensitive var names across `src/`, `signals/`, and `scripts/` — every reference is in a server-side route handler (`src/app/api/**`), `src/utils/agentAuth.ts`, or the Python publish config; none appear in any `"use client"` component.
- The three criteria needing a live public URL (reachability + live traffic, endpoints over public HTTPS, live session e2e check) stay unchecked — verified by the human after they run the deploy, per this issue's Agent constraint and Checkpoint.
- `npm --prefix storefront test` (87/87 passed) and `npm --prefix storefront run lint` (clean) both green.
