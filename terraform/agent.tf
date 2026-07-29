resource "google_ces_agent" "root" {
  agent_id     = var.agent_id
  location     = var.location
  app          = google_ces_app.this.name
  project      = var.project_id
  display_name = "Root agent"

  # The console-format instruction copy is what the live agent actually
  # runs (docs/runbook.md §8.2: paste instructions.console.txt into the
  # Root Agent node, verbatim -- its {@TOOL: ...} references only resolve
  # in that format). agent/instructions.md is the human-readable source
  # for the same contract; edit there first and mirror changes into the
  # console copy.
  instruction = file("${path.module}/../agent/instructions.console.txt")

  # Model settings are app-level (see app.tf) -- the live agent carries
  # none and inherits the app's.

  # end_session is attached to every agent the console builds.
  tools = [
    "projects/${var.project_id}/locations/${var.location}/apps/${var.app_id}/tools/end_session",
  ]

  toolsets {
    toolset  = google_ces_toolset.context.id
    tool_ids = ["getUserContext"]
  }

  toolsets {
    toolset  = google_ces_toolset.catalog.id
    tool_ids = ["searchCatalog"]
  }

  # No llm_agent {} block: the live console-built agent stores no explicit
  # agent-type config (LLM is the default), and declaring the empty block
  # leaves a permanent "+ llm_agent {}" plan diff against imported state.

  lifecycle {
    ignore_changes = [
      # Provider v7.41.0 import gap: import leaves the create-only,
      # ForceNew agent_id null in state -- without this, the first plan
      # after import wants to destroy and recreate the live agent.
      # Greenfield creates still use var.agent_id.
      agent_id,
    ]
  }

  deletion_policy = local.ces_deletion_policy
}

# Root agent can't be set on google_ces_app at create time (the agent must
# reference its parent app first) -- this association resource completes
# the wiring afterwards (docs/research/cx-agent-studio-terraform.md §1b).
resource "google_ces_app_root_agent_association" "this" {
  app_id   = google_ces_app.this.name
  location = var.location
  project  = var.project_id
  agent_id = google_ces_agent.root.name

  deletion_policy = local.ces_deletion_policy
}
