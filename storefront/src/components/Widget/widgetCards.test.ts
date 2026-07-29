// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  buildWidgetElement,
  makeWidgetTemplate,
  normalizeWidgetPayload,
  renderWidgetCardsHtml,
  replaceWidgetTokensIn,
  safeCardUrl,
} from "./widgetCards";

const PRODUCT = {
  title: "Silk Twill Square Scarf",
  subtitle: "Atelier Lune",
  price: "$340",
  productId: "silk-twill-square-scarf",
  uri: "https://signals-google-gecx-storefront.vercel.app/products/silk-twill-square-scarf",
  imageUris: [
    "https://images.unsplash.com/photo-1518893063132-36e46dbe2428?auto=format&fit=crop&w=1200&q=80",
  ],
};

describe("buildWidgetElement", () => {
  it("builds a carousel rail with one anchor card per product", () => {
    const el = buildWidgetElement(document, "productCarousel", {
      productDetails: [PRODUCT, { ...PRODUCT, title: "Felt Cloche Hat" }],
    });
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-widget-card")).toBe("productCarousel");
    const anchors = el!.querySelectorAll("a");
    expect(anchors).toHaveLength(2);
    expect(anchors[0].href).toBe(PRODUCT.uri);
    expect(anchors[0].querySelector("img")?.src).toBe(PRODUCT.imageUris[0]);
    expect(anchors[0].textContent).toContain("Silk Twill Square Scarf");
    expect(anchors[0].textContent).toContain("Atelier Lune");
    expect(anchors[0].textContent).toContain("$340");
    expect(anchors[1].textContent).toContain("Felt Cloche Hat");
  });

  it("builds a single details card from a flat payload", () => {
    const el = buildWidgetElement(document, "productDetails", PRODUCT);
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-widget-card")).toBe("productDetails");
    expect(el!.querySelectorAll("a")).toHaveLength(1);
    expect(el!.textContent).toContain("$340");
  });

  it("skips products without a title but keeps the rest", () => {
    const el = buildWidgetElement(document, "productCarousel", {
      productDetails: [{ price: "$1" }, PRODUCT],
    });
    expect(el!.querySelectorAll("a")).toHaveLength(1);
  });

  it("returns null for unknown widgets and unrenderable payloads", () => {
    expect(buildWidgetElement(document, "quickActions", PRODUCT)).toBeNull();
    expect(buildWidgetElement(document, "productCarousel", null)).toBeNull();
    expect(
      buildWidgetElement(document, "productCarousel", { productDetails: [] })
    ).toBeNull();
    expect(buildWidgetElement(document, "productDetails", {})).toBeNull();
  });

  it("prevents default and delegates same-origin clicks to onNavigate", () => {
    const onNavigate = vi.fn().mockReturnValue(true);
    const el = buildWidgetElement(document, "productDetails", PRODUCT, onNavigate);
    document.body.appendChild(el!);
    const anchor = el!.querySelector("a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0][0]).toBeInstanceOf(URL);
    expect(event.defaultPrevented).toBe(true);
    el!.remove();
  });

  it("rejects a javascript: uri: no href, no data-uri, click is a no-op", () => {
    const onNavigate = vi.fn().mockReturnValue(true);
    const el = buildWidgetElement(
      document,
      "productDetails",
      { ...PRODUCT, uri: "javascript:alert(1)" },
      onNavigate
    );
    document.body.appendChild(el!);
    const anchor = el!.querySelector("a")!;
    expect(anchor.hasAttribute("href")).toBe(false);
    expect(anchor.hasAttribute("data-uri")).toBe(false);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    el!.remove();
  });

  it("rejects a data: uri: no href, no data-uri", () => {
    const el = buildWidgetElement(document, "productDetails", {
      ...PRODUCT,
      uri: "data:text/html,<script>alert(1)</script>",
    });
    const anchor = el!.querySelector("a")!;
    expect(anchor.hasAttribute("href")).toBe(false);
    expect(anchor.hasAttribute("data-uri")).toBe(false);
  });
});

describe("safeCardUrl", () => {
  it("rejects javascript: uris", () => {
    expect(safeCardUrl("javascript:alert(1)", "https://example.com/")).toBeNull();
  });

  it("rejects data: uris", () => {
    expect(
      safeCardUrl("data:text/html,<script>alert(1)</script>", "https://example.com/")
    ).toBeNull();
  });

  it("rejects uppercase and whitespace-padded javascript: uris", () => {
    expect(safeCardUrl("  JAVASCRIPT:alert(1)", "https://example.com/")).toBeNull();
    expect(safeCardUrl("JaVaScRiPt:alert(1)", "https://example.com/")).toBeNull();
  });

  it("resolves an absolute https:// uri", () => {
    const url = safeCardUrl("https://example.com/products/x", "https://example.com/");
    expect(url).not.toBeNull();
    expect(url!.href).toBe("https://example.com/products/x");
  });

  it("resolves a relative uri against the base", () => {
    const url = safeCardUrl("/products/x", "https://example.com/");
    expect(url).not.toBeNull();
    expect(url!.href).toBe("https://example.com/products/x");
  });

  it("resolves a protocol-relative uri against the base's protocol", () => {
    const url = safeCardUrl("//example.com/products/x", "https://example.com/");
    expect(url).not.toBeNull();
    expect(url!.protocol).toBe("https:");
  });
});

describe("normalizeWidgetPayload", () => {
  it("normalises the structured carousel payload (runSession outputs[].payload)", () => {
    // Captured live 2026-07-29: the structured delivery mode adds a `type`
    // discriminator and wraps products in productDetails.
    const context = normalizeWidgetPayload({
      type: "product_detail_carousel",
      productDetails: [PRODUCT, { ...PRODUCT, title: "Embossed Leather Belt" }],
    });
    expect(context).not.toBeNull();
    expect(context!.kind).toBe("carousel");
    expect(context!.items).toHaveLength(2);
    expect(context!.items[0].imageUri).toBe(PRODUCT.imageUris[0]);
  });

  it("normalises a flat details payload", () => {
    const context = normalizeWidgetPayload(PRODUCT);
    expect(context!.kind).toBe("details");
    expect(context!.items[0].title).toBe(PRODUCT.title);
  });

  it("treats a single-item carousel as a details card", () => {
    const context = normalizeWidgetPayload({ productDetails: [PRODUCT] });
    expect(context!.kind).toBe("details");
  });

  it("returns null for unrenderable payloads", () => {
    expect(normalizeWidgetPayload(null)).toBeNull();
    expect(normalizeWidgetPayload("x")).toBeNull();
    expect(normalizeWidgetPayload({ productDetails: [] })).toBeNull();
    expect(normalizeWidgetPayload({ price: "$1" })).toBeNull();
  });
});

describe("renderWidgetCardsHtml", () => {
  it("renders an HTML string with data-uri cards and no live listeners needed", () => {
    const context = normalizeWidgetPayload({
      type: "product_detail_carousel",
      productDetails: [PRODUCT, { ...PRODUCT, title: "Felt Cloche Hat" }],
    });
    const html = renderWidgetCardsHtml(context);
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("[data-widget-card=productCarousel]")).not.toBeNull();
    const cards = host.querySelectorAll("[data-uri]");
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute("data-uri")).toBe(PRODUCT.uri);
    // template path builds divs, not anchors — clicks go through
    // registerRichMessageHandler
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("$340");
  });

  it("returns an empty string for junk context", () => {
    expect(renderWidgetCardsHtml(null)).toBe("");
    expect(renderWidgetCardsHtml({ items: [] })).toBe("");
  });
});

describe("makeWidgetTemplate(true) — anchor fallback for builds without registerRichMessageHandler", () => {
  it("renders <a href> cards whose href round-trips through outerHTML", () => {
    const context = normalizeWidgetPayload({
      type: "product_detail_carousel",
      productDetails: [PRODUCT, { ...PRODUCT, title: "Felt Cloche Hat" }],
    });
    const html = makeWidgetTemplate(true)(context);
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("[data-widget-card=productCarousel]")).not.toBeNull();
    const anchors = host.querySelectorAll("a");
    expect(anchors).toHaveLength(2);
    expect(anchors[0].getAttribute("href")).toBe(PRODUCT.uri);
    expect(anchors[1].textContent).toContain("Felt Cloche Hat");
    // No data-uri-only divs left over — every card is a real anchor.
    expect(host.querySelectorAll("[data-uri]")).toHaveLength(2);
  });

  it("omits href for an unsafe uri, same gate as the div variant", () => {
    const context = normalizeWidgetPayload({ ...PRODUCT, uri: "javascript:alert(1)" });
    const html = makeWidgetTemplate(true)(context);
    const host = document.createElement("div");
    host.innerHTML = html;
    const anchor = host.querySelector("a")!;
    expect(anchor.hasAttribute("href")).toBe(false);
    expect(anchor.hasAttribute("data-uri")).toBe(false);
  });

  it("returns an empty string for junk context, same as the div variant", () => {
    expect(makeWidgetTemplate(true)(null)).toBe("");
    expect(makeWidgetTemplate(true)({ items: [] })).toBe("");
  });
});

describe("replaceWidgetTokensIn", () => {
  function messageNode(text: string): { root: HTMLElement; span: HTMLElement } {
    // Mirrors the live ces-messenger structure: li.from-bot > span > #text
    // (single text node carrying the whole message, token included).
    const root = document.createElement("ul");
    const li = document.createElement("li");
    li.className = "from-bot text-response";
    const span = document.createElement("span");
    span.textContent = text;
    li.appendChild(span);
    root.appendChild(li);
    return { root, span };
  }

  const TOKEN =
    '{@Widget: productDetails(payload: {title: "Silk Twill Square Scarf", subtitle: "Atelier Lune", price: "$340", uri: "https://x.test/products/scarf", imageUris: ["https://img.test/scarf.jpg"]})}';

  it("swaps the token for a card and keeps surrounding prose", () => {
    const { root, span } = messageNode(`Lovely choice. ${TOKEN} Anything else?`);
    const replaced = replaceWidgetTokensIn(root);
    expect(replaced).toBe(1);
    expect(span.textContent).not.toContain("{@Widget:");
    expect(span.textContent).toContain("Lovely choice.");
    expect(span.textContent).toContain("Anything else?");
    expect(span.querySelector("[data-widget-card=productDetails]")).not.toBeNull();
  });

  it("strips unrenderable tokens without leaking syntax", () => {
    const { root, span } = messageNode(
      "Before {@Widget: quickActions(payload: {x: 1})} after"
    );
    expect(replaceWidgetTokensIn(root)).toBe(1);
    expect(span.textContent).toBe("Before  after");
    expect(span.querySelector("[data-widget-card]")).toBeNull();
  });

  it("leaves incomplete streaming tokens untouched until complete", () => {
    const { root, span } = messageNode(`Prose ${TOKEN.slice(0, 60)}`);
    expect(replaceWidgetTokensIn(root)).toBe(0);
    expect(span.textContent).toContain("{@Widget:");
  });

  it("is idempotent across repeated calls (observer re-entry)", () => {
    const { root } = messageNode(`Take a look: ${TOKEN}`);
    expect(replaceWidgetTokensIn(root)).toBe(1);
    expect(replaceWidgetTokensIn(root)).toBe(0);
    expect(root.querySelectorAll("[data-widget-card]")).toHaveLength(1);
  });

  it("handles multiple tokens in one message", () => {
    const { root, span } = messageNode(`A ${TOKEN} B ${TOKEN} C`);
    expect(replaceWidgetTokensIn(root)).toBe(2);
    expect(span.querySelectorAll("[data-widget-card]")).toHaveLength(2);
    expect(span.textContent).toContain("A ");
    expect(span.textContent).toContain(" B ");
    expect(span.textContent).toContain(" C");
  });
});
