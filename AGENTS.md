# Signals × Google CX Agent Studio Demo

Demo integration: customer-facing agent built in Google Gemini Enterprise for CX (CX Agent Studio) pulling real-time behavioural context from Snowplow Signals. Design decisions: `docs/design.md`.

## Agent skills

### Issue tracker

GitHub Issues on `snowplow-industry-solutions/signals-google-cx-agent-studio` (migrated from local `.scratch/` markdown on 2026-07-29; pre-migration history stays under `.scratch/signals-cx-agent-demo/`). The PRD remains at `.scratch/signals-cx-agent-demo/PRD.md`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) exist as real GitHub labels on the repo. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
