import type { Collection } from "@/types/commerce";

export const collections: Collection[] = [
  {
    slug: "city-after-dark",
    name: "City After Dark",
    eyebrow: "Evening Edit",
    description:
      "Sharper tailoring, silk movement, and sculptural accessories designed for gallery dinners and late reservations.",
    mood: "Polished, nocturnal, and quietly dramatic.",
    heroImage:
      "https://images.unsplash.com/photo-1495462911434-be47104d70fa?auto=format&fit=crop&w=1400&q=80",
    featuredProductIds: ["p1", "p2", "p5", "p8", "p11", "p14", "p18", "p22", "p26"],
    spotlightDesigner: "Maison Cendre",
  },
  {
    slug: "winter-salon",
    name: "Winter Salon",
    eyebrow: "Cold Weather",
    description:
      "Cashmere layers, felt accessories, and tonal dressing with enough softness to feel intimate and editorial.",
    mood: "Soft structure and rich seasonal texture.",
    heroImage:
      "https://images.unsplash.com/photo-1550872199-63f4382fe925?auto=format&fit=crop&w=1400&q=80",
    featuredProductIds: ["p3", "p4", "p6", "p10", "p13", "p19", "p20", "p23"],
    spotlightDesigner: "Atelier Lune",
  },
  {
    slug: "city-uniform",
    name: "City Uniform",
    eyebrow: "Workwear",
    description:
      "Tailored separates, precise leather, and understated accessories for a considered day wardrobe.",
    mood: "Confident, modular, and beautifully composed.",
    heroImage:
      "https://images.unsplash.com/photo-1629511565591-a1d494ad6c58?auto=format&fit=crop&w=1400&q=80",
    featuredProductIds: ["p4", "p7", "p9", "p12", "p15", "p17", "p21", "p24", "p25"],
    spotlightDesigner: "Maison Cendre",
  },
  {
    slug: "accessory-atelier",
    name: "Accessory Atelier",
    eyebrow: "Finishing Pieces",
    description:
      "Watches, scarves, hats, and bags selected to complete a look rather than compete with it.",
    mood: "Concise statements with styling intelligence.",
    heroImage:
      "https://images.unsplash.com/photo-1724318497004-084cece3e7ae?auto=format&fit=crop&w=1400&q=80",
    featuredProductIds: ["p5", "p6", "p7", "p10", "p11", "p16", "p23", "p24", "p26"],
    spotlightDesigner: "Arc Studio",
  },
];

export function getCollectionBySlug(slug: string) {
  return collections.find((collection) => collection.slug === slug);
}
