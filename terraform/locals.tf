locals {
  # Baseline tagging policy. None of the
  # google_ces_* resources below expose a labels field (confirmed against
  # the provider doc sources), so this only reaches the one supporting resource this config
  # creates (the shared-secret Secret Manager secret). Project-level labels
  # are applied out-of-band -- see README.md.
  baseline_labels = {
    system         = "signals-gecx-demo"
    snowplow-owner = "cc017"
    environment    = "dev"
  }

  # These resources back a live public demo with a hard recording deadline
  # default to PREVENT so a bad plan/apply can't silently
  # tear down the agent. Override per-resource with -var if a deliberate
  # rebuild is intended.
  ces_deletion_policy = "PREVENT"

  # agent/tools/*.openapi.yaml are committed with this placeholder as
  # servers[0].url so no real hostname lands in git. The toolsets render the
  # deployed storefront origin in its place at plan time, from
  # var.storefront_url -- the same value the widget deployment uses for
  # allowed_origins. Nothing in agent/tools/ is ever edited for an apply.
  storefront_url_placeholder = "https://your-storefront.example.com"

  openapi_schemas = {
    for stem in ["get-user-context", "search-catalog", "self-tracking"] :
    stem => replace(
      file("${path.module}/../agent/tools/${stem}.openapi.yaml"),
      local.storefront_url_placeholder,
      var.storefront_url,
    )
  }
}
