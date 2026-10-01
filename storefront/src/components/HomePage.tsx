"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { useDemoMode } from "@/components/Demo/DemoModeProvider";
import { SignalsDebugPanel } from "@/components/Demo/SignalsDebugPanel";
import { ProductCard } from "@/components/ProductCard";
import { useSignals } from "@/components/Signals/SignalsProvider";
import { collections } from "@/data/collections";
import { products } from "@/data/products";
import { deriveEditorialModules } from "@/utils/personalization";
import { useTrackDemoProductListView } from "@/utils/tracking";

function getHomepageProducts(favoriteCategory?: string, favoriteDesigner?: string) {
  return [...products].sort((left, right) => {
    const leftScore =
      Number(left.category === favoriteCategory) +
      Number(left.designer === favoriteDesigner);
    const rightScore =
      Number(right.category === favoriteCategory) +
      Number(right.designer === favoriteDesigner);

    return rightScore - leftScore;
  });
}

export function HomePage() {
  const pathname = usePathname();
  const { attributes, bootstrapReady } = useSignals();
  const { highlightPersonalization } = useDemoMode();

  const editorialModules = useMemo(
    () => deriveEditorialModules(attributes),
    [attributes]
  );
  const featuredProducts = useMemo(
    () =>
      getHomepageProducts(
        attributes?.favorite_category,
        attributes?.favorite_designer
      ).slice(0, 4),
    [attributes]
  );

  useTrackDemoProductListView({
    pathname,
    ready: bootstrapReady,
    listId: "home-featured",
    listName: "Home Featured",
    listType: "homepage",
    items: featuredProducts,
  });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10">
      <section className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[2.5rem] border border-white/10 bg-(--panel) p-8 lg:p-12">
          <p className="text-[10px] uppercase tracking-[0.45em] text-[var(--muted)]">
            In-session Signals luxury demo
          </p>
          <h1 className="mt-4 max-w-3xl font-(--font-display) text-6xl leading-none text-foreground lg:text-7xl">
            A high-fashion storefront that reveals taste as it forms.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--muted)]">
            Browse tailoring, outerwear, watches, scarves, and evening pieces. The
            site reads live Signals attributes to reorder edits, suggest finishing
            pieces, and surface concierge-style interventions without leaning on
            discounts or urgency.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/collections/city-after-dark"
              className="rounded-full bg-[var(--accent)] px-6 py-3 text-xs uppercase tracking-[0.28em] text-black transition hover:opacity-90"
            >
              Explore Evening Edit
            </Link>
            <Link
              href="/collections/accessory-atelier"
              className="rounded-full border border-white/15 px-6 py-3 text-xs uppercase tracking-[0.28em] text-foreground transition hover:border-[var(--accent)]"
            >
              Open Accessory Atelier
            </Link>
          </div>

          {attributes ? (
            <div className="mt-10 grid gap-4 border-t border-white/10 pt-6 md:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">
                  Favorite category
                </p>
                <p className="mt-2 font-(--font-display) text-3xl text-foreground">
                  {attributes.favorite_category ?? "Pending"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">
                  Favorite designer
                </p>
                <p className="mt-2 font-(--font-display) text-3xl text-foreground">
                  {attributes.favorite_designer ?? "Pending"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--muted)]">
                  Favorite occasion
                </p>
                <p className="mt-2 font-(--font-display) text-3xl text-foreground">
                  {attributes.favorite_occasion ?? "Pending"}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div
          className="min-h-[32rem] rounded-[2.5rem] border border-white/10 bg-cover bg-center"
          style={{
            backgroundImage:
              "url(https://images.unsplash.com/photo-1551113006-731674fbb3ff?auto=format&fit=crop&w=1400&q=80)",
          }}
        />
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        {editorialModules.slice(0, 3).map((module, index) => (
          <article
            key={module.id}
            className={`rounded-[2rem] border p-6 ${
              index === 0 && highlightPersonalization
                ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                : "border-white/10 bg-(--panel)"
            }`}
          >
            <p className="text-[10px] uppercase tracking-[0.35em] text-[var(--muted)]">
              {module.eyebrow}
            </p>
            <h2 className="mt-4 font-(--font-display) text-4xl text-foreground">
              {module.title}
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
              {module.description}
            </p>
            {index === 0 && highlightPersonalization ? (
              <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-[var(--accent)]">
                Highlighted because Signals reordered this module
              </p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="mt-12">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.4em] text-[var(--muted)]">
              Featured edit
            </p>
            <h2 className="mt-3 font-(--font-display) text-5xl text-foreground">
              Selected around your current Signals profile.
            </h2>
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {featuredProducts.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              listId="home-featured"
              listName="Home Featured"
              personalized={index < 2}
              reason="Signals moved this piece higher for your current taste profile"
            />
          ))}
        </div>
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        {collections.slice(0, 4).map((collection) => (
          <Link
            key={collection.slug}
            href={`/collections/${collection.slug}`}
            className="overflow-hidden rounded-[2rem] border border-white/10 bg-(--panel)"
          >
            <div
              className="h-72 bg-cover bg-center"
              style={{ backgroundImage: `url(${collection.heroImage})` }}
            />
            <div className="space-y-3 p-6">
              <p className="text-[10px] uppercase tracking-[0.35em] text-[var(--muted)]">
                {collection.eyebrow}
              </p>
              <h3 className="font-(--font-display) text-4xl text-foreground">
                {collection.name}
              </h3>
              <p className="text-sm leading-7 text-[var(--muted)]">
                {collection.description}
              </p>
            </div>
          </Link>
        ))}
      </section>

      <SignalsDebugPanel />
    </div>
  );
}
