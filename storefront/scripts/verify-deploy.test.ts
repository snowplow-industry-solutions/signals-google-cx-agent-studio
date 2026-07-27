import { describe, expect, it } from "vitest";

import { buildChecks, evaluateResult } from "./verify-deploy";

describe("buildChecks", () => {
  it("builds a reachability check that requires no auth header", () => {
    const [siteCheck] = buildChecks("secret", "session-1");
    expect(siteCheck.path).toBe("/");
    expect(siteCheck.expectedStatus).toBe(200);
    expect(siteCheck.headers).toBeUndefined();
  });

  it("builds unauthorized checks for context and catalog with no auth header", () => {
    const checks = buildChecks("secret", "session-1");
    const unauthorized = checks.filter((check) => check.expectedStatus === 401);
    expect(unauthorized).toHaveLength(2);
    for (const check of unauthorized) {
      expect(check.headers).toBeUndefined();
    }
  });

  it("builds authorized checks for context and catalog carrying the shared-secret header", () => {
    const checks = buildChecks("my-secret", "session-1");
    const authorized = checks.filter((check) => check.headers?.["x-agent-api-key"] === "my-secret");
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
    const contextCheck = buildChecks("secret", "session-1")[2];
    const result = evaluateResult(contextCheck, 200, { profile: {} });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("recent_activity");
    expect(result.detail).toContain("agent_instructions");
  });

  it("passes when the body validator finds every required key", () => {
    const contextCheck = buildChecks("secret", "session-1")[2];
    const result = evaluateResult(contextCheck, 200, {
      profile: {},
      recent_activity: "",
      agent_instructions: "",
    });
    expect(result.pass).toBe(true);
  });

  it("fails the catalog check when results is present but not an array", () => {
    const catalogCheck = buildChecks("secret", "session-1")[4];
    const result = evaluateResult(catalogCheck, 200, { results: "not-an-array" });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('"results" is not an array');
  });

  it("passes the catalog check when results is an array", () => {
    const catalogCheck = buildChecks("secret", "session-1")[4];
    const result = evaluateResult(catalogCheck, 200, { results: [] });
    expect(result.pass).toBe(true);
  });
});
