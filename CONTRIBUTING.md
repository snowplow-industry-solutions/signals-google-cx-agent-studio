# Contributing

This repo is a reference integration, not a supported product. Issues and
pull requests are welcome; response times are best-effort.

## Before you open a PR

1. Run the storefront checks from the repo root:
   `npm --prefix storefront run snowtype:generate` (once, needs a Snowplow org
   in `storefront/.env.local`), then
   `npm --prefix storefront test && npm --prefix storefront run lint && npm --prefix storefront run build`.
2. If you changed `terraform/`, run `terraform fmt -check` and `terraform validate`.
3. Never commit credentials, org IDs, project IDs or hostnames. Use the
   `<placeholder>` convention from the docs. `gitleaks git .` should be clean.
4. Describe the change in plain language: what it does and why, for a reader
   who hasn't seen your local setup.

## Where things live

See [AGENTS.md](./AGENTS.md) for the layout and the per-directory READMEs for
details.
