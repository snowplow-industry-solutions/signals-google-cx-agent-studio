terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source = "hashicorp/google"
      # google_ces_* family: google_ces_app/toolset (7.10.0), google_ces_deployment
      # (7.11.0), google_ces_agent (7.12.0), google_ces_app_version (7.13.0),
      # google_ces_app_root_agent_association (7.31.0).
      version = ">= 7.31.0"
    }
  }
}

provider "google" {
  project = var.project_id
}
