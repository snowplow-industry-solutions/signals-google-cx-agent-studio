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
    featuredProductIds: ["p1", "p2", "p5", "p8", "p11", "p14", "p18", "p22", "p26", "p38", "p39", "p40"],
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
    featuredProductIds: ["p3", "p4", "p6", "p10", "p13", "p15", "p19", "p20", "p23", "p42"],
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
    featuredProductIds: ["p4", "p7", "p9", "p12", "p15", "p16", "p17", "p19", "p21", "p24", "p25", "p30", "p33", "p34", "p35", "p36", "p37"],
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
    featuredProductIds: ["p5", "p6", "p7", "p10", "p11", "p16", "p17", "p18", "p23", "p24", "p26", "p29", "p31", "p32", "p36", "p37", "p41", "p42"],
    spotlightDesigner: "Arc Studio",
  },
  {
    slug: "tailored-signature",
    name: "Tailored Signature",
    eyebrow: "House Tailoring",
    description:
      "The structured core of the house — coats, blazers, and trousers with the pieces that anchor them.",
    mood: "Precise, architectural, and enduring.",
    heroImage: "https://images.unsplash.com/photo-1618866903271-595806e0679d?auto=format&fit=crop&w=1400&q=80",
    featuredProductIds: ["p1", "p3", "p9", "p13", "p25", "p33", "p34", "p35"],
    spotlightDesigner: "Maison Cendre",
  },
  {
    slug: "ceremony-edit",
    name: "The Ceremony Edit",
    eyebrow: "Occasion Dressing",
    description:
      "Gowns, fluid silk, and finishing pieces composed for weddings, black-tie invitations, and evenings that ask for more.",
    mood: "Formal, luminous, and deliberate.",
    heroImage: "https://images.unsplash.com/photo-1643736801656-cbe3a047cbf2?auto=format&fit=crop&w=1400&q=80",
    featuredProductIds: ["p2", "p8", "p11", "p14", "p22", "p27", "p38", "p39", "p40", "p41"],
    spotlightDesigner: "Maison Cendre",
  },
  {
    slug: "resort-light",
    name: "Resort Light",
    eyebrow: "Warm Weather",
    description:
      "Washed linen, sandwashed silk, raffia, and straw for travel wardrobes that keep their restraint in the sun.",
    mood: "Sun-washed ease with a quiet spine.",
    heroImage: "https://images.unsplash.com/photo-1780988304047-535d2ed29032?auto=format&fit=crop&w=1400&q=80",
    featuredProductIds: ["p12", "p21", "p27", "p28", "p29", "p30", "p31", "p32"],
    spotlightDesigner: "Atelier Lune",
  },
];

export function getCollectionBySlug(slug: string) {
  return collections.find((collection) => collection.slug === slug);
}
