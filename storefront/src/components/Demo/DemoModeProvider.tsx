"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

import { getInitialDemoMode, logSignalsDemo } from "@/utils/demo";

interface DemoModeContextValue {
  highlightPersonalization: boolean;
  panelOpen: boolean;
  toggleHighlight: () => void;
  togglePanel: () => void;
}

const DemoModeContext = createContext<DemoModeContextValue | null>(null);

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const [highlightPersonalization, setHighlightPersonalization] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return getInitialDemoMode(window.location.search).highlight;
  });
  const [panelOpen, setPanelOpen] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return getInitialDemoMode(window.location.search).panelOpen;
  });

  const value = useMemo(
    () => ({
      highlightPersonalization,
      panelOpen,
      toggleHighlight: () => {
        setHighlightPersonalization((current) => {
          const next = !current;
          logSignalsDemo("Highlight personalization toggled", next);
          return next;
        });
      },
      togglePanel: () => {
        setPanelOpen((current) => !current);
      },
    }),
    [highlightPersonalization, panelOpen]
  );

  return (
    <DemoModeContext.Provider value={value}>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  const context = useContext(DemoModeContext);
  if (!context) {
    throw new Error("useDemoMode must be used within a DemoModeProvider");
  }

  return context;
}
