/**
 * DOM builders for the storefront's own rendering of CX Agent Studio
 * rich-response widgets. ces-messenger prints `{@Widget: …}`
 * invocations as raw chat text (see agent/instructions.md 'Rich response
 * widgets'), so these cards are
 * injected into its shadow DOM in place of the token. Everything is styled
 * inline: page stylesheets don't cascade into the shadow root, but CSS
 * custom properties (--accent, --foreground, …) inherit through it, so the
 * luxury palette comes from var() references with hex fallbacks.
 */

import { findPartialTokenStart, findWidgetTokens } from "@/utils/widgetTokens";

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
 * unrenderable. Accepts both delivery modes' shapes (see
 * agent/instructions.md 'Rich response widgets'): the carousel's
 * `{productDetails: […]}` wrapper and the details
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

// Exported so other shadow-DOM injections (e.g. useWidgetLoadingIndicator)
// share the same luxury-palette tokens instead of redefining them.
export const CARD_BG = "color-mix(in srgb, var(--background, #131311) 88%, white)";
export const CARD_BORDER = "1px solid rgba(247, 241, 231, 0.14)";
export const TEXT_COLOR = "var(--foreground, #f7f1e7)";
export const MUTED_COLOR = "var(--muted, rgba(247, 241, 231, 0.62))";
export const ACCENT_COLOR = "var(--accent, #b79559)";

function styled<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style: Partial<CSSStyleDeclaration>
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  Object.assign(el.style, style);
  return el;
}

/** Layout/click-routing variant for one card — see `buildCards` for what
 * `wide` and `asAnchor` each mean. */
interface BuildCardOptions {
  wide: boolean;
  asAnchor: boolean;
}

function buildCard(
  doc: Document,
  product: ProductCardData,
  onNavigate: NavigateHandler | undefined,
  { wide, asAnchor }: BuildCardOptions
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
      rail.appendChild(
        buildCard(doc, item, onNavigate, { wide: false, asAnchor })
      );
    }
    return rail;
  }

  const wrap = styled(doc, "div", {
    padding: "0.5rem 0",
    maxWidth: "17rem",
  });
  wrap.setAttribute("data-widget-card", "productDetails");
  wrap.appendChild(
    buildCard(doc, context.items[0], onNavigate, { wide: true, asAnchor })
  );
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
 * Factory for ces-messenger's rich-message system (registerTemplate) — the
 * structured-payload delivery mode, which the stock component otherwise
 * drops as a blank reply. Returns a template function receiving the
 * WidgetCardContext prepared by the payload-received hook and producing an
 * HTML string; listeners can't survive that string round-trip, so the two
 * `asAnchor` variants pick between the two click-routing strategies the
 * registration site (attachPayloadPath) chooses between at registration
 * time:
 *
 * - `asAnchor = false` (default shape): plain `div` + `data-uri` cards;
 *   clicks are routed by registerRichMessageHandler.
 * - `asAnchor = true`: native `<a href>` cards — the fallback for a
 *   ces-messenger build that lacks registerRichMessageHandler, where the
 *   div+data-uri shape would otherwise ship dead links. Native navigation
 *   is a degraded but honest path (full page load; conversation loss),
 *   preferred over a link that silently does nothing.
 */
export function makeWidgetTemplate(asAnchor: boolean): (context: unknown) => string {
  return (context: unknown): string => {
    const cardContext = context as WidgetCardContext | null;
    if (!cardContext || !Array.isArray(cardContext.items) || cardContext.items.length === 0) {
      return "";
    }
    return buildCards(document, cardContext, undefined, asAnchor).outerHTML;
  };
}

/** The default (div + data-uri) template variant — kept as a stable export
 * for existing callers/tests; equivalent to `makeWidgetTemplate(false)`. */
export const renderWidgetCardsHtml = makeWidgetTemplate(false);

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

/**
 * Finds every text node under `root` whose text ends in an incomplete
 * trailing `{@Widget: …}` invocation (still streaming in). Call after
 * `replaceWidgetTokensIn` has processed the same root, so any *complete*
 * token earlier in an originally-mixed text node has already been swapped
 * for a card and the remaining partial sits in its own text node — this
 * walk only needs to look at `findPartialTokenStart` per node, not re-derive
 * completeness itself.
 *
 * Pure and read-only: callers decide what to do with the nodes (the
 * streaming-suppression seam in useWidgetTokenRenderer hides their nearest
 * ancestor element rather than touching the node).
 */
export function findPartialTokenTextNodes(root: Node): Text[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (findPartialTokenStart(n.textContent ?? "") >= 0) {
      found.push(n as Text);
    }
  }
  return found;
}
