import { describe, expect, it } from "vitest";

import { findPartialTokenStart, findWidgetTokens } from "./widgetTokens";

// Captured verbatim from the live agent's runSession output on 2026-07-29:
// JS-object-literal keys, double-quoted strings,
// and a `summary:` argument that is not part of the fixed widget schema.
const LIVE_CAROUSEL_TOKEN =
  '{@Widget: productCarousel(payload: {productDetails: [{imageUris: ["https://images.unsplash.com/photo-1518893063132-36e46dbe2428?auto=format&fit=crop&w=1200&q=80"], price: "$340", productId: "silk-twill-square-scarf", subtitle: "Atelier Lune", title: "Silk Twill Square Scarf", uri: "https://your-storefront.example.com/products/silk-twill-square-scarf"}, {imageUris: ["https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=1200&q=80"], price: "$680", productId: "hammered-gold-cuff-bracelet", subtitle: "Arc Studio", title: "Hammered Gold Cuff Bracelet", uri: "https://your-storefront.example.com/products/hammered-gold-cuff-bracelet"}]}, summary: "A curated selection of accessories.")}';

const LIVE_DETAILS_TOKEN =
  '{@Widget: productDetails(payload: {imageUris: ["https://images.unsplash.com/photo-1518893063132-36e46dbe2428?auto=format&fit=crop&w=1200&q=80"], price: "$340", productId: "silk-twill-square-scarf", subtitle: "Atelier Lune", title: "Silk Twill Square Scarf", uri: "https://your-storefront.example.com/products/silk-twill-square-scarf"}, summary: "Detailed view of the scarf.")}';

interface CarouselPayload {
  productDetails: Array<Record<string, unknown>>;
}

describe("findWidgetTokens", () => {
  it("parses the live-captured carousel token", () => {
    const text = `Here are some pieces. ${LIVE_CAROUSEL_TOKEN} Anything else?`;
    const tokens = findWidgetTokens(text);
    expect(tokens).toHaveLength(1);
    const [token] = tokens;
    expect(token.name).toBe("productCarousel");
    expect(text.slice(token.start, token.end)).toBe(LIVE_CAROUSEL_TOKEN);

    const payload = token.payload as CarouselPayload;
    expect(payload.productDetails).toHaveLength(2);
    expect(payload.productDetails[0].title).toBe("Silk Twill Square Scarf");
    expect(payload.productDetails[0].price).toBe("$340");
    expect(payload.productDetails[0].imageUris).toEqual([
      "https://images.unsplash.com/photo-1518893063132-36e46dbe2428?auto=format&fit=crop&w=1200&q=80",
    ]);
    expect(payload.productDetails[1].uri).toBe(
      "https://your-storefront.example.com/products/hammered-gold-cuff-bracelet"
    );
  });

  it("parses the live-captured details token (flat payload)", () => {
    const tokens = findWidgetTokens(LIVE_DETAILS_TOKEN);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].name).toBe("productDetails");
    const payload = tokens[0].payload as Record<string, unknown>;
    expect(payload.title).toBe("Silk Twill Square Scarf");
    expect(payload.subtitle).toBe("Atelier Lune");
  });

  it("finds multiple tokens and preserves surrounding text offsets", () => {
    const text = `A ${LIVE_DETAILS_TOKEN} B ${LIVE_DETAILS_TOKEN} C`;
    const tokens = findWidgetTokens(text);
    expect(tokens).toHaveLength(2);
    expect(text.slice(0, tokens[0].start)).toBe("A ");
    expect(text.slice(tokens[0].end, tokens[1].start)).toBe(" B ");
    expect(text.slice(tokens[1].end)).toBe(" C");
  });

  it("ignores an incomplete (still-streaming) token", () => {
    const partial = LIVE_CAROUSEL_TOKEN.slice(0, 120);
    expect(findWidgetTokens(`Some prose ${partial}`)).toHaveLength(0);
  });

  it("returns payload null for unparseable arguments, keeping offsets", () => {
    const text = "x {@Widget: productCarousel(payload: {broken [}])} y";
    const tokens = findWidgetTokens(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].payload).toBeNull();
    expect(text.slice(tokens[0].end)).toBe(" y");
  });

  it("tolerates values containing braces, colons, and parens inside strings", () => {
    const text =
      '{@Widget: productDetails(payload: {title: "Coat (wool) — {limited}: 2/2", uri: "https://x.test/a?b=c:d"})}';
    const tokens = findWidgetTokens(text);
    expect(tokens).toHaveLength(1);
    const payload = tokens[0].payload as Record<string, unknown>;
    expect(payload.title).toBe("Coat (wool) — {limited}: 2/2");
    expect(payload.uri).toBe("https://x.test/a?b=c:d");
  });

  it("handles numbers, booleans, null, and trailing commas", () => {
    const text =
      '{@Widget: productDetails(payload: {title: "X", rating: 4.5, inStock: true, review: null,})}';
    const [token] = findWidgetTokens(text);
    const payload = token.payload as Record<string, unknown>;
    expect(payload.rating).toBe(4.5);
    expect(payload.inStock).toBe(true);
    expect(payload.review).toBeNull();
  });

  it("returns nothing for token-free text", () => {
    expect(findWidgetTokens("A plain concierge reply.")).toHaveLength(0);
    expect(findWidgetTokens("")).toHaveLength(0);
  });
});

describe("findPartialTokenStart", () => {
  it("returns the marker index for a streaming token", () => {
    const partial = `prose ${LIVE_CAROUSEL_TOKEN.slice(0, 80)}`;
    expect(findPartialTokenStart(partial)).toBe("prose ".length);
  });

  it("returns -1 when every token is complete", () => {
    expect(findPartialTokenStart(`a ${LIVE_DETAILS_TOKEN} b`)).toBe(-1);
  });

  it("returns -1 for token-free text", () => {
    expect(findPartialTokenStart("no tokens here")).toBe(-1);
  });
});
