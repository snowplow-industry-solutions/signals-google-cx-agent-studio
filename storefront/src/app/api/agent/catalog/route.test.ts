import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const SHARED_SECRET = "test-shared-secret";

function makeRequest(query: string, headers?: Record<string, string>) {
  return new NextRequest(`https://storefront.example/api/agent/catalog${query}`, {
    headers,
  });
}

function authedRequest(query: string) {
  return makeRequest(query, { "x-agent-api-key": SHARED_SECRET });
}

describe("GET /api/agent/catalog", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_SHARED_SECRET", SHARED_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("auth", () => {
    it("rejects a request with no shared-secret header", async () => {
      const response = await GET(makeRequest(""));
      expect(response.status).toBe(401);
    });

    it("rejects a request with the wrong shared-secret header", async () => {
      const response = await GET(makeRequest("", { "x-agent-api-key": "wrong-secret" }));
      expect(response.status).toBe(401);
    });

    it("rejects any request when the server has no secret configured", async () => {
      vi.unstubAllEnvs();
      const response = await GET(authedRequest(""));
      expect(response.status).toBe(401);
    });

    it("accepts a request with the correct shared-secret header", async () => {
      const response = await GET(authedRequest(""));
      expect(response.status).toBe(200);
    });
  });

  describe("filtering", () => {
    it("returns a bounded list when no filters are given", async () => {
      const response = await GET(authedRequest(""));
      const body = await response.json();

      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results.length).toBeLessThanOrEqual(10);
    });

    it("filters by category", async () => {
      const response = await GET(authedRequest("?category=Dresses"));
      const body = await response.json();

      expect(body.results.length).toBeGreaterThan(0);
      for (const result of body.results) {
        expect(result.category).toBe("Dresses");
      }
    });

    it("filters by designer case-insensitively", async () => {
      const response = await GET(authedRequest("?designer=maison%20cendre"));
      const body = await response.json();

      expect(body.results.length).toBeGreaterThan(0);
      for (const result of body.results) {
        expect(result.designer).toBe("Maison Cendre");
      }
    });

    it("filters by occasion", async () => {
      const response = await GET(authedRequest("?occasion=Evening"));
      const body = await response.json();

      expect(body.results.length).toBeGreaterThan(0);
      for (const result of body.results) {
        expect(result.occasion).toBe("Evening");
      }
    });

    it("filters by color", async () => {
      const response = await GET(authedRequest("?color=Black"));
      const body = await response.json();

      expect(body.results.length).toBeGreaterThan(0);
      for (const result of body.results) {
        expect(result.color).toBe("Black");
      }
    });

    it("filters by max_price", async () => {
      const response = await GET(authedRequest("?max_price=500"));
      const body = await response.json();

      expect(body.results.length).toBeGreaterThan(0);
      for (const result of body.results) {
        expect(result.price).toBeLessThanOrEqual(500);
      }
    });

    it("ignores an invalid max_price rather than erroring", async () => {
      const response = await GET(authedRequest("?max_price=not-a-number"));
      expect(response.status).toBe(200);
    });

    it("combines multiple filters", async () => {
      const response = await GET(
        authedRequest("?category=Tailoring&designer=Maison%20Cendre&occasion=Workwear")
      );
      const body = await response.json();

      expect(body.results.length).toBeGreaterThan(0);
      for (const result of body.results) {
        expect(result.category).toBe("Tailoring");
        expect(result.designer).toBe("Maison Cendre");
        expect(result.occasion).toBe("Workwear");
      }
    });

    it("returns an empty list when a filter combination matches nothing", async () => {
      const response = await GET(authedRequest("?category=Shoes&color=Ivory&designer=Arc%20Studio"));
      const body = await response.json();

      expect(body.results).toEqual([]);
    });

    it("matches free-text query against the product name", async () => {
      const response = await GET(authedRequest("?query=Cashmere%20Wrap%20Coat"));
      const body = await response.json();

      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results.some((result: { name: string }) => result.name === "Camel Cashmere Wrap Coat")).toBe(
        true
      );
    });

    it("matches free-text query against the product description", async () => {
      const response = await GET(authedRequest("?query=gallery-like%20presence"));
      const body = await response.json();

      expect(body.results.some((result: { name: string }) => result.name === "Ivory Silk Column Dress")).toBe(
        true
      );
    });
  });

  describe("bounds and shape", () => {
    it("caps the limit param at the maximum allowed", async () => {
      const response = await GET(authedRequest("?limit=1000"));
      const body = await response.json();

      expect(body.results.length).toBeLessThanOrEqual(25);
    });

    it("falls back to the default limit for an invalid limit param", async () => {
      const response = await GET(authedRequest("?limit=not-a-number"));
      const body = await response.json();

      expect(body.results.length).toBeLessThanOrEqual(10);
    });

    it("shapes each result with the fields an agent needs", async () => {
      const response = await GET(authedRequest("?limit=1"));
      const body = await response.json();

      expect(body.results[0]).toEqual({
        name: expect.any(String),
        designer: expect.any(String),
        category: expect.any(String),
        occasion: expect.any(String),
        color: expect.any(String),
        price: expect.any(Number),
        url: expect.stringMatching(/^\/products\//),
        image: expect.stringMatching(/^https?:\/\//),
      });
    });
  });
});
