import { describe, expect, it } from "vitest";

import { collections } from "@/data/collections";
import { products } from "@/data/products";

const collectionSlugs = new Set(collections.map((collection) => collection.slug));
const productIds = new Set(products.map((product) => product.id));

describe("catalog integrity", () => {
  it("has unique product ids, slugs, and SKUs", () => {
    expect(new Set(products.map((product) => product.id)).size).toBe(products.length);
    expect(new Set(products.map((product) => product.slug)).size).toBe(products.length);
    expect(new Set(products.map((product) => product.sku)).size).toBe(products.length);
  });

  it("references only defined collections", () => {
    for (const product of products) {
      for (const slug of product.collections) {
        expect(
          collectionSlugs.has(slug),
          `${product.id} references undefined collection "${slug}"`
        ).toBe(true);
      }
    }
  });

  it("keeps featuredProductIds and product memberships in mirror", () => {
    for (const collection of collections) {
      for (const id of collection.featuredProductIds) {
        expect(productIds.has(id), `${collection.slug} features unknown product "${id}"`).toBe(true);
        const product = products.find((candidate) => candidate.id === id);
        expect(
          product?.collections.includes(collection.slug),
          `${collection.slug} features ${id} but ${id} does not list it in collections`
        ).toBe(true);
      }
    }
    for (const product of products) {
      for (const slug of product.collections) {
        const collection = collections.find((candidate) => candidate.slug === slug);
        expect(
          collection?.featuredProductIds.includes(product.id),
          `${product.id} lists "${slug}" but is missing from its featuredProductIds`
        ).toBe(true);
      }
    }
  });

  it("uses Unsplash URLs at the standard widths", () => {
    for (const product of products) {
      expect(product.image).toMatch(/^https:\/\/images\.unsplash\.com\/.+w=1200/);
      expect(product.thumbnail).toMatch(/^https:\/\/images\.unsplash\.com\/.+w=800/);
    }
    for (const collection of collections) {
      expect(collection.heroImage).toMatch(/^https:\/\/images\.unsplash\.com\/.+w=1400/);
    }
  });

  it("gives every product recommendation raw material", () => {
    for (const product of products) {
      expect(product.collections.length, `${product.id} has no collections`).toBeGreaterThan(0);
      expect(
        product.complementaryCategories.length,
        `${product.id} has no complementaryCategories`
      ).toBeGreaterThan(0);
      expect(product.stylingNotes.length, `${product.id} has no stylingNotes`).toBeGreaterThan(0);
    }
  });
});
