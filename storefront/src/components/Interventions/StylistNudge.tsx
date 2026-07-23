"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSnowplow } from "@/components/Analytics/SnowplowProvider";
import { useDemoMode } from "@/components/Demo/DemoModeProvider";
import { products } from "@/data/products";
import type { Product } from "@/types/commerce";
import type { Intervention } from "@/types/signals";
import { logSignalsDemo } from "@/utils/demo";

const AUTO_DISMISS_MS = 12_000;

function resolveNudgeProduct(intervention: Intervention): Product | null {
  const a = intervention.attributes;

  const viewedIds = new Set(
    Array.isArray(a.recently_viewed_product_ids)
      ? a.recently_viewed_product_ids.map(String)
      : []
  );

  const unseen = products.filter((p) => !viewedIds.has(p.id));
  const candidates = unseen.length > 0 ? unseen : products;

  const favCategory = typeof a.favorite_category === "string" ? a.favorite_category : null;
  const favOccasion = typeof a.favorite_occasion === "string" ? a.favorite_occasion : null;
  const favDesigner = typeof a.favorite_designer === "string" ? a.favorite_designer : null;
  const favColor = typeof a.favorite_color_family === "string" ? a.favorite_color_family : null;

  let best: Product | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    let score = 0;
    if (favCategory && candidate.category === favCategory) score += 5;
    if (favOccasion && candidate.occasion === favOccasion) score += 4;
    if (favDesigner && candidate.designer === favDesigner) score += 3;
    if (favColor && candidate.colorFamily === favColor) score += 2;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

export function StylistNudge() {
  const { activeIntervention, dismissIntervention } = useSnowplow();
  const { highlightPersonalization } = useDemoMode();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interventionIdRef = useRef<string | null>(null);

  const nudgeProduct = useMemo(() => {
    if (!activeIntervention) return null;
    return resolveNudgeProduct(activeIntervention);
  }, [activeIntervention]);

  useEffect(() => {
    if (!activeIntervention || !nudgeProduct) return;

    interventionIdRef.current = activeIntervention.intervention_id;

    logSignalsDemo("Stylist nudge displayed", {
      productName: nudgeProduct.name,
      interventionId: activeIntervention.intervention_id,
    });

    const enterTimer = setTimeout(() => setVisible(true), 50);

    timerRef.current = setTimeout(() => {
      logSignalsDemo("Stylist nudge dismissed", {
        reason: "auto",
        interventionId: interventionIdRef.current,
      });
      setVisible(false);
      setTimeout(dismissIntervention, 300);
    }, AUTO_DISMISS_MS);

    return () => {
      setVisible(false);
      clearTimeout(enterTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeIntervention, nudgeProduct, dismissIntervention]);

  const handleDismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    logSignalsDemo("Stylist nudge dismissed", {
      reason: "manual",
      interventionId: interventionIdRef.current,
    });
    setVisible(false);
    setTimeout(dismissIntervention, 300);
  }, [dismissIntervention]);

  const handleCtaClick = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    logSignalsDemo("Stylist nudge CTA clicked", {
      targetProductSlug: nudgeProduct?.slug,
      interventionId: interventionIdRef.current,
    });
  }, [nudgeProduct]);

  if (!activeIntervention || !nudgeProduct) return null;

  const favoriteOccasion =
    typeof activeIntervention.attributes.favorite_occasion === "string"
      ? activeIntervention.attributes.favorite_occasion.toLowerCase()
      : null;

  return (
    <aside
      className={`fixed bottom-4 left-4 z-50 w-[22rem] rounded-[1.5rem] border p-5 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${
        highlightPersonalization
          ? "border-[var(--accent)] bg-[var(--panel-strong)]"
          : "border-[var(--accent)]/25 bg-[color:color-mix(in_srgb,var(--background)_92%,black)]"
      }`}
    >
      {highlightPersonalization && (
        <p className="mb-2 text-[10px] uppercase tracking-[0.35em] text-[var(--muted)]">
          StylistNudgeIntervention
        </p>
      )}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.4em] text-[var(--accent)]">
          Your Stylist Suggests
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 text-xs text-[var(--muted)] transition-colors hover:text-foreground"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>

      <div className="mb-3 flex gap-3">
        <div
          className="h-16 w-16 shrink-0 rounded-xl border border-white/10 bg-cover bg-center"
          style={{ backgroundImage: `url(${nudgeProduct.thumbnail})` }}
        />
        <div className="min-w-0">
          <p className="font-(--font-display) text-lg leading-snug text-foreground">
            {nudgeProduct.name}
          </p>
          <p className="text-xs text-[var(--muted)]">{nudgeProduct.designer}</p>
        </div>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        {favoriteOccasion
          ? `Based on your ${favoriteOccasion} taste, our stylist recommends the ${nudgeProduct.name} \u2014 a piece you haven\u2019t explored yet.`
          : `Our stylist selected the ${nudgeProduct.name} based on your browsing \u2014 a piece you haven\u2019t explored yet.`}
      </p>

      <Link
        href={`/products/${nudgeProduct.slug}`}
        onClick={handleCtaClick}
        className="inline-block rounded-full bg-[var(--accent)] px-5 py-2.5 text-[10px] uppercase tracking-[0.28em] text-black transition-opacity hover:opacity-90"
      >
        View Recommendation
      </Link>
    </aside>
  );
}
