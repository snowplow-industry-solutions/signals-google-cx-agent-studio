resource "google_ces_agent" "root" {
  agent_id     = var.agent_id
  location     = var.location
  app          = google_ces_app.this.app_id
  project      = var.project_id
  display_name = "Atelier Signals Concierge - Root Agent"
  description  = "Luxury fashion concierge grounded in real-time Snowplow Signals context (agent/instructions.md)."

  instruction = file("${path.module}/../agent/instructions.md")

  model_settings {
    model       = var.model_name
    temperature = var.model_temperature
  }

  toolsets {
    toolset = google_ces_toolset.context.id
  }

  toolsets {
    toolset = google_ces_toolset.catalog.id
  }

  llm_agent {}

  deletion_policy = local.ces_deletion_policy
}

# Root agent can't be set on google_ces_app at create time (the agent must
# reference its parent app first) -- this association resource completes
# the wiring afterwards (docs/research/cx-agent-studio-terraform.md §1b).
resource "google_ces_app_root_agent_association" "this" {
  app_id   = google_ces_app.this.app_id
  location = var.location
  project  = var.project_id
  agent_id = google_ces_agent.root.agent_id

  deletion_policy = local.ces_deletion_policy
}
