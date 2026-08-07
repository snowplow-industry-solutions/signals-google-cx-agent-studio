output "app_name" {
  description = "Full resource name of the CES app."
  value       = google_ces_app.this.name
}

output "root_agent_name" {
  description = "Full resource name of the root agent."
  value       = google_ces_agent.root.name
}

output "context_toolset_name" {
  description = "Full resource name of the getUserContext toolset."
  value       = google_ces_toolset.context.name
}

output "catalog_toolset_name" {
  description = "Full resource name of the searchCatalog toolset."
  value       = google_ces_toolset.catalog.name
}

output "app_version_name" {
  description = "Full resource name of the managed app version."
  value       = google_ces_app_version.current.name
}

output "deployment_name" {
  description = "Full resource name of the web-widget deployment -- this is the NEXT_PUBLIC_CES_DEPLOYMENT_ID value (storefront/.env.example, docs/setup-cx-agent-studio.md §6)."
  value       = google_ces_deployment.web_widget.name
}
