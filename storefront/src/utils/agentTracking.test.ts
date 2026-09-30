import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  capFreeTextQuery,
  clampTrackedMaxPrice,
  isDryRunTrackingRequest,
  MAX_TRACKED_QUERY_LENGTH,
  resolveAgentIdentity,
  trackCatalogSearchToolExecution,
} from "./agentTracking";

function requestWithHeaders(headers: Record<string, string>) {
  return new NextRequest("https://storefront.example/api/agent/context", { headers });
}

describe("resolveAgentIdentity", () => {
  it("reads all four identity fields from their headers when present", () => {
    const identity = resolveAgentIdentity(
      requestWithHeaders({
        "x-ces-session-id": "chat-1",
        "x-snowplow-session-id": "domain-session-1",
        "x-snowplow-user-id": "domain-user-1",
        "x-snowplow-turn-id": "turn-1",
      })
    );

    expect(identity).toEqual({
      chatSessionId: "chat-1",
      domainSessionId: "domain-session-1",
      domainUserId: "domain-user-1",
      turnId: "turn-1",
    });
  });

  it("falls back to null for every field when no headers are sent and no fallback session id is given", () => {
    const identity = resolveAgentIdentity(requestWithHeaders({}));

    expect(identity).toEqual({
      chatSessionId: null,
      domainSessionId: null,
      domainUserId: null,
      turnId: null,
    });
  });

  it("falls back to the query-param session id for the domain session id when the header is absent", () => {
    const identity = resolveAgentIdentity(requestWithHeaders({}), "query-session-1");

    expect(identity.domainSessionId).toBe("query-session-1");
  });

  it("prefers the domain session id header over the query-param fallback", () => {
    const identity = resolveAgentIdentity(
      requestWithHeaders({ "x-snowplow-session-id": "header-session-1" }),
      "query-session-1"
    );

    expect(identity.domainSessionId).toBe("header-session-1");
  });

  it("treats a null fallback session id the same as no fallback", () => {
    const identity = resolveAgentIdentity(requestWithHeaders({}), null);

    expect(identity.domainSessionId).toBeNull();
  });
});

describe("isDryRunTrackingRequest", () => {
  it.each([
    ["1", true],
    ["true", false],
    ["0", false],
    [undefined, false],
  ])("treats header value %j as dry-run=%s", (headerValue, expected) => {
    const request = requestWithHeaders(headerValue === undefined ? {} : { "x-agent-tracking-dry-run": headerValue });
    expect(isDryRunTrackingRequest(request)).toBe(expected);
  });
});

describe("capFreeTextQuery", () => {
  const overLength = "x".repeat(MAX_TRACKED_QUERY_LENGTH + 50);

  it.each([
    ["", ""],
    ["short query", "short query"],
    ["x".repeat(MAX_TRACKED_QUERY_LENGTH), "x".repeat(MAX_TRACKED_QUERY_LENGTH)],
    [overLength, overLength.slice(0, MAX_TRACKED_QUERY_LENGTH)],
  ])("caps %j to length <= %i", (input, expected) => {
    expect(capFreeTextQuery(input)).toBe(expected);
    expect(capFreeTextQuery(input).length).toBeLessThanOrEqual(MAX_TRACKED_QUERY_LENGTH);
  });

  it("honors a custom max length", () => {
    expect(capFreeTextQuery("abcdef", 3)).toBe("abc");
  });
});

describe("clampTrackedMaxPrice", () => {
  it.each([
    [null, null],
    [0, 0],
    [500, 500],
    [100000, 100000],
    [100000.01, null],
    [500000, null],
    [-1, null],
  ])("clamps %j to %j", (input, expected) => {
    expect(clampTrackedMaxPrice(input)).toBe(expected);
  });
});

const TRACKING_ENV = {
  NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL: "https://collector.example",
  NEXT_PUBLIC_SNOWPLOW_APP_ID: "test-app",
};

function stubTrackingEnv() {
  for (const [key, value] of Object.entries(TRACKING_ENV)) {
    vi.stubEnv(key, value);
  }
}

async function decodeCollectorPayload(request: Request) {
  const body = (await request.clone().json()) as { data: Record<string, string>[] };
  const [payload] = body.data;
  const event = JSON.parse(payload.ue_pr).data as { schema: string; data: Record<string, unknown> };
  const entities = (JSON.parse(payload.co) as { data: Array<{ schema: string; data: Record<string, unknown> }> }).data;
  return { payload, event, entities };
}

describe("trackCatalogSearchToolExecution", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubTrackingEnv();
    fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const baseCatalogSearch = {
    category: null,
    designer: null,
    occasion: null,
    color: null,
    maxPrice: null,
    query: null,
    limit: 10,
    resultCount: 0,
    productIds: [],
  };

  it("mints one invocation id shared by the event and agent_context when no turn id is present", async () => {
    await trackCatalogSearchToolExecution({
      identity: { chatSessionId: null, domainSessionId: null, domainUserId: null, turnId: null },
      success: true,
      durationMs: 10,
      catalogSearch: baseCatalogSearch,
    });

    const { event, entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
    const agentContext = entities.find((e) => e.schema === "iglu:com.snowplow.agent.tracking/agent_context/jsonschema/1-0-0");

    expect(event.data.invocation_id).toEqual(expect.any(String));
    expect(event.data.invocation_id).toBe(agentContext?.data.invocation_id);
  });

  it.each([
    [500000, null],
    [-1, null],
    [100000, 100000],
    [500, 500],
    [null, null],
  ])("clamps a max_price of %j to %j on the catalog_search entity", async (maxPrice, expected) => {
    await trackCatalogSearchToolExecution({
      identity: { chatSessionId: null, domainSessionId: null, domainUserId: null, turnId: null },
      success: true,
      durationMs: 10,
      catalogSearch: { ...baseCatalogSearch, maxPrice },
    });

    const { entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
    const catalogSearch = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/catalog_search/jsonschema/1-0-0");
    expect(catalogSearch?.data.max_price).toBe(expected);
  });

  it("slices designer and category fields to their schema maxLengths", async () => {
    const overLongDesigner = "d".repeat(150);
    const overLongCategory = "c".repeat(80);

    await trackCatalogSearchToolExecution({
      identity: { chatSessionId: null, domainSessionId: null, domainUserId: null, turnId: null },
      success: true,
      durationMs: 10,
      catalogSearch: { ...baseCatalogSearch, designer: overLongDesigner, category: overLongCategory },
    });

    const { entities } = await decodeCollectorPayload(fetchMock.mock.calls[0][0] as Request);
    const catalogSearch = entities.find((e) => e.schema === "iglu:com.snowplow_demo.fashion/catalog_search/jsonschema/1-0-0");
    expect((catalogSearch?.data.designer as string).length).toBe(128);
    expect((catalogSearch?.data.category as string).length).toBe(64);
  });
});
