import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { capFreeTextQuery, MAX_TRACKED_QUERY_LENGTH, resolveAgentIdentity } from "./agentTracking";

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
