/**
 * DOM builders for the storefront's own rendering of CX Agent Studio
 * rich-response widgets (issue 09). ces-messenger prints `{@Widget: …}`
 * invocations as raw chat text (docs/runbook.md §11.5), so these cards are
 * injected into its shadow DOM in place of the token. Everything is styled
 * inline: page stylesheets don't cascade into the shadow root, but CSS
 * custom properties (--accent, --foreground, …) inherit through it, so the
 * luxury palette comes from var() references with hex fallbacks.
 */

import { findWidgetTokens } from "@/utils/widgetTokens";

/** One product as the fixed PRODUCT_CAROUSEL/PRODUCT_DETAILS schema ships it
 * (agent/tools/*.widget.json): title required; the rest best-effort. */
interface ProductFields {
  title?: unknown;
  subtitle?: unknown;
  price?: unknown;
  uri?: unknown;
  imageUris?: unknown;
}

/** Normalised card data shared by both render paths. */
export interface ProductCardData {
  title: string;
  subtitle: string;
  price: string;
  uri: string;
  imageUri: string;
}

export interface WidgetCardContext {
  kind: "carousel" | "details";
  items: ProductCardData[];
}

export type NavigateHandler = (url: URL) => boolean;

/**
 * Parses `uri` against `base` and returns the resulting URL only when its
 * protocol is `http:` or `https:` — otherwise null. Model-emitted card URIs
 * are untrusted text: without this gate a `javascript:` (or `data:`) URI
 * would execute on click, whether assigned as an anchor `href` or passed to
 * `window.location.assign`. Both card-navigation paths must resolve URIs
 * through this single helper rather than hand-rolling their own
 * `new URL` + try/catch.
 */
export function safeCardUrl(uri: string, base: string): URL | null {
  let url: URL;
  try {
    url = new URL(uri, base);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

function normalizeProduct(product: ProductFields): ProductCardData | null {
  const title = typeof product.title === "string" ? product.title : null;
  if (!title) return null;
  return {
    title,
    subtitle: typeof product.subtitle === "string" ? product.subtitle : "",
    price: typeof product.price === "string" ? product.price : "",
    uri: typeof product.uri === "string" ? product.uri : "",
    imageUri:
      Array.isArray(product.imageUris) && typeof product.imageUris[0] === "string"
        ? product.imageUris[0]
        : "",
  };
}

/**
 * Normalises either widget payload shape into card data, or null when
 * unrenderable. Accepts both delivery modes' shapes (docs/runbook.md
 * §11.5): the carousel's `{productDetails: […]}` wrapper and the details
 * widget's flat product object. The structured-payload mode also carries a
 * `type` discriminator (e.g. "product_detail_carousel"), which is
 * tolerated but not required — the token mode has only the widget name.
 */
export function normalizeWidgetPayload(payload: unknown): WidgetCardContext | null {
  if (payload === null || typeof payload !== "object") return null;
  const obj = payload as { productDetails?: unknown } & ProductFields;

  if (Array.isArray(obj.productDetails)) {
    const items = obj.productDetails
      .map((item) =>
        item && typeof item === "object" ? normalizeProduct(item as ProductFields) : null
      )
      .filter((item): item is ProductCardData => item !== null);
    if (items.length === 0) return null;
    return { kind: items.length > 1 ? "carousel" : "details", items };
  }

  const single = normalizeProduct(obj);
  return single ? { kind: "details", items: [single] } : null;
}

const CARD_BG = "color-mix(in srgb, var(--background, #131311) 88%, white)";
const CARD_BORDER = "1px solid rgba(247, 241, 231, 0.14)";
const TEXT_COLOR = "var(--foreground, #f7f1e7)";
const MUTED_COLOR = "var(--muted, rgba(247, 241, 231, 0.62))";
const ACCENT_COLOR = "var(--accent, #b79559)";

function styled<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style: Partial<CSSStyleDeclaration>
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  Object.assign(el.style, style);
  return el;
}

function buildCard(
  doc: Document,
  product: ProductCardData,
  onNavigate: NavigateHandler | undefined,
  wide: boolean,
  asAnchor: boolean
): HTMLElement {
  const { title, subtitle, price, uri, imageUri } = product;

  // Model-emitted uri is untrusted: only a URI that resolves to http(s)
  // is wired up for navigation (href, data-uri, click listener, pointer
  // cursor) — a bare `javascript:` or `data:` URI is left completely
  // inert rather than assigned anywhere a click could execute it.
  const safeUrl = uri ? safeCardUrl(uri, doc.baseURI) : null;

  // Anchor for the token path (native href behaviour, plus an optional SPA
  // listener); plain data-uri div for HTML-string rendering (template
  // path), where listeners wouldn't survive innerHTML insertion — clicks
  // are then routed via registerRichMessageHandler.
  const card = styled(doc, asAnchor ? "a" : "div", {
    display: "flex",
    flexDirection: "column",
    flex: wide ? "1 1 auto" : "0 0 11rem",
    width: wide ? "100%" : "11rem",
    textDecoration: "none",
    background: CARD_BG,
    border: CARD_BORDER,
    borderRadius: "0.5rem",
    overflow: "hidden",
    color: TEXT_COLOR,
    cursor: safeUrl ? "pointer" : "default",
  });
  if (safeUrl) card.setAttribute("data-uri", uri);
  if (safeUrl && card instanceof HTMLAnchorElement) card.href = uri;
  if (safeUrl && onNavigate && asAnchor) {
    card.addEventListener("click", (event) => {
      if (onNavigate(safeUrl)) event.preventDefault();
    });
  }

  if (imageUri) {
    const img = styled(doc, "img", {
      width: "100%",
      height: wide ? "13rem" : "9rem",
      objectFit: "cover",
      display: "block",
    });
    img.src = imageUri;
    img.alt = title;
    card.appendChild(img);
  }

  const body = styled(doc, "div", {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    padding: "0.6rem 0.7rem 0.7rem",
  });

  if (subtitle) {
    const sub = styled(doc, "div", {
      fontSize: "0.62rem",
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: MUTED_COLOR,
    });
    sub.textContent = subtitle;
    body.appendChild(sub);
  }

  const name = styled(doc, "div", {
    fontSize: "0.85rem",
    lineHeight: "1.25",
  });
  name.textContent = title;
  body.appendChild(name);

  if (price) {
    const priceEl = styled(doc, "div", {
      fontSize: "0.8rem",
      marginTop: "0.25rem",
      color: ACCENT_COLOR,
    });
    priceEl.textContent = price;
    body.appendChild(priceEl);
  }

  card.appendChild(body);
  return card;
}

/** Builds the shared card layout (rail or single card) from normalised data. */
function buildCards(
  doc: Document,
  context: WidgetCardContext,
  onNavigate?: NavigateHandler,
  asAnchor = true
): HTMLElement {
  if (context.kind === "carousel") {
    const rail = styled(doc, "div", {
      display: "flex",
      gap: "0.6rem",
      overflowX: "auto",
      padding: "0.5rem 0",
      maxWidth: "100%",
    });
    rail.setAttribute("data-widget-card", "productCarousel");
    for (const item of context.items) {
      rail.appendChild(buildCard(doc, item, onNavigate, false, asAnchor));
    }
    return rail;
  }

  const wrap = styled(doc, "div", {
    padding: "0.5rem 0",
    maxWidth: "17rem",
  });
  wrap.setAttribute("data-widget-card", "productDetails");
  wrap.appendChild(buildCard(doc, context.items[0], onNavigate, true, asAnchor));
  return wrap;
}

/**
 * Builds the replacement element for one widget token, or null when there
 * is nothing renderable (unknown widget, unparseable/empty payload) — in
 * which case the caller still strips the raw token, because leaking
 * `{@Widget:` syntax to the shopper is never acceptable (the surrounding
 * prose already carries the recommendation).
 */
export function buildWidgetElement(
  doc: Document,
  name: string,
  payload: unknown,
  onNavigate?: NavigateHandler
): HTMLElement | null {
  if (name !== "productCarousel" && name !== "productDetails") return null;
  const context = normalizeWidgetPayload(payload);
  if (!context) return null;
  if (name === "productDetails") context.kind = "details";
  return buildCards(doc, context, onNavigate);
}

/**
 * Template function for ces-messenger's rich-message system
 * (registerTemplate) — the structured-payload delivery mode, which the
 * stock component otherwise drops as a blank reply. Receives the
 * WidgetCardContext prepared by the payload-received hook and returns an
 * HTML string; clicks are handled by registerRichMessageHandler via each
 * card's data-uri attribute (listeners can't survive string rendering).
 */
export function renderWidgetCardsHtml(context: unknown): string {
  const cardContext = context as WidgetCardContext | null;
  if (!cardContext || !Array.isArray(cardContext.items) || cardContext.items.length === 0) {
    return "";
  }
  return buildCards(document, cardContext, undefined, false).outerHTML;
}

/**
 * Replaces every complete `{@Widget: …}` token found in the text nodes
 * under `root` with rendered cards (or with nothing when unrenderable).
 * Safe to call repeatedly — processed text no longer contains tokens, and
 * injected cards carry no token text. Returns how many tokens were
 * replaced.
 */
export function replaceWidgetTokensIn(
  root: Node,
  onNavigate?: NavigateHandler
): number {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.textContent && n.textContent.includes("{@Widget:")) {
      targets.push(n as Text);
    }
  }

  let replaced = 0;
  for (const textNode of targets) {
    const text = textNode.textContent ?? "";
    const tokens = findWidgetTokens(text);
    if (tokens.length === 0) continue;

    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const token of tokens) {
      const before = text.slice(cursor, token.start);
      if (before) fragment.appendChild(doc.createTextNode(before));
      const el = buildWidgetElement(doc, token.name, token.payload, onNavigate);
      if (el) fragment.appendChild(el);
      cursor = token.end;
      replaced++;
    }
    const after = text.slice(cursor);
    if (after) fragment.appendChild(doc.createTextNode(after));

    textNode.parentNode?.replaceChild(fragment, textNode);
  }
  return replaced;
}
