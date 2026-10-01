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
   `<placeholder>` convention from the docs. Verify with:
   ```
   GIT_CONFIG_GLOBAL=/dev/null gitleaks git --redact --exit-code 1 .
   ```
   A global `git config format.pretty` (e.g. `oneline`) breaks gitleaks'
   history parsing, hence the scrubbed config — and treat a scan that
   reports `0 commits scanned` as a failed scan, not a pass.
4. Describe the change in plain language: what it does and why, for a reader
   who hasn't seen your local setup.

## Where things live

See [AGENTS.md](./AGENTS.md) for the layout and the per-directory READMEs for
details.

## CI

`.github/workflows/ci.yml` runs the storefront checks only when the repo
secrets `SNOWPLOW_CONSOLE_ORG_ID`, `SNOWPLOW_CONSOLE_API_KEY_ID` and
`SNOWPLOW_CONSOLE_API_KEY` are set (they point at a Snowplow org seeded with
this repo's tracking plan). Forks and Dependabot PRs skip those steps — see
the note in the workflow itself. If the org behind the secrets expires, CI
reports a snowtype error — re-seed a fresh org with
`./scripts/setup-trial-org.sh` and update the secrets.

The `secrets-scan` job runs the same gitleaks history scan as above,
using the repo's `.gitleaks.toml`.
