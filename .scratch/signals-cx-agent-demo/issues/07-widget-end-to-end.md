# 07 — Chat widget end-to-end

Status: awaiting-human-test
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Close the loop in the browser: embed the ces-messenger web component in the deployed storefront, wire the page script to read the visitor's `domain_sessionid` and pass it via `setQueryParameters` when the widget loads, and configure the managed token broker for public access. Result: a visitor browses, opens chat, and the agent already knows their session — no identification step.

Session id read: use `getDomainSessionId(trackerId?)` from `@snowplow/browser-tracker` (named export, sync, returns `string | undefined`) instead of hand-parsing the `_sp_id` cookie. Introduced in tracker **4.9.0**; `storefront/package.json` pins `^4.6.9` with the lockfile resolving 4.6.9, so bump to `^4.10.0` (current latest) as part of this issue. Handle the `undefined` case (tracker not yet initialised / new visitor) gracefully — that's the cookieless-fallback criterion below.

Verify-at-build item from the PRD lands here: pin the widget generation (`ces-messenger` vs `chat-messenger`) to whichever supports query-parameter passing against our agent deployment.

**Agent constraint:** prepare everything that lives in the repo — the tracker bump to `^4.10.0` (package.json + lockfile, confirm existing tracking still passes tests), the ces-messenger embed in the storefront layout, the `getDomainSessionId()` → `setQueryParameters` wiring as a client component with a graceful `undefined` fallback, styling against the luxury theme, unit tests for the wiring/fallback, and the runbook section (widget deployment + token broker public-access setup in the console, embed snippet, verification walkthrough). For the widget-generation pin (`ces-messenger` vs `chat-messenger`): document findings from official docs plus the exact check the human should run against the live deployment — don't guess. **Permitted live access — outbound, read-only:** unauthenticated HTTP GETs against the deployed site (`https://signals-google-gecx-storefront.vercel.app`) are allowed, e.g. extending `verify-deploy.ts` to assert the widget embed is present post-deploy; no credentials are available in the sandbox and none should be requested. Do **not** modify the live Vercel project or the CX Agent Studio console — widget deployment, token broker config, and the live-agent criteria are human-verified afterwards, per the checkpoint.

## Acceptance criteria

- [ ] Tracker bumped to `^4.10.0`; existing tracking unaffected (tests + lint green)
- [ ] Widget renders on the deployed site, styled acceptably against the luxury theme
- [ ] Session id read via `getDomainSessionId()` and delivered to the agent session automatically
- [ ] Full flow works on the deployed site: browse products → add to cart → open chat → agent references actual browsing/cart behaviour unprompted
- [ ] Context freshness acceptable: activity seconds old is reflected in the conversation
- [ ] New/cookieless visitor gets graceful generic concierge behaviour
- [ ] Embed + wiring steps documented in the runbook

## Blocked by

- `06-cx-agent-and-tools.md`

## Parked by pipeline (2026-07-28 11:26) — resolved, see comment below

Implementer flagged a spec conflict / blocker (first line truncated by the pipeline log capture):

> …s this sandbox doesn't have, and the issue text lacks the explicit **Agent constraint** carve-out that issues 05 and 06 both needed before an agent could touch them.

### Why this is blocked (implementer's log)

Looking at each acceptance criterion in `07-widget-end-to-end.md`:

1. **"Widget renders on the deployed site, styled acceptably"** — requires the live Vercel deployment (from issue 05) to actually load and visually inspect. Cannot be done from this sandbox.
2. **"Session id read from the Snowplow cookie and delivered to the agent session automatically"** — the cookie-read + `setQueryParameters` call is code I could write, but "delivered to the agent session" can only be confirmed by loading the real `ces-messenger` widget in a browser against the live CX Agent Studio agent from issue 06 and inspecting its session-context injection — the exact kind of check issue 06's runbook §8.4/§8.5 reserved for the human simulator pass.
3. **"Full flow works on the deployed site: browse → add to cart → open chat → agent references actual behaviour unprompted"** — inherently a live-browser, live-pipeline, live-agent end-to-end check. No sandbox substitute.
4. **"Context freshness acceptable: activity seconds old is reflected"** — requires timing observation against the live trial pipeline and live agent conversation.
5. **"New/cookieless visitor gets graceful generic concierge behaviour"** — same live-agent dependency as #2/#3; the fallback *logic* is codeable, but verifying the agent's actual behavior needs the live simulator/widget.
6. **"Embed + wiring steps documented in the runbook"** — the one criterion that's pure repo documentation, agent-doable in isolation.

This is the identical shape to issue 06's original block: one documentation criterion is prep-doable, the rest require live console/browser/pipeline access this sandbox cannot have. Issues 05 and 06 both only became safely implementable once a human added an explicit **Agent constraint** section scoping exactly what prep work was authorized (widget/wiring *code* and runbook docs) versus reserved for the human checkpoint (live verification against the deployed site + live agent). Issue 07 has `Checkpoint: human-test-required` already set, but — like issue 06 pre-carve-out — has no **Agent constraint** section, so there's no authorized scope for me to safely implement against without guessing what's in/out of bounds (e.g., should I also touch the deployed Vercel project's env/config, or only the repo's `storefront/` source?).

**Recommendation:** add an Agent constraint to `07-widget-end-to-end.md` mirroring 05/06's pattern, e.g.: *"prepare the widget embed (ces-messenger component in the storefront layout), the cookie-read/`setQueryParameters` wiring code, and the runbook section — do not touch the live Vercel deployment or CX Agent Studio console; the live-site/live-agent criteria are verified by the human afterwards."* Then re-queue.

No code was written and nothing was committed.

<promise>BLOCKED</promise>

## Comments

**2026-07-28 (human/assistant):** Un-parked. Added the Agent constraint above
(mirroring the 05/06 prep-only carve-out), per the implementer's recommendation,
with one extension: since the live URL now exists (unlike 05 pre-deploy), the
sandbox is permitted outbound, read-only, unauthenticated HTTP GETs against the
deployed site — no credentials, no mutations, no Vercel/console changes. Also
rolled in the tracker bump to `^4.10.0` to use the new `getDomainSessionId()`
getter (introduced 4.9.0; verified against the type definitions) instead of
hand-parsing the `_sp_id` cookie. Re-queued as ready-for-agent.

**2026-07-28 (human/assistant):** Parked a second time at 12:06 — false alarm.
The re-run's sandbox checked out the stale `sandcastle/07-widget-end-to-end`
branch left behind by the first run (created from main *before* the Agent
constraint was added; sandcastle reuses an existing branch as-is rather than
recreating it from main). The implementer saw the old issue text and correctly
re-flagged the missing carve-out. Dropped that duplicate parked block, deleted
the stale fully-merged branch, and added a guard to `.sandcastle/main.mts` that
deletes a leftover fully-merged pipeline branch before creating the sandbox.
Re-queued as ready-for-agent — the constraint above stands unchanged.