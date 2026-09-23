"use client";

import { getDomainSessionId } from "@snowplow/browser-tracker";
import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

import { useWidgetConversationTracking } from "@/components/Widget/useWidgetConversationTracking";
import { useWidgetLoadingIndicator } from "@/components/Widget/useWidgetLoadingIndicator";
import { useWidgetTokenRenderer } from "@/components/Widget/useWidgetTokenRenderer";
import type { CesMessengerElement } from "@/types/ces-messenger";
import { logSignalsDemo } from "@/utils/demo";
import { getDomainUserId } from "@/utils/getDomainUserId";

// GitHub-distributed component (not the gstatic "chat-messenger" generation) —
// only this one documents setQueryParameters(), which is how
// SESSION_CONTEXT_VARIABLE below reaches the agent's
// `$context.variables.snowplow_session_id` binding (docs/setup-cx-agent-studio.md §6).
const WIDGET_SCRIPT_SRC =
  "https://www.gstatic.com/ces-console/fast/ces-messenger/ces-messenger.js";

// Must match the agent variable name bound via `x-ces-session-context` in
// agent/tools/get-user-context.openapi.yaml (docs/setup-cx-agent-studio.md §4).
const SESSION_CONTEXT_VARIABLE = "snowplow_session_id";

// Same binding pattern as SESSION_CONTEXT_VARIABLE, but for the shopper's
// domain user id; matches the SnowplowUserIdHeader binding shared by all
// three OpenAPI tool schemas (agent/tools/*.openapi.yaml).
const USER_ID_CONTEXT_VARIABLE = "snowplow_user_id";

// Armed by the conversation hook (issue 25) at mount and re-armed after every
// send, so each turn's request carries the id the browser's message events
// use; matches the TurnIdHeader binding shared by all three OpenAPI tool
// schemas.
const TURN_ID_CONTEXT_VARIABLE = "snowplow_turn_id";

// The widget's shadow styles fall back to Vue-green (#42b883) for
// --host-primary-color, which clashes hard with the luxury palette; pick up
// the site accent instead. custom-css is injected into the shadow DOM and is
// the sanctioned hook for anything the CSS variable doesn't reach.
const WIDGET_HOST_STYLE = {
  "--host-primary-color": "var(--accent)",
} as React.CSSProperties;

const WIDGET_CUSTOM_CSS = `
  button { letter-spacing: 0.08em; }
`;

// The full variable set each widget element should carry. setQueryParameters()
// replaces the whole set on every call (see CesMessengerElement), so every
// push resends everything merged so far. Callers can also run before the
// gstatic script has upgraded the element (no setQueryParameters yet): the
// merge is kept and the next push after load carries it. Keyed per element
// so the entry dies with the widget instance.
const queryParameters = new WeakMap<CesMessengerElement, Record<string, string>>();

/** Merges `params` into the element's variable set and pushes the whole set if the widget is loaded. Returns whether it pushed. */
function mergeQueryParameters(element: CesMessengerElement, params: Record<string, string>): boolean {
  const merged = { ...(queryParameters.get(element) ?? {}), ...params };
  queryParameters.set(element, merged);
  if (Object.keys(merged).length === 0 || typeof element.setQueryParameters !== "function") {
    return false;
  }
  element.setQueryParameters({ ...merged });
  return true;
}

/**
 * Sends the shopper's identity variables (domain_sessionid, domain_userid)
 * to a loaded widget element, together with anything already merged for it
 * (the conversation hook arms `snowplow_turn_id` at mount, before the widget
 * has loaded). Exported for the component test; the component calls it from
 * its loaded handler.
 */
export function sendIdentityVariables(element: CesMessengerElement) {
  // Both ids go in ONE call: setQueryParameters replaces the whole variable
  // set, so setting them one key at a time left the agent with only the
  // last one (the getUserContext-called-with-{} regression from issue 22).
  const params: Record<string, string> = {};

  const sessionId = getDomainSessionId();
  if (!sessionId) {
    logSignalsDemo(
      "ces-messenger loaded with no domain_sessionid yet (new/cookieless visitor); leaving snowplow_session_id unset so the agent falls back to generic concierge behaviour"
    );
  } else {
    params[SESSION_CONTEXT_VARIABLE] = sessionId;
  }

  const userId = getDomainUserId();
  if (!userId) {
    logSignalsDemo(
      "ces-messenger loaded with no domain_userid yet (new/cookieless visitor); leaving snowplow_user_id unset"
    );
  } else {
    params[USER_ID_CONTEXT_VARIABLE] = userId;
  }

  if (mergeQueryParameters(element, params)) {
    logSignalsDemo("Passed Snowplow identity variables to ces-messenger", params);
  }
}

export function CesMessengerWidget() {
  const elementRef = useRef<CesMessengerElement | null>(null);
  const deploymentId = process.env.NEXT_PUBLIC_CES_DEPLOYMENT_ID;

  // Issue 09: render {@Widget: …} tokens (which ces-messenger would print
  // as raw text) as product cards. Idles harmlessly while the agent runs
  // the text-only instruction variant.
  useWidgetTokenRenderer(elementRef);

  // Issue 13: typing/"still working" indicator — upstream ships none.
  useWidgetLoadingIndicator(elementRef);

  // Issue 25: message_sent/message_received conversation tracking, plus
  // concierge card-click tracking wired into useWidgetTokenRenderer's navigate.
  useWidgetConversationTracking(elementRef);

  const handleLoaded = useCallback(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    sendIdentityVariables(element);
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    // The widget dispatches ces-messenger-loaded on window, NOT on the
    // element — an element-level listener never fires and the session id
    // silently never reaches the agent. It can also have fired before this
    // effect runs (the gstatic script loads independently of hydration), so
    // treat a callable setQueryParameters as "already loaded".
    if (typeof element.setQueryParameters === "function") {
      handleLoaded();
      return;
    }

    window.addEventListener("ces-messenger-loaded", handleLoaded);
    return () => {
      window.removeEventListener("ces-messenger-loaded", handleLoaded);
    };
  }, [handleLoaded]);

  if (!deploymentId) {
    logSignalsDemo(
      "NEXT_PUBLIC_CES_DEPLOYMENT_ID is not set; ces-messenger widget disabled"
    );
    return null;
  }

  return (
    <>
      <Script src={WIDGET_SCRIPT_SRC} strategy="afterInteractive" />
      {/* Text-only: the component defaults audio-output-mode to ALWAYS_ON
          (agent speaks) and audio-input-mode to DEFAULT_ON (mic active); the
          console channel's "Interaction type: Text" setting does not reach a
          hand-authored embed. */}
      <ces-messenger
        ref={elementRef}
        deployment-id={deploymentId}
        chat-title="Atelier Concierge"
        token-broker-url="MANAGED"
        theme-id="dark"
        audio-input-mode="NONE"
        audio-output-mode="DISABLED"
        custom-css={WIDGET_CUSTOM_CSS}
        style={WIDGET_HOST_STYLE}
        className="fixed bottom-4 right-4 z-50"
      />
    </>
  );
}

// Called by the conversation hook (issue 25): once at mount to arm the first
// turn's id, then again right after each send to arm the next one (the widget
// dispatches its user-input event only after the request has gone, so an id
// set at send time would ride on the following turn). Unlike the identity
// variables above, the turn id changes every turn, but because
// setQueryParameters replaces rather than merges it travels together with
// whatever else has been merged for this element. Before the widget has
// loaded, the id is held and goes out with the identity variables.
export function setSnowplowTurnId(element: CesMessengerElement, turnId: string) {
  const pushed = mergeQueryParameters(element, { [TURN_ID_CONTEXT_VARIABLE]: turnId });
  logSignalsDemo(
    pushed
      ? "Set snowplow_turn_id on ces-messenger"
      : "Holding snowplow_turn_id until ces-messenger loads",
    { turnId }
  );
}
