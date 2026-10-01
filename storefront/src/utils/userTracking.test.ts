// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUserContext, getShopperProfileId } from "./userTracking";

describe("userTracking", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists a stable shopper profile id", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("shopper-123");

    const firstId = getShopperProfileId();
    const secondId = getShopperProfileId();

    expect(firstId).toBe("shopper-123");
    expect(secondId).toBe("shopper-123");
    expect(localStorage.getItem("atelier-signals-shopper-profile-id")).toBe("shopper-123");
  });

  it("creates a user entity with only available Signals attributes", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("shopper-456");

    expect(
      createUserContext({
        favorite_category: "Accessories",
        price_affinity: "premium",
      })
    ).toEqual({
      schema: "iglu:com.snowplow_demo.fashion/user/jsonschema/1-0-0",
      data: {
        shopper_profile_id: "shopper-456",
        favorite_category: "Accessories",
        price_affinity: "premium",
      },
    });
  });
});
