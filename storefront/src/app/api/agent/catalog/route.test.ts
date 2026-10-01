import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const SHARED_SECRET = "test-shared-secret";

function makeRequest(query: string, headers?: Record<string, string>) {
  return new NextRequest(`https://storefront.example/api/agent/catalog${query}`, {
    headers,
  });
}

function authedRequest(query: string, extraHeaders?: Record<string, string>) {
  return makeRequest(query, { "x-agent-api-key": SHARED_SECRET, ...extraHeaders });
}

const TRACKING_ENV = {
  NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL: "https://collector.example",
  NEXT_PUBLIC_SNOWPLOW_APP_ID: "test-app",
};

function stubTrackingEnv() {
  for (const [key, value] of Object.entries(TRACKING_ENV)) {
    vi.stubEnv(key, value);
  }
}

interface DecodedCollectorPayload {
  payload: Record<string, string>;
  event: { schema: string; data: Record<string, unknown> };
  entities: Array<{ schema: string; data: Record<string, unknown> }>;
}

async function decodeCollectorPayload(request: Request): Promise<DecodedCollectorPayload> {
  const body = (await request.clone().json()) as { data: Record<string, string>[] };
  const [payload] = body.data;
  const event = JSON.parse(payload.ue_pr).data as DecodedCollectorPayload["event"];
  const entities = (JSON.parse(payload.co) as { data: DecodedCollectorPayload["entities"] }).data;
  return { payload, event, entities };
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

  describe("tracking", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("sends no collector event for an unauthorized request", async () => {
      stubTrackingEnv();

      await GET(makeRequest(""));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("behaves exactly as today, with no fetch attempted, when no collector URL is configured", async () => {
      const response = await GET(authedRequest("?query=Cashmere%20Wrap%20Coat"));

      expect(response.status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("emits exactly one tool_execution event with the expected schema, entities, identity, and platform", async () => {
      stubTrackingEnv();

      const response = await GET(
        authedRequest("?category=Outerwear&query=Cashmere%20Wrap%20Coat&limit=5", {
          "x-ces-session-id": "chat-session-1",
          "x-snowplow-session-id": "domain-session-1",
          "x-snowplow-user-id": "domain-user-1",
          "x-snowplow-turn-id": "turn-1",
        })
      );

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const { payload, event, entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);

      expect(payload.p).toBe("srv");
      expect(payload.aid).toBe("test-app-agent");
      expect(payload.sid).toBe("domain-session-1");
      expect(payload.duid).toBe("domain-user-1");

      expect(event.schema).toBe("iglu:com.snowplow.agent.tracking/tool_execution/jsonschema/1-0-0");
      expect(event.data).toMatchObject({ success: true, invocation_id: "turn-1" });

      const toolContext = entities.find((e) => e.schema === "iglu:com.snowplow.agent.tracking/tool_context/jsonschema/1-0-0");
      expect(toolContext?.data).toMatchObject({ tool_name: "searchCatalog", tool_category: "business" });

      const agentContext = entities.find((e) => e.schema === "iglu:com.snowplow.agent.tracking/agent_context/jsonschema/1-0-0");
      expect(agentContext?.data).toMatchObject({
        invocation_id: "turn-1",
        session_id: "chat-session-1",
        agent_type: "Atelier Concierge",
        model_provider: "google",
        model_name: "gemini-3.0-flash-001",
        user_id: "domain-user-1",
      });

      const conversation = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/conversation/jsonschema/1-0-0");
      expect(conversation?.data).toEqual({
        chat_session_id: "chat-session-1",
        turn_id: "turn-1",
        turn_index: null,
        channel: "unknown",
      });

      const catalogSearch = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/catalog_search/jsonschema/1-0-0");
      expect(catalogSearch?.data).toEqual({
        category: "Outerwear",
        designer: null,
        occasion: null,
        color: null,
        max_price: null,
        query: "Cashmere Wrap Coat",
        limit: 5,
        result_count: 1,
        product_ids: ["p3"],
      });
    });

    it("caps an overlong free-text query before recording it on the catalog_search entity", async () => {
      stubTrackingEnv();
      const overLength = "z".repeat(250);

      await GET(authedRequest(`?query=${encodeURIComponent(overLength)}`));

      const { entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
      const catalogSearch = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/catalog_search/jsonschema/1-0-0");
      expect((catalogSearch?.data.query as string).length).toBe(200);
    });

    it("does not return the response until the collector POST has resolved", async () => {
      stubTrackingEnv();

      let releaseFetch = () => {};
      const fetchGate = new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      fetchMock.mockImplementation(async () => {
        await fetchGate;
        return new Response("", { status: 200 });
      });

      let responseSettled = false;
      const responsePromise = GET(authedRequest("")).then((response) => {
        responseSettled = true;
        return response;
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(responseSettled).toBe(false);

      releaseFetch();
      const response = await responsePromise;

      expect(responseSettled).toBe(true);
      expect(response.status).toBe(200);
    });
  });
});
