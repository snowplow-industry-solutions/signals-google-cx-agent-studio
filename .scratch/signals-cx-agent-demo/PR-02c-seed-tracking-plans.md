# PR: 02c — Deterministic tracking-plan seeding script + tracking-assets rename

**Branch:** sandcastle/02c-seed-tracking-plans  
**Issue:** .scratch/signals-cx-agent-demo/issues/02c-seed-tracking-plans.md

## Summary

Renamed `storefront/tracking-plan/` to `storefront/tracking-assets/` (and its data-products subdirectory to `tracking-plans/`) to align product terminology. Added a deterministic seeding script (`npm run seed:tracking-plans`) that derives org-specific UUIDs from committed template UUIDs using RFC 4122 v5, eliminating ID collisions when re-seeding across multiple trial orgs while keeping committed source files stable. The script publishes data structures to both dev and prod, then the tracking plan, all in one command with full idempotency support.

## Changes

**Directory structure:**
- Renamed `storefront/tracking-plan/` → `storefront/tracking-assets/` (via `git mv`, preserves history)
- Renamed `storefront/tracking-plan/data-products/` → `storefront/tracking-assets/tracking-plans/`
- Updated all references: `storefront/snowtype.config.json`, `storefront/README.md`, `storefront/docs/agent-notes.md`, `storefront/.env.example`, `docs/runbook.md`
- Deleted `storefront/tracking-plan/remint-ids.py` (replaced by deterministic derivation)

**Seeding script (`storefront/scripts/seed-tracking-plans.ts`):**
- Parses `storefront/.env.local` for credentials with precedence over shell env
- Validates required env vars (`SNOWPLOW_CONSOLE_API_KEY`, `SNOWPLOW_CONSOLE_API_KEY_ID`, `SNOWPLOW_CONSOLE_ORG_ID`) on non-dry-run
- Copies `tracking-assets/tracking-plans/` to a temp directory
- Scans all YAML files for template UUIDs (committed values, never rewritten)
- Derives org-specific UUIDs using `uuidv5(FIXED_NAMESPACE, orgId + ":" + templateUuid)` — same template → same derived UUID per org
- Replaces all template UUIDs in the temp tree with derived UUIDs
- Publishes sequence (from storefront cwd):
  - `snowplow-cli data-structures validate ./tracking-assets/data-structures`
  - `snowplow-cli data-structures publish dev ./tracking-assets/data-structures`
  - `snowplow-cli data-structures publish prod ./tracking-assets/data-structures`
  - `snowplow-cli data-products publish <temp-tree>`
- `--dry-run` flag prints the template→derived mapping and planned commands without executing or requiring credentials
- Cleans up temp directory in all cases (finally block)

**Tests (`storefront/scripts/seed-tracking-plans.test.ts`):**
- `parseEnvFile`: simple key=value parsing, quoted-value stripping, comment/blank line filtering, whitespace trimming
- `resolveEnv`: precedence (shell env wins over file)
- `findMissingEnvVars`: identifies missing required variables
- `uuidv5`: RFC 4122 v5 known-answer test (DNS namespace vector), determinism check, org-differentiation check
- `scanTemplateUuids`: finds only `resourceName:` UUIDs, deduplicates repeated UUIDs
- `buildUuidMapping`: one mapping per template UUID, consistency across multiple calls
- `replaceUuids`: replaces all occurrences of mapped UUIDs, leaves unmapped UUIDs alone

**Package updates:**
- Added `tsx` to devDependencies in `storefront/package.json`
- Added script: `"seed:tracking-plans": "tsx scripts/seed-tracking-plans.ts"`

**Documentation:**
- `docs/runbook.md` §4 step 3: changed from `npm run remint && snowplow-cli data-products publish ...` to `npm run seed:tracking-plans`
- Updated troubleshooting to explain UUID derivation per-org (replaces the old "id already exists" entry)
- All path references now use `tracking-assets` instead of `tracking-plan`

## Pipeline review record

1. **Implement** (5 commits): rename directories + implement seeding script + add tests + update docs (ddc17f5 → f8255fd)
2. **Agent verification** (84829ce): acceptance criteria marked complete after script passes all RFC 4122 checks and dry-run validation
3. **Fix** (29d0ed3): pass resolved env to snowplow-cli subprocess (env shadowing bug caught in later review)

## Manual testing plan

### Prerequisites

1. Trial org provisioned and credentials captured (from Snowplow Console):
   - `SNOWPLOW_CONSOLE_API_KEY`
   - `SNOWPLOW_CONSOLE_API_KEY_ID`
   - `SNOWPLOW_CONSOLE_ORG_ID`
2. `storefront/.env.local` populated with all three credential vars (see `storefront/.env.example` template)
3. `snowplow-cli` installed (e.g. `brew install snowplow-product/taps/snowplow-cli`)
4. Node 18+ and npm installed

### Test steps

**Step 1: Dry-run validation**

```bash
cd storefront
npm run seed:tracking-plans -- --dry-run
```

Expected output:
- Message showing 10 unique template UUIDs being mapped (1 source app + 1 tracking plan + 8 event specs)
- Template → derived UUID mapping table (each template maps to a single deterministic derived UUID)
- Four planned commands listed:
  - `snowplow-cli data-structures validate ./tracking-assets/data-structures`
  - `snowplow-cli data-structures publish dev ./tracking-assets/data-structures`
  - `snowplow-cli data-structures publish prod ./tracking-assets/data-structures`
  - `snowplow-cli data-products publish <temp-path>`
- Exit code 0
- `git status` output shows clean working tree (no files modified)

**Step 2: Seed the trial org (first run)**

```bash
cd storefront
npm run seed:tracking-plans
```

Expected behavior:
- Script validates and publishes data structures (dev, then prod) — should see output from each `snowplow-cli` invocation
- Script publishes the tracking plan with derived UUIDs
- All commands exit with code 0; script finishes with no error
- Temp directory is cleaned up

**Step 3: Verify resources in Snowplow Console**

1. Open Snowplow Console (BDP UI) for the trial org
2. Navigate to Data Products Studio → Data Structures
3. Verify the eight event specs exist and are in production:
   - `cart_updated`, `cart_viewed`, `checkout_completed`, `checkout_started`, `checkout_step_viewed`, `product_list_clicked`, `product_list_viewed`, `product_viewed`
4. Verify the four entity structures exist and are in production:
   - `cart`, `checkout`, `product`, `user`
5. Navigate to Data Products Studio → Data Products
6. Verify the tracking plan `fashion_ecommerce` exists with one source application `fashion_storefront`

**Step 4: Verify idempotency (second run)**

```bash
cd storefront
npm run seed:tracking-plans
```

Expected behavior:
- Script runs without error (all commands succeed)
- All `snowplow-cli` invocations complete successfully

**Step 5: Verify no duplication**

1. Return to Snowplow Console
2. Navigate to Data Products Studio → Data Products
3. Verify the tracking plan still shows one source application `fashion_storefront` (not duplicated — shows one entry, not two)
4. Verify the same derived UUIDs were re-derived:
   ```bash
   npm run seed:tracking-plans -- --dry-run
   ```
   Compare the UUID mapping with the output from step 1 — all template UUIDs should map to the identical derived UUIDs

### If it fails

- **Missing env vars on dry-run**: `.env.local` exists and is readable. Dry-run should not require credentials but should use `SNOWPLOW_CONSOLE_ORG_ID` if set for the mapping demo.
- **Missing env vars on real run**: Check that all three credential vars are in `.env.local` or exported in the current shell (`echo $SNOWPLOW_CONSOLE_API_KEY`, etc.).
- **`snowplow-cli` not found**: Install via `brew install snowplow-product/taps/snowplow-cli` or confirm it's in `$PATH` (`which snowplow-cli`).
- **Data structures publish fails with "Schema already exists"**: The trial org already has these structures from a previous run. This is expected and OK — the publish is idempotent. Re-run the command; it should succeed.
- **Data products publish fails with 404 "Schema for event X was not found or not in production"**: The data structures were not promoted to production. Verify step 3 shows all event specs in production status (not just "dev"). If not, manually promote in Console or re-run the seeding script.
- **Resources show duplicated in Console after second run**: Verify the resources have the same derived UUIDs both times (step 5). If UUIDs differ, the `uuidv5` derivation is not deterministic — check that `SNOWPLOW_CONSOLE_ORG_ID` is identical both runs and `FIXED_NAMESPACE` in the script hasn't changed.

## Rollback

On an unmergered branch: `git branch -D sandcastle/02c-seed-tracking-plans`

On a merged commit: `git revert <merge-commit-hash>` and push (undoes the rename, deletion, and script additions while preserving history).

On main with uncommitted work downstream: stash any local changes first (`git stash`), then revert.
