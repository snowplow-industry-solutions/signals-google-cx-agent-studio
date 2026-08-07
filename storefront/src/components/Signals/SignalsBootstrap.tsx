"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { waitForSnowplowTracker } from "@/components/Analytics/SnowplowProvider";
import { useSignals } from "@/components/Signals/SignalsProvider";
import { getSessionId } from "@/utils/getSessionId";
import { trackDemoPageView } from "@/utils/tracking";
import { useSessionMonitor } from "@/utils/useSessionMonitor";

export function SignalsBootstrap() {
  const pathname = usePathname();
  const {
    fetchAttributes,
    markBootstrapPending,
    markBootstrapReady,
    resetAttributes,
  } = useSignals();

  useEffect(() => {
    let cancelled = false;
    markBootstrapPending();

    const syncTracking = async () => {
      try {
        await waitForSnowplowTracker();
        if (cancelled) {
          return;
        }

        trackDemoPageView(pathname);

        const sessionId = getSessionId();
        if (sessionId) {
          await fetchAttributes(sessionId);
        }
      } finally {
        if (!cancelled) {
          markBootstrapReady(pathname);
        }
      }
    };

    void syncTracking();

    return () => {
      cancelled = true;
    };
  }, [fetchAttributes, markBootstrapPending, markBootstrapReady, pathname]);

  useSessionMonitor((newSessionId) => {
    resetAttributes();
    if (newSessionId) {
      void fetchAttributes(newSessionId);
    }
  });

  return null;
}
