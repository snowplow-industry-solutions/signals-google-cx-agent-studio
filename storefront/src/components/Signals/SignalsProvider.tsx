"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

import type { SignalsBatchResponse, SignalsAttributes } from "@/types/signals";
import { logSignalsDemo } from "@/utils/demo";

interface SignalsContextValue {
  attributes: SignalsAttributes | null;
  bootstrapReady: boolean;
  loading: boolean;
  error: string | null;
  fetchAttributes: (
    identifier: string,
    serviceName?: string,
    attributeKey?: string
  ) => Promise<void>;
  fetchBatchAttributes: (
    identifiers: string[],
    serviceName?: string,
    attributeKey?: string
  ) => Promise<SignalsBatchResponse>;
  markBootstrapPending: () => void;
  markBootstrapReady: (pathname?: string) => void;
  resetAttributes: () => void;
}

const SignalsContext = createContext<SignalsContextValue | null>(null);

export function SignalsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [attributes, setAttributes] = useState<SignalsAttributes | null>(null);
  const [bootstrapReadyPathname, setBootstrapReadyPathname] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAttributes = useCallback(
    async (
      identifier: string,
      serviceName = "fashion_ecommerce_demo",
      attributeKey = "domain_sessionid"
    ) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/signals/attributes?identifier=${encodeURIComponent(identifier)}&serviceName=${encodeURIComponent(serviceName)}&attributeKey=${encodeURIComponent(attributeKey)}`
        );

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? `Failed to fetch Signals attributes`);
        }

        const payload = await response.json();
        setAttributes(payload.attributes);
        logSignalsDemo("Fetched Signals attributes", payload.attributes);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to fetch Signals attributes";
        setError(message);
        console.error("[Signals Demo] Attribute fetch failed", caughtError);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchBatchAttributes = useCallback(
    async (
      identifiers: string[],
      serviceName = "fashion_ecommerce_demo",
      attributeKey = "domain_sessionid"
    ) => {
      const response = await fetch("/api/signals/attributes/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifiers,
          serviceName,
          attributeKey,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to fetch batch Signals attributes");
      }

      const payload = await response.json();
      return payload.attributes as SignalsBatchResponse;
    },
    []
  );

  const resetAttributes = useCallback(() => {
    setAttributes(null);
    setError(null);
    setLoading(false);
    logSignalsDemo("Reset Signals attributes");
  }, []);

  const markBootstrapPending = useCallback(() => {
    setBootstrapReadyPathname(null);
  }, []);

  const markBootstrapReady = useCallback(
    (resolvedPathname?: string) => {
      setBootstrapReadyPathname(resolvedPathname ?? pathname);
    },
    [pathname]
  );

  return (
    <SignalsContext.Provider
      value={{
        attributes,
        bootstrapReady: bootstrapReadyPathname === pathname,
        loading,
        error,
        fetchAttributes,
        fetchBatchAttributes,
        markBootstrapPending,
        markBootstrapReady,
        resetAttributes,
      }}
    >
      {children}
    </SignalsContext.Provider>
  );
}

export function useSignals() {
  const context = useContext(SignalsContext);
  if (!context) {
    throw new Error("useSignals must be used within a SignalsProvider");
  }

  return context;
}
