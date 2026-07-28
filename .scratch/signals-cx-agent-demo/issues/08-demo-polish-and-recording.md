# 08 — Demo polish + recording

Status: awaiting-human-test
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Turn the working integration into the webinar deliverable. Write the demo script with browse-before-chat choreography (products browsed and carted before the widget opens, so attributes are in the Profile Store — no dead air). Prepare a seeded fallback session with known-good attributes in case the pipeline hiccups during recording. Verify the on-page debug panel shows live attribute values for the "prove it's real" beat. Sweep all presenter-facing material for correct current Google product naming. Rehearse, record the session, deliver.

**Hard deadline: recording delivered by Thursday 7 August 2026.**

**Agent constraint:** prepare everything that lives in the repo — the demo
script as a repo doc (scene-by-scene choreography, talking points, the
"prove it's real-time" beat), the Google product-naming sweep across
presenter-facing material *in this repo* (demo script, runbook, storefront
UI copy such as the debug panel; slides or other material outside the repo
are the human's), completion of `docs/runbook.md` end-to-end (someone else
could re-create the demo after trial expiry), a rehearsal checklist in the
runbook that folds in the console allowed-origins cleanup noted in the
comments, and a documented, human-runnable procedure for preparing and
verifying the seeded fallback session (exact steps/commands and the
verification call to run — not a live run). **Permitted live access —
outbound, read-only:** unauthenticated HTTP GETs against the deployed site
(`https://signals-google-gecx-storefront.vercel.app`); no credentials are
available in the sandbox and none should be requested. Do **not** attempt to
seed or verify a live Signals session, verify the debug panel against the
live flow, rehearse, record, deliver, or touch the CX Agent Studio console
or Vercel project — those criteria are human-verified afterwards, per the
checkpoint.

## Acceptance criteria

- [ ] Demo script written: scene-by-scene choreography, talking points, the "prove it's real-time" moment
- [ ] Seeded fallback session prepared and verified retrievable
- [ ] Debug panel displays live attributes during the scripted flow
- [ ] Google product names correct in script and any on-screen material
- [ ] Runbook complete end-to-end (someone else could re-create the demo after trial expiry)
- [ ] At least one full rehearsal pass with no manual intervention
- [ ] Recording produced and delivered by 7 August 2026

## Blocked by

- `07-widget-end-to-end.md`

## Comments

**2026-07-28 (human/assistant):** Pre-recording sweep item carried over from
the 07 live walkthrough: remove the temporary `http://localhost:3000` entry
from the chat channel's allowed origins in the CX Agent Studio console (it
was added for local testing only). Human/console step — fold it into the
rehearsal checklist.

## Parked by pipeline (2026-07-28 16:06) — resolved, see comment below

Implementer flagged a spec conflict / blocker:

fied retrievable**" means confirming the Signals API actually returns those attributes for that session ID — that requires live credentials to the Snowplow trial org and a live call to the Profile Store/Agentic Context API. No such credentials exist in this sandbox, and none should be requested per the constraint pattern established on issues 05/06/07.
3. **"Debug panel displays live attributes during the scripted flow"** — the `SignalsDebugPanel` component already exists (`storefront/src/components/Demo/SignalsDebugPanel.tsx`) and renders live attributes from `useSignals()`. But confirming it *displays live values during the actual scripted browse-then-chat flow* requires a real browser against the live deployed site, live pipeline, and live agent — the exact class of check reserved for the human simulator pass in issues 06/07.
4. **"Google product names correct in script and any on-screen material"** — a documentation/copy sweep, agent-doable, but only meaningful once the script and on-screen material (from #1) exist and once it's clear what "on-screen material" encompasses (slides? overlays? outside this repo?).
5. **"Runbook complete end-to-end"** — mostly agent-doable (docs/runbook.md already exists and has been extended by prior issues); could be finished here.
6. **"At least one full rehearsal pass with no manual intervention"** — inherently a live-browser, live-pipeline, live-agent, live-widget end-to-end run. No sandbox substitute; this is precisely the kind of check that required a human (Jordan) to perform for issue 07.
7. **"Recording produced and delivered by 7 August 2026"** — requires actually operating screen-recording software, producing a video file, and delivering it to marketing. This sandbox has no browser/recording capability and no delivery channel — it categorically cannot be done here.

The issue's own carried-over comment also flags a **human/console step** (removing `http://localhost:3000` from the CX Agent Studio channel's allowed origins) that this sandbox has no console credentials to perform.

Unlike issues 05, 06, and 07, `08-demo-polish-and-recording.md` has no **Agent constraint** section scoping which pieces are safe prep work (script + naming sweep + runbook completion) versus reserved for a human checkpoint (seeded-session live verification, debug-panel live verification, rehearsal, recording, delivery, console origin cleanup). Without that carve-out I'd be guessing at scope, which is the same reasoning that got 07 correctly parked the first time.

**Recommendation:** add an Agent constraint mirroring 05/06/07's pattern — e.g. *"prepare the demo script doc, the Google product-naming sweep, and finish the runbook — do not attempt to seed/verify a live Signals session, verify the debug panel against a live flow, rehearse, record, or touch the CX Agent Studio console; those are human-verified afterwards, per a checkpoint."* Then re-queue.

No code was written and nothing was committed.

<promise>BLOCKED</promise>

**2026-07-28 (human/assistant):** Un-parked. Added the Agent constraint above
(mirroring the 05/06/07 prep-only carve-out) and `Checkpoint:
human-test-required`, per the implementer's recommendation. Also resolved the
"on-screen material" ambiguity: scope for the naming sweep is this repo only
(script, runbook, storefront UI copy); anything outside the repo stays with
the human. Seeded fallback session is scoped to a documented human-runnable
procedure — no live seeding/verification from the sandbox. Rehearsal,
recording, delivery, debug-panel live check, and console origin cleanup all
remain human checkpoint work. Re-queued as ready-for-agent.