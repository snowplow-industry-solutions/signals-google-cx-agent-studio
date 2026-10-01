# `terraform/` — CX Agent Studio as code

Terraform config that creates the customer-facing CX Agent Studio
app/agent/toolsets/deployment (the `google_ces_*` resource family,
`hashicorp/google >= 7.31.0`) from scratch, in one `apply` — no console
build required. The same `.tf` files can also **adopt** an app already
built in the console (via
[../docs/setup-cx-agent-studio.md](../docs/setup-cx-agent-studio.md))
using `terraform import`, so that demo survives console drift and can be
re-created after a trial expires. Creating a new app is the primary path
and needs nothing beyond this directory; adopting a console-built app
additionally requires the console build to already exist, and a human
running `import`/`plan` against the real project. The new-app steps are in
["Creating a new app"](#creating-a-new-app) below; the import steps are in
["Adopting a console-built app"](#adopting-a-console-built-app).

## Layout

- `versions.tf` -- provider requirement (`google >= 7.31.0`) and the
`google` provider block.
- `variables.tf` -- every live resource ID (project, app, agent, toolsets,
app version, deployment) plus the console-chosen app display name as
required inputs with no default; everything else (widget copy, labels)
has a demo-appropriate default. The three agent-variable declarations
(`snowplow_session_id`, `snowplow_user_id`, `snowplow_turn_id`) are
hardcoded on `google_ces_app.this` in `app.tf` rather than exposed as
variables here -- their names are part of the contract with
`agent/tools/*.openapi.yaml`'s `x-ces-session-context` bindings, not
free choices.
- `locals.tf` -- the shared `deletion_policy = "PREVENT"` applied to every
`google_ces_*` resource.
- `variables.tf` also declares `labels`, the map stamped on the Secret
Manager secret (the only labellable resource here).
- `secrets.tf` -- the Secret Manager secret backing all three toolsets'
API-key auth, labelled with `var.labels`, plus the CES service-agent IAM grant to
read it.
- `app.tf`, `agent.tf`, `toolsets.tf`, `deployment.tf` -- the app, root
agent + app/root-agent association, the three OpenAPI toolsets (sourced
from `agent/tools/*.openapi.yaml`: `getUserContext`, `searchCatalog`, and
the self-tracking toolset), the app version, and the
web-widget deployment (public access, origin check, recaptcha off).
- `tools.tf` -- the two typed widget tools
(`productCarousel`/`productDetails`), adopted after the console build added
them.
- `outputs.tf` -- resource names, including the deployment name that feeds
`NEXT_PUBLIC_CES_DEPLOYMENT_ID`.
- `terraform.tfvars.example` -- copy to `terraform.tfvars` (gitignored) and
fill in with real IDs; never commit real values.

## Creating a new app

This is the primary path: there is no console build to adopt, so there's
nothing to import. This config creates the whole app -- the app, its three
toolsets, both widget tools, the agent, the first app version, the
web-widget deployment, and the backing secret -- from scratch, in one
`apply`.

### Isolate state and variables

Terraform workspaces give each app its own state (the default workspace
uses `terraform.tfstate`; a named workspace uses
`terraform.tfstate.d/<name>/terraform.tfstate`, already covered by the
`*.tfstate.*` rule in the repo's `.gitignore`). If this directory will only
ever manage one app, the default workspace and a single `terraform.tfvars`
(gitignored; copy from `terraform.tfvars.example`) are enough -- skip ahead
to ["init, plan, apply"](#init-plan-apply) below.

To manage more than one app from the same clone -- for example, adopting a
console-built app in the same directory (["Adopting a console-built
app"](#adopting-a-console-built-app) below) alongside a new one, or
standing up a second environment -- give each additional app its own
workspace and its own `*.tfvars` file. Workspaces do **not** isolate
variable files: `terraform.tfvars` and any `*.auto.tfvars` load regardless
of which workspace is selected, so a second app needs a file Terraform
never auto-loads, passed explicitly on every command:

```bash
cd terraform
terraform workspace new new-app    # or: terraform workspace select new-app
cp terraform.tfvars.example terraform.new-app.tfvars   # gitignored: matches *.tfvars
```

Fill in every placeholder in `terraform.new-app.tfvars` (or
`terraform.tfvars`, for the single-app case) with IDs of your own choosing
for `app_id`, `agent_id`, `context_toolset_id`, `catalog_toolset_id`, and
`app_version_id` (or accept `self_tracking_toolset_id`'s default), display
names of your choosing for `app_display_name`, `app_version_display_name`,
and `deployment_display_name`, and `storefront_url`/`allowed_origins`
pointed at this app's own storefront deployment. Leave
`agent_shared_secret_id` unset so a new secret is created rather than
adopting another app's. **Never reuse another managed app's IDs, secret, or
tfvars file** -- each app this config manages needs its own.
`storefront_url` also becomes the server URL inside the three tool
schemas -- you do not edit anything under `agent/tools/` (see ["Tool schema
server URL"](#tool-schema-server-url-is-rendered-from-storefront_url)
below).

### init, plan, apply

```bash
terraform init
TF_VAR_agent_shared_secret_value=<a new value, distinct from any other managed app's AGENT_SHARED_SECRET> \
  terraform plan    # add -var-file=terraform.new-app.tfvars for a second app
TF_VAR_agent_shared_secret_value=<same value> \
  terraform apply   # add -var-file=terraform.new-app.tfvars for a second app
```

### The secret-accessor grant happens automatically here

On this path there's no console step at all, so nothing has granted the CES
service agent access to the secret yet:
`google_secret_manager_secret_iam_member.ces_service_agent_accessor` in
`secrets.tf` creates the grant as part of the same `apply` that creates the
secret, no manual `gcloud` command needed. (On the import path below, the
grant already exists -- it was created when the console tools were
configured -- and is only adopted; see the troubleshooting entry in
[`docs/setup-cx-agent-studio.md`](../docs/setup-cx-agent-studio.md#troubleshooting)
for the manual `gcloud secrets add-iam-policy-binding` that path needs if
the grant is missing.)

### Plan noise to expect

A clean first plan against an empty state reads `Plan: N to add, 0 to
change, 0 to destroy` -- none of the ["Known plan diffs after
import"](#known-plan-diffs-after-import-accepted) apply, since there's no
existing live resource for this state to reconcile against. The one live
risk worth checking before this `apply` is provider issue
[#26231](https://github.com/hashicorp/terraform-provider-google/issues/26231)
(see ["Known risk"](#known-risk-to-check-before-relying-on-apply) below): it
was reported against exactly this kind of *create* call, so confirm its
status first if `model_name` is a `gemini-3-*` model paired with a non-null
`model_temperature` in the `us` location.

### Tool schema server URL is rendered from `storefront_url`

The three OpenAPI files under `agent/tools/` are committed with
`servers[0].url: https://your-storefront.example.com`, so no real hostname
ever lands in git. `locals.tf`'s `openapi_schemas` map substitutes
`var.storefront_url` for that placeholder at plan time and `toolsets.tf`
feeds the rendered text to each `google_ces_toolset`. Consequences:

- **Never hand-edit the URL in `agent/tools/*.openapi.yaml` before an
  `apply`, and never commit such an edit.** Earlier provisioning runs did
  this by hand and then reverted the files, which left a plan that wanted
  to put the placeholder back — a diff that must not be applied. With the
  substitution in config, a clean tree gives a clean plan.
- **A plan that changes only the toolsets' `open_api_schema`, with the
  diff confined to the `servers:` block, means the `storefront_url` in
  your active tfvars differs from the one applied.** Check which one is
  right before applying; the widget deployment's `allowed_origins` uses the
  same variable, so the two always move together.
- `storefront_url` has a validation rule rejecting the placeholder default
  and anything that is not a bare `https://` origin, so a forgotten tfvars
  value fails at plan time instead of creating tools that call a dead host.

The manual console import in
[`docs/setup-cx-agent-studio.md` §3](../docs/setup-cx-agent-studio.md#3-import-the-two-openapi-tools)
still needs the URL swapped into a local copy of each file, because the
console reads the file verbatim.

## Adopting a console-built app

Everything in this section runs against the live project, by a human. It
requires the console-built resources from
[../docs/setup-cx-agent-studio.md](../docs/setup-cx-agent-studio.md) to
already exist, and adopts them via `terraform import` so that this config
can manage a demo that started in the console, survive console drift, and
be re-created after a trial expires.

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
| `app_version_display_name` | The same version's display name (console → deployment → the version's `deployment-version-…` name)                                                |
| `deployment_display_name` | Console → the web-widget deployment's display name                                                                                                 |
| `app_display_name`        | Console → the app's display name                                                                                                                   |
| `model_name`              | Console → the **app's** model settings (the console sets model/temperature at the app level; the agent inherits). Read the live value, don't guess |
| `storefront_url`          | The deployed storefront's public `https://` origin. Becomes the widget deployment's allowed origin **and** the `servers[0].url` inside all three OpenAPI toolsets — see ["Tool schema server URL"](#tool-schema-server-url-is-rendered-from-storefront_url) above |


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

`google_ces_app`/`google_ces_agent` have no `labels` field, so any organisation
tagging policy has to be applied to the project directly, out-of-band:

```bash
gcloud projects update "${PROJECT_ID}" --update-labels=<key>=<value>,...
```

> Only do this on a **dedicated** project. On a project shared with other
> workloads, stamping this demo's labels on the whole project would mislabel
> everyone's resources — skip it and rely on the secret's `labels` instead.

### 6. Re-apply after trial expiry

Re-run the two setup guides against the fresh org/project to get new
console-built resources (this import path doesn't create them; for a
from-scratch app with no console step at all, use ["Creating a new
app"](#creating-a-new-app) instead), then update `terraform.tfvars` with the
new IDs and re-run steps 2–3 above against the new project.

Publishing a change to an already-imported app (or to any app this config
manages) is covered separately in ["Publishing an agent
change"](#publishing-an-agent-change) below.

**State has no remote backend.** `terraform/terraform.tfstate` is local and
gitignored, and it is the only record of the imports above; a fresh clone would
replay the whole drift. Keep a copy off the machine that holds it.

## Publishing an agent change

The web-widget deployment serves whatever `app_version_id` names — an
immutable snapshot taken when that version was created, not the agent's
live draft. Editing `agent/instructions.md` (mirrored into
`agent/instructions.console.widgets.txt`) or any tool schema and
re-applying does **nothing** to what the widget serves until a new version
is published. The simulator tests the agent's live draft regardless of the
pinned version, which is why this is easy to miss in testing and only shows
up when a demo watches the widget specifically.

`app_version_id` and `description` are ForceNew on `google_ces_app_version`,
and every `google_ces_*` resource carries `deletion_policy = "PREVENT"`
(`local.ces_deletion_policy`), so simply editing `app_version_id` in tfvars
plans a replacement that PREVENT blocks, and applying it fails. Publish a
new version instead by moving Terraform off the old one *before* changing
the ID:

```bash
terraform state rm google_ces_app_version.current
```

This only removes the resource from Terraform's state — the old version
stays live, still served by the deployment, until the next apply; nothing
is deleted.

Then set `app_version_id` (and `app_version_display_name`) in tfvars to the
new version and apply:

```bash
TF_VAR_agent_shared_secret_value=<the live AGENT_SHARED_SECRET value> terraform plan
TF_VAR_agent_shared_secret_value=<the live AGENT_SHARED_SECRET value> terraform apply
```

Expect the plan to show one version to add and
`google_ces_deployment.web_widget` changed in place (`app_version`
repointed at the new version's id). **If the plan instead shows the
deployment being replaced, stop** — a new deployment means a new
`NEXT_PUBLIC_CES_DEPLOYMENT_ID`, which the storefront would need to pick up
too.

### Moving an existing two-version workspace

One-off for a workspace created before this config collapsed to a single
`google_ces_app_version` resource — where `google_ces_app_version.current`
and `google_ces_app_version.v2_text_with_widgets` both existed in state and
the deployment served the second one. Back up state first (see "State has
no remote backend" above), then:

1. `terraform state rm google_ces_app_version.current` (the old first
   version stays live, just unmanaged).
2. `terraform state mv google_ces_app_version.v2_text_with_widgets google_ces_app_version.current`.
3. In that workspace's tfvars, set `app_version_id` and
   `app_version_display_name` to the served version's values.
4. `terraform plan` must show no changes. If it shows a replacement, stop
   and restore from the state backup Terraform writes.

## Ownership boundary (what Terraform owns vs. stays manual)

**Terraform owns:** app (incl. its app-level model settings -- that's
where the console stores them; the agent inherits, and the three
`snowplow_session_id`/`snowplow_user_id`/`snowplow_turn_id` agent-variable
declarations), root agent
(instructions from `agent/instructions.console.widgets.txt`, the
console-format copy the live agent actually runs once the widget tools are
added -- `agent/instructions.md` is the human-readable source and
`agent/instructions.console.txt` the pre-widget base),
the app/root-agent association, all three OpenAPI toolsets (schemas from
`agent/tools/`, including the self-tracking toolset), both widget tools
(`tools.tf`), the app version, the web-widget deployment's public-access
settings, and the shared-secret Secret Manager secret.

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
guarded with `ignore_changes` because the re-publish flow (["Publishing an
agent change"](#publishing-an-agent-change) above) relies on Terraform
owning this pointer.
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
tfvars does not move what state manages — see ["Publishing an agent
change"](#publishing-an-agent-change) above for the `terraform state rm` +
new-`apply` procedure this requires.
- **Console-built widget tools plan as creates** until imported. Read the two
UUIDs from the agent's `tools` list (read-only CES REST), set
`product_carousel_tool_id` / `product_details_tool_id` in tfvars, and import
both (see [step 2](#2-import-the-console-built-resources)).
- **`snowplow_session_id`, `snowplow_user_id`, and `snowplow_turn_id` must
all keep no default value.** They're `google_ces_app` `variable_declarations`
entries (see `app.tf`); a default on any of them lets a missing or failed
value silently fall back to it instead of erroring, so the agent quietly
describes a different shopper's journey (or mislabels events with the wrong
identity/turn) using stale/wrong context.

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
