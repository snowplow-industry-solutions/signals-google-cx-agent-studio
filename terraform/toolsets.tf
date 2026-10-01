# open_api_tool via google_ces_tool is read-only; google_ces_toolset is the
# writable path for OpenAPI tools. One toolset per schema file in
# agent/tools/. context and catalog mirror the console-built toolsets on the
# original app (named after the OpenAPI operationIds at import); self_tracking
# has no console-built counterpart to mirror -- it's created fresh by this
# config -- so its display name follows the same operationId
# convention for consistency. The console sets no descriptions on any of
# these, so none are set here.
#
# open_api_schema comes from local.openapi_schemas (locals.tf), which
# substitutes var.storefront_url for the committed placeholder server URL.
# A plan whose toolsets want to change only servers[0].url means
# storefront_url in the active tfvars disagrees with what was applied.

# Merged Signals context (Profile Store attributes + Agentic Context
# narrative) for a shopper session. GET /api/agent/context.
resource "google_ces_toolset" "context" {
  toolset_id   = var.context_toolset_id
  location     = var.location
  app          = google_ces_app.this.name
  project      = var.project_id
  display_name = "getUserContext"

  open_api_toolset {
    open_api_schema = local.openapi_schemas["get-user-context"]

    api_authentication {
      api_key_config {
        # The console wires tools to the mutable "latest" alias, not a
        # pinned version number (confirmed against the live API), and the
        # version-resource reference can only ever render "versions/N" --
        # so build the live form, keeping the dependency via secret_id.
        api_key_secret_version = "projects/${var.project_id}/secrets/${google_secret_manager_secret.agent_shared_secret.secret_id}/versions/latest"
        key_name               = "x-agent-api-key"
        request_location       = "HEADER"
      }
    }
  }

  deletion_policy = local.ces_deletion_policy
}

# Agent self-tracking: logs the shopper intent the concierge detected, the
# decisions it makes, and constraints the catalog couldn't satisfy, as
# Snowplow events. POST /api/agent/track-intent, /track-decision,
# /track-constraint. Same API-key secret config as context/catalog above --
# see terraform/README.md "Secret reconciliation" for why it's the mutable
# "latest" alias rather than a pinned secret version.
resource "google_ces_toolset" "self_tracking" {
  toolset_id   = var.self_tracking_toolset_id
  location     = var.location
  app          = google_ces_app.this.name
  project      = var.project_id
  display_name = "selfTracking"

  open_api_toolset {
    open_api_schema = local.openapi_schemas["self-tracking"]

    api_authentication {
      api_key_config {
        api_key_secret_version = "projects/${var.project_id}/secrets/${google_secret_manager_secret.agent_shared_secret.secret_id}/versions/latest"
        key_name               = "x-agent-api-key"
        request_location       = "HEADER"
      }
    }
  }

  deletion_policy = local.ces_deletion_policy
}

# Storefront product catalog search, filterable by category/designer/
# occasion/colour/price. GET /api/agent/catalog.
resource "google_ces_toolset" "catalog" {
  toolset_id   = var.catalog_toolset_id
  location     = var.location
  app          = google_ces_app.this.name
  project      = var.project_id
  display_name = "searchCatalog"

  open_api_toolset {
    open_api_schema = local.openapi_schemas["search-catalog"]

    api_authentication {
      api_key_config {
        # The console wires tools to the mutable "latest" alias, not a
        # pinned version number (confirmed against the live API), and the
        # version-resource reference can only ever render "versions/N" --
        # so build the live form, keeping the dependency via secret_id.
        api_key_secret_version = "projects/${var.project_id}/secrets/${google_secret_manager_secret.agent_shared_secret.secret_id}/versions/latest"
        key_name               = "x-agent-api-key"
        request_location       = "HEADER"
      }
    }
  }

  deletion_policy = local.ces_deletion_policy
}
