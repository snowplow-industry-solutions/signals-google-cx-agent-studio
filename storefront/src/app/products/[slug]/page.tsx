import { notFound } from "next/navigation";

import { ProductPage } from "@/components/ProductPage";
import { getProductBySlug, products } from "@/data/products";

export function generateStaticParams() {
  return products.map((product) => ({
    slug: product.slug,
  }));
}

export default async function ProductRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const relatedProducts = products.filter((candidate) => candidate.id !== product.id);

  return <ProductPage product={product} relatedProducts={relatedProducts} />;
}
