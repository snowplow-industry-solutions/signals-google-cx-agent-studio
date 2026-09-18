resource "google_ces_app" "this" {
  app_id       = var.app_id
  location     = var.location
  project      = var.project_id
  display_name = var.app_display_name

  # Root agent is wired via google_ces_app_root_agent_association.this --
  # the agent must reference its parent app at create time, so it can't be
  # set inline here (provider example: "Root agent should not be specified
  # when creating an app").

  # Model settings live at the app level, not on the root agent -- the
  # console configures them here and the agent inherits (confirmed live
  # 2026-07-29; the live agent resource has no modelSettings). See
  # README.md re: provider bug #26231 before applying a gemini-3-* model
  # with a non-null temperature in the "us" location.
  model_settings {
    model       = var.model_name
    temperature = var.model_temperature
  }

  tool_execution_mode = "PARALLEL"

  # Declared here (not on google_ces_agent) because variable_declarations
  # is an app-level field shared by every agent in the app. Deliberately no
  # default value: terraform/README.md, Reconciliation gotchas notes a default
  # silently masks a missing session id with another session's data. No description
  # either -- the console-built declaration has none, and adding one here
  # would leave a permanent plan diff. (Purpose: shopper's Snowplow
  # domain_sessionid, populated by the ces-messenger widget via
  # setQueryParameters() -- docs/setup-cx-agent-studio.md §6.)
  variable_declarations {
    name        = "snowplow_session_id"
    description = "" # required argument; the console-built declaration has none
    schema {
      type = "STRING"
    }
  }

  # Same rationale as snowplow_session_id above: no default, so a missing
  # value errors instead of silently reusing another shopper's identity or
  # turn. Populated by the ces-messenger widget alongside the session id
  # (docs/setup-cx-agent-studio.md §6) and consumed by the self-tracking
  # toolset's identity headers (agent/tools/self-tracking.openapi.yaml).
  variable_declarations {
    name        = "snowplow_user_id"
    description = ""
    schema {
      type = "STRING"
    }
  }

  # Same rationale as snowplow_session_id above. Minted per turn by the
  # widget (issue 22) rather than read from the tracker, so tool calls and
  # self-tracking events issued during the same turn share an id.
  variable_declarations {
    name        = "snowplow_turn_id"
    description = ""
    schema {
      type = "STRING"
    }
  }

  lifecycle {
    ignore_changes = [
      # Provider v7.41.0 import gap: terraform import populates `name` but
      # leaves the create-only `app_id` field null in state, and app_id is
      # ForceNew -- without this, the first plan after import wants to
      # destroy and recreate the live app. Greenfield creates still use
      # var.app_id (ignore_changes only applies to updates).
      app_id,
      # Owned by google_ces_app_root_agent_association.this.
      root_agent,
      # Console-owned settings this config deliberately doesn't manage
      # (README.md "Ownership boundary"): the console creates default
      # guardrails and populates audio/language/logging/timezone settings
      # on every app it builds.
      guardrails,
      metadata,
      pinned,
      audio_processing_config,
      language_settings,
      logging_settings,
      time_zone_settings,
    ]
  }

  deletion_policy = local.ces_deletion_policy
}
