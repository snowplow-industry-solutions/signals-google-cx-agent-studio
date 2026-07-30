# open_api_tool via google_ces_tool is read-only; google_ces_toolset is the
# writable path for OpenAPI tools (docs/research/cx-agent-studio-terraform.md
# §1b). One toolset per schema file, matching the two tools defined in
# agent/tools/. Display names mirror the console-built toolsets (named after
# the OpenAPI operationIds at import, §8.3); the console sets no
# descriptions, so none are set here.

# Merged Signals context (Profile Store attributes + Agentic Context
# narrative) for a shopper session. GET /api/agent/context.
resource "google_ces_toolset" "context" {
  toolset_id   = var.context_toolset_id
  location     = var.location
  app          = google_ces_app.this.name
  project      = var.project_id
  display_name = "getUserContext"

  open_api_toolset {
    open_api_schema = file("${path.module}/../agent/tools/get-user-context.openapi.yaml")

    api_authentication {
      api_key_config {
        # The console wires tools to the mutable "latest" alias, not a
        # pinned version number (confirmed live 2026-07-29), and the
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

# Storefront product catalog search, filterable by category/designer/
# occasion/colour/price. GET /api/agent/catalog.
resource "google_ces_toolset" "catalog" {
  toolset_id   = var.catalog_toolset_id
  location     = var.location
  app          = google_ces_app.this.name
  project      = var.project_id
  display_name = "searchCatalog"

  open_api_toolset {
    open_api_schema = file("${path.module}/../agent/tools/search-catalog.openapi.yaml")

    api_authentication {
      api_key_config {
        # The console wires tools to the mutable "latest" alias, not a
        # pinned version number (confirmed live 2026-07-29), and the
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
