"use client";

import { getDomainSessionId } from "@snowplow/browser-tracker";
import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

import type { CesMessengerElement } from "@/types/ces-messenger";
import { logSignalsDemo } from "@/utils/demo";

// GitHub-distributed component (not the gstatic "chat-messenger" generation) —
// only this one documents setQueryParameters(), which is how
// SESSION_CONTEXT_VARIABLE below reaches the agent's
// `$context.variables.snowplow_session_id` binding (docs/runbook.md §9).
const WIDGET_SCRIPT_SRC =
  "https://www.gstatic.com/ces-console/fast/ces-messenger/ces-messenger.js";

// Must match the agent variable name bound via `x-ces-session-context` in
// agent/tools/get-user-context.openapi.yaml (docs/runbook.md §8.4).
const SESSION_CONTEXT_VARIABLE = "snowplow_session_id";

export function CesMessengerWidget() {
  const elementRef = useRef<CesMessengerElement | null>(null);
  const deploymentId = process.env.NEXT_PUBLIC_CES_DEPLOYMENT_ID;

  const handleLoaded = useCallback(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const sessionId = getDomainSessionId();
    if (!sessionId) {
      logSignalsDemo(
        "ces-messenger loaded with no domain_sessionid yet (new/cookieless visitor); leaving snowplow_session_id unset so the agent falls back to generic concierge behaviour"
      );
      return;
    }

    element.setQueryParameters({ [SESSION_CONTEXT_VARIABLE]: sessionId });
    logSignalsDemo("Passed domain_sessionid to ces-messenger", { sessionId });
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    element.addEventListener("ces-messenger-loaded", handleLoaded);
    return () => {
      element.removeEventListener("ces-messenger-loaded", handleLoaded);
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
        className="fixed bottom-4 right-4 z-50"
      />
    </>
  );
}
