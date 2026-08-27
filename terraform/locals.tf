locals {
  # These resources back a live demo. Default to PREVENT so a bad plan/apply
  # can't silently tear down the agent. Override per-resource with -var if a
  # deliberate rebuild is intended.
  ces_deletion_policy = "PREVENT"
}
