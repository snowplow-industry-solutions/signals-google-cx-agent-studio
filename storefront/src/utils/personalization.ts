import { getProductById } from "@/data/products";
import type {
  CartRecommendation,
  PersonalizationCallout,
  Product,
} from "@/types/commerce";
import type { SignalsAttributes } from "@/types/signals";

interface DeriveComplementaryProductsArgs {
  attributes: SignalsAttributes | null;
  currentProductId: string;
  products: Product[];
}

interface DeriveCollectionCalloutArgs {
  attributes: SignalsAttributes | null;
  collectionName: string;
}

interface DeriveCartRecommendationsArgs {
  attributes: SignalsAttributes | null;
  cartProductIds: string[];
  products: Product[];
}

interface DeriveDebugSummaryArgs {
  attributes: SignalsAttributes | null;
  currentProductId?: string;
  cartProductIds?: string[];
  collectionName?: string;
  products: Product[];
}

interface EditorialModule {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}

const editorialModules: EditorialModule[] = [
  {
    id: "evening-salon",
    eyebrow: "Curated For The Evening",
    title: "A sharper edit for after dark",
    description: "Sculptural accessories and fluid silhouettes selected around your evening interest.",
  },
  {
    id: "tailored-uniform",
    eyebrow: "City Tailoring",
    title: "Refined structure, quietly composed",
    description: "Tailored pieces and finishing details that mirror your current wardrobe direction.",
  },
  {
    id: "winter-salon",
    eyebrow: "Cold Weather",
    title: "Soft winter layers with editorial depth",
    description: "Cashmere outerwear and felt accessories for colder, quieter dressing.",
  },
  {
    id: "accessory-atelier",
    eyebrow: "Finishing Pieces",
    title: "The accessories that complete the look",
    description: "Watches, scarves, and bags selected as complements rather than afterthoughts.",
  },
];

function getCount(map: Record<string, number> | undefined, key: string) {
  return map?.[key] ?? 0;
}

function sortByScore<T>(items: T[], score: (item: T) => number): T[] {
  return [...items].sort((left, right) => score(right) - score(left));
}

export function deriveComplementaryProducts({
  attributes,
  currentProductId,
  products,
}: DeriveComplementaryProductsArgs): Product[] {
  const currentProduct = getProductById(currentProductId);
  if (!currentProduct) {
    return [];
  }

  const favoriteDesigner = attributes?.favorite_designer;
  const favoriteOccasion = attributes?.favorite_occasion;
  const highIntent = new Set(attributes?.high_intent_product_ids ?? []);

  return sortByScore(
    products.filter((product) => product.id !== currentProductId),
    (candidate) => {
      let score = 0;

      if (currentProduct.complementaryCategories.includes(candidate.category)) {
        score += 6;
      }
      if (candidate.category === "Accessories") {
        score += 2;
        if (currentProduct.category === "Tailoring") {
          score += 3;
        }
      }
      if (candidate.category === "Watches" && currentProduct.category === "Tailoring") {
        score += 3;
      }
      if (candidate.designer === favoriteDesigner) {
        score += 3;
      }
      if (candidate.occasion === favoriteOccasion) {
        score += 3;
      } else if (favoriteOccasion) {
        score -= 1;
      }
      if (candidate.colorFamily === attributes?.favorite_color_family) {
        score += 2;
      }
      if (getCount(attributes?.category_interest_counts, candidate.category) > 0) {
        score += 2;
      }
      if (getCount(attributes?.designer_interest_counts, candidate.designer) > 0) {
        score += 2;
      }
      if (highIntent.has(candidate.id)) {
        score += 2;
      }

      return score;
    }
  ).slice(0, 3);
}

export function deriveEditorialModules(
  attributes: SignalsAttributes | null
): EditorialModule[] {
  return sortByScore(editorialModules, (module) => {
    if (!attributes) {
      return 0;
    }

    let score = 0;

    if (module.id === "evening-salon") {
      score += getCount(attributes.occasion_interest_counts, "Evening");
      score += getCount(attributes.category_interest_counts, "Dresses");
      if (attributes.favorite_occasion === "Evening") {
        score += 4;
      }
    }
    if (module.id === "tailored-uniform") {
      score += getCount(attributes.category_interest_counts, "Tailoring");
      score += getCount(attributes.designer_interest_counts, "Maison Cendre");
    }
    if (module.id === "winter-salon") {
      score += getCount(attributes.occasion_interest_counts, "Winter");
      score += getCount(attributes.category_interest_counts, "Outerwear");
    }
    if (module.id === "accessory-atelier") {
      score += getCount(attributes.category_interest_counts, "Accessories");
      score += getCount(attributes.category_interest_counts, "Watches");
    }

    return score;
  });
}

export function deriveCollectionCallout({
  attributes,
  collectionName,
}: DeriveCollectionCalloutArgs): PersonalizationCallout {
  const favoriteOccasion = attributes?.favorite_occasion ?? "City";
  const favoriteCategory = attributes?.favorite_category ?? "Accessories";

  return {
    title: `${collectionName}, refined around your ${favoriteOccasion.toLowerCase()} taste`,
    description: `Signals is elevating ${favoriteCategory.toLowerCase()} and complementary finishing pieces that match your current edit.`,
    workflow: "CollectionPageMerchandising",
  };
}

export function deriveCartRecommendations({
  attributes,
  cartProductIds,
  products,
}: DeriveCartRecommendationsArgs): CartRecommendation[] {
  const cartProducts = cartProductIds
    .map((id) => getProductById(id))
    .filter((product): product is Product => Boolean(product));
  const inCart = new Set(cartProductIds);

  const recommendations = sortByScore(
    products.filter((product) => !inCart.has(product.id)),
    (candidate) => {
      let score = 0;

      for (const product of cartProducts) {
        if (product.complementaryCategories.includes(candidate.category)) {
          score += 5;
        }
        if (product.occasion === candidate.occasion) {
          score += 2;
        }
      }

      if (candidate.designer === attributes?.favorite_designer) {
        score += 2;
      }
      if (candidate.category === "Accessories" || candidate.category === "Watches") {
        score += 2;
      }
      if (
        candidate.category === "Watches" &&
        cartProducts.some((product) => product.category === "Tailoring") &&
        attributes?.favorite_occasion === "Evening"
      ) {
        score += 4;
      }

      return score;
    }
  )
    .slice(0, 2)
    .map((product) => ({
      productId: product.id,
      reason: `A ${product.name.toLowerCase()} completes the silhouette of your current selection.`,
    }));

  return recommendations;
}

export function deriveDebugSummary({
  attributes,
  currentProductId,
  cartProductIds = [],
  collectionName,
  products,
}: DeriveDebugSummaryArgs) {
  const activeWorkflows: string[] = [];

  if (currentProductId && deriveComplementaryProducts({ attributes, currentProductId, products }).length > 0) {
    activeWorkflows.push("LookCompletionOnPDP");
  }
  if (collectionName) {
    activeWorkflows.push("CollectionPageMerchandising");
  }
  if (cartProductIds.length > 0 && deriveCartRecommendations({ attributes, cartProductIds, products }).length > 0) {
    activeWorkflows.push("CartStylingCompanion");
  }
  if ((attributes?.occasion_interest_counts?.Evening ?? 0) > 0) {
    activeWorkflows.push("EditorialHeroReordering");
  }

  return {
    activeWorkflows,
    topSignals: {
      favoriteCategory: attributes?.favorite_category ?? null,
      favoriteDesigner: attributes?.favorite_designer ?? null,
      favoriteOccasion: attributes?.favorite_occasion ?? null,
      cartValueBand: attributes?.cart_value_band ?? null,
    },
  };
}
