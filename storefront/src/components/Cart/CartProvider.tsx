"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { trackCartUpdatedSpec } from "@/snowtype/snowplow";
import { products } from "@/data/products";
import type { CartLineItem } from "@/types/commerce";
import { logSignalsDemo } from "@/utils/demo";
import { createCartUpdatedTrackingProps } from "@/utils/snowtypeTracking";

interface CartContextValue {
  lineItems: CartLineItem[];
  itemCount: number;
  subtotal: number;
  addItem: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Start empty on both server and client so SSR markup matches the first
  // client render; the stored cart is loaded after hydration.
  const [lineItems, setLineItems] = useState<CartLineItem[]>([]);
  const hasHydratedCart = useRef(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("atelier-signals-cart");
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as CartLineItem[];
      if (parsed.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- deferred localStorage load must run post-hydration so SSR markup matches the first client render
        setLineItems(parsed);
      }
    } catch {
      // Ignore malformed stored carts.
    }
  }, []);

  useEffect(() => {
    // Skip the initial empty render so the stored cart isn't overwritten
    // before it has been loaded.
    if (!hasHydratedCart.current) {
      hasHydratedCart.current = true;
      return;
    }

    window.localStorage.setItem("atelier-signals-cart", JSON.stringify(lineItems));
  }, [lineItems]);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = lineItems.reduce((sum, lineItem) => sum + lineItem.quantity, 0);
    const subtotal = lineItems.reduce((sum, lineItem) => {
      const product = products.find((candidate) => candidate.id === lineItem.productId);
      return sum + (product?.price ?? 0) * lineItem.quantity;
    }, 0);

    return {
      lineItems,
      itemCount,
      subtotal,
      addItem: (productId) => {
        setLineItems((current) => {
          const existing = current.find((lineItem) => lineItem.productId === productId);
          const next = existing
            ? current.map((lineItem) =>
                lineItem.productId === productId
                  ? { ...lineItem, quantity: lineItem.quantity + 1 }
                  : lineItem
              )
            : [...current, { productId, quantity: 1 }];

          const product = products.find((candidate) => candidate.id === productId);
          if (product) {
            trackCartUpdatedSpec(
              createCartUpdatedTrackingProps(
                "add_to_cart",
                product,
                1,
                next,
                products
              )
            );
            logSignalsDemo("Cart updated", { productId, next });
          }

          return next;
        });
      },
      removeItem: (productId) => {
        setLineItems((current) => {
          const existing = current.find((lineItem) => lineItem.productId === productId);
          const next = current
            .map((lineItem) =>
              lineItem.productId === productId
                ? { ...lineItem, quantity: lineItem.quantity - 1 }
                : lineItem
            )
            .filter((lineItem) => lineItem.quantity > 0);

          const product = products.find((candidate) => candidate.id === productId);
          if (product && existing) {
            if (existing.quantity > 1) {
              trackCartUpdatedSpec(
                createCartUpdatedTrackingProps(
                  "adjust_quantity",
                  product,
                  existing.quantity - 1,
                  next,
                  products
                )
              );
            } else {
              trackCartUpdatedSpec(
                createCartUpdatedTrackingProps(
                  "remove_from_cart",
                  product,
                  0,
                  next,
                  products
                )
              );
            }
          }

          return next;
        });
      },
      clearCart: () => {
        setLineItems([]);
      },
    };
  }, [lineItems]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }

  return context;
}
