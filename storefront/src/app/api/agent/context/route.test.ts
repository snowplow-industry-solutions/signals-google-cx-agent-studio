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

function authedRequest(query: string, extraHeaders?: Record<string, string>) {
  return makeRequest(query, { "x-agent-api-key": SHARED_SECRET, ...extraHeaders });
}

function stubSignalsEnv() {
  for (const [key, value] of Object.entries(SIGNALS_ENV)) {
    vi.stubEnv(key, value);
  }
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
        format: "json",
      });
    });

    it("renders buffered events into recent_activity beneath the summary line", async () => {
      getServiceAttributesMock.mockResolvedValue({});
      getAgenticContextMock.mockResolvedValue({
        summary: "Last activity 23 seconds ago. Session started 403 seconds ago.",
        prompt: "Speak as a luxury concierge.",
        events: [
          {
            seconds_since_start_of_session: 12,
            event: "product_viewed",
            url: "https://storefront.example/products/p18",
            event_context: { product_name: "Silk Scarf", designer: "Arc Studio" },
          },
          {
            seconds_since_start_of_session: 47,
            event: "cart_updated",
            url: "https://storefront.example/cart",
            event_context: { action: "add", product_name: "Silk Scarf" },
          },
        ],
      });

      const response = await GET(authedRequest("?session_id=abc-123"));
      const body = await response.json();

      expect(body.recent_activity).toBe(
        [
          "Last activity 23 seconds ago. Session started 403 seconds ago.",
          "- seconds_since_start_of_session: 12, event: product_viewed, url: https://storefront.example/products/p18, event_context: product_name: Silk Scarf, designer: Arc Studio",
          "- seconds_since_start_of_session: 47, event: cart_updated, url: https://storefront.example/cart, event_context: action: add, product_name: Silk Scarf",
        ].join("\n"),
      );
    });

    it("keeps recent_activity as the summary alone when no events are buffered", async () => {
      getServiceAttributesMock.mockResolvedValue({});
      getAgenticContextMock.mockResolvedValue({
        summary: "No events buffered.",
        prompt: "Speak as a luxury concierge.",
        events: [],
      });

      const response = await GET(authedRequest("?session_id=abc-123"));
      const body = await response.json();

      expect(body.recent_activity).toBe("No events buffered.");
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

      await GET(makeRequest("?session_id=abc-123"));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("behaves exactly as today, with no fetch attempted, when no collector URL is configured", async () => {
      stubSignalsEnv();
      getServiceAttributesMock.mockResolvedValue({ favorite_designer: "Maison Cendre" });
      getAgenticContextMock.mockResolvedValue({ summary: "Narrative." });

      const response = await GET(authedRequest("?session_id=abc-123"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        profile: { favorite_designer: "Maison Cendre" },
        recent_activity: "Narrative.",
        agent_instructions: "",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("emits exactly one tool_execution event with the expected schema, entities, identity, and platform", async () => {
      stubSignalsEnv();
      stubTrackingEnv();
      getServiceAttributesMock.mockResolvedValue({
        favorite_designer: "Maison Cendre",
        favorite_category: "Dresses",
      });
      getAgenticContextMock.mockResolvedValue({
        summary: "The shopper viewed three dresses.",
        prompt: "Speak as a luxury concierge.",
        events: [{ event: "product_viewed" }],
      });

      const response = await GET(
        authedRequest("?session_id=abc-123", {
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
      expect(toolContext?.data).toMatchObject({ tool_name: "getUserContext", tool_category: "business" });

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

      const contextLookup = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/context_lookup/jsonschema/1-0-0");
      expect(contextLookup?.data).toMatchObject({
        profile_returned: true,
        activity_returned: true,
        profile_attribute_count: 2,
        activity_event_count: 1,
        degraded_reason: "none",
      });
    });

    it("records missing_session as the degraded reason when session_id is absent", async () => {
      stubTrackingEnv();

      await GET(authedRequest(""));

      const { entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
      const contextLookup = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/context_lookup/jsonschema/1-0-0");
      expect(contextLookup?.data).toMatchObject({
        degraded_reason: "missing_session",
        profile_returned: false,
        activity_returned: false,
        signals_round_trip_ms: 0,
      });
    });

    it("records no_credentials as the degraded reason when Signals credentials are absent", async () => {
      stubTrackingEnv();

      await GET(authedRequest("?session_id=abc-123"));

      const { entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
      const contextLookup = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/context_lookup/jsonschema/1-0-0");
      expect(contextLookup?.data).toMatchObject({ degraded_reason: "no_credentials" });
    });

    it("records upstream_error as the degraded reason when the Signals calls fail", async () => {
      stubSignalsEnv();
      stubTrackingEnv();
      getServiceAttributesMock.mockRejectedValue(new Error("upstream timeout"));
      getAgenticContextMock.mockRejectedValue(new Error("event log unavailable"));

      const response = await GET(authedRequest("?session_id=abc-123"));

      expect(response.status).toBe(200);
      const { event, entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
      expect(event.data).toMatchObject({ success: true });
      const contextLookup = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/context_lookup/jsonschema/1-0-0");
      expect(contextLookup?.data).toMatchObject({ degraded_reason: "upstream_error" });
    });

    it("falls back to the domain session id for agent_context.session_id when no chat session id header is present", async () => {
      stubTrackingEnv();

      await GET(authedRequest("?session_id=abc-123", { "x-snowplow-session-id": "domain-session-2" }));

      const { entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
      const agentContext = entities.find((e) => e.schema === "iglu:com.snowplow.agent.tracking/agent_context/jsonschema/1-0-0");
      expect(agentContext?.data).toMatchObject({ session_id: "domain-session-2" });
    });

    it("falls back to the session_id query parameter for the domain session id when no header is sent", async () => {
      stubTrackingEnv();

      await GET(authedRequest("?session_id=query-session-1"));

      const { payload } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
      expect(payload.sid).toBe("query-session-1");
    });

    it("does not return the response until the collector POST has resolved", async () => {
      stubSignalsEnv();
      stubTrackingEnv();
      getServiceAttributesMock.mockResolvedValue({});
      getAgenticContextMock.mockResolvedValue({});

      let releaseFetch = () => {};
      const fetchGate = new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      fetchMock.mockImplementation(async () => {
        await fetchGate;
        return new Response("", { status: 200 });
      });

      let responseSettled = false;
      const responsePromise = GET(authedRequest("?session_id=abc-123")).then((response) => {
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
