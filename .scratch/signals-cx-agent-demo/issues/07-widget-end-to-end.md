# 07 — Chat widget end-to-end

Status: needs-human
Checkpoint: human-test-required

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Close the loop in the browser: embed the ces-messenger web component in the deployed storefront, wire the page script to read `domain_sessionid` from the Snowplow `_sp_id` cookie and pass it via `setQueryParameters` when the widget loads, and configure the managed token broker for public access. Result: a visitor browses, opens chat, and the agent already knows their session — no identification step.

Verify-at-build item from the PRD lands here: pin the widget generation (`ces-messenger` vs `chat-messenger`) to whichever supports query-parameter passing against our agent deployment.

## Acceptance criteria

- [ ] Widget renders on the deployed site, styled acceptably against the luxury theme
- [ ] Session id read from the Snowplow cookie and delivered to the agent session automatically
- [ ] Full flow works on the deployed site: browse products → add to cart → open chat → agent references actual browsing/cart behaviour unprompted
- [ ] Context freshness acceptable: activity seconds old is reflected in the conversation
- [ ] New/cookieless visitor gets graceful generic concierge behaviour
- [ ] Embed + wiring steps documented in the runbook

## Blocked by

- `06-cx-agent-and-tools.md`

## Parked by pipeline (2026-07-28 11:26)

Implementer flagged a spec conflict / blocker:

s this sandbox doesn't have, and the issue text lacks the explicit **Agent constraint** carve-out that issues 05 and 06 both needed before an agent could touch them.

## Why this is blocked

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