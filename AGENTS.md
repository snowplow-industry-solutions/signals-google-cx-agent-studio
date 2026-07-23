# Signals × Google CX Agent Studio Demo

Demo integration: customer-facing agent built in Google Gemini Enterprise for CX (CX Agent Studio) pulling real-time behavioural context from Snowplow Signals. Design decisions: `docs/design.md`.

## Agent skills

### Issue tracker

Issues and PRDs live as local markdown under `.scratch/<feature>/` until the GitHub repo (`snowplow-industry-solutions/signals-google-cx-agent-studio`, pending IT provisioning) exists. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
