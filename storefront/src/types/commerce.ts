export type ProductCategory =
  | "Outerwear"
  | "Tailoring"
  | "Knitwear"
  | "Dresses"
  | "Accessories"
  | "Bags"
  | "Shoes"
  | "Watches";

export type ProductOccasion =
  | "City"
  | "Evening"
  | "Resort"
  | "Winter"
  | "Workwear";

export type ColorFamily =
  | "Black"
  | "Ivory"
  | "Camel"
  | "Burgundy"
  | "Silver"
  | "Navy"
  | "Olive";

export interface Product {
  id: string;
  slug: string;
  sku: string;
  name: string;
  designer: string;
  category: ProductCategory;
  price: number;
  currency: "USD";
  description: string;
  longDescription: string;
  colorFamily: ColorFamily;
  silhouette: string;
  occasion: ProductOccasion;
  material: string;
  image: string;
  thumbnail: string;
  collections: string[];
  complementaryCategories: ProductCategory[];
  stylingNotes: string[];
  tags: string[];
}

export interface Collection {
  slug: string;
  name: string;
  eyebrow: string;
  description: string;
  mood: string;
  heroImage: string;
  featuredProductIds: string[];
  spotlightDesigner: string;
}

export interface CartLineItem {
  productId: string;
  quantity: number;
}

export interface CartRecommendation {
  productId: string;
  reason: string;
}

export interface PersonalizationCallout {
  title: string;
  description: string;
  workflow: string;
}
