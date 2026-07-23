"use client";

import { useMemo } from "react";

import { useSnowplow } from "@/components/Analytics/SnowplowProvider";
import { useCart } from "@/components/Cart/CartProvider";
import { useDemoMode } from "@/components/Demo/DemoModeProvider";
import { useSignals } from "@/components/Signals/SignalsProvider";
import { products } from "@/data/products";
import { deriveDebugSummary } from "@/utils/personalization";

interface SignalsDebugPanelProps {
  currentProductId?: string;
  collectionName?: string;
}

export function SignalsDebugPanel({
  currentProductId,
  collectionName,
}: SignalsDebugPanelProps) {
  const { lineItems } = useCart();
  const { attributes } = useSignals();
  const { simulateIntervention, activeIntervention } = useSnowplow();
  const { panelOpen, togglePanel, highlightPersonalization, toggleHighlight } =
    useDemoMode();

  const summary = useMemo(
    () =>
      deriveDebugSummary({
        attributes,
        currentProductId,
        cartProductIds: lineItems.map((lineItem) => lineItem.productId),
        collectionName,
        products,
      }),
    [attributes, collectionName, currentProductId, lineItems]
  );

  return (
    <aside className="fixed bottom-4 right-4 z-50 max-w-sm rounded-[1.5rem] border border-[var(--accent)]/25 bg-[color:color-mix(in_srgb,var(--background)_92%,black)] p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.4em] text-[var(--muted)]">
            Signals Demo Panel
          </p>
          <p className="font-(--font-display) text-2xl text-foreground">
            {panelOpen ? "Live personalization" : "Panel hidden"}
          </p>
        </div>
        <button
          type="button"
          onClick={togglePanel}
          className="rounded-full border border-white/15 px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-foreground"
        >
          {panelOpen ? "Collapse" : "Open"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={toggleHighlight}
          className="rounded-full border border-[var(--accent)]/35 px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-[var(--accent)]"
        >
          {highlightPersonalization ? "Highlight On" : "Highlight Off"}
        </button>
        <button
          type="button"
          onClick={simulateIntervention}
          disabled={activeIntervention !== null}
          className="rounded-full border border-[var(--accent)]/35 px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-[var(--accent)] disabled:opacity-40"
        >
          Trigger Nudge
        </button>
      </div>

      {panelOpen ? (
        <div className="space-y-4 text-sm text-[var(--muted)]">
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.32em] text-foreground">
              Top attributes
            </p>
            <ul className="space-y-1">
              <li>Favorite category: {summary.topSignals.favoriteCategory ?? "Not available"}</li>
              <li>Favorite designer: {summary.topSignals.favoriteDesigner ?? "Not available"}</li>
              <li>Favorite occasion: {summary.topSignals.favoriteOccasion ?? "Not available"}</li>
              <li>Cart value band: {summary.topSignals.cartValueBand ?? "Not available"}</li>
            </ul>
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.32em] text-[var(--foreground)]">
              Active workflows
            </p>
            <div className="flex flex-wrap gap-2">
              {summary.activeWorkflows.length > 0 ? (
                summary.activeWorkflows.map((workflow) => (
                  <span
                    key={workflow}
                    className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em]"
                  >
                    {workflow}
                  </span>
                ))
              ) : (
                <span className="text-xs">No workflow active yet.</span>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
