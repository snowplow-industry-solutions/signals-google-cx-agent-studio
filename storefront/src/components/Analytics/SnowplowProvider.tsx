"use client";

import {
  addInterventionHandlers,
  SignalsPlugin,
  subscribeToInterventions,
} from "@snowplow/signals-browser-plugin";
import {
  addGlobalContexts,
  newSession,
  newTracker,
  removeGlobalContexts,
} from "@snowplow/browser-tracker";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useSignals } from "@/components/Signals/SignalsProvider";
import type { Intervention } from "@/types/signals";
import { logSignalsDemo } from "@/utils/demo";
import { getSessionId } from "@/utils/getSessionId";
import { createUserContext } from "@/utils/userTracking";
import { useSessionMonitor } from "@/utils/useSessionMonitor";

interface SnowplowContextValue {
  activeIntervention: Intervention | null;
  dismissIntervention: () => void;
  simulateIntervention: () => void;
}

const SnowplowContext = createContext<SnowplowContextValue | null>(null);
const TRACKER_NAME = "fashion_demo";
const GLOBAL_USER_CONTEXT_KEY = "user";

let trackerReady = false;
let resolveTrackerReady: (() => void) | null = null;
let trackerReadyPromise = createTrackerReadyPromise();

function createTrackerReadyPromise() {
  return new Promise<void>((resolve) => {
    resolveTrackerReady = resolve;
  });
}

function markTrackerReady() {
  if (trackerReady) {
    return;
  }

  trackerReady = true;
  resolveTrackerReady?.();
}

export function waitForSnowplowTracker() {
  return trackerReady ? Promise.resolve() : trackerReadyPromise;
}

export function resetSnowplowTrackerReadyForTests() {
  trackerReady = false;
  trackerReadyPromise = createTrackerReadyPromise();
}

function subscribeToSignals(sessionId: string | null) {
  const endpoint = process.env.NEXT_PUBLIC_SIGNALS_INTERVENTIONS_ENDPOINT;
  if (!endpoint || !sessionId) {
    return;
  }

  subscribeToInterventions({
    endpoint,
    attributeKeyIds: {
      domain_sessionid: sessionId,
    },
  });

  logSignalsDemo("Subscribed to interventions", { endpoint, sessionId });
}

export function SnowplowProvider({ children }: { children: React.ReactNode }) {
  const { attributes } = useSignals();
  const [activeIntervention, setActiveIntervention] = useState<Intervention | null>(
    null
  );

  useEffect(() => {
    const collectorUrl = process.env.NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL;
    if (!collectorUrl) {
      logSignalsDemo(
        "NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL is not set; Snowplow tracking disabled"
      );
      return;
    }

    newTracker(TRACKER_NAME, collectorUrl, {
      appId: "signals-workshop-fashion-demo",
      platform: "web",
      contexts: {
        webPage: true,
      },
      plugins: [SignalsPlugin()],
    });

    addInterventionHandlers({
      stylistIntervention(intervention) {
        setActiveIntervention(intervention);
        logSignalsDemo("Received stylist intervention", intervention);
      },
    });

    markTrackerReady();
    const sessionId = getSessionId();
    subscribeToSignals(sessionId);
    logSignalsDemo("Snowplow tracker initialized", collectorUrl);
  }, []);

  useEffect(() => {
    const userContext = createUserContext(attributes);

    removeGlobalContexts([GLOBAL_USER_CONTEXT_KEY], [TRACKER_NAME]);
    addGlobalContexts(
      {
        [GLOBAL_USER_CONTEXT_KEY]: userContext,
      },
      [TRACKER_NAME]
    );
  }, [attributes]);

  useSessionMonitor((newSessionId) => {
    if (!newSessionId) {
      newSession([TRACKER_NAME]);
      subscribeToSignals(getSessionId());
      return;
    }
    subscribeToSignals(newSessionId);
  });

  const dismissIntervention = useCallback(() => {
    setActiveIntervention(null);
  }, []);

  const simulateIntervention = useCallback(() => {
    const flatAttrs: Record<string, string | number | boolean | (string | number | boolean)[]> = {};
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value === null || value === undefined) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          flatAttrs[key] = value;
        } else if (Array.isArray(value)) {
          flatAttrs[key] = value as (string | number | boolean)[];
        }
      }
    }
    const mock: Intervention = {
      intervention_id: crypto.randomUUID(),
      name: "stylistIntervention",
      version: 1,
      attributes: flatAttrs,
    };
    setActiveIntervention(mock);
    logSignalsDemo("Simulated stylist intervention", mock);
  }, [attributes]);

  const value = useMemo(
    () => ({
      activeIntervention,
      dismissIntervention,
      simulateIntervention,
    }),
    [activeIntervention, dismissIntervention, simulateIntervention]
  );

  return (
    <SnowplowContext.Provider value={value}>
      {children}
    </SnowplowContext.Provider>
  );
}

export function useSnowplow() {
  const context = useContext(SnowplowContext);
  if (!context) {
    throw new Error("useSnowplow must be used within a SnowplowProvider");
  }

  return context;
}
