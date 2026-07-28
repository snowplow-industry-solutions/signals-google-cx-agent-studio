# 10 — Terraform the CX Agent Studio config

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Back the UI-built agent with IaC so the demo survives console drift and can be re-created after trial expiry. Research (see `docs/research/cx-agent-studio-terraform.md`) found the CX Agent Studio surface has a native Terraform family — `google_ces_*` in the GA provider (`google >= 7.31.0`) — that covers nearly everything built by hand in issues 06/07:

- `google_ces_app` — the app shell
- `google_ces_agent` — Root Agent, with `instruction` sourced from a file in this repo (the live console instructions become the checked-in source of truth)
- `google_ces_app_root_agent_association` — wires agent as root
- `google_ces_toolset` — Signals OpenAPI spec inline + auth (note: `ces_tool`'s `open_api_tool` block is read-only; toolset is the writable path)
- `google_ces_app_version` + `google_ces_deployment` — widget deployment with `enable_public_access` / `allowed_origins` / recaptcha (the ces-messenger token-broker settings from issue 07)

Import the existing console-built resources rather than recreating, then confirm `terraform plan` is clean. Add an `apps.exportApp` JSON snapshot as a drift/backup artefact.

Known constraints from the research doc:

- `ces_security_settings` is beta-only — leave manual, note in runbook
- Gemini Enterprise enablement/licensing is outside the API — stays manual
- Open provider bug #26231: `ces_app` 400 with `gemini-3-flash` + temperature in `us` region — check whether it bites our config before relying on apply
- No `labels` field on `ces_app` — baseline tagging policy (`system`, `snowplow-owner=cc017`, `environment`) goes on the project and any supporting resources (e.g. GCS bucket for export snapshots) instead

## Acceptance criteria

- [ ] Terraform config in repo covering app, root agent (instruction from file), toolset with Signals OpenAPI spec, app version, deployment with public-access settings
- [ ] Existing console-built resources imported; `terraform plan` clean against live state
- [ ] Agent instructions and OpenAPI spec live as files in the repo, referenced by the TF config
- [ ] `apps.exportApp` JSON snapshot captured and stored
- [ ] Tagging policy applied to project/supporting resources; `ces_app` label gap noted
- [ ] Runbook updated: what Terraform owns, what stays manual (GE enablement, beta security settings), how to re-apply after trial expiry

## Blocked by

- `07-widget-end-to-end.md` (deployment/public-access config must be settled before codifying it)
