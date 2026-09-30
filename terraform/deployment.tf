# App versions are immutable snapshots -- `current` manages whichever version
# app_version_id names (the first one this workspace created, or the one the
# imported deployment served, for a clean initial plan). Publishing a change
# to the agent means adding a *new* google_ces_app_version resource below with
# a new app_version_id and repointing google_ces_deployment.web_widget at it
# -- see README.md "Re-apply after trial expiry / re-publish". Old version
# resources stay in config: deletion_policy is PREVENT, and a version the
# deployment has ever served is not worth destroying anyway.
resource "google_ces_app_version" "current" {
  app_version_id = var.app_version_id
  location       = var.location
  app            = google_ces_app.this.name
  project        = var.project_id
  display_name   = var.app_version_display_name

  depends_on = [
    google_ces_app_root_agent_association.this,
    google_ces_toolset.context,
    google_ces_toolset.catalog,
    google_ces_toolset.self_tracking,
  ]

  lifecycle {
    ignore_changes = [
      # Provider v7.41.0 import gap: import leaves the create-only,
      # ForceNew app_version_id null in state (see app.tf/agent.tf).
      app_version_id,
      # Console-deploy-generated text ("Automatically created from
      # deploying to ...") on the imported version; ForceNew, so managing
      # it here would force a replacement of an immutable snapshot.
      description,
    ]
  }

  deletion_policy = local.ces_deletion_policy
}

# Second published version: snapshots the agent draft once the real
# storefront origin is rendered into the instruction and tool schemas, and
# the decision tracking call moved into the searchCatalog step (one per turn)
# so the model writes reply text alongside widgets again. The deployment below serves this
# one; `current` above stays as the retained v1 snapshot.
resource "google_ces_app_version" "v2_text_with_widgets" {
  app_version_id = "v2-text-with-widgets"
  location       = var.location
  app            = google_ces_app.this.name
  project        = var.project_id
  display_name   = "v2 - reply text alongside widgets"
  description    = "Agent draft after PRs #38 and #40: real storefront origin in schemas and instruction; single decision call per turn so replies keep their text."

  depends_on = [
    google_ces_app_root_agent_association.this,
    google_ces_toolset.context,
    google_ces_toolset.catalog,
    google_ces_toolset.self_tracking,
  ]

  deletion_policy = local.ces_deletion_policy
}

# Widget channel + public-access/token-broker settings (the
# ces-messenger wiring, docs/setup-cx-agent-studio.md §6). Recaptcha stays off: the
# ces-messenger component has no reCAPTCHA support, and turning the
# deployment's recaptcha check on makes the broker reject every session
# (docs/setup-cx-agent-studio.md §6; terraform/README.md, Reconciliation
# gotchas).
resource "google_ces_deployment" "web_widget" {
  location     = var.location
  app          = google_ces_app.this.name
  project      = var.project_id
  display_name = var.deployment_display_name
  app_version  = google_ces_app_version.v2_text_with_widgets.id

  channel_profile {
    channel_type = "WEB_UI"

    # The console sets both on every WEB_UI deployment it builds; the demo
    # is text-only anyway (docs/setup-cx-agent-studio.md §6 pins audio off client-side).
    disable_dtmf             = true
    disable_barge_in_control = true

    web_widget_config {
      modality         = var.web_widget_modality
      theme            = var.web_widget_theme
      web_widget_title = var.web_widget_title

      security_settings {
        enable_public_access = true
        enable_origin_check  = true
        allowed_origins      = var.allowed_origins
        enable_recaptcha     = false
      }
    }
  }

  deletion_policy = local.ces_deletion_policy
}
