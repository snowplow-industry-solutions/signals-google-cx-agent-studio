import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildChecks, evaluateResult, runCheck } from "./verify-deploy";

describe("buildChecks", () => {
  it("builds a reachability check that requires no auth header", () => {
    const [siteCheck] = buildChecks("secret", "session-1");
    expect(siteCheck.path).toBe("/");
    expect(siteCheck.expectedStatus).toBe(200);
    expect(siteCheck.headers).toBeUndefined();
  });

  it("builds unauthorized checks for context and catalog with no auth header", () => {
    const checks = buildChecks("secret", "session-1");
    const unauthorized = checks.filter(
      (check) => check.expectedStatus === 401 && (check.path === "/api/agent/catalog" || check.path.startsWith("/api/agent/context")),
    );
    expect(unauthorized).toHaveLength(2);
    for (const check of unauthorized) {
      expect(check.headers).toBeUndefined();
    }
  });

  it("builds a text-format check for the ces-messenger widget embed", () => {
    const checks = buildChecks("secret", "session-1");
    const widgetCheck = checks.find((check) => check.name.includes("ces-messenger"));
    expect(widgetCheck?.path).toBe("/");
    expect(widgetCheck?.expectedStatus).toBe(200);
    expect(widgetCheck?.bodyFormat).toBe("text");
  });

  it("builds authorized checks for context and catalog carrying the shared-secret header", () => {
    const checks = buildChecks("my-secret", "session-1");
    const authorized = checks.filter(
      (check) =>
        check.headers?.["x-agent-api-key"] === "my-secret" &&
        (check.path === "/api/agent/catalog" || check.path.startsWith("/api/agent/context")),
    );
    expect(authorized).toHaveLength(2);
    expect(authorized.map((check) => check.path)).toEqual([
      "/api/agent/context?session_id=session-1",
      "/api/agent/catalog",
    ]);
  });

  it("URL-encodes the session id in the context path", () => {
    const checks = buildChecks("secret", "session with spaces");
    const contextCheck = checks.find((check) => check.path.startsWith("/api/agent/context"));
    expect(contextCheck?.path).toBe("/api/agent/context?session_id=session%20with%20spaces");
  });
});

describe("evaluateResult", () => {
  const check = buildChecks("secret", "session-1")[0];

  it("fails when the status doesn't match what was expected", () => {
    const result = evaluateResult(check, 500, null);
    expect(result.pass).toBe(false);
    expect(result.detail).toBe("expected status 200, got 500");
  });

  it("passes when the status matches and there is no body validator", () => {
    const result = evaluateResult(check, 200, null);
    expect(result.pass).toBe(true);
  });

  it("fails when the body validator reports a problem", () => {
    const contextCheck = buildChecks("secret", "session-1")[3];
    const result = evaluateResult(contextCheck, 200, { profile: {} });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("recent_activity");
    expect(result.detail).toContain("agent_instructions");
  });

  it("passes when the body validator finds every required key", () => {
    const contextCheck = buildChecks("secret", "session-1")[3];
    const result = evaluateResult(contextCheck, 200, {
      profile: {},
      recent_activity: "",
      agent_instructions: "",
    });
    expect(result.pass).toBe(true);
  });

  it("fails the catalog check when results is present but not an array", () => {
    const catalogCheck = buildChecks("secret", "session-1")[5];
    const result = evaluateResult(catalogCheck, 200, { results: "not-an-array" });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('"results" is not an array');
  });

  it("passes the catalog check when results is an array", () => {
    const catalogCheck = buildChecks("secret", "session-1")[5];
    const result = evaluateResult(catalogCheck, 200, { results: [] });
    expect(result.pass).toBe(true);
  });

  it("fails the widget-embed check when the script or element is missing", () => {
    const widgetCheck = buildChecks("secret", "session-1")[1];
    const result = evaluateResult(widgetCheck, 200, "<html><body>no widget here</body></html>");
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("ces-messenger script (found: false)");
    expect(result.detail).toContain("<ces-messenger> element (found: false)");
  });

  it("fails the widget-embed check when only the script is present", () => {
    const widgetCheck = buildChecks("secret", "session-1")[1];
    const html = '<script src="https://www.gstatic.com/ces-console/fast/ces-messenger/ces-messenger.js"></script>';
    const result = evaluateResult(widgetCheck, 200, html);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("ces-messenger script (found: true)");
    expect(result.detail).toContain("<ces-messenger> element (found: false)");
  });

  it("passes the widget-embed check when both the script and element are present", () => {
    const widgetCheck = buildChecks("secret", "session-1")[1];
    const html =
      '<script src="https://www.gstatic.com/ces-console/fast/ces-messenger/ces-messenger.js"></script>' +
      '<ces-messenger deployment-id="projects/p/locations/l/apps/a/deployments/d"></ces-messenger>';
    const result = evaluateResult(widgetCheck, 200, html);
    expect(result.pass).toBe(true);
  });
});

describe("self-tracking checks", () => {
  const selfTrackingChecks = buildChecks("my-secret", "session-1").filter((check) =>
    check.path.startsWith("/api/agent/track-"),
  );

  it("builds a pair of checks for each of the three self-tracking endpoints", () => {
    expect(selfTrackingChecks).toHaveLength(6);
    const paths = new Set(selfTrackingChecks.map((check) => check.path));
    expect(paths).toEqual(
      new Set(["/api/agent/track-intent", "/api/agent/track-decision", "/api/agent/track-constraint"]),
    );
  });

  it("sends a POST with a well-formed body for every self-tracking check", () => {
    for (const check of selfTrackingChecks) {
      expect(check.method).toBe("POST");
      expect(check.body).toBeTruthy();
    }
  });

  it("builds an unauthorized check with no headers and a 401 expectation for each endpoint", () => {
    const unauthorized = selfTrackingChecks.filter((check) => check.expectedStatus === 401);
    expect(unauthorized).toHaveLength(3);
    for (const check of unauthorized) {
      expect(check.headers).toBeUndefined();
    }
  });

  it("sends the shared secret and the dry-run header on every authorized probe", () => {
    const authorized = selfTrackingChecks.filter((check) => check.expectedStatus === 200);
    expect(authorized).toHaveLength(3);
    for (const check of authorized) {
      expect(check.headers?.["x-agent-api-key"]).toBe("my-secret");
      expect(check.headers?.["x-agent-tracking-dry-run"]).toBe("1");
    }
  });

  it("validates the track-intent confirmation shape", () => {
    const check = selfTrackingChecks.find(
      (c) => c.path === "/api/agent/track-intent" && c.expectedStatus === 200,
    )!;
    expect(evaluateResult(check, 200, { intent_id: "abc-123" }).pass).toBe(true);
    expect(evaluateResult(check, 200, {}).pass).toBe(false);
  });

  it("validates the track-decision confirmation shape", () => {
    const check = selfTrackingChecks.find(
      (c) => c.path === "/api/agent/track-decision" && c.expectedStatus === 200,
    )!;
    expect(evaluateResult(check, 200, { decision_id: "abc-123" }).pass).toBe(true);
    expect(evaluateResult(check, 200, {}).pass).toBe(false);
  });

  it("validates the track-constraint confirmation shape", () => {
    const check = selfTrackingChecks.find(
      (c) => c.path === "/api/agent/track-constraint" && c.expectedStatus === 200,
    )!;
    expect(evaluateResult(check, 200, { violation_id: "abc-123" }).pass).toBe(true);
    expect(evaluateResult(check, 200, {}).pass).toBe(false);
  });
});

describe("runCheck", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const selfTrackingChecks = buildChecks("my-secret", "session-1").filter((check) =>
    check.path.startsWith("/api/agent/track-"),
  );
  const authorizedChecks = selfTrackingChecks.filter((check) => check.expectedStatus === 200);
  const unauthenticatedCheck = selfTrackingChecks.find((check) => check.expectedStatus === 401)!;

  it.each(authorizedChecks.map((check) => [check.name, check] as const))(
    "sends a POST with the JSON body and dry-run headers for %s",
    async (_name, check) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

      await runCheck("http://localhost:3000", check);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(check.body));
      expect(init.headers).toMatchObject({
        "Content-Type": "application/json",
        "x-agent-api-key": "my-secret",
        "x-agent-tracking-dry-run": "1",
      });
    },
  );

  it("sends no x-agent-api-key header for an unauthenticated self-tracking check", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }));

    await runCheck("http://localhost:3000", unauthenticatedCheck);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(unauthenticatedCheck.body));
    expect(init.headers?.["x-agent-api-key"]).toBeUndefined();
  });
});
