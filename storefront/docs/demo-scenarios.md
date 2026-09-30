# Demo Scenarios

This guide is for the person presenting the Atelier Signals storefront to an end user or stakeholder.

## Demo Setup

1. Start the app with `npm run dev`.
2. Open the default mode at `http://localhost:3000/`.
3. Keep browser DevTools open if you want to narrate the `[Signals Demo]` console output.
4. Make sure the floating demo panel is visible.

For a quieter before/after comparison, open `http://localhost:3000/?demo=plain` first, then turn highlighting on in the demo panel once you are ready to reveal the personalization layer.

## Best Scenario Order

### 1. Homepage Editorial Reordering

**Route:** `/`

**What to say**

- The homepage is not just a static merch layout.
- Signals attributes can reorder editorial modules and featured products based on in-session behavior.

**What to point out**

- The top module in the editorial grid is visually highlighted when personalization highlighting is on.
- The demo panel shows active workflows like `EditorialHeroReordering`.
- The top attributes show the current favorite category, designer, and occasion.

### 2. Collection Page Merchandising

**Route:** `/collections/city-after-dark`

**What to say**

- The collection view shifts from a generic sort order to a taste-aware order.
- The callout block explains how Signals is shaping the page.

**What to point out**

- The personalized callout block at the top of the page
- The first few highlighted cards in the grid
- The Signals panel showing `CollectionPageMerchandising`

### 3. Product Detail Look Completion

**Route:** `/products/noir-double-breasted-blazer`

**What to say**

- This is the core luxury retail moment: instead of discounting, Signals completes the look.
- The recommendation rail should feel like a stylist's suggestion, not a generic upsell.

**What to point out**

- The "Complete the look" section
- Watch, scarf, and accessory recommendations as styling complements
- The active workflow `LookCompletionOnPDP`
- Any intervention or console log that references the current styling direction

### 4. Cart Styling Companion

**Route:** `/cart`

**What to do**

1. Add the blazer and one other evening piece to cart.
2. Open the cart route.

**What to say**

- The basket itself becomes a styling signal.
- Signals reads the current edit and suggests a finishing piece that feels coherent.

**What to point out**

- The highlighted `CartStylingCompanion` block
- The recommended add-on piece and its rationale text
- Cart total and live workflow list in the demo panel

### 5. Checkout Confidence Layer

**Route:** `/checkout`

**What to say**

- Instead of urgency or promo code mechanics, the checkout experience reinforces confidence in the selected edit.
- Signals helps the site speak back the shopper's taste rather than pushing a transaction tactic.

**What to point out**

- The confidence message tied to favorite occasion and category
- The displayed cart value band if available
- The fact that the checkout panel still reads live attributes and active workflows

## Agent Analytics

A separate walkthrough from the personalisation scenarios above: instead of
showing what the shopper sees, this shows what the concierge itself records
as it works. Needs the concierge agent deployed and reachable (the chat
widget on the live storefront), plus access to BDP Console.

**What to do**

1. Open the chat widget and hold a short conversation — ask something that
   triggers a recommendation (e.g. "I'm looking for something for a dinner
   party") so the turn exercises intent detection, a catalog search, and a
   decision, not just a context lookup.
2. In BDP Console's event explorer, find that conversation's events in the
   same domain session: filter to the shopper's session id (or the app id
   ending `-agent` / platform `srv` for just the agent's side), and look for
   `tool_execution`, `user_intent_detected`, and `agent_decision_logged`
   events alongside the browser's own `message_sent` / `message_received`.
3. Point out that `agent_context.invocation_id` on the agent events matches
   the `turn_id` on the browser message events for the same turn — the same
   conversation, two tracked perspectives.
4. Run one query from `analytics/agent-self-tracking.sql` (query 2a, detected
   intent distribution, reads well live) against the warehouse, once events
   have loaded, to show the conversation becoming an aggregate answer rather
   than a one-off trace.

**What to say**

- "Every recommendation the concierge makes is backed by a real catalog
  search — and now we can see that search, and why the agent made it."
- "The conversation itself is invisible to the shopper, but nothing the
  concierge does is invisible to the business."

**What to point out**

- The self-tracking events never affected the reply — the conversation you
  just had reads identically with or without instrumentation.
- The shared `invocation_id`/`turn_id` ties the agent's reasoning to the
  exact shopper turn that produced it.

## Before/After Presentation Pattern

Use this sequence when you want the personalization to feel especially legible:

1. Open the site in quiet mode with `?demo=plain`.
2. Show the same page once without visible highlight treatment.
3. Toggle highlight mode on in the demo panel.
4. Refresh or navigate to the same view again.
5. Point to:
   - highlighted cards
   - the active workflow list
   - `[Signals Demo]` logs

This makes the personalization logic easier to explain to a live audience.

## Console Narration

Useful log categories to mention during a live demo:

- tracker initialized
- fetched Signals attributes
- tracked page view or product event
- subscribed to interventions
- cart updated
- highlight personalization toggled

All of these are prefixed with:

```text
[Signals Demo]
```

## Suggested Narrative

Use language like:

- "Signals has recognized that this shopper is leaning toward evening tailoring."
- "Rather than offering a discount, the storefront completes the look with accessories."
- "The page is changing because in-session attributes now show a preference for this designer and occasion."
- "The highlighted state is just for demo clarity. We can switch it off and keep the same personalization logic."

Avoid language like:

- "People also bought"
- "Limited-time offer"
- "Use this promo code"
- "Hurry before it sells out"

## Fallback Paths

If one workflow is not visually striking enough, use these backups:

- If homepage changes are subtle, go directly to the blazer PDP and show look completion.
- If cart state is empty, add two items from the evening collection and revisit `/cart`.
- If you want a quieter comparison, restart with `?demo=plain` and toggle highlighting live.
