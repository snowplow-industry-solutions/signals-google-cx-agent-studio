import { notFound } from "next/navigation";

import { CollectionPage } from "@/components/CollectionPage";
import { collections, getCollectionBySlug } from "@/data/collections";
import { products } from "@/data/products";

export function generateStaticParams() {
  return collections.map((collection) => ({
    slug: collection.slug,
  }));
}

export default async function CollectionRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const collection = getCollectionBySlug(slug);

  if (!collection) {
    notFound();
  }

  const collectionProducts = products.filter((product) =>
    product.collections.includes(collection.slug)
  );

  return <CollectionPage collection={collection} products={collectionProducts} />;
}
