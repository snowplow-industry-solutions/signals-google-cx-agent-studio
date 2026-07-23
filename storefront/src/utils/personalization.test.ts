import { describe, expect, it } from "vitest";

import { products } from "@/data/products";
import type { SignalsAttributes } from "@/types/signals";

import {
  deriveCollectionCallout,
  deriveComplementaryProducts,
  deriveDebugSummary,
  deriveEditorialModules,
  deriveCartRecommendations,
} from "./personalization";

const eveningAttributes: SignalsAttributes = {
  favorite_category: "Tailoring",
  favorite_designer: "Maison Cendre",
  favorite_occasion: "Evening",
  category_interest_counts: {
    Tailoring: 4,
    Accessories: 3,
  },
  designer_interest_counts: {
    "Maison Cendre": 3,
    "Arc Studio": 2,
  },
  occasion_interest_counts: {
    Evening: 4,
  },
  color_family_interest_counts: {
    Black: 4,
    Silver: 2,
  },
  recently_viewed_product_ids: ["p1", "p5"],
  high_intent_product_ids: ["p1"],
  has_active_cart: true,
  cart_value_band: "luxury",
  checkout_stage: "cart",
};

describe("personalization utilities", () => {
  it("prefers complementary accessories for a tailored product detail page", () => {
    const recommendations = deriveComplementaryProducts({
      attributes: eveningAttributes,
      currentProductId: "p1",
      products,
    });

    expect(recommendations.map((product) => product.id)).toContain("p5");
    expect(recommendations.map((product) => product.id)).toContain("p18");
  });

  it("elevates modules matching the user taste profile", () => {
    const modules = deriveEditorialModules(eveningAttributes);

    expect(modules[0]?.id).toBe("evening-salon");
    expect(modules[1]?.id).toBe("tailored-uniform");
  });

  it("creates a collection callout aligned with the active collection and taste profile", () => {
    const callout = deriveCollectionCallout({
      attributes: eveningAttributes,
      collectionName: "City After Dark",
    });

    expect(callout.title).toContain("City After Dark");
    expect(callout.workflow).toBe("CollectionPageMerchandising");
  });

  it("suggests a styling completion item for the cart", () => {
    const cartRecommendations = deriveCartRecommendations({
      attributes: eveningAttributes,
      cartProductIds: ["p1", "p8"],
      products,
    });

    expect(cartRecommendations[0]?.productId).toBe("p18");
  });

  it("summarizes active workflows for the demo panel", () => {
    const summary = deriveDebugSummary({
      attributes: eveningAttributes,
      currentProductId: "p1",
      cartProductIds: ["p1", "p8"],
      collectionName: "City After Dark",
      products,
    });

    expect(summary.activeWorkflows).toContain("LookCompletionOnPDP");
    expect(summary.activeWorkflows).toContain("CartStylingCompanion");
    expect(summary.topSignals.favoriteCategory).toBe("Tailoring");
  });
});
