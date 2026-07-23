"use client";

import { createUser } from "../../snowtype/snowplow";
import type { SignalsAttributes } from "@/types/signals";

const SHOPPER_PROFILE_STORAGE_KEY = "atelier-signals-shopper-profile-id";

function createShopperProfileId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `shopper-${Date.now()}`;
}

export function getShopperProfileId() {
  if (typeof window === "undefined") {
    return "server-shopper-profile";
  }

  const existingId = window.localStorage.getItem(SHOPPER_PROFILE_STORAGE_KEY);
  if (existingId) {
    return existingId;
  }

  const shopperProfileId = createShopperProfileId();
  window.localStorage.setItem(SHOPPER_PROFILE_STORAGE_KEY, shopperProfileId);
  return shopperProfileId;
}

export function createUserContext(attributes: SignalsAttributes | null) {
  return createUser({
    shopper_profile_id: getShopperProfileId(),
    ...(attributes?.favorite_category
      ? { favorite_category: attributes.favorite_category }
      : {}),
    ...(attributes?.price_affinity ? { price_affinity: attributes.price_affinity } : {}),
    ...(attributes?.cart_value_band ? { cart_value_band: attributes.cart_value_band } : {}),
  });
}
