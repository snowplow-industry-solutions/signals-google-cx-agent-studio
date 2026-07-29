# PR: 11 — Rich response widgets in chat (polish)

**Branch:** sandcastle/11-rich-response-widgets
**Issue:** .scratch/signals-cx-agent-demo/issues/11-rich-response-widgets.md

## Summary

Added schema definitions, agent instructions, and runbook documentation for rich response widgets—enabling the agent to render product recommendations as visual carousel and product-details widgets in the CX Agent Studio chat interface instead of plain text. The catalog endpoint now exposes product images (required by the widgets), and comprehensive agent instructions guide when to emit each widget type, with a worked example grounded in real catalog data. All prep work for agent-side implementation is complete; live console steps, widget tool creation, and rendering verification (including resolution of a documented ces-messenger/chat-messenger compatibility question) are flagged for human testing.

## Changes

- **Catalog endpoint** (`storefront/src/app/api/agent/catalog/`): Added `image` field to `CatalogResult` in `route.ts` (exposed product image URLs required by the widgets) and updated `search-catalog.openapi.yaml` to document the new field. Tests updated and passing.

- **Widget tool schemas** (`agent/tools/`): Created two JSON Schema parameter definitions:
  - `product-carousel.widget.json` — for `PRODUCT_CAROUSEL` widget type (2-6 products, scrollable)
  - `product-details.widget.json` — for `PRODUCT_DETAILS` widget type (single product deep-dive)
  - Both schemas ground field values directly in `searchCatalog` results (`name`, `designer`, `price`, `image`, `url`); no invented data.

- **Agent instructions** (`agent/instructions.md` + `agent/instructions.console.txt`): 
  - New "Rich response widgets" section with usage rules (carousel for 2+ products, details for single-product deep-dives)
  - Field-mapping table showing 1:1 correspondence between widget fields and `searchCatalog` result fields
  - Worked example with real catalog products (Camel Cashmere Wrap Coat, Merino Rib Turtleneck)
  - Degrade-to-text rule for cases where a rich payload can't be used
  - Console version updated with constraint 5 + taskflow step

- **Runbook** (`docs/runbook.md` §10): Comprehensive section covering:
  - **Research citations** (§10.1): Official CX Agent Studio docs confirming rich response widgets, widget types (`PRODUCT_CAROUSEL`, `PRODUCT_DETAILS`), and schema-authorship model
  - **Open compatibility risk** (§10.2): Documented discrepancy between hosted `chat-messenger` (ships Product Carousel built-ins) and pinned open-source `ces-messenger` (no documented support); includes developer-forum citations and indicates this requires live verification
  - **Console steps** (§10.3–10.4): Step-by-step instructions to create the two widget tools in the CX Agent Studio console and attach them to the Root agent node
  - **Verification walkthrough** (§10.5): Test scenario (ask for accessories → expect carousel; ask about one product → expect details card) with placeholder for live agent log output
  - **Troubleshooting**: Guidance on what to check if rendering fails, with pointer to the ces-messenger risk as a likely cause

- **Issue tracking**:
  - `11-rich-response-widgets.md`: Ticked doable acceptance criteria (schemas confirmed, 09 dispositioned); left rendering criteria unchecked pending live test
  - `09-product-cards-stretch.md`: Added findings note and re-disposition trigger (§10.5 of runbook)

## Pipeline review record

1. **131eab6** — Added `image` field to `searchCatalog` endpoint (`route.ts`, tests, OpenAPI spec)
2. **95911f5** — Prepared widget schemas, agent instructions (markdown + console), comprehensive runbook with research citations and open risk documented
3. **56f6fb9** — Updated issue acceptance criteria and dispositioned issue 09

## Manual testing plan

### Prerequisites

- GCP account with CX Agent Studio access (the agent from runbook §8 must already exist)
- Browser with access to the live CX Agent Studio console and the deployed storefront (Vercel)
- `ces-messenger` compatibility question must be resolved (live rendering check in step 5 below)

### Testing steps

**1. Create the product carousel widget tool (console)**

1. In CX Agent Studio, open the agent from `docs/runbook.md` §8.
2. Go to the rich response widgets builder (rich response widgets icon in the agent builder).
3. Create a new widget tool named `productCarousel` from the `PRODUCT_CAROUSEL` template.
4. Do **not** edit the Parameters schema — the console auto-fills Google's fixed contract for typed widgets and the editor is read-only (corrected 2026-07-29; see runbook §10.1). Verify it matches the captured copy in `agent/tools/product-carousel.widget.json`.
5. Save the widget tool.
6. Return to the Root agent node and attach `productCarousel` to it (per `docs/runbook.md` §10.3).

**Expected result:** The widget tool appears in the agent's tool list and is available for tool calls.

**2. Create the product details widget tool (console)**

1. In the same rich response widgets builder, create a new widget tool named `productDetails` from the `PRODUCT_DETAILS` template.
2. Accept the auto-filled fixed schema (read-only, as above); verify it matches `agent/tools/product-details.widget.json`.
3. Save the widget tool.
4. Attach `productDetails` to the Root agent node.

**Expected result:** Both widget tools are now attached and available to the agent.

**3. Test carousel rendering (live agent)**

1. Open the deployed storefront in a browser (https://signals-google-gecx-storefront.vercel.app).
2. Complete browsing setup per `docs/runbook.md` §3 (set app ID env var if needed, browse products to seed pipeline with traffic).
3. Open the chat widget on the storefront.
4. Start a conversation with the agent. After the initial context fetch, ask a request that should return multiple products, e.g.: **"Show me a few cashmere pieces."**
5. Watch the agent's response.

**Expected result:** 
- The agent calls `searchCatalog` and receives 2+ products.
- The agent emits a `{@Widget: productCarousel}` instruction with the `productDetails` array populated from the search results.
- The chat widget renders a **scrollable carousel** with product cards (each showing image, title, subtitle/designer, price).
- Clicking a product link navigates to that product's page on the storefront (verify `uri` is a working absolute link).

**If it fails:** 
- Check `docs/runbook.md` §10.2 first — if the widgets appear as raw JSON or plain text instead of a card, or if a console/widget error appears, this likely indicates the `ces-messenger` compatibility risk is real (hosted `chat-messenger` ships these widgets, open-source `ces-messenger` does not). Document the finding and escalate to issue 09 disposition.
- If no error but no carousel renders, check: (a) agent instructions were synced to the console (paste the updated `agent/instructions.console.txt` if not), (b) the widget tool was created from the correct typed template (its read-only schema matches `agent/tools/product-carousel.widget.json`), (c) `searchCatalog` actually returned 2+ results (check browser network log for the tool call result).

**4. Test product details rendering (live agent)**

1. In the same chat session (or start a new one), ask about a specific product, e.g.: **"Tell me about the camel cashmere wrap coat."**
2. Watch the agent's response.

**Expected result:**
- The agent calls `searchCatalog` with narrowed filters and receives 1 product (or more, but focuses on one).
- The agent emits a `{@Widget: productDetails}` instruction with the single product's fields (`title`, `subtitle`, `price`, `productId`, `uri`, `imageUris`; `rating`/`review` omitted).
- The chat widget renders a **product details card** showing the image, title, designer subtitle, price, and a clickable link to the storefront.
- The link is a complete, absolute URL (not site-relative) and navigates to that product's page.

**If it fails:**
- Same troubleshooting as step 3: check the ces-messenger risk (§10.2), agent instructions sync, schema structure, and `searchCatalog` tool result in the network log.
- If the agent emits both carousel and details instructions, verify it's picking the right one per instructions (carousel for 2+, details for single).

**5. Verify the ces-messenger compatibility resolution (critical)**

This is the decision gate for whether this feature can ship as specified.

1. After testing steps 3–4, verify which rich-message rendering occurred:
   - ✓ **Both carousel and details rendered as visual cards:** the `ces-messenger` you're using supports these widget types. Feature is shippable; close this issue as done. Log the `ces-messenger` version (check the widget iframe source or the GitHub release tag).
   - ✗ **Widgets rendered as raw JSON, plain text, or errors:** the `ces-messenger` does not support these widget types (confirming the risk in §10.2). Feature **is not shippable as specified**. Document the ces-messenger version, error message (if any), and escalate to issue 09 (keep it open with this finding, do NOT close as wontfix). Issue 09's `registerClientSideFunction` custom-render path becomes the fallback.
   - ? **Ambiguous or partial rendering:** (e.g. carousel renders but details doesn't): document the specific behavior and escalate to issue 09.

2. Log the result in `<PLACEHOLDER: verification checkpoint>` at the end of `docs/runbook.md` §10.5.

**6. Verify text degradation (if applicable)**

If either widget rendering failed in step 5, verify the agent can still emit plain-text recommendations. Ask the same questions from steps 3–4 and confirm the agent provides a text response (without widget instructions) as a fallback. This is already implemented per instructions ("if a rich payload can't be used, emit plain text"), so if it doesn't happen, check agent instructions are synced and try the agent again.

## Rollback

To undo this PR: revert the merge commit (`git revert <merge-commit-hash>`), which will remove all schema, instruction, and runbook changes. If widget tools were already created in the console, delete them manually via the CX Agent Studio UI (rich response widgets builder → delete `productCarousel` and `productDetails`).

## Live test record (2026-07-29)

Steps 1–2 (console tool creation) done by human 2026-07-29 ~14:46 —
created from typed templates as-is after the read-only-schema correction
(see commit ed7e1d3); attachment to Root agent verified via CES REST.
Updated instructions pasted + new deployment version `a8c48c30…`
published ~15:06. Steps 3–4 run ~15:10 via Playwright against the
deployed storefront (click-browsed Accessories, live Signals attributes
visible in the debug panel: favourite category Accessories, designer
Atelier Lune, occasion City).

- **Step 3 (carousel): agent PASS / rendering FAIL.** Reply contained a
  schema-perfect `productCarousel` invocation grounded in three real
  session-relevant catalog items (scarf $340, cuff bracelet $680, cloche
  hat $410) — but `ces-messenger` printed the whole `{@Widget: …}` token
  as literal chat text. Screenshot:
  `widget-carousel-raw-text-failure.png` (Playwright output dir).
- **Step 4 (details): identical result** — correct `productDetails`
  payload, raw text in the bubble.
- **Root cause (wire-level):** `runSession` returns the widget
  invocation inside `outputs[].text`; no structured widget field exists
  in the response. Token→card parsing is a hosted `chat-messenger`
  client feature the pinned open-source component lacks. Confirms
  runbook §10.2's risk exactly as analysed.
- **Disposition:** visual acceptance criteria NOT met — issue 11 not
  shippable as specified for rendering; agent-side contract + `image`
  field + docs are verified correct. Finding fed to issue 09
  (custom-render fallback now known-feasible: parse the in-band token
  client-side; payload uses unquoted JS-object keys). Demo hazard until
  resolved: live agent emits raw tokens — revert console instructions to
  text-only or ship 09's renderer before recording.
- Model quirk noted: appends a `summary:` argument not in the fixed
  schema (harmless today; a client-side parser must tolerate it).
