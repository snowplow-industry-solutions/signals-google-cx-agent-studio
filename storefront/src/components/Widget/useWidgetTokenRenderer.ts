"use client";

import { useRouter } from "next/navigation";
import { useEffect, type RefObject } from "react";

import type { CesMessengerElement } from "@/types/ces-messenger";
import { logSignalsDemo } from "@/utils/demo";

import {
  normalizeWidgetPayload,
  renderWidgetCardsHtml,
  replaceWidgetTokensIn,
  safeCardUrl,
} from "./widgetCards";

const TEMPLATE_ID = "atelier_product_cards";

/**
 * Issue 09's client-side rich-response renderer. The CES agent's widget
 * invocations reach the browser in two shapes (docs/runbook.md §11.5), and
 * the stock open-source ces-messenger renders neither:
 *
 * 1. **In-band text tokens** — `{@Widget: …(payload: …)}` printed verbatim
 *    inside the chat bubble. Handled by watching the component's (open)
 *    shadow DOM and swapping every complete token for rendered cards.
 * 2. **Structured payloads** — `outputs[].payload` with
 *    `type: "product_detail_carousel"` and no text at all, which the stock
 *    component drops as a *blank* reply. Handled via the component's own
 *    rich-message system: a payload-received hook rewrites the payload to
 *    our registered template, and a rich-message handler routes card
 *    clicks.
 *
 * Both are no-ops while the agent runs text-only instructions — nothing
 * emits widgets, the machinery just idles.
 *
 * Card clicks stay inside the SPA via router.push: a full page load
 * remounts ces-messenger and loses the conversation (docs/demo-script.md
 * finding), so same-origin navigations must not follow the default
 * full-load path.
 */
export function useWidgetTokenRenderer(
  ref: RefObject<CesMessengerElement | null>
) {
  const router = useRouter();

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

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
      router.push(url.pathname + url.search + url.hash);
      return true;
    };

    const process = (root: Node) => {
      const replaced = replaceWidgetTokensIn(root, navigate);
      if (replaced > 0) {
        logSignalsDemo("Rendered rich-response widget token(s) in chat", {
          replaced,
        });
      }
    };

    const attachTokenObserver = (element: CesMessengerElement): boolean => {
      const shadowRoot = element.shadowRoot;
      if (!shadowRoot) return false;
      process(shadowRoot);
      observer = new MutationObserver(() => process(shadowRoot));
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

      element.registerTemplate(TEMPLATE_ID, renderWidgetCardsHtml);

      element.registerHook("payload-received", (payload) => {
        if (payload === null || typeof payload !== "object") return true;
        const p = payload as {
          template_id?: unknown;
          type?: unknown;
          context?: unknown;
        };
        // Leave payloads that already target a template alone; only claim
        // the widget-tool shapes. Observed live type discriminators
        // (2026-07-29): "product_detail_carousel" (PRODUCT_CAROUSEL) and
        // "base_product_detail" (PRODUCT_DETAILS).
        if (p.template_id !== undefined) return true;
        const isWidgetShape =
          typeof p.type === "string" && p.type.includes("product_detail");
        if (!isWidgetShape) return true;

        const context = normalizeWidgetPayload(payload);
        if (!context) return true;
        p.template_id = TEMPLATE_ID;
        p.context = context;
        logSignalsDemo("Rewrote widget payload to rich-message template", {
          kind: context.kind,
          items: context.items.length,
        });
        return true;
      });

      element.registerRichMessageHandler?.(TEMPLATE_ID, (_message, clicked) => {
        const card = clicked.closest("[data-uri]");
        const uri = card?.getAttribute("data-uri");
        if (uri) {
          const url = safeCardUrl(uri, window.location.href);
          if (!url) return { action: "keep" };
          if (!navigate(url)) window.location.assign(url.href);
        }
        return { action: "keep" };
      });

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
    };
  }, [ref, router]);
}
