"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";

import { useCart } from "@/components/Cart/CartProvider";
import { useDemoMode } from "@/components/Demo/DemoModeProvider";
import { SignalsDebugPanel } from "@/components/Demo/SignalsDebugPanel";
import { ProductCard } from "@/components/ProductCard";
import { useSignals } from "@/components/Signals/SignalsProvider";
import type { Product } from "@/types/commerce";
import { deriveComplementaryProducts } from "@/utils/personalization";
import {
  trackDemoProductView,
  useTrackDemoProductListView,
} from "@/utils/tracking";

interface ProductPageProps {
  product: Product;
  relatedProducts: Product[];
}

export function ProductPage({ product, relatedProducts }: ProductPageProps) {
  const pathname = usePathname();
  const { attributes, bootstrapReady } = useSignals();
  const { addItem } = useCart();
  const { highlightPersonalization } = useDemoMode();

  const complementaryProducts = useMemo(
    () =>
      deriveComplementaryProducts({
        attributes,
        currentProductId: product.id,
        products: relatedProducts,
      }),
    [attributes, product.id, relatedProducts]
  );

  useTrackDemoProductListView({
    pathname,
    ready: bootstrapReady,
    listId: `${product.id}-complete-the-look`,
    listName: "Complete The Look",
    listType: "product_detail",
    items: complementaryProducts,
  });

  useEffect(() => {
    trackDemoProductView(product);
  }, [product]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10">
      <section className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div
          className="min-h-[44rem] rounded-[2.5rem] border border-white/10 bg-cover bg-center"
          style={{ backgroundImage: `url(${product.image})` }}
        />
        <div className="rounded-[2.5rem] border border-white/10 bg-(--panel) p-8 lg:p-10">
          <p className="text-[10px] uppercase tracking-[0.45em] text-[var(--muted)]">
            {product.designer}
          </p>
          <h1 className="mt-4 font-(--font-display) text-6xl text-foreground">
            {product.name}
          </h1>
          <p className="mt-4 text-2xl text-[var(--accent)]">${product.price}</p>
          <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--muted)]">
            {product.longDescription}
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[1.5rem] border border-white/10 p-4">
              <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">
                Material
              </p>
              <p className="mt-2 text-sm text-foreground">{product.material}</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 p-4">
              <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">
                Silhouette
              </p>
              <p className="mt-2 text-sm text-foreground">{product.silhouette}</p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {product.stylingNotes.map((note) => (
              <span
                key={note}
                className="rounded-full border border-white/10 px-4 py-2 text-xs text-[var(--muted)]"
              >
                {note}
              </span>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => addItem(product.id)}
              className="rounded-full bg-[var(--accent)] px-6 py-3 text-xs uppercase tracking-[0.28em] text-black"
            >
              Add To Cart
            </button>
            <a
              href="#complete-the-look"
              className="rounded-full border border-white/15 px-6 py-3 text-xs uppercase tracking-[0.28em] text-foreground"
            >
              See Styling Pairings
            </a>
          </div>
        </div>
      </section>

      <section
        id="complete-the-look"
        className={`mt-10 rounded-[2rem] border p-6 ${
          highlightPersonalization
            ? "border-[var(--accent)] bg-[var(--panel-strong)]"
            : "border-white/10 bg-(--panel)"
        }`}
      >
        <p className="text-[10px] uppercase tracking-[0.35em] text-[var(--muted)]">
          LookCompletionOnPDP
        </p>
        <h2 className="mt-3 font-(--font-display) text-5xl text-foreground">
          Complete the look.
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted)]">
          Signals is reading your in-session preferences to prioritize finishing pieces
          that suit this product and your broader edit.
        </p>
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {complementaryProducts.map((item) => (
          <ProductCard
            key={item.id}
            product={item}
            listId={`${product.id}-complete-the-look`}
            listName="Complete The Look"
            personalized
            reason="Signals selected this piece as a stylistically coherent pairing"
          />
        ))}
      </section>

      <SignalsDebugPanel currentProductId={product.id} />
    </div>
  );
}
