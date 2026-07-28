# PR: 08 — Demo polish + recording

**Branch:** sandcastle/08-demo-polish-and-recording
**Issue:** .scratch/signals-cx-agent-demo/issues/08-demo-polish-and-recording.md

## Summary

Added the complete demo script and supporting procedures to turn the working integration into the webinar deliverable. The script provides scene-by-scene choreography (browse → chat → grounded recommendation → real-time proof-of-life moment → wrap-up) with exact talking points and product paths, plus a documented human-runnable procedure for seeding a fallback session with known-good attributes in case the pipeline hiccups during recording. Swept all presenter-facing material in the repo for correct Google product naming (Gemini Enterprise for CX / CX Agent Studio) and completed the runbook end-to-end with rehearsal checklist and verification commands.

## Changes

- **docs/demo-script.md** (new): scene-by-scene choreography with talking points; browse-before-chat flow (Maison Cendre pieces across three categories + cart add) followed by agent interaction grounded in live attributes; the "prove it's real-time" mid-conversation browse and refresh beat; fallback contingency section pointing to the runbook seeded-session procedure; explicit naming check guard (Gemini Enterprise for CX / CX Agent Studio, not deprecated names)
- **docs/runbook.md** (§10 new): pointer to demo script; seeded fallback-session preparation steps (exact browse sequence, devtools one-liner to capture `domain_sessionid`, curl command to verify `/api/agent/context` retrievability) and live-substitution procedure (`setQueryParameters` override); rehearsal checklist (console allowed-origins cleanup, deployment verification, seeded-session pre-check, fresh browser state, debug-panel verification, widget theming, reset control, full end-to-end run); recording/delivery pointer (human-only post-rehearsal)
- **.scratch/signals-cx-agent-demo/issues/08-demo-polish-and-recording.md** (updated): acceptance criteria marked complete (demo script, Google naming, runbook); implementer completion comment explaining scope (prep work done; live seeding, debug-panel verification, rehearsal, recording, delivery, console cleanup reserved for human checkpoint)
- **Google product-naming sweep**: grepped demo script, runbook, and storefront UI copy for outdated naming (Dialogflow, Contact Center AI, Vertex AI Agent Builder, chat-messenger widget confusion); confirmed script and runbook use current names consistently; storefront UI copy has no public-facing Google product references (only internal dev comments, not presenter-facing)

## Pipeline review record

- **Implement + review (single pass)**: issue un-parked with clarified Agent constraint per implementer's earlier recommendation; demo script + seeded-session procedure + rehearsal checklist + Google naming sweep completed; lint and test suite green (documentation-only changes, no source code); changes reviewed as complete per the constraint (prep work done, live verification/delivery steps correctly scoped to human checkpoint)

## Manual testing plan

### Prerequisites

- Deployed storefront reachable at `https://signals-google-gecx-storefront.vercel.app` (or current deployed URL)
- Fresh/incognito browser window (no leftover `_sp_id` cookie from prior testing)
- Debug panel visible (storefront default demo mode, no `?demo=plain` flag)
- For seeded-session verification step: `AGENT_SHARED_SECRET` value from `docs/runbook.md` §7

### Acceptance criteria — verification steps

**1. Demo script written: scene-by-scene choreography, talking points, the "prove it's real-time" moment**

Open `docs/demo-script.md` and confirm:
- [ ] Scene 1 (Browse before chat, ~90s): exact product paths listed (City After Dark collection, Noir Double-Breasted Blazer, Burgundy Silk Evening Gown, Camel Cashmere Wrap Coat). Try the browse sequence: visit each product page in order, add the Camel Cashmere Wrap Coat to cart, observe the debug panel populating "Favorite designer" (Maison Cendre) and "Favorite category". Confirm the "prove it's real" first beat is visible and accurate (attributes changing live on-screen).
- [ ] Scene 2 (Open chat, ~30s): instructions to let concierge's opening land without typing; talking point about unprompted context grounding; fallback contingency reference to runbook §10.2.
- [ ] Scene 3 (Grounded recommendation, ~45s): request for pairing recommendation; expected agent behavior (catalog search, real product by name/designer/price); talking point about context-filtered suggestion.
- [ ] Scene 4 ("Prove it's real-time" beat, ~45s): mid-conversation product view (Suede Chelsea Ankle Boot) followed by shoe recommendation request; expected agent answer reflects just-viewed item; expected debug-panel activity shows view within seconds. This is the second half of the live-attribute proof.
- [ ] Scene 5 (Wrap-up, ~15s): summary line with correct current product names.
- [ ] Fallback contingency section: reference to seeded-session procedure location and exact chat-override command documented.

**2. Google product names correct in script and any on-screen material**

Search the following files for naming drift:

```bash
grep -r "Dialogflow\|Contact Center AI\|CCAI\|Vertex AI Agent Builder\|chat-messenger widget" \
  docs/demo-script.md docs/runbook.md storefront/src/

# If grep returns results, confirm they are *not* in presenter-facing copy (OK if internal dev comments only).
```

Confirm in `docs/demo-script.md`:
- [ ] All product references use **Google Gemini Enterprise for CX** (not "Dialogflow", "Contact Center AI", "Vertex AI Agent Builder").
- [ ] All console references use **CX Agent Studio** (not deprecated names).
- [ ] Chat widget component called **ces-messenger**, not "chat-messenger".

Confirm in `docs/runbook.md` (especially §10):
- [ ] Same naming conventions as demo script.
- [ ] No outdated product names in new §10 sections.

Confirm in `storefront/src/` (search output should be internal dev comments only, not presenter-facing):
- [ ] No public-facing UI copy references Google/Gemini/Dialogflow product names.
- [ ] Any mentions are in `// ` comments or TypeScript `d.ts` type definitions, not in rendered text.

**3. Runbook complete end-to-end (someone else could re-create the demo after trial expiry)**

Read `docs/runbook.md` in full and confirm:
- [ ] §1–9 cover all setup, deployment, local widget configuration, and live agent verification steps.
- [ ] §10 adds demo script pointer, seeded fallback-session prep, and rehearsal checklist — all human-runnable and complete.
- [ ] All commands are copy-pasteable and concrete (e.g., `npm run verify:deploy -- https://<deployed-url>`, `curl -H "x-agent-api-key: $AGENT_SHARED_SECRET" ...`).
- [ ] Placeholders for human-filled data are marked `<PLACEHOLDER: ...>` (e.g., seeded session ID, verification timestamps).
- [ ] A new person could follow §1–10 from a blank state and understand how to re-create the demo, assuming the Snowplow/Gemini trial orgs are still available.

Optional: try a single runbook step (e.g., §7 step 4 or §9.3 verification) to confirm the commands work as documented.

### Seeded fallback session — documentation verification (human runs this during rehearsal prep)

The seeded-session procedure is documented in `docs/runbook.md` §10.2 for human execution during rehearsal. Confirm the documentation:
- [ ] §10.2 step 1–3: exact browser setup and browse sequence (matches `docs/demo-script.md` Scene 1) leading to debug-panel attribute population.
- [ ] §10.2 step 4: devtools one-liner to capture `domain_sessionid` is included and exact.
- [ ] §10.2 step 5: curl command to verify `/api/agent/context` retrievability is included; specifies headers, query param, and expected response structure (non-empty `profile` and `recent_activity`).
- [ ] §10.2 "Live substitution procedure": `setQueryParameters` override command included with exact syntax.

### Rehearsal checklist — documentation verification

Confirm `docs/runbook.md` §10.3 Rehearsal checklist is complete:
- [ ] Console step (allowed-origins cleanup) present and correctly attributed as human-only per the issue's carried-over comment.
- [ ] Deployment verification (`npm run verify:deploy...`) cross-referenced correctly.
- [ ] Seeded-session pre-check listed (prep and verification today, not stale).
- [ ] Fresh browser window / `_sp_id` cookie check listed.
- [ ] Debug panel, widget theming, reset control, and full end-to-end run checks present.
- [ ] All items are verifiable by a human running the checklist before recording.

### If it fails

**Demo script is incomplete or references outdated product names:**
- Confirm `AGENTS.md` and `docs/design.md` match on current official product names (should be "Google Gemini Enterprise for CX" and "CX Agent Studio").
- Re-check `storefront/src/data/products.ts` for the exact product paths and names; update the script if the catalog changed since the constraint was written.

**Google naming grep finds presenter-facing occurrences:**
- Check the file context: if it's a dev comment or `.d.ts` type name, it's acceptable (not presenter-facing). If it's in rendered UI copy, that's a bug — the sweep should have caught it. Verify the sweep was run against all files.

**Runbook steps don't work when tried:**
- Confirm the deployed storefront is still live at the URL in the runbook (permitted read-only GET to `https://signals-google-gecx-storefront.vercel.app` or current deployed URL should return 200).
- For §7 and §9 verification steps, confirm environment variables (`AGENT_SHARED_SECRET`, etc.) are set; see the runbook's earlier sections for setup.
- If a `curl` command fails, check the API endpoint path and headers match the current live agent deployment.

**Seeded-session prep fails during human rehearsal:**
- The curl verify step returns `{"profile":{}}` (empty): wait longer (pipeline ingestion lag) and re-check, or re-run the browse sequence.
- The devtools one-liner doesn't find `_sp_id` cookie: confirm no cookies were cleared between browsing and the capture step; refresh the page and wait for the pipeline to re-ingest.

## Rollback

Revert the merge commit: `git revert -m 1 <merge-commit-hash>` (or `git reset --hard HEAD~1` if not yet pushed). Then delete the branch: `git branch -D sandcastle/08-demo-polish-and-recording`.
