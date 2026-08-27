"use client";

import { useEffect, type RefObject } from "react";

import {
  ACCENT_COLOR,
  CARD_BG,
  CARD_BORDER,
  MUTED_COLOR,
} from "@/components/Widget/widgetCards";
import type { CesMessengerElement } from "@/types/ces-messenger";

/**
 * The typing/loading indicator. Upstream `ces-messenger` ships no
 * built-in indicator and no config for one (checked against the
 * GoogleCloudPlatform/ces-messenger docs), so this builds one
 * client-side from the component's send/receive/failure events, on the same
 * shadow-DOM injection surface `useWidgetTokenRenderer` already
 * uses.
 *
 * Event names (`ces-user-input-entered`, `ces-text-sent`, `ces-message-sent`,
 * `ces-message-received`, `ces-text-received`, `ces-payload-received`,
 * `ces-messenger-disconnected`, `ces-authentication-error`) are doc-derived,
 * same unversioned-gstatic-script caveat as the renderer: unverifiable
 * without a browser and a live agent to test against. Every listener is wired
 * defensively — attached to both `window` (the confirmed dispatch target for
 * `ces-messenger-loaded`, see CesMessengerWidget) and the element itself (in
 * case a given build dispatches there instead), and every handler tolerates
 * an event firing zero, one, or many times without throwing. A human should
 * confirm the live event names/targets and adjust here if they differ.
 *
 * Coexistence with the token renderer: the injected node carries no
 * `{@Widget:` text, so it is inert to `replaceWidgetTokensIn` and
 * `createPartialTokenVisibility` — showing/hiding it never fights their
 * MutationObserver-driven passes over the same shadow root.
 */

const SEND_EVENTS = [
  "ces-user-input-entered",
  "ces-text-sent",
  "ces-message-sent",
] as const;

const RECEIVE_EVENTS = [
  "ces-message-received",
  "ces-text-received",
  "ces-payload-received",
] as const;

const FAILURE_EVENTS = [
  "ces-messenger-disconnected",
  "ces-authentication-error",
] as const;

const INDICATOR_ATTR = "data-widget-loading-indicator";
const DOTS_ATTR = "data-widget-loading-indicator-dots";

/** Force-swap to the "still working" cue when no reply has arrived. */
const STILL_WORKING_TIMEOUT_MS = 30000;

/**
 * Finds the best insertion point for the indicator. The live message list is
 * a `<ul>` of `<li class="from-bot ...">` / `<li class="from-user ...">`
 * items (captured verbatim from the live widget markup, see
 * widgetCards.test.ts / widgetTokenVisibility.test.ts fixtures) — that's a
 * best-effort match, not a documented contract, so it falls back to any
 * `<ul>` and finally to the shadow root itself, which always exists.
 */
function findMessageListContainer(shadowRoot: ShadowRoot): Element | ShadowRoot {
  const existingMessage = shadowRoot.querySelector("li.from-bot, li.from-user");
  if (existingMessage?.parentElement) return existingMessage.parentElement;
  return shadowRoot.querySelector("ul") ?? shadowRoot;
}

function createIndicatorElement(doc: Document): HTMLElement {
  const bubble = doc.createElement("li");
  bubble.setAttribute(INDICATOR_ATTR, "typing");
  bubble.setAttribute("role", "status");
  bubble.setAttribute("aria-live", "polite");
  Object.assign(bubble.style, {
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
    width: "fit-content",
    margin: "0.25rem 0",
    padding: "0.5rem 0.75rem",
    borderRadius: "999px",
    background: CARD_BG,
    border: CARD_BORDER,
    color: MUTED_COLOR,
    fontSize: "0.75rem",
    letterSpacing: "0.08em",
  } satisfies Partial<CSSStyleDeclaration>);

  const label = doc.createElement("span");
  label.setAttribute(DOTS_ATTR, "");
  label.textContent = "● ● ●";
  label.style.color = ACCENT_COLOR;
  bubble.appendChild(label);

  return bubble;
}

function setStillWorking(bubble: HTMLElement): void {
  bubble.setAttribute(INDICATOR_ATTR, "stalled");
  const label = bubble.querySelector<HTMLElement>(`[${DOTS_ATTR}]`);
  if (label) {
    label.textContent = "Still working…";
    label.style.color = MUTED_COLOR;
  }
}

export function useWidgetLoadingIndicator(
  ref: RefObject<CesMessengerElement | null>
) {
  useEffect(() => {
    let indicator: HTMLElement | null = null;
    let stillWorkingTimer: ReturnType<typeof setTimeout> | null = null;

    const clearStillWorkingTimer = () => {
      if (stillWorkingTimer) {
        clearTimeout(stillWorkingTimer);
        stillWorkingTimer = null;
      }
    };

    const removeIndicator = () => {
      clearStillWorkingTimer();
      indicator?.remove();
      indicator = null;
    };

    const handleSend = () => {
      // Idempotent: several send events can fire for a single shopper
      // message (input-entered, text-sent, message-sent), and must not
      // stack duplicate bubbles or reset an already-running timeout.
      if (indicator) return;

      const element = ref.current;
      const shadowRoot = element?.shadowRoot;
      if (!shadowRoot) return;

      const doc = shadowRoot.ownerDocument;
      indicator = createIndicatorElement(doc);
      findMessageListContainer(shadowRoot).appendChild(indicator);

      stillWorkingTimer = setTimeout(() => {
        if (indicator) setStillWorking(indicator);
      }, STILL_WORKING_TIMEOUT_MS);
    };

    const handleReceive = () => {
      // A late reply must still clear the "still working" cue, not just the
      // initial typing state.
      removeIndicator();
    };

    const handleFailure = () => {
      removeIndicator();
    };

    const target = ref.current;
    const listenerTargets: EventTarget[] = target ? [window, target] : [window];

    for (const eventTarget of listenerTargets) {
      for (const name of SEND_EVENTS) eventTarget.addEventListener(name, handleSend);
      for (const name of RECEIVE_EVENTS)
        eventTarget.addEventListener(name, handleReceive);
      for (const name of FAILURE_EVENTS)
        eventTarget.addEventListener(name, handleFailure);
    }

    return () => {
      for (const eventTarget of listenerTargets) {
        for (const name of SEND_EVENTS)
          eventTarget.removeEventListener(name, handleSend);
        for (const name of RECEIVE_EVENTS)
          eventTarget.removeEventListener(name, handleReceive);
        for (const name of FAILURE_EVENTS)
          eventTarget.removeEventListener(name, handleFailure);
      }
      removeIndicator();
    };
  }, [ref]);
}
