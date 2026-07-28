# open_api_tool via google_ces_tool is read-only; google_ces_toolset is the
# writable path for OpenAPI tools (docs/research/cx-agent-studio-terraform.md
# §1b). One toolset per schema file, matching the two tools defined in
# agent/tools/.

resource "google_ces_toolset" "context" {
  toolset_id   = var.context_toolset_id
  location     = var.location
  app          = google_ces_app.this.app_id
  project      = var.project_id
  display_name = "Get User Context"
  description  = "Merged Signals context (Profile Store attributes + Agentic Context narrative) for a shopper session. GET /api/agent/context."

  open_api_toolset {
    open_api_schema = file("${path.module}/../agent/tools/get-user-context.openapi.yaml")

    api_authentication {
      api_key_config {
        api_key_secret_version = google_secret_manager_secret_version.agent_shared_secret.name
        key_name               = "x-agent-api-key"
        request_location       = "HEADER"
      }
    }
  }

  deletion_policy = local.ces_deletion_policy
}

resource "google_ces_toolset" "catalog" {
  toolset_id   = var.catalog_toolset_id
  location     = var.location
  app          = google_ces_app.this.app_id
  project      = var.project_id
  display_name = "Search Catalog"
  description  = "Storefront product catalog search, filterable by category/designer/occasion/colour/price. GET /api/agent/catalog."

  open_api_toolset {
    open_api_schema = file("${path.module}/../agent/tools/search-catalog.openapi.yaml")

    api_authentication {
      api_key_config {
        api_key_secret_version = google_secret_manager_secret_version.agent_shared_secret.name
        key_name               = "x-agent-api-key"
        request_location       = "HEADER"
      }
    }
  }

  deletion_policy = local.ces_deletion_policy
}
