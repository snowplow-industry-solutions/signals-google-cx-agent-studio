"use client";

import { useRouter } from "next/navigation";
import { useEffect, type RefObject } from "react";

import {
  trackConciergeCardClick,
  trackConciergeCardsShown,
} from "@/components/Widget/useWidgetConversationTracking";
import {
  makeWidgetTemplate,
  normalizeWidgetPayload,
  replaceWidgetTokensIn,
  safeCardUrl,
  type WidgetCardContext,
} from "@/components/Widget/widgetCards";
import { createPartialTokenVisibility } from "@/components/Widget/widgetTokenVisibility";
import type { CesMessengerElement } from "@/types/ces-messenger";
import { logSignalsDemo } from "@/utils/demo";

const TEMPLATE_ID = "atelier_product_cards";

/**
 * The client-side rich-response renderer. The CES agent's widget
 * invocations reach the browser in two shapes (see agent/instructions.md
 * 'Rich response widgets'), and
 * the stock open-source ces-messenger renders neither:
 *
 * 1. **In-band text tokens** — `{@Widget: …(payload: …)}` printed verbatim
 *    inside the chat bubble. Handled by watching the component's (open)
 *    shadow DOM and swapping every complete token for rendered cards. A
 *    trailing *incomplete* token (still streaming in) is never shown raw
 *    either: createPartialTokenVisibility hides the nearest ancestor
 *    element of that text — without touching the node's content, since
 *    ces-messenger owns and rewrites it every tick — until the token
 *    completes or a safety timeout reveals it.
 * 2. **Structured payloads** — `outputs[].payload` with
 *    `type: "product_detail_carousel"` and no text at all, which the stock
 *    component drops as a *blank* reply. Handled via the component's own
 *    rich-message system: a payload-received hook rewrites the payload to
 *    our registered template. Click routing is decided once, at
 *    registration time: a build exposing
 *    registerRichMessageHandler gets the div+data-uri template with clicks
 *    routed through it; a build that lacks that method gets the anchor
 *    template instead, so links stay live (native navigation) rather than
 *    silently dead. A registration-time payload that fails
 *    normalizeWidgetPayload is not silently dropped — it's
 *    logged via logSignalsDemo so the presenter can see why a reply came
 *    back blank.
 *
 * Both are no-ops while the agent runs text-only instructions — nothing
 * emits widgets, the machinery just idles.
 *
 * Card clicks stay inside the SPA via router.push: a full page load
 * remounts ces-messenger and loses the conversation, so same-origin
 * navigations must not follow the default full-load path.
 *
 * Rendering cards on either path counts as an impression of the concierge
 * list (trackConciergeCardsShown), pairing with the card-click tracking so
 * the placement reports views as well as clicks like every other product
 * list on the storefront. Each path already fires exactly once per widget
 * (a token is replaced once; the payload hook runs once per payload), so no
 * extra dedupe is needed here.
 */
export function useWidgetTokenRenderer(
  ref: RefObject<CesMessengerElement | null>
) {
  const router = useRouter();

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const partialVisibility = createPartialTokenVisibility();

    const navigate = (url: URL): boolean => {
      // Widget payloads carry the *deployed* storefront's absolute URLs
      // (agent instructions build uri from the production base), so a
      // strict same-origin check would full-load production from a local
      // dev session. Storefront routes are the same app on any origin —
      // route them through the SPA router by path.
      const internal =
        url.origin === window.location.origin ||
        /^\/(products|collections)\//.test(url.pathname);
      if (!internal) return false;
      trackConciergeCardClick(url);
      router.push(url.pathname + url.search + url.hash);
      return true;
    };

    const onCardsRendered = (context: WidgetCardContext) => {
      trackConciergeCardsShown(context.items);
    };

    const replaceTokensUnder = (root: Node) => {
      const replaced = replaceWidgetTokensIn(root, navigate, onCardsRendered);
      // Runs after the replace pass so a token that just completed is
      // already a card by the time visibility re-checks for a partial.
      partialVisibility.process(root);
      if (replaced > 0) {
        logSignalsDemo("Rendered rich-response widget token(s) in chat", {
          replaced,
        });
      }
    };

    const attachTokenObserver = (element: CesMessengerElement): boolean => {
      const shadowRoot = element.shadowRoot;
      if (!shadowRoot) return false;
      replaceTokensUnder(shadowRoot);
      observer = new MutationObserver(() => replaceTokensUnder(shadowRoot));
      observer.observe(shadowRoot, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      return true;
    };

    const attachPayloadPath = (element: CesMessengerElement): boolean => {
      if (
        typeof element.registerTemplate !== "function" ||
        typeof element.registerHook !== "function"
      ) {
        return false;
      }

      // Link strategy is decided once, here, at registration time — not
      // re-checked per render. A build that exposes
      // registerRichMessageHandler gets the current div+data-uri cards with
      // clicks routed through it; otherwise cards render as native anchors
      // (the safeCardUrl-gated href) so links stay live via plain
      // browser navigation instead of shipping dead div+data-uri cards no
      // click handler will ever route. Never
      // register both mechanisms for one build.
      const richMessageHandler = element.registerRichMessageHandler;
      element.registerTemplate(
        TEMPLATE_ID,
        makeWidgetTemplate(typeof richMessageHandler !== "function")
      );

      element.registerHook("payload-received", (payload) => {
        if (payload === null || typeof payload !== "object") return true;
        const p = payload as {
          template_id?: unknown;
          type?: unknown;
          context?: unknown;
        };
        // Leave payloads that already target a template alone; only claim
        // the widget-tool shapes. Observed live type discriminators:
        // "product_detail_carousel" (PRODUCT_CAROUSEL) and
        // "base_product_detail" (PRODUCT_DETAILS).
        if (p.template_id !== undefined) return true;
        const isWidgetShape =
          typeof p.type === "string" && p.type.includes("product_detail");
        if (!isWidgetShape) return true;

        const context = normalizeWidgetPayload(payload);
        if (!context) {
          // Claimed the payload but couldn't normalise it (e.g. missing
          // title) — the hook still returns true, so the stock component
          // falls through to its own (blank) handling of this reply. No
          // invented fallback content in chat; at minimum, make the
          // failure observable to the presenter.
          logSignalsDemo("Widget payload unrenderable — reply will be blank", {
            type: p.type,
          });
          return true;
        }
        p.template_id = TEMPLATE_ID;
        p.context = context;
        // The template renders these items straight after this hook returns,
        // so the impression is counted here where the payload is seen once.
        onCardsRendered(context);
        logSignalsDemo("Rewrote widget payload to rich-message template", {
          kind: context.kind,
          items: context.items.length,
        });
        return true;
      });

      if (typeof richMessageHandler === "function") {
        richMessageHandler(TEMPLATE_ID, (_message, clicked) => {
          const card = clicked.closest("[data-uri]");
          const uri = card?.getAttribute("data-uri");
          if (uri) {
            const url = safeCardUrl(uri, window.location.href);
            if (!url) return { action: "keep" };
            if (!navigate(url)) window.location.assign(url.href);
          }
          return { action: "keep" };
        });
      }

      return true;
    };

    // The gstatic script upgrades <ces-messenger> (creating its shadow root
    // and instance methods) independently of React hydration, so poll until
    // both integration points attach — the ces-messenger-loaded event can
    // fire before this effect runs.
    let tokenPathReady = false;
    let payloadPathReady = false;
    const attach = (): boolean => {
      const element = ref.current;
      if (!element) return false;
      if (!tokenPathReady) tokenPathReady = attachTokenObserver(element);
      if (!payloadPathReady) payloadPathReady = attachPayloadPath(element);
      return tokenPathReady && payloadPathReady;
    };

    if (!attach()) {
      pollTimer = setInterval(() => {
        if (attach() && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }, 500);
    }

    return () => {
      observer?.disconnect();
      if (pollTimer) clearInterval(pollTimer);
      partialVisibility.dispose();
    };
  }, [ref, router]);
}
