locals {
  # These resources back a live demo. Default to PREVENT so a bad plan/apply
  # can't silently tear down the agent. Override per-resource with -var if a
  # deliberate rebuild is intended.
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
