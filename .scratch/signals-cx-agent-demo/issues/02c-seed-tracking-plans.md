# 02c — Deterministic tracking-plan seeding script + tracking-assets rename

Status: awaiting-human-test
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

Full design (approved 2026-07-26): `docs/superpowers/specs/2026-07-26-seed-tracking-plans-design.md` — read it first; this issue summarises it.

## Why

Seeding a fresh trial org fails when committed source-application / data-product UUIDs were ever published from a previous org (IDs are global primary keys across all Snowplow orgs). The current workaround (`storefront/tracking-plan/remint-ids.py`) rewrites committed YAML with fresh random UUIDs — constant git churn, and unsafe if this repo goes public (any cloner who publishes the committed IDs claims them globally). Trial orgs expire, so re-seeding must be one deterministic command.

## What to build

### 1. Directory rename (product-line naming update: Data Products → Tracking Plans)

Use `git mv` (history preserved):

- `storefront/tracking-plan/` → `storefront/tracking-assets/`
- `storefront/tracking-plan/data-products/` → `storefront/tracking-assets/tracking-plans/`
- `data-structures/` keeps its name.

snowplow-cli command vocabulary is unchanged (`data-structures`, `data-products`) — only repo paths change. Update every old-path reference: `storefront/snowtype.config.json` (functional — snowtype reads the data-structures path), `storefront/README.md`, `storefront/docs/agent-notes.md`, `storefront/.env.example`, `docs/runbook.md`. Do NOT touch `storefront/.env.local` (gitignored, absent in agent worktrees; the human updates its comment line). Sandcastle logs and `.next` cache keep old paths.

### 2. Script: `storefront/scripts/seed-tracking-plans.ts`

Add `tsx` devDependency to `storefront/package.json` and script `"seed:tracking-plans": "tsx scripts/seed-tracking-plans.ts"`.

Pipeline:

1. **Env loading.** Parse `storefront/.env.local` if present (simple in-script parser, no dotenv dep; pre-existing process env wins). Fail fast naming any missing var: `SNOWPLOW_CONSOLE_API_KEY`, `SNOWPLOW_CONSOLE_API_KEY_ID`, `SNOWPLOW_CONSOLE_ORG_ID`. Never print values.
2. **Build step.** Copy `tracking-assets/tracking-plans/` tree to a temp dir (preserves `$ref` relative paths). Replace each `resourceName: <uuid>` template UUID with `uuidv5(FIXED_NAMESPACE, orgId + ":" + templateUuid)`. Same template UUID → same derived UUID everywhere. Committed files are NEVER rewritten — they are stable template keys.
3. **Publish sequence** (streamed output, cwd = `storefront/`, stop on first non-zero exit):

   ```
   snowplow-cli data-structures validate ./tracking-assets/data-structures
   snowplow-cli data-structures publish dev ./tracking-assets/data-structures
   snowplow-cli data-structures publish prod ./tracking-assets/data-structures
   snowplow-cli data-products publish <temp-build-dir>
   ```

   Data structures publish straight from the repo tree (no UUIDs in them; org-scoped, no collision issue).
4. **`--dry-run` flag.** Builds the temp tree, prints the template→derived ID mapping and the commands it would run, executes nothing. Requires no API keys; uses `SNOWPLOW_CONSOLE_ORG_ID` if set, else a fixed dummy org ID clearly labelled in output. This is how the agent verifies the script without credentials.

UUIDv5: RFC 4122 v5 (SHA-1) via Node `crypto`, hand-rolled (~15 lines), no `uuid` package. `FIXED_NAMESPACE` is a constant UUID committed in the script.

### 3. Tests: `storefront/scripts/seed-tracking-plans.test.ts` (vitest)

Pure functions only (command runner stays a thin untested shell): env-file parser (quotes, comments, existing-env precedence); UUID scan / template→derived mapping (consistency, count — currently 10 UUIDs: 1 source app, 1 data product, 8 event specs); text replacement (all occurrences, non-UUID lines untouched); uuidv5 against a known RFC test vector + determinism (same inputs → same output, different org → different output).

### 4. Cleanup + docs

- Delete `remint-ids.py`.
- `docs/runbook.md` §4: step 3 becomes `npm run seed:tracking-plans`; remove the re-mint step and the "id already exists" troubleshooting entry (replace with a note that IDs are derived per-org automatically). Update all renamed paths.

## Acceptance criteria

Agent-verifiable:

- [x] Rename complete via `git mv`; no references to `tracking-plan/` or `data-products/` paths remain outside `.sandcastle/logs/`, `.next/`, and this issue's history
- [x] `npm run seed:tracking-plans -- --dry-run` (from `storefront/`) prints a consistent template→derived mapping for all 10 UUIDs and the four planned commands, touches no committed files (`git status` clean), and exits 0 without credentials
- [x] Missing-env failure names the missing variables and exits non-zero (non-dry-run path)
- [x] uuidv5 implementation passes an RFC 4122 known-answer test
- [x] `npm test` and `npm run lint` green in `storefront/`
- [x] `remint-ids.py` deleted; runbook §4 + troubleshooting updated

Human-verified (checkpoint):

- [ ] Real run against the trial org publishes data structures (dev + prod) and the tracking plan without ID collision
- [ ] Second run is idempotent: same derived IDs, resources updated not duplicated (org still shows 1 source app, 1 tracking plan)

## Blocked by

- `02a-signals-publish-prep.md`

## Comments

**2026-07-26 (human, via session agent):** Trial org exists (HITL half of 02b done); org verified empty of data products as of today — previous session's `dp publish` never succeeded, so first real run publishes fresh. Credentials live in `storefront/.env.local` (primary checkout only). The real publish is the human checkpoint test: `cd storefront && npm run seed:tracking-plans`.
