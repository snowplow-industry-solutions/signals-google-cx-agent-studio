"use client";

import { useEffect, useState } from "react";

import {
  trackCheckoutCompletedSpec,
  trackCheckoutStartedSpec,
  trackCheckoutStepViewedSpec,
} from "@/snowtype/snowplow";
import { useCart } from "@/components/Cart/CartProvider";
import { useDemoMode } from "@/components/Demo/DemoModeProvider";
import { SignalsDebugPanel } from "@/components/Demo/SignalsDebugPanel";
import { useSignals } from "@/components/Signals/SignalsProvider";
import { products } from "@/data/products";
import {
  createCheckoutCompletedTrackingProps,
  createCheckoutStepTrackingProps,
} from "@/utils/snowtypeTracking";

const checkoutSteps = ["shipping", "payment", "review"] as const;
type CheckoutStep = (typeof checkoutSteps)[number];

export function CheckoutPage() {
  const { lineItems, subtotal, clearCart } = useCart();
  const { attributes } = useSignals();
  const { highlightPersonalization } = useDemoMode();
  const [step, setStep] = useState<CheckoutStep>("shipping");

  useEffect(() => {
    const tracking = createCheckoutStepTrackingProps(step, lineItems, products);

    if (tracking.kind === "started") {
      trackCheckoutStartedSpec(tracking.props);
      return;
    }

    trackCheckoutStepViewedSpec(tracking.props);
  }, [lineItems, step]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 lg:px-10">
      <section className="rounded-[2.5rem] border border-white/10 bg-(--panel) p-8 lg:p-10">
        <p className="text-[10px] uppercase tracking-[0.4em] text-[var(--muted)]">
          CheckoutConfidenceLayer
        </p>
        <h1 className="mt-4 font-(--font-display) text-6xl text-foreground">
          Your edit is already coherent.
        </h1>
        <p className="mt-6 max-w-3xl text-base leading-8 text-[var(--muted)]">
          This checkout flow is designed for demo purposes: it highlights how Signals
          can reassure a high-intent shopper by reflecting the visual logic of the
          basket rather than pushing a discount.
        </p>

        <div
          className={`mt-8 rounded-[2rem] border p-6 ${
            highlightPersonalization
              ? "border-[var(--accent)] bg-[var(--panel-strong)]"
              : "border-white/10 bg-black/15"
          }`}
        >
          <p className="text-[10px] uppercase tracking-[0.35em] text-[var(--muted)]">
            Signals readout
          </p>
          <h2 className="mt-3 font-(--font-display) text-4xl text-foreground">
            {attributes?.favorite_occasion === "Evening"
              ? "Your current selection forms a complete evening edit."
              : "Your selected pieces hold together as a polished city wardrobe."}
          </h2>
          <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
            Favorite category: {attributes?.favorite_category ?? "pending"} · Favorite designer:{" "}
            {attributes?.favorite_designer ?? "pending"} · Cart value band:{" "}
            {attributes?.cart_value_band ?? "pending"}
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          {checkoutSteps.map((checkoutStep) => (
            <button
              key={checkoutStep}
              type="button"
              onClick={() => setStep(checkoutStep)}
              className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.24em] ${
                step === checkoutStep
                  ? "bg-[var(--accent)] text-black"
                  : "border border-white/15 text-foreground"
              }`}
            >
              {checkoutStep}
            </button>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between gap-6 rounded-[1.5rem] border border-white/10 p-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">
              Order total · {step}
            </p>
            <p className="mt-2 font-(--font-display) text-5xl text-foreground">
              ${subtotal}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              trackCheckoutCompletedSpec(
                createCheckoutCompletedTrackingProps(lineItems, products)
              );
              clearCart();
            }}
            className="rounded-full bg-[var(--accent)] px-6 py-3 text-xs uppercase tracking-[0.28em] text-black"
          >
            Place Demo Order
          </button>
        </div>
      </section>

      <SignalsDebugPanel />
    </div>
  );
}
