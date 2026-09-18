import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_ENDPOINTS,
  TOOL_EXECUTION_SCHEMA,
  aggregateExpectedCounts,
  countGoodEventsBySchema,
  diffSchemaCounts,
  evaluateRun,
  extractGoodEventIdentity,
  extractGoodEventSchema,
  fetchMicroBadCount,
  fetchMicroGoodEvents,
  findIdentityMismatches,
  fireEndpoints,
  resetMicro,
  waitForExpectedCount,
  type AgentIdentity,
  type MicroGoodEvent,
} from "./verify-micro";

const IDENTITY: AgentIdentity = {
  chatSessionId: "chat-1",
  domainSessionId: "session-1",
  domainUserId: "user-1",
  turnId: "turn-1",
};

function goodEvent(schema: string, overrides: Record<string, unknown> = {}): MicroGoodEvent {
  return {
    event: {
      domain_sessionid: IDENTITY.domainSessionId,
      domain_userid: IDENTITY.domainUserId,
      unstruct_event: { data: { schema, data: {} } },
      ...overrides,
    },
  };
}

describe("AGENT_ENDPOINTS request construction", () => {
  it("builds the context endpoint request with the shared secret and all four identity headers", () => {
    const [contextSpec] = AGENT_ENDPOINTS;
    const { url, init } = contextSpec.request("http://localhost:3001", "my-secret", IDENTITY);

    expect(url).toBe("http://localhost:3001/api/agent/context?session_id=session-1");
    expect(init.headers).toEqual({
      "x-agent-api-key": "my-secret",
      "x-ces-session-id": "chat-1",
      "x-snowplow-session-id": "session-1",
      "x-snowplow-user-id": "user-1",
      "x-snowplow-turn-id": "turn-1",
    });
  });

  it("builds the catalog endpoint request against the catalog path", () => {
    const catalogSpec = AGENT_ENDPOINTS.find((spec) => spec.name.includes("searchCatalog"));
    const { url } = catalogSpec!.request("http://localhost:3001", "my-secret", IDENTITY);

    expect(url).toBe("http://localhost:3001/api/agent/catalog?category=dresses");
  });

  it("URL-encodes the session id in the context request", () => {
    const [contextSpec] = AGENT_ENDPOINTS;
    const { url } = contextSpec.request(
      "http://localhost:3001",
      "secret",
      { ...IDENTITY, domainSessionId: "session with spaces" },
    );
    expect(url).toBe("http://localhost:3001/api/agent/context?session_id=session%20with%20spaces");
  });

  it("declares exactly one expected tool_execution good event per endpoint", () => {
    for (const spec of AGENT_ENDPOINTS) {
      expect(spec.expectedGoodEvents).toEqual([{ schema: TOOL_EXECUTION_SCHEMA, count: 1 }]);
    }
  });
});

describe("aggregateExpectedCounts", () => {
  it("sums counts for the same schema across multiple endpoint specs", () => {
    const totals = aggregateExpectedCounts(AGENT_ENDPOINTS);
    expect(totals.get(TOOL_EXECUTION_SCHEMA)).toBe(AGENT_ENDPOINTS.length);
  });

  it("keeps separate schemas separate", () => {
    const specs = [
      { name: "a", request: () => ({ url: "", init: {} }), expectedGoodEvents: [{ schema: "schema-a", count: 1 }] },
      { name: "b", request: () => ({ url: "", init: {} }), expectedGoodEvents: [{ schema: "schema-b", count: 2 }] },
    ];
    const totals = aggregateExpectedCounts(specs);
    expect(totals.get("schema-a")).toBe(1);
    expect(totals.get("schema-b")).toBe(2);
  });
});

describe("extractGoodEventSchema / extractGoodEventIdentity", () => {
  it("reads the tracked schema from the nested unstruct_event envelope", () => {
    expect(extractGoodEventSchema(goodEvent(TOOL_EXECUTION_SCHEMA))).toBe(TOOL_EXECUTION_SCHEMA);
  });

  it("returns null when there is no unstruct_event", () => {
    expect(extractGoodEventSchema({ event: {} })).toBeNull();
  });

  it("reads domain_sessionid and domain_userid off the event", () => {
    expect(extractGoodEventIdentity(goodEvent(TOOL_EXECUTION_SCHEMA))).toEqual({
      domainSessionId: "session-1",
      domainUserId: "user-1",
    });
  });

  it("returns nulls when the event carries no identity", () => {
    expect(extractGoodEventIdentity({ event: {} })).toEqual({ domainSessionId: null, domainUserId: null });
  });
});

describe("countGoodEventsBySchema", () => {
  it("tallies multiple events of the same schema", () => {
    const events = [goodEvent(TOOL_EXECUTION_SCHEMA), goodEvent(TOOL_EXECUTION_SCHEMA), goodEvent("other-schema")];
    const counts = countGoodEventsBySchema(events);
    expect(counts.get(TOOL_EXECUTION_SCHEMA)).toBe(2);
    expect(counts.get("other-schema")).toBe(1);
  });

  it("skips events with no resolvable schema", () => {
    const counts = countGoodEventsBySchema([{ event: {} }]);
    expect(counts.size).toBe(0);
  });
});

describe("diffSchemaCounts", () => {
  it("reports no mismatches when actual matches expected", () => {
    const expected = new Map([[TOOL_EXECUTION_SCHEMA, 2]]);
    const actual = new Map([[TOOL_EXECUTION_SCHEMA, 2]]);
    expect(diffSchemaCounts(expected, actual)).toEqual([]);
  });

  it("reports a mismatch with expected and actual counts", () => {
    const expected = new Map([[TOOL_EXECUTION_SCHEMA, 2]]);
    const actual = new Map([[TOOL_EXECUTION_SCHEMA, 1]]);
    expect(diffSchemaCounts(expected, actual)).toEqual([{ schema: TOOL_EXECUTION_SCHEMA, expected: 2, actual: 1 }]);
  });

  it("treats a schema missing from actual as a count of zero", () => {
    const expected = new Map([[TOOL_EXECUTION_SCHEMA, 1]]);
    const actual = new Map<string, number>();
    expect(diffSchemaCounts(expected, actual)).toEqual([{ schema: TOOL_EXECUTION_SCHEMA, expected: 1, actual: 0 }]);
  });
});

describe("findIdentityMismatches", () => {
  it("finds no problems when every good event carries the expected identity", () => {
    const events = [goodEvent(TOOL_EXECUTION_SCHEMA), goodEvent("other-schema")];
    expect(findIdentityMismatches(events, IDENTITY)).toEqual([]);
  });

  it("flags an event whose domain_sessionid doesn't match", () => {
    const events = [goodEvent(TOOL_EXECUTION_SCHEMA, { domain_sessionid: "wrong-session" })];
    const problems = findIdentityMismatches(events, IDENTITY);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("domain_sessionid");
  });

  it("flags an event whose domain_userid doesn't match", () => {
    const events = [goodEvent(TOOL_EXECUTION_SCHEMA, { domain_userid: "wrong-user" })];
    const problems = findIdentityMismatches(events, IDENTITY);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("domain_userid");
  });
});

describe("evaluateRun", () => {
  const passingResult = { requestFailures: [], schemaMismatches: [], badEventCount: 0, identityProblems: [] };

  it("passes when every check is clean", () => {
    const { pass, lines } = evaluateRun(passingResult);
    expect(pass).toBe(true);
    expect(lines.every((line) => line.startsWith("PASS"))).toBe(true);
  });

  it("fails and reports request failures", () => {
    const { pass, lines } = evaluateRun({ ...passingResult, requestFailures: ["endpoint X: timed out"] });
    expect(pass).toBe(false);
    expect(lines.some((line) => line.includes("endpoint X: timed out"))).toBe(true);
  });

  it("fails and reports schema mismatches", () => {
    const { pass, lines } = evaluateRun({
      ...passingResult,
      schemaMismatches: [{ schema: TOOL_EXECUTION_SCHEMA, expected: 2, actual: 1 }],
    });
    expect(pass).toBe(false);
    expect(lines.some((line) => line.includes("expected 2 good event(s), found 1"))).toBe(true);
  });

  it("fails when there are bad events", () => {
    const { pass, lines } = evaluateRun({ ...passingResult, badEventCount: 3 });
    expect(pass).toBe(false);
    expect(lines.some((line) => line.includes("3 bad event(s)"))).toBe(true);
  });

  it("fails and reports identity problems", () => {
    const { pass, lines } = evaluateRun({ ...passingResult, identityProblems: ["good event 0: bad identity"] });
    expect(pass).toBe(false);
    expect(lines.some((line) => line.includes("bad identity"))).toBe(true);
  });
});

describe("fireEndpoints", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns no failures when every request responds ok", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const failures = await fireEndpoints("http://localhost:3001", "secret", IDENTITY, AGENT_ENDPOINTS);
    expect(failures).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(AGENT_ENDPOINTS.length);
  });

  it("records a failure with the status code for a non-ok response", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const failures = await fireEndpoints("http://localhost:3001", "secret", IDENTITY, AGENT_ENDPOINTS);
    expect(failures).toHaveLength(AGENT_ENDPOINTS.length);
    expect(failures[0]).toContain("401");
  });

  it("records a failure with the error message when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));
    const failures = await fireEndpoints("http://localhost:3001", "secret", IDENTITY, AGENT_ENDPOINTS);
    expect(failures[0]).toContain("connection refused");
  });
});

describe("Micro API helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchMicroGoodEvents calls /micro/good and returns the parsed array", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ event: {} }])));
    const events = await fetchMicroGoodEvents("http://localhost:9090");
    expect(fetchMock).toHaveBeenCalledWith(new URL("/micro/good", "http://localhost:9090"));
    expect(events).toEqual([{ event: {} }]);
  });

  it("fetchMicroBadCount calls /micro/bad and returns the array length", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{}, {}])));
    const count = await fetchMicroBadCount("http://localhost:9090");
    expect(fetchMock).toHaveBeenCalledWith(new URL("/micro/bad", "http://localhost:9090"));
    expect(count).toBe(2);
  });

  it("resetMicro calls /micro/reset", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    await resetMicro("http://localhost:9090");
    expect(fetchMock).toHaveBeenCalledWith(new URL("/micro/reset", "http://localhost:9090"));
  });
});

describe("waitForExpectedCount", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns immediately once the expected count is reached", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ event: {} }, { event: {} }])));
    const events = await waitForExpectedCount("http://localhost:9090", 2, { attempts: 5, delayMs: 0 });
    expect(events).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls again when the count hasn't been reached yet", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ event: {} }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ event: {} }, { event: {} }])));

    const events = await waitForExpectedCount("http://localhost:9090", 2, { attempts: 5, delayMs: 0 });
    expect(events).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured number of attempts", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify([{ event: {} }])));
    const events = await waitForExpectedCount("http://localhost:9090", 5, { attempts: 3, delayMs: 0 });
    expect(events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
