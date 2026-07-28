# 10 — Terraform the CX Agent Studio config

Status: ready-for-agent
Checkpoint: human-test-required

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

**Agent constraint:** prepare everything that lives in the repo — the
Terraform config (`google_ces_app`, `google_ces_agent` with `instruction`
via `file("agent/instructions.md")`, `google_ces_app_root_agent_association`,
`google_ces_toolset` with the OpenAPI spec via `file(...)` from
`agent/tools/`, `google_ces_app_version`, `google_ces_deployment` with the
public-access/allowed-origins settings), with live resource IDs taken as
input variables (documented, no invented placeholder IDs presented as real),
baseline labels threaded onto any supporting resources per the tagging
policy (lowercase values, `snowplow-owner` key form for GCP), and the
runbook section covering the ownership boundary (what Terraform owns vs.
stays manual: GE enablement, beta `ces_security_settings`), the `ces_app`
label gap, and re-apply-after-trial-expiry steps. Also document — as exact
human-runnable commands, not runs — the import sequence for the
console-built resources (including where to find each real resource ID),
the `terraform plan` clean-check, and the `apps.exportApp` snapshot call +
where to store it. **Permitted live access — outbound, read-only:**
unauthenticated HTTP GETs (provider docs/registry, checking the current
status of provider bug #26231 on the public tracker). Do **not** run
`terraform import`/`plan`/`apply` against live state, call `apps.exportApp`,
apply labels to the live project, or fabricate any output of those calls —
the import, clean plan, snapshot, and live-label criteria are human-verified
afterwards, per the checkpoint.

## Acceptance criteria

- [ ] Terraform config in repo covering app, root agent (instruction from file), toolset with Signals OpenAPI spec, app version, deployment with public-access settings
- [ ] Existing console-built resources imported; `terraform plan` clean against live state
- [ ] Agent instructions and OpenAPI spec live as files in the repo, referenced by the TF config
- [ ] `apps.exportApp` JSON snapshot captured and stored
- [ ] Tagging policy applied to project/supporting resources; `ces_app` label gap noted
- [ ] Runbook updated: what Terraform owns, what stays manual (GE enablement, beta security settings), how to re-apply after trial expiry

## Blocked by

- `07-widget-end-to-end.md` (deployment/public-access config must be settled before codifying it)

## Parked by pipeline (2026-07-28 16:12) — resolved, see comment below

Implementer flagged a spec conflict / blocker:

ance criteria mix two categories of work without a scoping boundary between them:

**Agent-doable (no live credentials needed):**
- Write `.tf` files for `google_ces_app`, `google_ces_agent` (instruction via `file("agent/instructions.md")`), `google_ces_app_root_agent_association`, `google_ces_toolset` (OpenAPI spec via `file("agent/tools/*.openapi.yaml")`), `google_ces_app_version`, `google_ces_deployment`
- Runbook section on what Terraform owns vs. stays manual

**Requires live GCP credentials this sandbox does not have:**
- "Existing console-built resources imported; `terraform plan` clean against live state" — `terraform import` needs the real resource IDs of the console-built app/agent/toolset/deployment that already exist in the Snowplow-managed sandbox GCP project (created via console in issues 06/07), plus an authenticated GCP provider to run `plan` against
- "`apps.exportApp` JSON snapshot captured and stored" — a live call to the CES v1 API against that same real app
- "Tagging policy applied to project/supporting resources" — actually *applying* labels to the live project, as opposed to just writing the resource

This is the identical situation that got issue 08 parked on 2026-07-28: acceptance criteria bundle agent-doable prep with live-credential/console-verification work, and the issue has **no `Agent constraint` section** carving out which pieces are safe to implement now versus reserved for a human checkpoint (unlike issues 05/06/07, which had explicit constraints scoping the agent to prep work). Issue 08's blocked note explicitly recommends adding that carve-out before re-queuing rather than letting the agent guess. Guessing here has real cost: if I write `import` blocks or "confirm plan clean" against placeholder resource IDs I invent, or fabricate an `apps.exportApp` JSON snapshot without a live call, that's worse than not writing it — it would misrepresent live state that doesn't exist in this sandbox and could get checked in as if it were verified.

I could write just the Terraform authoring + runbook piece and leave the rest unticked, but per the issue-08 precedent this repo's convention is to park and request an explicit `Agent constraint` rather than have the agent unilaterally decide the scope split.

**Recommendation:** add an `Agent constraint` section to `10-terraform-agent-config.md` mirroring 05/06/07/08's pattern, e.g.:

> Write the Terraform config (`app`, `agent`, `toolset`, `app_version`, `deployment` resources) referencing the existing `agent/instructions.md` and `agent/tools/*.openapi.yaml` files, and update the runbook with the ownership boundary and tagging-gap note. Do **not** attempt `terraform import` against live resources, run `terraform plan`/`apply`, call `apps.exportApp`, or apply labels to the live project — those require live GCP credentials this sandbox doesn't have and are verified by a human afterwards, per a checkpoint.

No code was written and nothing was committed.

<promise>BLOCKED</promise>

## Comments

**2026-07-28 (human/assistant):** Un-parked. Added the Agent constraint above
(mirroring the 05/06/07/08 prep-only carve-out) and `Checkpoint:
human-test-required`, per the implementer's recommendation — with the
implementer's own sharpening kept: live resource IDs enter the config as
documented input variables, and the import/plan/exportApp steps are written
up as exact human-runnable commands rather than executed or faked. Import,
clean-plan confirmation, snapshot capture, and live labels stay with the
human checkpoint. Re-queued as ready-for-agent.