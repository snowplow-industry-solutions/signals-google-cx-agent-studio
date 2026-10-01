"use client";

import Link from "next/link";

import { trackProductListClickedSpec } from "@/snowtype/snowplow";
import { useCart } from "@/components/Cart/CartProvider";
import { useDemoMode } from "@/components/Demo/DemoModeProvider";
import type { Product } from "@/types/commerce";
import { createProductListClickedTrackingProps } from "@/utils/snowtypeTracking";

interface ProductCardProps {
  product: Product;
  listId: string;
  listName: string;
  personalized?: boolean;
  reason?: string;
}

export function ProductCard({
  product,
  listId,
  listName,
  personalized = false,
  reason,
}: ProductCardProps) {
  const { addItem } = useCart();
  const { highlightPersonalization } = useDemoMode();

  return (
    <article
      className={`group overflow-hidden rounded-[2rem] border transition-all duration-300 ${
        personalized && highlightPersonalization
          ? "border-[var(--accent)] bg-[var(--panel-strong)] shadow-[0_0_0_1px_rgba(183,149,89,0.32)]"
          : "border-white/10 bg-(--panel)"
      }`}
    >
      <Link
        href={`/products/${product.slug}`}
        onClick={() =>
          trackProductListClickedSpec(
            createProductListClickedTrackingProps(listId, listName, product)
          )
        }
        className="block"
      >
        <div
          className="h-80 bg-cover bg-center transition duration-500 group-hover:scale-[1.03]"
          style={{ backgroundImage: `url(${product.thumbnail})` }}
        />
      </Link>

      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-[var(--muted)]">
              {product.designer}
            </p>
            <Link
              href={`/products/${product.slug}`}
              onClick={() =>
                trackProductListClickedSpec(
                  createProductListClickedTrackingProps(listId, listName, product)
                )
              }
              className="mt-2 block font-(--font-display) text-2xl text-foreground"
            >
              {product.name}
            </Link>
          </div>
          <p className="text-sm text-[var(--muted)]">${product.price}</p>
        </div>

        <p className="max-w-md text-sm leading-6 text-[var(--muted)]">
          {product.description}
        </p>

        {personalized && highlightPersonalization ? (
          <div className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-2 text-xs uppercase tracking-[0.28em] text-[var(--accent)]">
            {reason ?? "Selected around your in-session Signals profile"}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
            <span>{product.category}</span>
            <span>{product.colorFamily}</span>
            <span>{product.occasion}</span>
          </div>
          <button
            type="button"
            onClick={() => addItem(product.id)}
            className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.24em] text-foreground transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Add To Cart
          </button>
        </div>
      </div>
    </article>
  );
}
