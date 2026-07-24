# Repo conventions (pipeline reference)

Authoritative sources, in order:

1. `AGENTS.md` — project overview, issue tracker + triage-label conventions
2. `docs/design.md` — design decisions for the Signals × CX Agent Studio demo
3. `.scratch/signals-cx-agent-demo/PRD.md` — product spec

## Layout

- `storefront/` — the Next.js demo app (the code you'll mostly touch)
- `.scratch/signals-cx-agent-demo/` — PRD, issues, PR files (metadata, not app code)
- `docs/` — design docs and runbook

## Commands (run from repo root)

- Tests: `npm --prefix storefront test` (vitest)
- Lint: `npm --prefix storefront run lint` (eslint)
- Dev server: `npm --prefix storefront run dev`
- Build: `npm --prefix storefront run build`

## Hard rules

- No credentials, tokens, or org-specific values committed — env vars only,
  documented in `storefront/.env.example`.
- Issue `Status:` / `Checkpoint:` lines are host-owned; agents never edit them.
- Match the existing code style of the file you're editing; comments only for
  constraints the code can't express.
