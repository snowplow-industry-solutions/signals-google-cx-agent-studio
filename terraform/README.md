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
  app version, deployment) plus the console-chosen app display name as
  required inputs with no default; everything else (widget copy, labels)
  has a demo-appropriate default.
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

**Terraform owns:** app (incl. its app-level model settings -- that's
where the console stores them; the agent inherits), root agent
(instructions from `agent/instructions.console.txt`, the console-format
copy the live agent actually runs -- `agent/instructions.md` is the
human-readable source, see runbook §8.2), the app/root-agent association,
both OpenAPI toolsets (schemas from `agent/tools/`), the app version, the
web-widget deployment's public-access settings, and the shared-secret
Secret Manager secret.

**Console-owned, ignored by Terraform** (`lifecycle.ignore_changes` in
`app.tf`): the app's default guardrails, audio/language/logging/timezone
settings, `metadata`, and `pinned` -- populated by the console on every
app it builds and deliberately not managed here.

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
`gemini-3-flash` + `temperature` in the `us` location. The live console
build stores model settings at the **app** level (the agent inherits
them), so after the 2026-07-29 reconciliation this config sets
`model_settings` on `google_ces_app` with `gemini-3.0-flash-001` +
`temperature = 1` in `us` -- **the exact shape the issue reports**.
Import and `plan` are unaffected (verified live); the risk is confined to
a future `apply` that has to *send* those fields (a greenfield create, or
any update touching the app). Check the issue's status before such an
apply, and if it still bites, apply with `model_settings` temporarily
matching live state or set `model_temperature = null`.

## Known plan diffs after import (accepted)

Observed on the 2026-07-29 verification run (`Plan: 0 to add, 9 to
change, 0 to destroy`) -- all provider/import artifacts, none of them
config↔live drift:

- **`deletion_policy = "DELETE" -> "PREVENT"` on every `google_ces_*`
  resource.** Provider-side virtual field with no API call behind it;
  import defaults it to `DELETE`, `locals.tf` pins `PREVENT`. Clears on
  first apply.
- **`+ app_version` on `google_ces_deployment.web_widget`.** Import
  leaves the field null in state even though the live deployment is
  pinned to a version; the planned value is exactly the live one. Not
  guarded with `ignore_changes` because the re-publish flow (README
  below) relies on Terraform owning this pointer.
- **`labels`/`terraform_labels` backfill on the Secret Manager secret.**
  Import records live labels only in `effective_labels`; the live values
  already match `local.baseline_labels`, so the "change" is a no-op.
- **A zero-field "update" on the secret *version*.** Plan-JSON comparison
  showed `secret_data` before == after, which doubles as verification
  that the console secret's payload equals the deployed
  `AGENT_SHARED_SECRET`.

Related, and guarded in config rather than accepted: the provider's
import leaves the create-only ForceNew ID fields (`app_id`, `agent_id`,
`app_version_id`) null in state, which a naive plan reads as
destroy-and-recreate. `app.tf`/`agent.tf`/`deployment.tf` carry
`lifecycle.ignore_changes` for those fields, and child resources
reference `google_ces_app.this.name` (populated by import) instead of
`.app_id` (null).

## Secret reconciliation (RESOLVED 2026-07-29: import)

The console's API-key auth form (used in issue 06) accepts a raw secret
*value* directly; the `google_ces_toolset` schema instead requires a Secret
Manager secret *version resource name*, which means the console-era setup
has its own Secret Manager secret behind that form. `secrets.tf` declares
an explicit, labelled secret for Terraform to own going forward, and there
were two ways to reconcile at import time:

1. **Import the existing secret** into `google_secret_manager_secret.agent_shared_secret`
   / `..._version` so the first `plan` is clean.
2. **Let `secrets.tf` create a new secret**, `apply` it, then update both
   tools' console auth config to point at the new secret version.

The 2026-07-29 live run took option 1, because the "hidden" secret turned
out not to be hidden at all: `signals-agent-studio-agent-shared-secret`
already carried the full baseline label set, already had the CES
service-agent `secretAccessor` grant `secrets.tf` declares, and its
payload matched the deployed `AGENT_SHARED_SECRET` (verified via plan-JSON
state comparison, not by printing it). Option 2 would have duplicated all
of that and added a console repoint step for zero benefit. Two config
consequences to know about:

- `agent_shared_secret_id` is set to the live secret's ID in
  `terraform.tfvars` (the variable's `ces-agent-shared-secret` default
  only applies to a greenfield §10.7 re-create).
- The toolsets reference the console's mutable
  `.../versions/latest` alias, built by string interpolation in
  `toolsets.tf` -- a `google_secret_manager_secret_version` resource
  reference can only ever render a pinned `versions/N`, which would show
  as a permanent diff against the live `latest` wiring.
