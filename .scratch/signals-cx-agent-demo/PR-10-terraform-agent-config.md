# PR: Terraform the CX Agent Studio config

**Branch:** sandcastle/10-terraform-agent-config
**Issue:** .scratch/signals-cx-agent-demo/issues/10-terraform-agent-config.md

## Summary

Added Infrastructure-as-Code backing for the console-built CES app, agent, toolsets, and deployment from issues 06/07, using the `google_ces_*` Terraform resources. This lets the demo survive console drift and be re-created after trial expiry. The repo now contains all `.tf` files and the runbook for importing existing resources and confirming a clean plan; actual import/plan/snapshot/labeling against live state is reserved for human verification per the Agent constraint (no live GCP credentials in this sandbox).

## Changes

- **`terraform/` — new directory**
  - `versions.tf`, `variables.tf` (every live resource ID as required input), `locals.tf` (labels, deletion policy)
  - `secrets.tf` — Secret Manager secret backing both toolsets' API-key auth + CES service-agent IAM
  - `app.tf`, `agent.tf`, `toolsets.tf`, `deployment.tf` — all CES resources with public-access/origin-check settings from issue 07
  - `outputs.tf` — resource names for integration with the frontend
  - `terraform.tfvars.example` — template for real values (gitignored; copy and fill in before use)
  - `.terraform.lock.hcl` — Google provider v7.41.0 pinned, schema-validated against provider >= 7.31.0

- **`.gitignore`** — ignores `terraform/.terraform/`, `*.tfstate*`, `*.tfvars` (keeps `.example`)

- **`docs/runbook.md` — new §10 "Terraform: codify, import, and re-apply"**
  - Ownership boundary: what Terraform owns (app, agent, toolsets, app version, deployment, secret) vs. stays manual (Gemini Enterprise enablement, beta security settings)
  - Table mapping every variable to where its live value is found
  - Full `terraform import` sequence in dependency order with exact resource IDs
  - Clean-plan confirmation command with environment variable for the shared secret
  - `apps.exportApp` snapshot capture command (curl, host placeholder left for human to confirm from API reference)
  - Project-level tagging via `gcloud` (workaround for `ces_app`/`ces_agent` label gap)
  - Re-apply after trial expiry and app-version immutability note
  - Five new troubleshooting entries (secret-reconciliation diff, model-availability 400, import ID format, etc.)

- **`.scratch/signals-cx-agent-demo/issues/10-terraform-agent-config.md` — updated**
  - Ticked three acceptance criteria satisfied by this prep: the config itself, instructions/OpenAPI as files, runbook
  - Added agent comment documenting the work done and constraints respected
  - Left unticked: import + clean plan, `exportApp` snapshot, live tagging (all require live GCP access)

## Pipeline review record

- **Implement (2026-07-28):** Agent prepared all repo-side config on `sandcastle/10-terraform-agent-config`; schema-validated with `terraform init -backend=false && terraform validate` (passed clean; no live GCP calls). Verified with `npm --prefix storefront test && npm --prefix storefront run lint` (no regressions).

## Manual testing plan

This is a two-phase flow: the repo prep (already done, ready to verify) followed by live resource import/validation against the real sandbox project.

### Prerequisites

- **Local:** Terraform >= 1.0 installed; `gcloud` CLI authenticated with permissions on the Snowplow-managed sandbox GCP project
- **GCP sandbox:** Console-built resources from issues 06/07 already exist (app, root agent with instructions, two toolsets with API-key auth, app version, web-widget deployment with public-access enabled)
- **Environment variables and files:**
  ```
  export PROJECT_ID=<sandbox-project-id>
  export LOCATION=<app-location-segment>  # from console URL or exportApp response
  export APP_ID=<app-id>
  export AGENT_ID=<root-agent-id>
  export CONTEXT_TOOLSET_ID=<getUserContext-toolset-id>
  export CATALOG_TOOLSET_ID=<searchCatalog-toolset-id>
  export APP_VERSION_ID=<currently-pinned-version-id>
  export DEPLOYMENT_DISPLAY_NAME=<web-widget-deployment-display-name>
  export MODEL_NAME=<root-agent-model-setting-from-console>
  export AGENT_SHARED_SECRET_ID=<Secret Manager secret ID backing the console tools' auth>
  export AGENT_SHARED_SECRET_VERSION=<its-live-version-number>
  export AGENT_SHARED_SECRET_VALUE=<the-live-API-key-value>
  ```

### Phase 1: Repo structure and schema validation (locally, no live access)

1. **Verify the Terraform layout:**
   ```bash
   ls -la terraform/
   # Expected: versions.tf, variables.tf, locals.tf, secrets.tf, app.tf, agent.tf,
   #           toolsets.tf, deployment.tf, outputs.tf, terraform.tfvars.example,
   #           .terraform.lock.hcl
   ```

2. **Confirm schema is valid against the pinned provider:**
   ```bash
   cd terraform/
   terraform init -backend=false
   terraform validate
   # Expected: "Success! The configuration is valid."
   ```

3. **Check file references are correct:**
   ```bash
   grep -n "file(" *.tf
   # Expected lines like:
   #   agent.tf: instruction = file("../agent/instructions.md")
   #   toolsets.tf: open_api_schema = file("../agent/tools/get-user-context.openapi.yaml")
   #   toolsets.tf: open_api_schema = file("../agent/tools/search-catalog.openapi.yaml")
   ```

4. **Verify variables have no dangerous defaults:**
   ```bash
   grep -A2 "variable \"project_id\"" variables.tf
   # Expected: no default; required = true
   grep -A2 "variable \"snowplow_session_id\"" variables.tf
   # Expected: no default; required = true (per §8.4/§9.1 finding)
   ```

### Phase 2: Import existing console-built resources and validate plan

1. **Copy and fill the variables file:**
   ```bash
   cd terraform/
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with the environment variables from Prerequisites
   ```

2. **Initialize the backend:**
   ```bash
   terraform init
   # Expected: "Terraform has been successfully configured for this working directory."
   ```

3. **Import the console-built resources in dependency order:**
   ```bash
   # App first (no deps)
   terraform import google_ces_app.this \
     "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}"
   # Expected: "google_ces_app.this: Import complete!"

   # Toolsets next (app is their parent)
   terraform import google_ces_toolset.context \
     "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/toolsets/${CONTEXT_TOOLSET_ID}"
   # Expected: "google_ces_toolset.context: Import complete!"

   terraform import google_ces_toolset.catalog \
     "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/toolsets/${CATALOG_TOOLSET_ID}"
   # Expected: "google_ces_toolset.catalog: Import complete!"

   # Agent (app is parent)
   terraform import google_ces_agent.root \
     "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/agents/${AGENT_ID}"
   # Expected: "google_ces_agent.root: Import complete!"

   # App-root-agent association
   terraform import google_ces_app_root_agent_association.this \
     "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/agents/${AGENT_ID}"
   # Expected: "google_ces_app_root_agent_association.this: Import complete!"

   # App version (app is parent)
   terraform import google_ces_app_version.current \
     "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/versions/${APP_VERSION_ID}"
   # Expected: "google_ces_app_version.current: Import complete!"

   # Deployment (app is parent)
   terraform import google_ces_deployment.web_widget \
     "projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}/deployments/<deployment-resource-id>"
   # Note: deployment ID is NOT the display name; if unsure, check console → deployment details
   # Expected: "google_ces_deployment.web_widget: Import complete!"
   ```

4. **Import the shared secret (only if using the console-secret-import path, not the fresh-secret path):**
   ```bash
   # See terraform/README.md "Secret reconciliation" for the two paths; if using the
   # "import console's hidden secret" path, run:
   terraform import google_secret_manager_secret.agent_shared_secret \
     "projects/${PROJECT_ID}/secrets/${AGENT_SHARED_SECRET_ID}"
   # Expected: "google_secret_manager_secret.agent_shared_secret: Import complete!"

   terraform import google_secret_manager_secret_version.agent_shared_secret \
     "projects/${PROJECT_ID}/secrets/${AGENT_SHARED_SECRET_ID}/versions/${AGENT_SHARED_SECRET_VERSION}"
   # Expected: "google_secret_manager_secret_version.agent_shared_secret: Import complete!"
   ```

5. **Confirm a clean plan:**
   ```bash
   TF_VAR_agent_shared_secret_value="${AGENT_SHARED_SECRET_VALUE}" terraform plan
   # Expected: "No changes. Your infrastructure matches the configuration."
   # OR (if using fresh-secret path): only the Secret Manager resource creation diffs
   #     (as documented in terraform/README.md "Secret reconciliation")
   # If any other diffs appear, they indicate a mismatch between live state and the config
   # — do not proceed until reconciled. Common causes:
   #   - A variable value doesn't match the console value (double-check project_id,
   #     location, app_id, agent_id, etc. from the console)
   #   - A resource attribute was changed in the console after the Terraform config
   #     was written (e.g., agent instructions edited)
   #   - A resource ID in the import command was wrong (verify format against
   #     terraform/README.md or the provider docs)
   ```

### Phase 3: Capture `apps.exportApp` snapshot and apply labels

1. **Get the CES API host from the official reference:**
   ```bash
   # Visit https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/reference/rest/v1/projects.locations.apps/exportApp
   # Confirm the REST endpoint host (likely https://converseai.googleapis.com or similar)
   export CES_API_HOST="<confirmed-host>"
   ```

2. **Capture the snapshot:**
   ```bash
   mkdir -p agent/export/
   curl -X POST \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json" \
     "${CES_API_HOST}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/apps/${APP_ID}:exportApp" \
     -d '{"exportFormat": "JSON"}' \
     -o "agent/export/app-export-$(date +%Y%m%d).json"
   # Expected: HTTP 200 and a valid JSON file written; `jq . agent/export/app-export-*.json` should parse cleanly
   ```

3. **Apply baseline labels to the project (workaround for `ces_app`/`ces_agent` label gap):**
   ```bash
   gcloud projects update "${PROJECT_ID}" \
     --update-labels=system=signals-gecx-demo,snowplow-owner=cc017,environment=dev
   # Expected: "Updated [...]"
   gcloud projects describe "${PROJECT_ID}" --format='value(labels)'
   # Expected: output includes "environment=dev environment=dev snowplow-owner=cc017 system=signals-gecx-demo"
   ```

### Verification summary

Record results at these placeholders in `docs/runbook.md`:

- **After §10.3 import:** `<PLACEHOLDER: import verification run log — all 7–9 import commands succeeded, resource names confirmed>`
- **After §10.4 plan:** `<PLACEHOLDER: clean-plan verification run log>`
- **After §10.5 snapshot:** `<PLACEHOLDER: exportApp snapshot capture log — date, file path, any drift noticed vs. the `.tf` sources>`
- **After §10.6 labels:** `<PLACEHOLDER: project-labelling verification log>`

### If it fails

- **Import command says "resource already managed":** The resource ID format may be wrong or it was already imported. Check the provider docs and the error message carefully; the resource-name formats differ slightly per resource type.
- **Plan shows unexpected diffs:** A variable value doesn't match console state. Most common: `project_id`, `location`, or `agent_id` misread from console. Verify all six variables in the console before re-running plan.
- **API call fails (exportApp, gcloud):** Confirm GCP credentials are fresh (`gcloud auth login` if needed) and the project ID is correct. For API host errors, re-check the official CES reference docs.
- **Terraform schema errors:** Run `terraform init -backend=false && terraform validate` again locally to diagnose; usually indicates a typo in `terraform.tfvars` or a provider version mismatch.

## Rollback

If needed: `git revert -n <commit-hash>` to create a revert commit, or `git reset --hard main` to discard unpushed work (only run this if the branch is backed up and no live resources were created yet).

