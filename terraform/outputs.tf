# Every output here is a *full* resource name
# (projects/<project>/locations/<location>/apps/<app>/...). On provider
# v7.41.0 that is the resource's `id`; `.name` is only the last path segment
# (a `.name`-based deployment_name hands the widget a bare UUID and it
# refuses to start).

output "app_name" {
  description = "Full resource name of the CES app."
  value       = google_ces_app.this.id
}

output "root_agent_name" {
  description = "Full resource name of the root agent."
  value       = google_ces_agent.root.id
}

output "context_toolset_name" {
  description = "Full resource name of the getUserContext toolset."
  value       = google_ces_toolset.context.id
}

output "catalog_toolset_name" {
  description = "Full resource name of the searchCatalog toolset."
  value       = google_ces_toolset.catalog.id
}

output "self_tracking_toolset_name" {
  description = "Full resource name of the self-tracking toolset."
  value       = google_ces_toolset.self_tracking.id
}

output "app_version_name" {
  description = "Full resource name of the app version the web-widget deployment serves."
  value       = google_ces_app_version.v2_text_with_widgets.id
}

output "initial_app_version_name" {
  description = "Full resource name of the retained first app version (google_ces_app_version.current)."
  value       = google_ces_app_version.current.id
}

output "deployment_name" {
  description = "Full resource name of the web-widget deployment -- this is the NEXT_PUBLIC_CES_DEPLOYMENT_ID value (storefront/.env.example, docs/setup-cx-agent-studio.md §6)."
  value       = google_ces_deployment.web_widget.id
}
