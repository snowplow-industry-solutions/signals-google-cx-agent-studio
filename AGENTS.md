# AGENTS.md

Guide for agents and contributors working in this repo. Start with the
[README](./README.md) for what the project is and how the pieces fit together.

## Repo layout

- `storefront/` — the Next.js app: tracking, Signals proxies, the
  `/api/agent/*` tool endpoints, and the chat-widget embed. Has its own
  [README](./storefront/README.md), `package.json`, and test/lint/build
  scripts. **This is the app.**
- `agent/` — source of truth for the CX Agent Studio agent: persona
  instructions (`instructions.md` is human-readable; `instructions.console*.txt`
  are the console-format copies) and the OpenAPI tool schemas
  (`tools/*.openapi.yaml`). See [`agent/README.md`](./agent/README.md).
- `terraform/` — `google_ces_*` config codifying the console-built agent. See
  [`terraform/README.md`](./terraform/README.md).
- `docs/` — the two setup guides.
- `analytics/` — BigQuery queries for the agent and web analytics.
- `scripts/verification/` — probes that validate a live deployment.

## Setup

- Live pipeline + storefront deploy:
  [`docs/setup-snowplow-trial.md`](./docs/setup-snowplow-trial.md).
- Agent, tools, and widget:
  [`docs/setup-cx-agent-studio.md`](./docs/setup-cx-agent-studio.md).
- Terraform: [`terraform/README.md`](./terraform/README.md).

## Working in the storefront

Run commands against the app directory:

```
npm --prefix storefront install
npm --prefix storefront run dev     # dev server
npm --prefix storefront test        # vitest
npm --prefix storefront run lint
npm --prefix storefront run build
```

`snowtype/` holds generated tracking helpers and `snowtype.config.json` is
generated from `snowtype.config.example.json`. Both are per-org and gitignored,
so a fresh clone must run `npm run snowtype:generate` before `test`, `lint` or
`build` will pass. Never edit either by hand — regenerate.

## Secrets & identifiers

Keep real credentials and resource IDs out of git. They belong in gitignored
local files (`storefront/.env.local`, `terraform/terraform.tfvars`) or a deploy
target's secret store, copied from the committed `*.example` templates. In docs
and committed config, use placeholders (`<your-gcp-project>`,
`<your-storefront-url>`).
