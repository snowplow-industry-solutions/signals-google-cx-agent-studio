# Backs the API-key auth on both toolsets (secrets.tf, not toolsets.tf,
# since both toolsets share the one shared secret). The
# google_ces_toolset.open_api_toolset.api_authentication.api_key_config
# schema requires a Secret Manager secret version -- there's no way to
# hand it a raw string, unlike the console's API-key auth form (see
# README.md for what that implies at import time).

data "google_project" "sandbox" {
  project_id = var.project_id
}

resource "google_secret_manager_secret" "agent_shared_secret" {
  project   = var.project_id
  secret_id = var.agent_shared_secret_id
  labels    = local.baseline_labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "agent_shared_secret" {
  secret      = google_secret_manager_secret.agent_shared_secret.id
  secret_data = var.agent_shared_secret_value

  lifecycle {
    ignore_changes = [
      # var.agent_shared_secret_value is deliberately unset in the committed
      # tfvars (it defaults to null and is passed with
      # TF_VAR_agent_shared_secret_value only on a greenfield create), so on
      # the import path the config value reads null against the adopted
      # version's real data. Both attributes are ForceNew, so without this the
      # plan replaces the live version on every run -- rotating
      # AGENT_SHARED_SECRET out from under the Vercel env and breaking both
      # toolsets' API-key auth. Rotation is a deliberate human op (runbook
      # §12), never a side effect of an unrelated apply.
      secret_data,
      is_secret_data_base64,
    ]
  }
}

# The CES service agent reads the secret when the tool executes a call
# (docs/runbook.md Troubleshooting: "Failed to get secret ... please check
# that the service account has the Secret Manager Secret Accessor role").
resource "google_secret_manager_secret_iam_member" "ces_service_agent_accessor" {
  project   = google_secret_manager_secret.agent_shared_secret.project
  secret_id = google_secret_manager_secret.agent_shared_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-${data.google_project.sandbox.number}@gcp-sa-ces.iam.gserviceaccount.com"
}
