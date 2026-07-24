# 02a — Live pipeline prep: env wiring, publish dry-run, runbook skeleton

Status: awaiting-human-test

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

Split from `02-live-pipeline.md`: this is the agent-doable half. The human half (trial org signup, credentials, live end-to-end proof) is `02b-trial-org.md`.

## What to build

Prepare everything that can be done *before* the Snowplow Free Trial org exists, so that once a human creates the org (02b), going live is a fill-in-the-blanks exercise:

- Wire the storefront tracker so collector URL and app ID come from env config (no hardcoded endpoints); document the exact env vars in `.env.example`.
- Make the Signals config-as-code publish script (fashion ecommerce stream attribute group + service) runnable with credentials supplied via env; verify it fails fast with a clear message when credentials are missing, and that `--dry-run` validates the config as far as possible without a live org.
- Write the runbook skeleton (`docs/runbook.md` or similar): org creation steps, credential capture (API URL, key, key ID, org ID), env setup, publish steps (dry-run then real), and an end-to-end verification section — with placeholders where live values go.

## Acceptance criteria

- [x] Storefront tracker reads collector URL + app ID from env; `.env.example` documents every required var
- [x] Publish script runs with env-supplied credentials, exits with a clear error when they're absent, and dry-run validates config locally
- [x] Runbook skeleton covers org creation → credentials → env setup → publish → verification, with explicit placeholders for live values
- [x] No credentials or org-specific values committed

## Blocked by

- `01-storefront-foundation.md`
