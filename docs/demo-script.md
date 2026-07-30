# Demo script — Signals × Gemini Enterprise for CX (CX Agent Studio)

Scene-by-scene choreography and talking points for the webinar recording.
Deliverable: a single take, browse-before-chat, showing a shopper's real
Snowplow Signals behavioural context grounding a Gemini Enterprise for CX
(CX Agent Studio) concierge agent's replies with no dead air. Target runtime
~4 minutes.

Before rehearsing or recording, run the checklist in `docs/runbook.md`
("Rehearsal checklist" section) — it folds in the console allowed-origins
cleanup and the other pre-flight checks this script assumes are already
done (fresh browser state, debug panel visible, seeded fallback session
verified).

## Cast and setup

- One presenter, one browser window, deployed storefront
  (`https://signals-google-gecx-storefront.vercel.app` or the current
  deployed URL) open full-screen.
- Fresh/incognito session (no prior `_sp_id` cookie) so the browsing in
  Scene 1 is the entire signal the agent has to work with — this is what
  makes the "no dead air" beat credible rather than staged.
- Debug panel visible (default demo mode; don't pass `?demo=plain`) —
  it's the presenter's own on-screen proof, not just narration.
- **Navigate by clicking site links only.** Product-view tracking fires on
  in-app route changes; pasting a URL into the address bar or refreshing
  mid-scene loads the page without registering the view, and a refresh also
  remounts the chat widget. Every product path in this script is reachable
  by clicking — never type a URL once Scene 1 starts.

## Scene 1 — Browse before chat (~90s)

Purpose: build a real, live taste profile in the Profile Store *before* the
chat ever opens, so Scene 2 has zero dead air waiting on attributes.

1. Land on the homepage (`/`).
2. Open the **City After Dark** collection (`/collections/city-after-dark`)
   — spotlight designer Maison Cendre, evening edit.
3. View **Noir Double-Breasted Blazer** (`/products/noir-double-breasted-blazer`,
   Maison Cendre, Tailoring, $1,480).
4. View **Burgundy Silk Evening Gown** (`/products/burgundy-silk-evening-gown`,
   Maison Cendre, Dresses, $2,860).
5. View **Camel Cashmere Wrap Coat** (`/products/camel-cashmere-wrap-coat`,
   Maison Cendre, Outerwear, $2,380) — a different category, same designer,
   to make "favourite designer" the clear, unambiguous signal.
6. Add the Camel Cashmere Wrap Coat to cart.
7. Pause on the debug panel (bottom-left) and narrate: point at "Favorite
   designer" and "Favorite category" populating from the browsing just
   done. This is the first half of the "prove it's real" beat — attributes
   changing live, on-screen, tied to actions the audience just watched.

Talking point: *"Every view and cart add just now went through Snowplow's
pipeline into Signals in real time. Watch the panel — that's not a mock,
that's the actual Profile Store."*

## Scene 2 — Open chat: the "no dead air" moment (~30s)

1. Click the chat launcher (bottom-right). The panel opens empty — the
   widget does not send a proactive greeting; the concierge speaks after
   the shopper's first message.
2. Send a light, contentless opener: *"Hello — I'm getting ready for an
   evening event."* Nothing about the coat, the designer, or the browsing.
3. Let the reply land: it should reference the shopper's evening/tailoring
   browsing and the coat now in cart, unprompted.

Talking point: *"All I said was hello. I never mentioned the coat, the
designer, or anything I looked at — the agent already knows, because
Signals context flows into the Gemini Enterprise for CX agent from the
very first turn."*

If the reply is generic instead — no reference to the browsing or the cart
(degraded/unknown-session fallback) — do not stop — this is exactly the
trigger for the seeded fallback session substitution in
`docs/runbook.md`'s "Seeded fallback session" section; swap sessions and
continue without narrating the hiccup.

## Scene 3 — Grounded recommendation, rendered as product cards (~60s)

1. Ask: *"What would you pair with this coat for an evening event?"*
2. The agent should call `searchCatalog` scoped to the shopper's context
   (Maison Cendre / evening) and recommend a real catalog product by name,
   designer, and price — never an invented item.
3. The reply lands as **product cards inside the chat** — photo, designer,
   name, price — in the storefront's own dark palette rather than a
   paragraph of text. Say nothing for a beat and let them draw.
4. Click a card. It opens that product's page **without a reload**: the
   chat panel stays open, the conversation is still there, and the view is
   tracked like any other in-app navigation — which is exactly the state
   Scene 4 continues from.

Talking points: *"That's not a generic suggestion — it just searched our
actual catalog, filtered by what it already knows I like."* Then, over the
cards: *"And it's not describing products at me — those are real catalog
items rendered right in the conversation, straight into the storefront."*

If the reply comes back as prose with no cards, don't chase it — the model
sometimes answers a "couple of pieces" ask in words alone. Follow up with
*"what else would work with that?"*, which reliably renders a carousel;
there is nothing to fix live.

## Scene 4 — "Prove it's real-time" beat (~45s)

Purpose: show the context isn't just the batch profile from Scene 1, but
updates within seconds of new behaviour — the freshness half of the "prove
it's real" moment.

1. Without closing the chat (it stays open and keeps its history across
   in-app navigation), click **Winter** in the site nav, then open one
   product not browsed yet: **Suede Chelsea Ankle Boot**
   (`/products/suede-chelsea-ankle-boot`, Maison Cendre, Shoes, $780). The
   boot lives in the Winter Salon collection — it is not reachable from the
   evening pages, so the nav click is the route.
2. Immediately switch back to the chat and ask: *"What shoes would go with
   this look?"*
3. The agent's answer should reflect that just-viewed boot (or a close
   catalog match), and the debug panel's activity should show the view
   within seconds — not stale, not absent.

Talking point: *"I viewed that a few seconds ago, mid-conversation, and
it's already in the agent's context. This is live behavioural grounding,
not a nightly batch job."*

## Scene 5 — Wrap-up (~15s)

Close with one summary line naming the integration correctly: *"That's
Snowplow Signals grounding a customer-facing agent built in Google Gemini
Enterprise for CX, using CX Agent Studio — real-time behavioural context,
turned into a concrete recommendation, in one conversation."*

## Fallback contingency

If the live pipeline or agent stalls at any point (empty/degraded context,
no reply, timeout): switch to the seeded fallback session rather than
narrating the failure. Procedure and exact commands:
`docs/runbook.md`, "Seeded fallback session" section. The seeded session
was built with the same Scene 1 choreography above, so its attributes match
what this script narrates even if substituted mid-take.

## Naming check

Every reference to the platform in this script uses the current official
names: **Google Gemini Enterprise for CX** (the product) and **CX Agent
Studio** (the console/tool used to build the agent). Do not say
"Dialogflow", "Contact Center AI (CCAI)", or "Vertex AI Agent Builder" —
those are prior or adjacent product names, not this one. The chat widget
component is **ces-messenger**; do not call it "chat-messenger" (a
different, unrelated Google widget generation — see `docs/runbook.md` §9.1).
