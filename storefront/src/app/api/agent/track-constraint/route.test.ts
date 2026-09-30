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

const VALID_BODY = {
  constraint_type: "budget",
  requirement: "Under $200.",
  reason_not_met: "Nothing in stock under $200.",
};

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest("https://storefront.example/api/agent/track-constraint", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
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

describe("POST /api/agent/track-constraint", () => {
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

      const response = await POST(makeRequest(VALID_BODY));

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a request with the wrong shared-secret header", async () => {
      const response = await POST(makeRequest(VALID_BODY, { "x-agent-api-key": "wrong-secret" }));
      expect(response.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("rejects invalid JSON with a 400 and tracks nothing", async () => {
      stubTrackingEnv();

      const response = await POST(
        new NextRequest("https://storefront.example/api/agent/track-constraint", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-api-key": SHARED_SECRET },
          body: "not json",
        })
      );

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an unrecognised constraint_type with a 400 and tracks nothing", async () => {
      stubTrackingEnv();

      const response = await POST(authedRequest({ ...VALID_BODY, constraint_type: "not_a_real_type" }));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/constraint_type/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a missing requirement with a 400", async () => {
      const response = await POST(
        authedRequest({ constraint_type: VALID_BODY.constraint_type, reason_not_met: VALID_BODY.reason_not_met })
      );
      expect(response.status).toBe(400);
    });

    it("rejects a missing reason_not_met with a 400", async () => {
      const response = await POST(
        authedRequest({ constraint_type: VALID_BODY.constraint_type, requirement: VALID_BODY.requirement })
      );
      expect(response.status).toBe(400);
    });

    it("rejects an alternatives_considered value that is not an array of strings with a 400", async () => {
      const response = await POST(authedRequest({ ...VALID_BODY, alternatives_considered: "not-an-array" }));
      expect(response.status).toBe(400);
    });

    it("rejects a non-string recommendation with a 400", async () => {
      const response = await POST(authedRequest({ ...VALID_BODY, recommendation: 42 }));
      expect(response.status).toBe(400);
    });
  });

  describe("dry run", () => {
    it("validates and answers normally but tracks nothing when the dry-run header is set", async () => {
      stubTrackingEnv();

      const response = await POST(authedRequest(VALID_BODY, { "x-agent-tracking-dry-run": "1" }));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.violation_id).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("tracking", () => {
    it("behaves normally with no fetch attempted when no collector is configured", async () => {
      const response = await POST(authedRequest(VALID_BODY));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.violation_id).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("emits exactly one constraint_violation event with the expected schema, entities, identity, and minted id", async () => {
      stubTrackingEnv();

      const response = await POST(
        authedRequest(
          {
            constraint_type: "designer_unavailable",
            requirement: "A piece by Maison Cendre under $500.",
            reason_not_met: "No Maison Cendre pieces are priced under $500.",
            alternatives_considered: ["Arc Studio pieces under $500"],
            recommendation: "Suggested an Arc Studio coat instead.",
          },
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
      expect(body).toEqual({ violation_id: expect.any(String) });

      const { payload, event, entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);

      expect(payload.p).toBe("srv");
      expect(payload.aid).toBe("test-app-agent");
      expect(payload.sid).toBe("domain-session-1");
      expect(payload.duid).toBe("domain-user-1");

      expect(event.schema).toBe("iglu:com.snowplow.agent.tracking/constraint_violation/jsonschema/1-0-0");
      expect(event.data).toMatchObject({
        invocation_id: "turn-1",
        violation_id: body.violation_id,
        constraint_type: "designer_unavailable",
        user_requirement: "A piece by Maison Cendre under $500.",
        reason_not_met: "No Maison Cendre pieces are priced under $500.",
        alternatives_considered: ["Arc Studio pieces under $500"],
        recommendation: "Suggested an Arc Studio coat instead.",
      });
      expect(typeof event.data.violated_at).toBe("string");

      const toolContext = entities.find((e) => e.schema === "iglu:com.snowplow.agent.tracking/tool_context/jsonschema/1-0-0");
      expect(toolContext?.data).toMatchObject({ tool_name: "trackConstraintViolation", tool_category: "self_tracking" });

      const conversation = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/conversation/jsonschema/1-0-0");
      expect(conversation?.data).toMatchObject({ chat_session_id: "chat-session-1", turn_id: "turn-1" });
    });

    it("defaults alternatives_considered and recommendation to null when not provided", async () => {
      stubTrackingEnv();

      await POST(authedRequest(VALID_BODY));

      const { event } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
      expect(event.data.alternatives_considered).toBeNull();
      expect(event.data.recommendation).toBeNull();
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
      const responsePromise = POST(authedRequest(VALID_BODY)).then((response) => {
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
