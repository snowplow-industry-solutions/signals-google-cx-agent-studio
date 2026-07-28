# App versions are immutable snapshots (docs/research/cx-agent-studio-terraform.md
# §1b) -- this manages whichever version app_version_id names (the one the
# live deployment currently serves, for a clean initial plan). Publishing a
# future change means adding a *new* google_ces_app_version resource with a
# new app_version_id and repointing google_ces_deployment.web_widget.app_version
# at it -- see README.md "Re-apply after trial expiry / re-publish".
resource "google_ces_app_version" "current" {
  app_version_id = var.app_version_id
  location       = var.location
  app            = google_ces_app.this.app_id
  project        = var.project_id
  display_name   = var.app_version_display_name

  depends_on = [
    google_ces_app_root_agent_association.this,
    google_ces_toolset.context,
    google_ces_toolset.catalog,
  ]

  deletion_policy = local.ces_deletion_policy
}

# Widget channel + public-access/token-broker settings (issue 07's
# ces-messenger wiring, docs/runbook.md §9.2). Recaptcha stays off: the
# ces-messenger component has no reCAPTCHA support, and turning the
# deployment's recaptcha check on makes the broker reject every session
# (docs/runbook.md §9.2, Troubleshooting).
resource "google_ces_deployment" "web_widget" {
  location     = var.location
  app          = google_ces_app.this.app_id
  project      = var.project_id
  display_name = var.deployment_display_name
  app_version  = google_ces_app_version.current.id

  channel_profile {
    channel_type = "WEB_UI"

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
