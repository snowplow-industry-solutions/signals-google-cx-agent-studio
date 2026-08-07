import { NextRequest, NextResponse } from "next/server";

import { products } from "@/data/products";
import type { ColorFamily, Product, ProductCategory, ProductOccasion } from "@/types/commerce";
import { isAuthorizedAgentRequest } from "@/utils/agentAuth";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

interface CatalogResult {
  name: string;
  designer: string;
  category: ProductCategory;
  occasion: ProductOccasion;
  color: ColorFamily;
  price: number;
  url: string;
  image: string;
}

function toCatalogResult(product: Product): CatalogResult {
  return {
    name: product.name,
    designer: product.designer,
    category: product.category,
    occasion: product.occasion,
    color: product.colorFamily,
    price: product.price,
    url: `/products/${product.slug}`,
    image: product.image,
  };
}

function equalsIgnoreCase(value: string, candidate: string): boolean {
  return value.toLowerCase() === candidate.toLowerCase();
}

function parseLimit(raw: string | null): number {
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAgentRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const designer = searchParams.get("designer");
  const occasion = searchParams.get("occasion");
  const color = searchParams.get("color");
  const maxPriceParam = searchParams.get("max_price");
  const query = searchParams.get("query")?.trim().toLowerCase() ?? "";
  const limit = parseLimit(searchParams.get("limit"));

  const maxPrice = maxPriceParam === null ? null : Number(maxPriceParam);
  const hasMaxPrice = maxPrice !== null && Number.isFinite(maxPrice);

  const filtered = products.filter((product) => {
    if (category && !equalsIgnoreCase(product.category, category)) return false;
    if (designer && !equalsIgnoreCase(product.designer, designer)) return false;
    if (occasion && !equalsIgnoreCase(product.occasion, occasion)) return false;
    if (color && !equalsIgnoreCase(product.colorFamily, color)) return false;
    if (hasMaxPrice && product.price > (maxPrice as number)) return false;
    if (query) {
      const haystack = `${product.name} ${product.description}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const results = filtered.slice(0, limit).map(toCatalogResult);

  return NextResponse.json({ results });
}
