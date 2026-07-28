# `terraform/` — CX Agent Studio as code

Terraform config for the console-built CES app/agent/toolsets/deployment
from issues 06/07, using the `google_ces_*` resource family (`hashicorp/google
>= 7.31.0`) identified in `docs/research/cx-agent-studio-terraform.md`. This
directory is prep: config this sandbox can author, but not apply -- import,
`plan`, `apps.exportApp`, and live labelling happen against the real sandbox
project, by a human. See `docs/runbook.md` ("Terraform: import, plan, and
re-apply") for the full command sequence and
`.scratch/signals-cx-agent-demo/issues/10-terraform-agent-config.md` for the
acceptance criteria.

## Layout

- `versions.tf` -- provider requirement (`google >= 7.31.0`) and the
  `google` provider block.
- `variables.tf` -- every live resource ID (project, app, agent, toolsets,
  app version, deployment) as a required input with no default; everything
  else (widget copy, labels) has a demo-appropriate default.
- `locals.tf` -- the baseline tagging-policy labels and a shared
  `deletion_policy = "PREVENT"` applied to every `google_ces_*` resource.
- `secrets.tf` -- the Secret Manager secret backing both toolsets' API-key
  auth, labelled per policy, plus the CES service-agent IAM grant to read it.
- `app.tf`, `agent.tf`, `toolsets.tf`, `deployment.tf` -- the app, root
  agent + app/root-agent association, the two OpenAPI toolsets (sourced from
  `agent/tools/*.openapi.yaml`), the app version, and the web-widget
  deployment (public access, origin check, recaptcha off).
- `outputs.tf` -- resource names, including the deployment name that feeds
  `NEXT_PUBLIC_CES_DEPLOYMENT_ID`.
- `terraform.tfvars.example` -- copy to `terraform.tfvars` (gitignored) and
  fill in with real IDs; never commit real values.

## Ownership boundary (what Terraform owns vs. stays manual)

**Terraform owns:** app, root agent (instructions from `agent/instructions.md`),
the app/root-agent association, both OpenAPI toolsets (schemas from
`agent/tools/`), the app version, the web-widget deployment's public-access
settings, and the shared-secret Secret Manager secret.

**Stays manual, permanently:**
- Gemini Enterprise for CX enablement/licensing/allowlisting for the sandbox
  project -- outside the `ces.v1` API entirely.
- `google_ces_security_settings` -- beta-provider-only; this repo pins the
  GA `google` provider throughout, so it's console-configured or would need
  a separate `google-beta` block this config deliberately doesn't add.
- Simulator/console verification, and anything requiring a human eyeball on
  a live conversation.

**The `ces_app` label gap:** neither `google_ces_app` nor `google_ces_agent`
exposes a `labels` field (confirmed against the provider doc sources). The
only Terraform-managed resource this config introduces that supports labels
is the Secret Manager secret in `secrets.tf`, which carries the full
baseline set. Project-level labelling is out-of-band -- see the runbook.

## Known risk to check before relying on `apply`

Provider issue [#26231](https://github.com/hashicorp/terraform-provider-google/issues/26231)
(open as of 2026-07-28): `google_ces_app` 400s when configuring
`gemini-3-flash` + `temperature` in the `us` location. This config only sets
`model_settings` on `google_ces_agent` (not `google_ces_app`), which isn't
the exact repro reported -- but the underlying model-availability
restriction may still apply at the agent level. Check the issue's current
status and, if `var.location = "us"`, test a `plan`/targeted `apply` of just
`google_ces_agent.root` before trusting the rest, especially if
`model_name` is a `gemini-3-*` variant with `model_temperature` set.

## Secret reconciliation (read before importing the toolsets)

The console's API-key auth form (used in issue 06) accepts a raw secret
*value* directly; the `google_ces_toolset` schema instead requires a Secret
Manager secret *version resource name*, which means CES's console creates
its own hidden Secret Manager secret behind that form. `secrets.tf` instead
creates an explicit, labelled secret for Terraform to own going forward.
Two ways to reconcile at import time -- a human decision, not made here:

1. **Import the existing hidden secret** into `google_secret_manager_secret.agent_shared_secret`
   / `..._version` (discover its name from the live toolset's auth config or
   an `apps.exportApp` snapshot) so the first `plan` is clean.
2. **Let `secrets.tf` create a new secret**, `apply` it, then update both
   tools' console auth config to point at the new secret version -- accept
   one non-clean diff on the toolsets' `api_authentication` on the first
   `plan`, which clears after that follow-up apply.
