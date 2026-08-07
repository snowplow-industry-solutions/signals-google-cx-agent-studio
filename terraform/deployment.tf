# App versions are immutable snapshots -- this manages whichever version
# app_version_id names (the one the
# live deployment currently serves, for a clean initial plan). Publishing a
# future change means adding a *new* google_ces_app_version resource with a
# new app_version_id and repointing google_ces_deployment.web_widget.app_version
# at it -- see README.md "Re-apply after trial expiry / re-publish".
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

# Widget channel + public-access/token-broker settings (issue 07's
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
  app_version  = google_ces_app_version.current.id

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
