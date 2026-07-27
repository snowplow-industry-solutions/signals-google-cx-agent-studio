import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getServiceAttributesMock = vi.fn();
const getAgenticContextMock = vi.fn();

vi.mock("@snowplow/signals-node", () => ({
  Signals: vi.fn().mockImplementation(function SignalsMock() {
    return {
      getServiceAttributes: getServiceAttributesMock,
      getAgenticContext: getAgenticContextMock,
    };
  }),
}));

import { GET } from "./route";

const SHARED_SECRET = "test-shared-secret";
const SIGNALS_ENV = {
  SIGNALS_DEPLOYED_URL: "https://signals.example",
  SNOWPLOW_CONSOLE_API_KEY: "test-api-key",
  SNOWPLOW_CONSOLE_API_KEY_ID: "test-api-key-id",
  SNOWPLOW_CONSOLE_ORG_ID: "test-org-id",
};

function makeRequest(query: string, headers?: Record<string, string>) {
  return new NextRequest(`https://storefront.example/api/agent/context${query}`, {
    headers,
  });
}

function authedRequest(query: string) {
  return makeRequest(query, { "x-agent-api-key": SHARED_SECRET });
}

function stubSignalsEnv() {
  for (const [key, value] of Object.entries(SIGNALS_ENV)) {
    vi.stubEnv(key, value);
  }
}

describe("GET /api/agent/context", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_SHARED_SECRET", SHARED_SECRET);
    getServiceAttributesMock.mockReset();
    getAgenticContextMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("auth", () => {
    it("rejects a request with no shared-secret header", async () => {
      const response = await GET(makeRequest("?session_id=abc"));
      expect(response.status).toBe(401);
    });

    it("rejects a request with the wrong shared-secret header", async () => {
      const response = await GET(makeRequest("?session_id=abc", { "x-agent-api-key": "wrong-secret" }));
      expect(response.status).toBe(401);
    });

    it("rejects any request when the server has no secret configured", async () => {
      vi.unstubAllEnvs();
      const response = await GET(authedRequest("?session_id=abc"));
      expect(response.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("returns a well-formed degraded payload with 200 semantics when session_id is missing", async () => {
      const response = await GET(authedRequest(""));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        profile: {},
        recent_activity: "",
        agent_instructions: "",
      });
      expect(getServiceAttributesMock).not.toHaveBeenCalled();
      expect(getAgenticContextMock).not.toHaveBeenCalled();
    });

    it("returns a degraded payload with 200 semantics when Signals credentials are not configured", async () => {
      const response = await GET(authedRequest("?session_id=abc"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        profile: {},
        recent_activity: "",
        agent_instructions: "",
      });
    });
  });

  describe("merge and flattening", () => {
    beforeEach(() => {
      stubSignalsEnv();
    });

    it("merges profile attributes and agentic context into the money-slice shape", async () => {
      getServiceAttributesMock.mockResolvedValue({
        favorite_designer: "Maison Cendre",
        favorite_category: "Dresses",
        total_product_views: 4,
      });
      getAgenticContextMock.mockResolvedValue({
        summary: "The shopper viewed three dresses and added one to their cart.",
        prompt: "Speak as a luxury concierge.",
      });

      const response = await GET(authedRequest("?session_id=abc-123"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        profile: {
          favorite_designer: "Maison Cendre",
          favorite_category: "Dresses",
          total_product_views: 4,
        },
        recent_activity: "The shopper viewed three dresses and added one to their cart.",
        agent_instructions: "Speak as a luxury concierge.",
      });

      expect(getServiceAttributesMock).toHaveBeenCalledWith({
        name: "fashion_ecommerce_demo",
        attribute_key: "domain_sessionid",
        identifier: "abc-123",
      });
      expect(getAgenticContextMock).toHaveBeenCalledWith({
        name: "fashion_session_activity",
        identifier: "abc-123",
      });
    });

    it("joins array-valued attributes into a human-readable string, not a raw array", async () => {
      getServiceAttributesMock.mockResolvedValue({
        favorite_categories: ["Dresses", "Outerwear"],
        recently_viewed_product_ids: [],
      });
      getAgenticContextMock.mockResolvedValue({ summary: "", prompt: "" });

      const response = await GET(authedRequest("?session_id=abc-123"));
      const body = await response.json();

      expect(body.profile.favorite_categories).toBe("Dresses, Outerwear");
      expect(body.profile).not.toHaveProperty("recently_viewed_product_ids");
    });

    it("flattens dict-valued attributes into a human-readable string, not a nested object", async () => {
      getServiceAttributesMock.mockResolvedValue({
        category_interest_counts: { Dresses: 5, Outerwear: 2 },
      });
      getAgenticContextMock.mockResolvedValue({ summary: "", prompt: "" });

      const response = await GET(authedRequest("?session_id=abc-123"));
      const body = await response.json();

      expect(typeof body.profile.category_interest_counts).toBe("string");
      expect(body.profile.category_interest_counts).toBe("Dresses: 5, Outerwear: 2");
    });

    it("drops null/undefined attributes rather than including empty keys", async () => {
      getServiceAttributesMock.mockResolvedValue({
        favorite_designer: "Maison Cendre",
        favorite_color_family: null,
        checkout_stage: undefined,
      });
      getAgenticContextMock.mockResolvedValue({ summary: "", prompt: "" });

      const response = await GET(authedRequest("?session_id=abc-123"));
      const body = await response.json();

      expect(body.profile).toEqual({ favorite_designer: "Maison Cendre" });
    });
  });

  describe("degraded shapes", () => {
    beforeEach(() => {
      stubSignalsEnv();
    });

    it("returns a degraded payload for an unknown session id (empty upstream responses)", async () => {
      getServiceAttributesMock.mockResolvedValue({});
      getAgenticContextMock.mockResolvedValue({});

      const response = await GET(authedRequest("?session_id=never-seen-session"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        profile: {},
        recent_activity: "",
        agent_instructions: "",
      });
    });

    it("degrades gracefully, not a 5xx, when the profile attributes call fails upstream", async () => {
      getServiceAttributesMock.mockRejectedValue(new Error("upstream timeout"));
      getAgenticContextMock.mockResolvedValue({ summary: "Narrative text.", prompt: "Prompt text." });

      const response = await GET(authedRequest("?session_id=abc-123"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.profile).toEqual({});
      expect(body.recent_activity).toBe("Narrative text.");
      expect(body.agent_instructions).toBe("Prompt text.");
    });

    it("degrades gracefully, not a 5xx, when the agentic context call fails upstream", async () => {
      getServiceAttributesMock.mockResolvedValue({ favorite_designer: "Maison Cendre" });
      getAgenticContextMock.mockRejectedValue(new Error("event log unavailable"));

      const response = await GET(authedRequest("?session_id=abc-123"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.profile).toEqual({ favorite_designer: "Maison Cendre" });
      expect(body.recent_activity).toBe("");
      expect(body.agent_instructions).toBe("");
    });

    it("degrades gracefully, not a 5xx, when both upstream calls fail", async () => {
      getServiceAttributesMock.mockRejectedValue(new Error("upstream timeout"));
      getAgenticContextMock.mockRejectedValue(new Error("event log unavailable"));

      const response = await GET(authedRequest("?session_id=abc-123"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        profile: {},
        recent_activity: "",
        agent_instructions: "",
      });
    });
  });
});
