import { describe, expect, it } from "vitest";

import { createCart, createCheckout, createProduct } from "../../snowtype/snowplow";
import { products } from "@/data/products";

import {
  createCartUpdatedTrackingProps,
  createCheckoutStepTrackingProps,
  createProductListTrackingFingerprint,
  createProductListViewedTrackingProps,
} from "./snowtypeTracking";

describe("snowtype tracking helpers", () => {
  const primaryProduct = products[0]!;
  const secondaryProduct = products[1]!;
  const lineItems = [
    { productId: primaryProduct.id, quantity: 2 },
    { productId: secondaryProduct.id, quantity: 1 },
  ];

  it("builds cart update props with product and cart contexts", () => {
    const tracking = createCartUpdatedTrackingProps(
      "add_to_cart",
      primaryProduct,
      2,
      lineItems,
      products
    );

    expect(tracking).toMatchObject({
      action: "add_to_cart",
      product_id: primaryProduct.id,
      quantity: 2,
      cart_line_count: 2,
    });
    expect(tracking.context).toEqual([
      createProduct({
        product_id: primaryProduct.id,
        sku: primaryProduct.sku,
        product_name: primaryProduct.name,
        designer: primaryProduct.designer,
        category: primaryProduct.category,
        color_family: primaryProduct.colorFamily,
        occasion: primaryProduct.occasion,
        price: primaryProduct.price,
        currency: primaryProduct.currency,
      }),
      createCart({
        cart_line_count: 2,
        cart_value: primaryProduct.price * 2 + secondaryProduct.price,
        currency: "USD",
      }),
    ]);
  });

  it("branches shipping to checkout started and later steps to checkout step viewed", () => {
    const shipping = createCheckoutStepTrackingProps("shipping", lineItems, products);
    const payment = createCheckoutStepTrackingProps("payment", lineItems, products);

    expect(shipping.kind).toBe("started");
    expect(shipping.props).toMatchObject({
      checkout_step: "shipping",
      cart_line_count: 2,
    });
    expect(payment.kind).toBe("stepViewed");
    expect(payment.props).toMatchObject({
      checkout_step: "payment",
      cart_line_count: 2,
    });
    expect(shipping.props.context?.[0]).toEqual(
      createCheckout({
        checkout_step: "shipping",
        item_count: 3,
        order_value: primaryProduct.price * 2 + secondaryProduct.price,
        currency: "USD",
      })
    );
    expect(payment.props.context?.[0]).toEqual(
      createCheckout({
        checkout_step: "payment",
        item_count: 3,
        order_value: primaryProduct.price * 2 + secondaryProduct.price,
        currency: "USD",
      })
    );
  });

  it("builds product list viewed props with list metadata and product contexts", () => {
    const tracking = createProductListViewedTrackingProps(
      "home-featured",
      "Home Featured",
      "homepage",
      [primaryProduct, secondaryProduct]
    );

    expect(tracking).toMatchObject({
      list_id: "home-featured",
      list_name: "Home Featured",
      list_type: "homepage",
      product_count: 2,
    });
    expect(tracking.context).toEqual([
      createProduct({
        product_id: primaryProduct.id,
        sku: primaryProduct.sku,
        product_name: primaryProduct.name,
        designer: primaryProduct.designer,
        category: primaryProduct.category,
        color_family: primaryProduct.colorFamily,
        occasion: primaryProduct.occasion,
        price: primaryProduct.price,
        currency: primaryProduct.currency,
      }),
      createProduct({
        product_id: secondaryProduct.id,
        sku: secondaryProduct.sku,
        product_name: secondaryProduct.name,
        designer: secondaryProduct.designer,
        category: secondaryProduct.category,
        color_family: secondaryProduct.colorFamily,
        occasion: secondaryProduct.occasion,
        price: secondaryProduct.price,
        currency: secondaryProduct.currency,
      }),
    ]);
  });

  it("creates a stable fingerprint from route, list, and product order", () => {
    const baseline = createProductListTrackingFingerprint("/", "home-featured", [
      primaryProduct,
      secondaryProduct,
    ]);
    const same = createProductListTrackingFingerprint("/", "home-featured", [
      primaryProduct,
      secondaryProduct,
    ]);
    const changedOrder = createProductListTrackingFingerprint("/", "home-featured", [
      secondaryProduct,
      primaryProduct,
    ]);
    const changedRoute = createProductListTrackingFingerprint("/collections/edit", "home-featured", [
      primaryProduct,
      secondaryProduct,
    ]);

    expect(same).toBe(baseline);
    expect(changedOrder).not.toBe(baseline);
    expect(changedRoute).not.toBe(baseline);
  });
});
