resource "google_ces_app" "this" {
  app_id       = var.app_id
  location     = var.location
  project      = var.project_id
  display_name = "Atelier Signals Concierge"
  description  = "Customer-facing concierge agent for the Atelier Signals demo storefront (Signals x CX Agent Studio)."

  # Root agent is wired via google_ces_app_root_agent_association.this --
  # the agent must reference its parent app at create time, so it can't be
  # set inline here (provider example: "Root agent should not be specified
  # when creating an app").

  # Declared here (not on google_ces_agent) because variable_declarations
  # is an app-level field shared by every agent in the app. Deliberately no
  # default value: docs/runbook.md Troubleshooting notes a default silently
  # masks a missing session id with another session's data.
  variable_declarations {
    name        = "snowplow_session_id"
    description = "Shopper's Snowplow domain_sessionid, populated by the ces-messenger widget via setQueryParameters() (docs/runbook.md CX Agent Studio setup, §9.4)."
    schema {
      type = "STRING"
    }
  }

  deletion_policy = local.ces_deletion_policy
}
