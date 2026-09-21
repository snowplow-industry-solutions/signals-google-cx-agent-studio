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

// Set once per send by the conversation hook (issue 25), not on load; matches
// the TurnIdHeader binding shared by all three OpenAPI tool schemas.
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

// Last variable set handed to each widget element. setQueryParameters()
// replaces the whole set on every call (see CesMessengerElement), so every
// later call must resend what came before. Keyed per element so the entry
// dies with the widget instance.
const lastSentQueryParameters = new WeakMap<CesMessengerElement, Record<string, string>>();

function sendQueryParameters(element: CesMessengerElement, params: Record<string, string>) {
  lastSentQueryParameters.set(element, params);
  element.setQueryParameters({ ...params });
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

    if (Object.keys(params).length === 0) {
      return;
    }

    sendQueryParameters(element, params);
    logSignalsDemo("Passed Snowplow identity variables to ces-messenger", params);
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

// Called by the conversation hook (issue 25) right before each send, with
// the same element the other widget hooks already receive via elementRef.
// Unlike the session/user id variables above, the turn id is per-turn, not
// set-once-on-load -- but because setQueryParameters replaces rather than
// merges, it is resent together with whatever handleLoaded last sent, or the
// first send would wipe the session and user ids again.
export function setSnowplowTurnId(element: CesMessengerElement, turnId: string) {
  sendQueryParameters(element, {
    ...(lastSentQueryParameters.get(element) ?? {}),
    [TURN_ID_CONTEXT_VARIABLE]: turnId,
  });
  logSignalsDemo("Set snowplow_turn_id on ces-messenger", { turnId });
}
