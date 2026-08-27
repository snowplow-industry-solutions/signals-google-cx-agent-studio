# `terraform/` — CX Agent Studio as code

Terraform config that codifies the console-built CES
app/agent/toolsets/deployment (from
`[../docs/setup-cx-agent-studio.md](../docs/setup-cx-agent-studio.md)`) using
the `google_ces_*` resource family (`hashicorp/google >= 7.31.0`). Terraform
does **not** create these greenfield — it adopts what the console already built,
via `terraform import`, so the demo survives console drift and can be re-created
after a trial expires. Import, `plan`, `apps.exportApp`, and live labelling all
run against the real project, by a human. The full command sequence is in
["Import, plan, and re-apply"](#import-plan-and-re-apply) below.

## Layout

- `versions.tf` -- provider requirement (`google >= 7.31.0`) and the
`google` provider block.
- `variables.tf` -- every live resource ID (project, app, agent, toolsets,
app version, deployment) plus the console-chosen app display name as
required inputs with no default; everything else (widget copy, labels)
has a demo-appropriate default.
- `locals.tf` -- the shared `deletion_policy = "PREVENT"` applied to every
`google_ces_*` resource.
- `variables.tf` also declares `labels`, the map stamped on the Secret
Manager secret (the only labellable resource here).
- `secrets.tf` -- the Secret Manager secret backing both toolsets' API-key
auth, labelled with `var.labels`, plus the CES service-agent IAM grant to
read it.
- `app.tf`, `agent.tf`, `toolsets.tf`, `deployment.tf` -- the app, root
agent + app/root-agent association, the two OpenAPI toolsets (sourced from
`agent/tools/*.openapi.yaml`), the app version, and the web-widget
deployment (public access, origin check, recaptcha off).
- `tools.tf` -- the two typed widget tools
(`productCarousel`/`productDetails`), adopted after the console build added
them.
- `outputs.tf` -- resource names, including the deployment name that feeds
`NEXT_PUBLIC_CES_DEPLOYMENT_ID`.
- `terraform.tfvars.example` -- copy to `terraform.tfvars` (gitignored) and
fill in with real IDs; never commit real values.

## Ownership boundary (what Terraform owns vs. stays manual)

**Terraform owns:** app (incl. its app-level model settings -- that's
where the console stores them; the agent inherits), root agent
(instructions from `agent/instructions.console.widgets.txt`, the
console-format copy the live agent actually runs once the widget tools are
added -- `agent/instructions.md` is the human-readable source and
`agent/instructions.console.txt` the pre-widget base),
the app/root-agent association, both OpenAPI toolsets (schemas from
`agent/tools/`), both widget tools (`tools.tf`), the app version, the
web-widget deployment's public-access settings, and the shared-secret
Secret Manager secret.

**Console-owned, ignored by Terraform** (`lifecycle.ignore_changes` in
`app.tf`): the app's default guardrails, audio/language/logging/timezone
settings, `metadata`, and `pinned` -- populated by the console on every
app it builds and deliberately not managed here.

**Stays manual, permanently:**

- Gemini Enterprise for CX enablement/licensing/allowlisting for the project
-- outside the `ces.v1` API entirely.
- `google_ces_security_settings` -- beta-provider-only; this repo pins the
GA `google` provider throughout, so it's console-configured or would need
a separate `google-beta` block this config deliberately doesn't add.
- Simulator/console verification, and anything requiring a human eyeball on
a live conversation.

**The `ces_app` label gap:** neither `google_ces_app` nor `google_ces_agent`
exposes a `labels` field (confirmed against the provider doc sources). The
only Terraform-managed resource this config introduces that supports labels
is the Secret Manager secret in `secrets.tf`, which carries `var.labels`.
Project-level labelling is out-of-band -- see [step
5](#5-project-level-tagging).

## Known risk to check before relying on `apply`

Provider issue [#26231](https://github.com/hashicorp/terraform-provider-google/issues/26231)
tracks `google_ces_app` 400ing when configuring `gemini-3-flash` +
`temperature` in the `us` location. The live console build stores model
settings at the **app** level (the agent inherits them), so this config sets
`model_settings` on `google_ces_app` with `gemini-3.0-flash-001` +
`temperature = 1` in `us` -- **the exact shape the issue reports**.
Import and `plan` are unaffected (verified live); the risk is confined to
a future `apply` that has to *send* those fields (a greenfield create, or
any update touching the app). Check the issue's status before such an
apply, and if it still bites, apply with `model_settings` temporarily
matching live state or set `model_temperature = null`.

## Known plan diffs after import (accepted)

Verified against a live import (`Plan: 0 to add, 11 to change, 0 to destroy`
after the widget tools were adopted; 9 before) -- all provider/import
artifacts, none of them config↔live drift:

- `**deletion_policy = "DELETE" -> "PREVENT"` on every `google_ces_*`
resource.** Provider-side virtual field with no API call behind it;
import defaults it to `DELETE`, `locals.tf` pins `PREVENT`. Clears on
first apply.
- `**+ app_version` on `google_ces_deployment.web_widget`.** Import
leaves the field null in state even though the live deployment is
pinned to a version; the planned value is exactly the live one. Not
guarded with `ignore_changes` because the re-publish flow (README
below) relies on Terraform owning this pointer.
- `**labels`/`terraform_labels` backfill on the Secret Manager secret.**
Import records live labels only in `effective_labels`; the live values
already match `var.labels`, so the "change" is a no-op.
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

## Reconciliation gotchas

Because Terraform adopts console-built resources by import, a few drifts recur.
Reconcile config **to** live (never the reverse, when live is the verified
behaviour); each of these is fixed with imports and `lifecycle` blocks, not
cloud writes:

- **The shared secret is imported, not created.** The console's API-key auth
form stores its own Secret Manager secret behind the scenes; `secrets.tf`
adopts that existing secret rather than creating a duplicate (which would add
a console-repoint step for zero benefit). Set `agent_shared_secret_id` to the
live secret's ID in `terraform.tfvars`; the variable's default only applies to
a greenfield re-create. The toolsets reference the console's mutable
`.../versions/latest` alias via string interpolation in `toolsets.tf` — a
`google_secret_manager_secret_version` resource reference can only render a
pinned `versions/N`, which would show as a permanent diff against the live
`latest` wiring.
- **The shared-secret version replaces on every run** unless guarded.
`var.agent_shared_secret_value` is unset in committed tfvars (passed via
`TF_VAR_agent_shared_secret_value` only on a greenfield create), so on the
import path it reads null against the adopted version's real data; both
`secret_data` and `is_secret_data_base64` are ForceNew, so a naive plan
replaces the live version — rotating `AGENT_SHARED_SECRET` out from under
Vercel and breaking both toolsets' auth. `secrets.tf` carries
`lifecycle.ignore_changes` on both; rotation stays a deliberate human op.
- **The app version replaces instead of moving.** `app_version_id` sits in
`google_ces_app_version.current`'s `ignore_changes`, so re-pinning it in
tfvars does not move what state manages, and a ForceNew `display_name` change
can mint a duplicate version. Re-pinning after a publish needs a `terraform state rm` + `terraform import` pair — editing tfvars alone is not enough.
- **Console-built widget tools plan as creates** until imported. Read the two
UUIDs from the agent's `tools` list (read-only CES REST), set
`product_carousel_tool_id` / `product_details_tool_id` in tfvars, and import
both (see [step 2](#2-import-the-console-built-resources)).
- **`snowplow_session_id` must keep no default value.** It's a
`google_ces_app` `variable_declarations` entry (see `app.tf`); a default
there lets a missing or failed session id silently fall back to it instead
of erroring, so the agent quietly describes a different shopper's journey
using stale/wrong session context.

**State has no remote backend.** `terraform/terraform.tfstate` is local and
gitignored, and it is the only record of the imports below; a fresh clone would
replay the whole drift. Keep a copy off the machine that holds it.

## Import, plan, and re-apply

Everything here runs against the live project, by a human. It requires the
console-built resources from
`[../docs/setup-cx-agent-studio.md](../docs/setup-cx-agent-studio.md)` to
already exist.

### 1. Fill in the resource IDs

Every ID below is a required `variables.tf` input with no default — put them in
`terraform.tfvars` (gitignored; copy from `terraform.tfvars.example`) before
running anything.


| Variable                  | Where to find it                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_id`              | Your GCP project ID (IAM & Admin → Settings)                                                                                                       |
| `location`                | The app's resource-name location segment (console URL, or an `apps.exportApp` response's `name`)                                                   |
| `app_id`                  | Console → app settings, or the `name` field's `apps/{app_id}` segment                                                                              |
| `agent_id`                | Console → Root Agent node settings                                                                                                                 |
| `context_toolset_id`      | Console → the `getUserContext` toolset's settings                                                                                                  |
| `catalog_toolset_id`      | Console → the `searchCatalog` toolset's settings                                                                                                   |
| `app_version_id`          | The version pinned to the live deployment's channel (console → deployment → pinned Agent Version)                                                  |
| `deployment_display_name` | Console → the web-widget deployment's display name                                                                                                 |
| `app_display_name`        | Console → the app's display name                                                                                                                   |
| `model_name`              | Console → the **app's** model settings (the console sets model/temperature at the app level; the agent inherits). Read the live value, don't guess |


All of the above are also discoverable without console access via the CES REST
API using ADC credentials (`gcloud auth application-default print-access-token`), e.g. `GET https://ces.googleapis.com/v1/projects/<project>/locations/<location>/apps/<app_id>`
and its `/agents`, `/toolsets`, `/versions`, `/deployments` children.

### 2. Import the console-built resources

From `terraform/`, with `terraform.tfvars` filled in and `terraform init` run
once:

```bash
PROJECT_ID=<project_id>
LOCATION=<location>
APP_ID=<app_id>
AGENT_ID=<agent_id>
CONTEXT_TOOLSET_ID=<context_toolset_id>
CATALOG_TOOLSET_ID=<catalog_toolset_id>
APP_VERSION_ID=<app_version_id>
DEPLOYMENT_ID=<deployment_id, from NEXT_PUBLIC_CES_DEPLOYMENT_ID's final path segment>

terraform import google_ces_app.this \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}"
terraform import google_ces_toolset.context \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/toolsets/${CONTEXT_TOOLSET_ID}"
terraform import google_ces_toolset.catalog \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/toolsets/${CATALOG_TOOLSET_ID}"
terraform import google_ces_agent.root \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/agents/${AGENT_ID}"
terraform import google_ces_app_root_agent_association.this \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/agents/${AGENT_ID}"
terraform import google_ces_app_version.current \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/versions/${APP_VERSION_ID}"
terraform import google_ces_deployment.web_widget \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/deployments/${DEPLOYMENT_ID}"

# Widget tools — UUIDs appear in the agent's `tools` list (REST GET on the
# agent, or console → root agent → tools).
PRODUCT_DETAILS_TOOL_ID=<product_details_tool_id>
PRODUCT_CAROUSEL_TOOL_ID=<product_carousel_tool_id>

terraform import google_ces_tool.product_details \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/tools/${PRODUCT_DETAILS_TOOL_ID}"
terraform import google_ces_tool.product_carousel \
  "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/tools/${PRODUCT_CAROUSEL_TOOL_ID}"
```

Import the shared secret too (see [Secret
reconciliation](#reconciliation-gotchas) for why the
existing secret is adopted rather than recreated). Set `agent_shared_secret_id`
to the live secret's ID in `terraform.tfvars`, then:

```bash
SECRET_ID=<the secret backing the console tools' API-key auth>
SECRET_VERSION=<its live version number, e.g. 1>

terraform import google_secret_manager_secret.agent_shared_secret \
  "projects/${PROJECT_ID}/secrets/${SECRET_ID}"
terraform import google_secret_manager_secret_version.agent_shared_secret \
  "projects/${PROJECT_ID}/secrets/${SECRET_ID}/versions/${SECRET_VERSION}"
terraform import google_secret_manager_secret_iam_member.ces_service_agent_accessor \
  "projects/${PROJECT_ID}/secrets/${SECRET_ID} roles/secretmanager.secretAccessor serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-ces.iam.gserviceaccount.com"
```

Find the secret's ID in the live toolsets' `apiKeyConfig.apiKeySecretVersion`
(console or REST), its version numbers via
`https://secretmanager.googleapis.com/v1/projects/<project>/secrets/<secret>/versions`,
and the project number via `gcloud projects describe`.

> **Provider import gap:** `terraform import` leaves the create-only ForceNew ID
> fields (`app_id`, `agent_id`, `app_version_id`) null in state, so a naive
> first plan wants to **destroy and recreate** those resources. The config
> guards against this with `lifecycle.ignore_changes` on those fields (see
> `app.tf`, `agent.tf`, `deployment.tf`) and by having child resources reference
> `google_ces_app.this.name` (populated by import) rather than `.app_id` (null).
> If a plan ever shows `must be replaced` on these resources, check those guards
> before touching anything live.

### 3. Confirm a clean plan

```bash
TF_VAR_agent_shared_secret_value=<the live AGENT_SHARED_SECRET value> terraform plan
```

Expected: no changes, or only the accepted diffs documented in ["Known plan
diffs after import"](#known-plan-diffs-after-import-accepted). Any other diff
means a variable value or a `.tf` argument doesn't match live state — reconcile
config **to** live (never the reverse, when live is the verified behaviour)
before treating this config as authoritative.

### 4. Snapshot the live app (optional backup)

A belt-and-braces backup independent of Terraform state. `:exportApp` returns a
**long-running operation** (poll it until `"done": true`), and the finished
operation's `response.appContent` is a **base64-encoded ZIP** (not JSON,
regardless of `exportFormat`) holding per-resource files:

```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
  -H "Content-Type: application/json" \
  "https://ces.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}:exportApp" \
  -d '{"exportFormat": "JSON"}'
# poll the returned operation name until done, then:
#   response.appContent | base64 -d > export.zip
```

### 5. Project-level tagging

`google_ces_app`/`google_ces_agent` have no `labels` field, so any baseline
tagging policy has to be applied to the project directly, out-of-band:

```bash
gcloud projects update "${PROJECT_ID}" --update-labels=<key>=<value>,...
```

> Only do this on a **dedicated** project. On a project shared with other
> workloads, stamping this demo's labels on the whole project would mislabel
> everyone's resources — skip it and rely on the secret's `labels` instead.

### 6. Re-apply after trial expiry / re-publish a change

1. Re-run the two setup guides against the fresh org/project to get new
  console-built resources (Terraform doesn't create these greenfield).
2. Update `terraform.tfvars` with the new IDs and re-run steps 2–3 against the
  new project.
3. **For a content-only change** (e.g. edited `agent/instructions.md`) on an
  already-imported project: app versions are immutable, so don't edit
   `google_ces_app_version.current` in place. Add a new `google_ces_app_version`
   resource with a new `app_version_id`, point
   `google_ces_deployment.web_widget.app_version` at it, `apply`, then remove the
   old version resource once the cutover is confirmed in the console.

> **Re-pinning `app_version_id` after a publish needs `terraform state rm` +
> `terraform import` of the live version** — editing tfvars alone won't move it,
> because `app_version_id` sits in the version resource's `ignore_changes`.

