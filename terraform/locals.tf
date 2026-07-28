locals {
  # Baseline tagging policy (docs/design.md decision #7). None of the
  # google_ces_* resources below expose a labels field (confirmed against
  # the provider doc sources -- see docs/research/cx-agent-studio-terraform.md
  # §1b), so this only reaches the one supporting resource this config
  # creates (the shared-secret Secret Manager secret). Project-level labels
  # are applied out-of-band -- see README.md.
  baseline_labels = {
    system         = "signals-gecx-demo"
    snowplow-owner = "cc017"
    environment    = "dev"
  }

  # These resources back a live public demo with a hard recording deadline
  # (docs/design.md); default to PREVENT so a bad plan/apply can't silently
  # tear down the agent. Override per-resource with -var if a deliberate
  # rebuild is intended.
  ces_deletion_policy = "PREVENT"
}
