# Live resource identifiers below have no defaults on purpose: they identify
# resources the console already created in *your* project. Fill them in from
# the console (or `apps.exportApp`, see README.md) before running plan/import.

variable "project_id" {
  type        = string
  description = "Your GCP project ID hosting the CX Agent Studio app."
}

variable "location" {
  type        = string
  description = <<-EOT
    CES app location (the resource name segment `.../locations/<location>/...`).
    Read it off the console URL when viewing the app, or the `name` field of
    an `apps.exportApp` response. Provider examples default to "us", but that
    is not confirmed for this project -- verify rather than assume, and note
    that provider bug #26231 (see README.md) affects `gemini-3-flash` +
    `temperature` specifically in the "us" region.
  EOT
}

variable "app_id" {
  type        = string
  description = "ID of the existing console-built CES app to import as google_ces_app.this."
}

variable "app_display_name" {
  type        = string
  description = <<-EOT
    Display name of the existing console-built app -- whatever name was
    chosen at creation in the console (docs/setup-cx-agent-studio.md §2 doesn't
    prescribe one). Read the live value from the console so the first
    plan after import is clean.
  EOT
}

variable "agent_id" {
  type        = string
  description = "ID of the existing console-built root agent to import as google_ces_agent.root."
}

variable "context_toolset_id" {
  type        = string
  description = "ID of the existing console-built toolset wrapping the getUserContext tool to import as google_ces_toolset.context."
}

variable "catalog_toolset_id" {
  type        = string
  description = "ID of the existing console-built toolset wrapping the searchCatalog tool to import as google_ces_toolset.catalog."
}

variable "self_tracking_toolset_id" {
  type        = string
  description = <<-EOT
    ID of the toolset wrapping the three self-tracking tools to
    manage as google_ces_toolset.self_tracking. Unlike context_toolset_id
    and catalog_toolset_id, this toolset has no console-built original to
    adopt an ID from -- the default below is the ID this config assigns it
    on a greenfield create. Override it only if importing this
    toolset onto an app where it was already created under a different ID.
  EOT
  default     = "self-tracking"
}

variable "app_version_id" {
  type        = string
  description = <<-EOT
    ID of the app version to manage as google_ces_app_version.current. App
    versions are immutable snapshots: if this ID matches the version the
    live deployment currently serves, it will be imported; publishing a
    future change means picking a *new* ID here and repointing the
    deployment at it (see README.md re-apply steps), not editing this one.
  EOT
}

variable "app_version_display_name" {
  type        = string
  description = "Display name for the app version identified by app_version_id."
}

variable "deployment_display_name" {
  type        = string
  description = "Display name of the existing console-built web-widget deployment to import as google_ces_deployment.web_widget."
}

variable "storefront_url" {
  type        = string
  description = <<-EOT
    Public HTTPS origin of the deployed storefront (docs/setup-snowplow-trial.md
    §7). Used as the widget deployment's allowed origin and rendered into the
    three OpenAPI tool schemas' servers[0].url (locals.tf openapi_schemas), so
    the committed agent/tools/*.openapi.yaml keep their placeholder.
  EOT
  default     = "https://your-storefront.example.com"

  validation {
    condition     = var.storefront_url != "https://your-storefront.example.com" && can(regex("^https://[^/]+$", var.storefront_url))
    error_message = "storefront_url must be the deployed storefront's real https:// origin (no path, no trailing slash) -- the placeholder default would make every agent tool call a dead URL."
  }
}

variable "allowed_origins" {
  type        = list(string)
  description = "Origins allowed to embed the web widget (google_ces_deployment security_settings.allowed_origins)."
  default     = ["https://your-storefront.example.com"]
}

variable "web_widget_title" {
  type        = string
  description = "Chat widget title, matching CesMessengerWidget.tsx's chat-title attribute."
  default     = "Atelier Concierge"
}

variable "web_widget_theme" {
  type        = string
  description = "Widget theme (LIGHT or DARK), matching CesMessengerWidget.tsx's theme-id attribute."
  default     = "DARK"
}

variable "web_widget_modality" {
  type        = string
  description = "Widget modality; the demo is text-only (docs/setup-cx-agent-studio.md §6 pins audio off client-side)."
  default     = "CHAT_ONLY"
}

variable "model_name" {
  type        = string
  description = <<-EOT
    LLM model for the app's model_settings. The console sets model
    settings at the *app* level, not on the root agent (the agent resource
    carries no modelSettings and inherits the app's). Must match whatever
    the live console app currently uses -- discover it from the console or
    `apps.exportApp` rather than guessing. See README.md re: provider bug
    #26231 before pairing this with a non-null model_temperature in the
    "us" location.
  EOT
}

variable "model_temperature" {
  type        = number
  description = "Temperature for the app's model_settings. Leave null to omit the field (inherit the model's default)."
  default     = null
}

variable "product_carousel_tool_id" {
  type        = string
  description = <<-EOT
    ID of the productCarousel widget tool to import as
    google_ces_tool.product_carousel. The console-built tool's ID is a
    UUID -- read it from the agent's `tools` list via the CES REST API or
    console. The default only applies to a greenfield re-create.
  EOT
  default     = "product-carousel"
}

variable "product_details_tool_id" {
  type        = string
  description = <<-EOT
    ID of the productDetails widget tool to import as
    google_ces_tool.product_details. Same discovery route as
    product_carousel_tool_id; the default only applies to a greenfield
    re-create.
  EOT
  default     = "product-details"
}

variable "agent_shared_secret_id" {
  type        = string
  description = <<-EOT
    Secret Manager secret ID this config creates to hold the agent-facing
    shared secret (storefront/.env.example's AGENT_SHARED_SECRET), referenced
    by both toolsets' API-key auth. See README.md for why this may differ
    from whatever secret already backs the console-configured tools, and the
    reconciliation choice that implies at import time.
  EOT
  default     = "ces-agent-shared-secret"
}

variable "agent_shared_secret_value" {
  type        = string
  description = "The AGENT_SHARED_SECRET value (docs/setup-snowplow-trial.md §7) to store in Secret Manager. Never set via a committed .tfvars file -- pass with TF_VAR_agent_shared_secret_value or -var at apply time."
  sensitive   = true
  default     = null
}

variable "labels" {
  type        = map(string)
  description = <<-EOT
    Labels applied to every labellable resource this config creates (today:
    only the Secret Manager secret in secrets.tf -- google_ces_app and
    google_ces_agent expose no labels field). Add your organisation's
    ownership/cost-centre keys here.
  EOT
  default = {
    system      = "signals-cx-agent-demo"
    environment = "dev"
  }
  validation {
    condition = alltrue([
      for k, v in var.labels :
      can(regex("^[a-z][a-z0-9_-]{0,62}$", k)) &&
      can(regex("^[a-z0-9_-]{0,63}$", v))
    ])
    error_message = "labels must be valid GCP label keys/values: keys are lowercase letters, digits, dashes and underscores, starting with a letter; values are lowercase letters, digits, dashes and underscores (or empty); both max 63 chars."
  }
}
