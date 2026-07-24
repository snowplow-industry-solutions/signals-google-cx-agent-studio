# PR: 02a — Live pipeline prep: env wiring, publish dry-run, runbook skeleton

**Branch:** sandcastle/02a-signals-publish-prep
**Issue:** .scratch/signals-cx-agent-demo/issues/02a-signals-publish-prep.md

## Summary

Prepares the storefront and Signals publish tooling for a live trial org by wiring the tracker's app ID from environment config (instead of hardcoding), adding validation and dry-run support to the publish script, and documenting the full end-to-end workflow in a runbook. With these changes, once a human creates a Snowplow Free Trial org (02b), going live is a fill-in-the-blanks exercise: drop credentials into `.env.local`, run `npm run signals:publish` with dry-run first, and verify end-to-end in the browser.

## Changes

**Storefront tracker configuration:**
- Wire `NEXT_PUBLIC_SNOWPLOW_APP_ID` from `.env.local` instead of hardcoding "signals-workshop-fashion-demo" in source
- Update test to verify app ID is read from env and tracking disables gracefully when it's unset
- Add eslint-disable comment on deferred cart hydration setState (review finding cleanup)

**Signals publish script:**
- Add validation that all four credential env vars are present (`SIGNALS_DEPLOYED_URL`, `SNOWPLOW_CONSOLE_API_KEY`, `SNOWPLOW_CONSOLE_API_KEY_ID`, `SNOWPLOW_CONSOLE_ORG_ID`)
- Exit with a clear, actionable error message when any are missing
- Preserve existing `--dry-run` mode, which validates config locally without requiring credentials

**Documentation:**
- Document all required env vars in `storefront/.env.example`, including the new `NEXT_PUBLIC_SNOWPLOW_APP_ID` with guidance on choosing `signals-workshop-fashion-demo` (live) vs `signals-workshop-fashion-demo-dev` (local)
- Create `docs/runbook.md` covering: trial org creation, credential capture from BDP Console, env setup, dry-run and real publish steps, end-to-end verification (with session ID lookup), and troubleshooting guide

## Pipeline review record

- **Implement:** 4 commits from setup through runbook + lint fix
  - `f12e5b5` Wire tracker app ID from env, alongside collector URL
  - `c829706` Fail fast with a clear error when Signals publish credentials are missing
  - `e533ecb` Add runbook skeleton for trial org signup and Signals publish
  - `cc15c2d` Fix review finding: suppress lint error on deferred cart hydration setState

## Manual testing plan

### Prerequisites

**Credentials (not needed for dry-run, required for real publish):**
- A Snowplow Free Trial org exists (or will soon; dry-run tests without it)
- API credentials captured from BDP Console (from `.scratch/signals-cx-agent-demo/issues/02b-trial-org.md`):
  - `SNOWPLOW_CONSOLE_API_KEY`
  - `SNOWPLOW_CONSOLE_API_KEY_ID`
  - `SNOWPLOW_CONSOLE_ORG_ID`
  - `SIGNALS_DEPLOYED_URL`
  - `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL`

**Services:**
- Node.js 18+ installed
- Python 3.8+ with pip (publish script requirement)

### Acceptance Criterion 1: Tracker reads app ID from env; .env.example documents all vars

**Step 1.1:** Verify `.env.example` documents all required vars
```bash
cat storefront/.env.example
```
**Expected result:** File lists `NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL`, `NEXT_PUBLIC_SNOWPLOW_APP_ID`, and `NEXT_PUBLIC_SIGNALS_INTERVENTIONS_ENDPOINT` with brief comments explaining each.

**Step 1.2:** Set up `.env.local` with a local development app ID
```bash
cp storefront/.env.example storefront/.env.local
# Edit .env.local and set (at minimum, for this test):
# NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL=https://collector.example.test (fake; we're just testing env reading)
# NEXT_PUBLIC_SNOWPLOW_APP_ID=signals-workshop-fashion-demo-dev
```

**Step 1.3:** Install and run the storefront dev server
```bash
npm --prefix storefront install
npm --prefix storefront run dev
```
Wait for the dev server to report it's listening (typically on `http://localhost:3000`).

**Step 1.4:** In a browser, load `http://localhost:3000` and open the browser console (F12)
```
Expected: One of these logs appears (exact wording may vary):
  - "Snowplow initialized with app ID: signals-workshop-fashion-demo-dev"
  - No "...tracking disabled" message
```

**Step 1.5:** Verify tracking disables when app ID is unset
- Stop the dev server (Ctrl+C)
- Edit `.env.local` and set `NEXT_PUBLIC_SNOWPLOW_APP_ID=` (empty)
- Restart: `npm --prefix storefront run dev`
- Reload the browser
```
Expected: Console shows "...NEXT_PUBLIC_SNOWPLOW_APP_ID is not set; Snowplow tracking disabled"
```

**If it fails:** Check that `.env.local` is being read by the Next.js server. Restart the dev server after any `.env.local` edits. Confirm `NEXT_PUBLIC_` prefix is used (public variables); non-public env vars won't reach the browser.

### Acceptance Criterion 2: Publish script runs with env-supplied credentials, exits with clear error when absent, and dry-run validates config

**Step 2.1:** Test dry-run without any credentials (should succeed)
```bash
cd storefront
npm run signals:publish -- --dry-run
```
**Expected result:** Script prints the attribute group and service config objects with no error. Look for output like:
```
Attribute group: fashion_ecommerce_session_attributes
Service: fashion_ecommerce_demo
```

**Step 2.2:** Test real publish without credentials (should fail fast with clear message)
```bash
cd storefront
npm run signals:publish
```
**Expected result:** Script exits immediately with a message like:
```
Missing required environment variable(s) for Signals publish: SIGNALS_DEPLOYED_URL, ...
Set them in .env.local (see .env.example), or run with --dry-run to validate the config without credentials.
```
(Exact list of missing vars may differ depending on what's in your current shell env.)

**Step 2.3:** Test real publish with all credentials set (if trial org exists; otherwise skip to step 2.4)
```bash
# Ensure .env.local has all four credential vars from step 2
cd storefront
set -a; . ./.env.local; set +a
npm run signals:publish
```
**Expected result:** Script publishes successfully and prints the published attribute group and service names/versions with no error.

**Step 2.4:** Confirm dry-run and real publish are both idempotent (can run twice without error)
```bash
npm run signals:publish -- --dry-run
npm run signals:publish -- --dry-run
```
**Expected result:** Both invocations succeed and print the same config.

**If it fails:**
- **"Missing environment variable(s)" even with `.env.local`:** Confirm you ran `set -a; . ./.env.local; set +a;` to export vars into the current shell. The npm script doesn't automatically source `.env.local` for real publish (unlike Next.js's dev server).
- **Publish fails with an API error:** Verify all four credential env vars are correct and the trial org is still active.

### Acceptance Criterion 3: Runbook skeleton covers org creation → credentials → env setup → publish → verification, with placeholders

**Step 3.1:** Verify the runbook file exists and has the expected sections
```bash
cat docs/runbook.md | head -50
```
**Expected result:** File starts with a title and lists these sections (in order):
1. Create the Snowplow Free Trial org
2. Capture credentials
3. Env setup
4. Publish the Signals config
5. End-to-end verification
6. Troubleshooting

**Step 3.2:** Verify placeholders are present for live values
```bash
grep -c "PLACEHOLDER" docs/runbook.md
```
**Expected result:** 6 or more instances of `<PLACEHOLDER:` (for trial signup URL, expiry date, credential values, and verification log).

**Step 3.3:** Verify the runbook step 3 (env setup) matches what we tested in steps 1 and 2
```bash
grep -A5 "Env setup" docs/runbook.md
```
**Expected result:** Steps mention `.env.local`, the four credential vars, and running `npm --prefix storefront run dev` and `npm run signals:publish -- --dry-run`.

**Step 3.4:** Verify the troubleshooting section covers the main failure modes from steps 2.2 and 1.5
```bash
grep -A3 "Troubleshooting" docs/runbook.md
```
**Expected result:** Troubleshooting mentions "Missing required environment variable(s)" and "tracking disabled".

**If it fails:** Ensure `docs/runbook.md` exists and was created by this PR. Check that the file is not empty and wasn't accidentally overwritten.

### Acceptance Criterion 4: No credentials or org-specific values committed

**Step 4.1:** Verify `.env.local` is gitignored and not in the PR
```bash
git status storefront/.env.local
git diff main...HEAD --name-only | grep -c ".env.local"
```
**Expected result:**
- First command shows "fatal: pathspec did not match any files" (or lists `.env.local` as untracked if you created one in testing)
- Second command returns 0 (no `.env.local` in the PR diff)

**Step 4.2:** Verify no real credentials appear anywhere in the diff
```bash
git diff main...HEAD | grep -i "api_key\|api.key\|secret\|password" | grep -v "PLACEHOLDER\|NEXT_PUBLIC_"
```
**Expected result:** No lines match (or only matches show `PLACEHOLDER` or env var *names*, not values).

**Step 4.3:** Verify `.env.example` contains only template with no real values
```bash
grep -E "^[A-Z_]+=(https://|sk-|[a-f0-9]{32})" storefront/.env.example
```
**Expected result:** No matches (all values in `.env.example` are either empty or clearly marked placeholders).

**If it fails:** Search the PR diff for any of the credential keys you used in testing. If found, request a revert of those specific commits and resubmit.

## Rollback

To undo this PR after merge, run:
```bash
git revert -m 1 <merge-commit-hash>
```

To revert the entire branch before merge:
```bash
git reset --hard main
```
