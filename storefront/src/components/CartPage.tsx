"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";

import { trackCartViewedSpec } from "@/snowtype/snowplow";
import { useCart } from "@/components/Cart/CartProvider";
import { useDemoMode } from "@/components/Demo/DemoModeProvider";
import { SignalsDebugPanel } from "@/components/Demo/SignalsDebugPanel";
import { ProductCard } from "@/components/ProductCard";
import { useSignals } from "@/components/Signals/SignalsProvider";
import { products } from "@/data/products";
import { deriveCartRecommendations } from "@/utils/personalization";
import { createCartViewedTrackingProps } from "@/utils/snowtypeTracking";

export function CartPage() {
  const { lineItems, subtotal, removeItem } = useCart();
  const { attributes } = useSignals();
  const { highlightPersonalization } = useDemoMode();

  const cartProducts = lineItems
    .map((lineItem) => ({
      lineItem,
      product: products.find((product) => product.id === lineItem.productId),
    }))
    .filter(
      (
        entry
      ): entry is {
        lineItem: { productId: string; quantity: number };
        product: (typeof products)[number];
      } => Boolean(entry.product)
    );

  const recommendations = useMemo(
    () =>
      deriveCartRecommendations({
        attributes,
        cartProductIds: lineItems.map((lineItem) => lineItem.productId),
        products,
      }),
    [attributes, lineItems]
  );

  useEffect(() => {
    trackCartViewedSpec(createCartViewedTrackingProps(lineItems, products));
  }, [lineItems]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10">
      <section className="grid gap-8 lg:grid-cols-[1fr_0.8fr]">
        <div className="rounded-4xl border border-white/10 bg-(--panel) p-6">
          <p className="text-[10px] uppercase tracking-[0.35em] text-(--muted)">
            Cart
          </p>
          <h1 className="mt-3 font-(--font-display) text-5xl text-foreground">
            Your current edit.
          </h1>

          <div className="mt-8 space-y-4">
            {cartProducts.length > 0 ? (
              cartProducts.map(({ lineItem, product }) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-white/10 p-4"
                >
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-(--muted)">
                      {product.designer}
                    </p>
                    <p className="mt-1 font-(--font-display) text-3xl text-foreground">
                      {product.name}
                    </p>
                    <p className="mt-2 text-sm text-(--muted)">
                      Quantity {lineItem.quantity} · ${product.price}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(product.id)}
                    className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.24em] text-foreground"
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-white/10 p-6 text-sm text-(--muted)">
                Your cart is empty. Add a few pieces to activate the cart styling companion.
              </div>
            )}
          </div>
        </div>

        <aside className="rounded-[2rem] border border-white/10 bg-(--panel) p-6">
          <p className="text-[10px] uppercase tracking-[0.35em] text-(--muted)">
            Order summary
          </p>
          <p className="mt-3 font-(--font-display) text-5xl text-foreground">
            ${subtotal}
          </p>
          <p className="mt-4 text-sm leading-7 text-(--muted)">
            This demo cart intentionally emphasizes styling cohesion over transactional
            nudges. The recommendation block below is driven by in-session Signals
            attributes and the contents of the basket.
          </p>
          <Link
            href="/checkout"
            className="mt-8 inline-flex rounded-full bg-[var(--accent)] px-6 py-3 text-xs uppercase tracking-[0.28em] text-black"
          >
            Continue To Checkout
          </Link>
        </aside>
      </section>

      <section
        className={`mt-8 rounded-[2rem] border p-6 ${
          highlightPersonalization
            ? "border-[var(--accent)] bg-[var(--panel-strong)]"
            : "border-white/10 bg-(--panel)"
        }`}
      >
        <p className="text-[10px] uppercase tracking-[0.35em] text-(--muted)">
          CartStylingCompanion
        </p>
        <h2 className="mt-3 font-(--font-display) text-5xl text-foreground">
          A finishing piece for the basket.
        </h2>
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        {recommendations.map((recommendation) => {
          const product = products.find((candidate) => candidate.id === recommendation.productId);
          if (!product) {
            return null;
          }

          return (
            <ProductCard
              key={product.id}
              product={product}
              listId="cart-styling-companion"
              listName="Cart Styling Companion"
              personalized
              reason={recommendation.reason}
            />
          );
        })}
      </section>

      <SignalsDebugPanel />
    </div>
  );
}
