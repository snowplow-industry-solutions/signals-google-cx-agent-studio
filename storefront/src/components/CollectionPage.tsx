"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { useDemoMode } from "@/components/Demo/DemoModeProvider";
import { SignalsDebugPanel } from "@/components/Demo/SignalsDebugPanel";
import { ProductCard } from "@/components/ProductCard";
import { useSignals } from "@/components/Signals/SignalsProvider";
import type { Collection, Product } from "@/types/commerce";
import { deriveCollectionCallout } from "@/utils/personalization";
import { useTrackDemoProductListView } from "@/utils/tracking";

interface CollectionPageProps {
  collection: Collection;
  products: Product[];
}

export function CollectionPage({ collection, products }: CollectionPageProps) {
  const pathname = usePathname();
  const { attributes, bootstrapReady } = useSignals();
  const { highlightPersonalization } = useDemoMode();

  const sortedProducts = useMemo(() => {
    return [...products].sort((left, right) => {
      const leftScore =
        Number(left.category === attributes?.favorite_category) +
        Number(left.designer === attributes?.favorite_designer) +
        Number(left.occasion === attributes?.favorite_occasion);
      const rightScore =
        Number(right.category === attributes?.favorite_category) +
        Number(right.designer === attributes?.favorite_designer) +
        Number(right.occasion === attributes?.favorite_occasion);

      return rightScore - leftScore;
    });
  }, [attributes, products]);

  const callout = useMemo(
    () =>
      deriveCollectionCallout({
        attributes,
        collectionName: collection.name,
      }),
    [attributes, collection.name]
  );

  useTrackDemoProductListView({
    pathname,
    ready: bootstrapReady,
    listId: collection.slug,
    listName: collection.name,
    listType: "collection",
    items: sortedProducts,
  });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10">
      <section
        className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-cover bg-center p-8 lg:p-12"
        style={{ backgroundImage: `linear-gradient(120deg, rgba(7,7,7,0.78), rgba(7,7,7,0.22)), url(${collection.heroImage})` }}
      >
        <p className="text-[10px] uppercase tracking-[0.45em] text-[var(--muted)]">
          {collection.eyebrow}
        </p>
        <h1 className="mt-4 font-(--font-display) text-6xl text-white lg:text-7xl">
          {collection.name}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-white/75">
          {collection.description}
        </p>
      </section>

      <section
        className={`mt-8 rounded-4xl border p-6 ${
          highlightPersonalization
            ? "border-[var(--accent)] bg-[var(--panel-strong)]"
            : "border-white/10 bg-(--panel)"
        }`}
      >
        <p className="text-[10px] uppercase tracking-[0.35em] text-[var(--muted)]">
          {callout.workflow}
        </p>
        <h2 className="mt-3 font-(--font-display) text-4xl text-foreground">
          {callout.title}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted)]">
          {callout.description}
        </p>
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {sortedProducts.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            listId={collection.slug}
            listName={collection.name}
            personalized={index < 3}
            reason="Signals reordered this collection around your live taste profile"
          />
        ))}
      </section>

      <SignalsDebugPanel collectionName={collection.name} />
    </div>
  );
}
