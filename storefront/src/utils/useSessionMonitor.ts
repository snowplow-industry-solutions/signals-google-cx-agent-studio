"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { logSignalsDemo } from "@/utils/demo";
import { getSessionId } from "@/utils/getSessionId";

export function useSessionMonitor(
  onSessionChange: (newSessionId: string | null, previousSessionId: string | null) => void,
  checkInterval = 5000
) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() =>
    getSessionId()
  );
  const previousSessionId = useRef<string | null>(currentSessionId);

  useEffect(() => {
    logSignalsDemo("Initial session detected", currentSessionId);
  }, [currentSessionId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextSessionId = getSessionId();

      if (nextSessionId === previousSessionId.current) {
        return;
      }

      logSignalsDemo("Session changed", {
        previous: previousSessionId.current,
        next: nextSessionId,
      });

      const oldSessionId = previousSessionId.current;
      previousSessionId.current = nextSessionId;
      setCurrentSessionId(nextSessionId);
      onSessionChange(nextSessionId, oldSessionId);
    }, checkInterval);

    return () => window.clearInterval(intervalId);
  }, [checkInterval, onSessionChange]);

  const checkNow = useCallback(() => {
    const nextSessionId = getSessionId();
    if (nextSessionId !== previousSessionId.current) {
      const oldSessionId = previousSessionId.current;
      previousSessionId.current = nextSessionId;
      setCurrentSessionId(nextSessionId);
      onSessionChange(nextSessionId, oldSessionId);
    }

    return nextSessionId;
  }, [onSessionChange]);

  return {
    currentSessionId,
    checkNow,
  };
}
