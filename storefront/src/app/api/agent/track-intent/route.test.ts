import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const SHARED_SECRET = "test-shared-secret";

const TRACKING_ENV = {
  NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL: "https://collector.example",
  NEXT_PUBLIC_SNOWPLOW_APP_ID: "test-app",
};

function stubTrackingEnv() {
  for (const [key, value] of Object.entries(TRACKING_ENV)) {
    vi.stubEnv(key, value);
  }
}

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest("https://storefront.example/api/agent/track-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authedRequest(body: unknown, extraHeaders?: Record<string, string>) {
  return makeRequest(body, { "x-agent-api-key": SHARED_SECRET, ...extraHeaders });
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

describe("POST /api/agent/track-intent", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("AGENT_SHARED_SECRET", SHARED_SECRET);
    fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("auth", () => {
    it("rejects a request with no shared-secret header and tracks nothing", async () => {
      stubTrackingEnv();

      const response = await POST(makeRequest({ intent_category: "gift", confidence: 0.9 }));

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a request with the wrong shared-secret header", async () => {
      const response = await POST(
        makeRequest({ intent_category: "gift", confidence: 0.9 }, { "x-agent-api-key": "wrong-secret" })
      );
      expect(response.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("rejects invalid JSON with a 400 and tracks nothing", async () => {
      stubTrackingEnv();

      const response = await POST(
        new NextRequest("https://storefront.example/api/agent/track-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-api-key": SHARED_SECRET },
          body: "not json",
        })
      );

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an unrecognised intent_category with a 400 and tracks nothing", async () => {
      stubTrackingEnv();

      const response = await POST(authedRequest({ intent_category: "not_a_real_category", confidence: 0.5 }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/intent_category/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([-0.01, 1.01, Number.NaN])("rejects an out-of-range confidence value %j with a 400", async (confidence) => {
      stubTrackingEnv();

      const response = await POST(authedRequest({ intent_category: "gift", confidence }));

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a missing intent_category with a 400", async () => {
      const response = await POST(authedRequest({ confidence: 0.5 }));
      expect(response.status).toBe(400);
    });

    it("rejects a non-string reasoning with a 400", async () => {
      const response = await POST(authedRequest({ intent_category: "gift", confidence: 0.5, reasoning: 42 }));
      expect(response.status).toBe(400);
    });
  });

  describe("dry run", () => {
    it("validates and answers normally but tracks nothing when the dry-run header is set", async () => {
      stubTrackingEnv();

      const response = await POST(
        authedRequest({ intent_category: "gift", confidence: 0.9 }, { "x-agent-tracking-dry-run": "1" })
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.intent_id).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("tracking", () => {
    it("behaves normally with no fetch attempted when no collector is configured", async () => {
      const response = await POST(authedRequest({ intent_category: "gift", confidence: 0.9 }));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.intent_id).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("emits exactly one user_intent_detected event with the expected schema, entities, identity, and minted id", async () => {
      stubTrackingEnv();

      const response = await POST(
        authedRequest(
          { intent_category: "complete_look", confidence: 0.75, reasoning: "Shopper asked for matching accessories." },
          {
            "x-ces-session-id": "chat-session-1",
            "x-snowplow-session-id": "domain-session-1",
            "x-snowplow-user-id": "domain-user-1",
            "x-snowplow-turn-id": "turn-1",
          }
        )
      );

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const body = await response.json();
      expect(body).toEqual({ intent_id: expect.any(String) });

      const { payload, event, entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);

      expect(payload.p).toBe("srv");
      expect(payload.aid).toBe("test-app-agent");
      expect(payload.sid).toBe("domain-session-1");
      expect(payload.duid).toBe("domain-user-1");

      expect(event.schema).toBe("iglu:com.snowplow.agent.tracking/user_intent_detected/jsonschema/1-0-0");
      expect(event.data).toMatchObject({
        invocation_id: "turn-1",
        intent_id: body.intent_id,
        intent_category: "complete_look",
        confidence: 0.75,
        reasoning: "Shopper asked for matching accessories.",
      });
      expect(typeof event.data.detected_at).toBe("string");

      const toolContext = entities.find((e) => e.schema === "iglu:com.snowplow.agent.tracking/tool_context/jsonschema/1-0-0");
      expect(toolContext?.data).toMatchObject({ tool_name: "trackUserIntent", tool_category: "self_tracking" });

      const agentContext = entities.find((e) => e.schema === "iglu:com.snowplow.agent.tracking/agent_context/jsonschema/1-0-0");
      expect(agentContext?.data).toMatchObject({ invocation_id: "turn-1", session_id: "chat-session-1" });

      const conversation = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/conversation/jsonschema/1-0-0");
      expect(conversation?.data).toEqual({
        chat_session_id: "chat-session-1",
        turn_id: "turn-1",
        turn_index: null,
        channel: "unknown",
      });
    });

    it("defaults reasoning to null when not provided", async () => {
      stubTrackingEnv();

      await POST(authedRequest({ intent_category: "price_check", confidence: 0.2 }));

      const { event } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
      expect(event.data.reasoning).toBeNull();
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
      const responsePromise = POST(authedRequest({ intent_category: "gift", confidence: 0.5 })).then((response) => {
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
