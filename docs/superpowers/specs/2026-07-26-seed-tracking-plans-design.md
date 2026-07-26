# Seed tracking plans: deterministic org bootstrapping (`npm run seed:tracking-plans`)

Date: 2026-07-26
Status: approved pending user review

## Problem

Seeding a fresh Snowplow trial org from this repo's committed tracking assets fails when
source application / data product (now "tracking plan") UUIDs were ever published from a
previous org — resource IDs are global primary keys across all Snowplow orgs. The current
workaround (`storefront/tracking-plan/remint-ids.py`) rewrites committed YAML with fresh
random UUIDs on every run, which:

- creates constant git churn (new IDs committed after each fresh-org seed), and
- is unsafe if the repo goes public: any cloner who publishes the committed IDs claims
  them globally, breaking every other user of the repo.

Trial orgs expire regularly (demo recording deadline 7 Aug 2026), so re-seeding must be a
one-command, deterministic operation.

## Solution overview

Replace the Python script with a TypeScript script, run as `npm run seed:tracking-plans`
from `storefront/`, that:

1. Treats committed `resourceName:` UUIDs as **stable template keys** — never rewritten.
2. At publish time, copies the tracking-plan YAML tree to a temp build directory and
   replaces each template UUID with `uuidv5(FIXED_NAMESPACE, "<orgId>:<templateUuid>")`.
3. Publishes data structures (validate → dev → prod) and tracking plans from the built
   tree via snowplow-cli, stopping on first failure.

Properties:

- **Zero git churn.** Committed files never change. No `--remint` flag, no state file.
- **Idempotent per org.** Same org ID derives the same real IDs every run — republish
  updates existing resources instead of duplicating them.
- **Fresh org = fresh IDs automatically.** New org ID → new derived IDs → no collision.
- **Public-repo safe.** Cloners derive IDs from their own org ID; committed template
  UUIDs are never published by anyone.

## Directory rename (product-line naming update)

Snowplow renamed Data Products → Tracking Plans. Rename repo paths now:

| Old | New |
| --- | --- |
| `storefront/tracking-plan/` | `storefront/tracking-assets/` |
| `storefront/tracking-plan/data-structures/` | `storefront/tracking-assets/data-structures/` |
| `storefront/tracking-plan/data-products/` | `storefront/tracking-assets/tracking-plans/` |

- Use `git mv` to preserve history.
- snowplow-cli command vocabulary is unchanged (`data-structures`, `data-products`/`dp`)
  — only repo paths change.
- `data-structures` keeps its name (product line still calls them Data Structures).

## Components

### 1. Script: `storefront/scripts/seed-tracking-plans.ts`

Run via `tsx` (new devDependency in `storefront/package.json`):

```json
"seed:tracking-plans": "tsx scripts/seed-tracking-plans.ts"
```

Pipeline:

1. **Env loading.** Parse `storefront/.env.local` if present (simple in-script parser,
   no dotenv dep; pre-existing process env wins). Fail fast with a message naming any
   missing var: `SNOWPLOW_CONSOLE_API_KEY`, `SNOWPLOW_CONSOLE_API_KEY_ID`,
   `SNOWPLOW_CONSOLE_ORG_ID`. Never print values.
2. **Build step.** Copy `tracking-assets/tracking-plans/` tree to a temp dir (preserves
   `$ref` relative paths). Scan for `resourceName: <uuid>` lines; replace each template
   UUID with its derived UUIDv5. Consistent mapping: the same template UUID maps to the
   same derived UUID everywhere (future-proofs cross-references by UUID).
3. **Publish sequence.** Run in order, streamed output, cwd = `storefront/`, stop on
   first non-zero exit and surface the CLI output:

   ```
   snowplow-cli data-structures validate ./tracking-assets/data-structures
   snowplow-cli data-structures publish dev ./tracking-assets/data-structures
   snowplow-cli data-structures publish prod ./tracking-assets/data-structures
   snowplow-cli data-products publish <temp-build-dir>
   ```

   Data structures publish straight from the repo tree (no UUIDs in them; schemas are
   keyed by vendor/name/version and are org-scoped — no collision issue).
4. **`--dry-run` flag.** Builds the temp tree, prints the template→derived ID mapping
   and the commands it would run, executes nothing. Requires no API keys; uses
   `SNOWPLOW_CONSOLE_ORG_ID` if set, else a fixed dummy org ID clearly labelled in the
   output. Lets an AFK agent (whose worktree has no `.env.local`) verify the script
   end-to-end without credentials.

### 2. UUIDv5 derivation

- `derivedId = uuidv5(NAMESPACE, orgId + ":" + templateUuid)` where `NAMESPACE` is a
  fixed constant UUID committed in the script.
- Implementation: RFC 4122 v5 (SHA-1) via Node `crypto` — small hand-rolled function
  (~15 lines), no `uuid` package dependency.
- Risk: the Console backend could reject non-v4 UUIDs. Considered unlikely (format is
  identical); verified on first real publish. Fallback: same SHA-1 derivation but force
  the version/variant bits to the v4 pattern — still deterministic.

### 3. Tests: `storefront/scripts/seed-tracking-plans.test.ts` (vitest)

Pure-function coverage:

- env-file parser (quotes, comments, existing-env precedence),
- UUID scan / template→derived mapping (consistency, count),
- text replacement (all occurrences, non-UUID lines untouched),
- uuidv5 derivation against a known RFC test vector, and determinism
  (same inputs → same output; different org → different output).

Command runner stays a thin untested shell around `child_process`.

## Documentation and cleanup

- Delete `storefront/tracking-plan/remint-ids.py`.
- `docs/runbook.md` §4: step 3 becomes `npm run seed:tracking-plans`; remove the
  re-mint step and the "id already exists" troubleshooting entry (replace with a short
  note that IDs are derived per-org automatically). Update all paths for the rename.
- Update old-path references: `storefront/snowtype.config.json` (functional — snowtype
  reads the data-structures path), `storefront/README.md`,
  `storefront/docs/agent-notes.md`, `storefront/.env.example`, and the comment line in
  `storefront/.env.local` (gitignored; values untouched).
- Sandcastle logs and `.next` cache keep old paths (historical/generated).

## Execution notes

- Work happens on `main` in the primary checkout
  (`/Users/jordanpeck-snowplow/Documents/work-projects/signals-gemini-connector`).
- Current org state verified 2026-07-26: 0 source applications, 0 data products — the
  previous session's `dp publish` re-run never succeeded, so first real run publishes
  everything fresh.
- The agent builds and tests the script (verifying via `--dry-run`); the user executes
  the actual publish (external state change), e.g.
  `! sh -c 'cd storefront && npm run seed:tracking-plans'`.
- Tracked as issue `.scratch/signals-cx-agent-demo/issues/02c-seed-tracking-plans.md`
  (`ready-for-agent`, checkpoint `human-test-required`) for the Sandcastle AFK
  pipeline; the real publish + idempotency re-run is the human checkpoint test.
