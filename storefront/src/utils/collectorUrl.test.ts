import { describe, expect, it } from "vitest";

import { normalizeCollectorUrl } from "./collectorUrl";

describe("normalizeCollectorUrl", () => {
  // BDP Console displays the collector endpoint as a bare hostname. Pasted in
  // as-is, the tracker resolves it against the page protocol — so on
  // http://localhost the request goes to http://, the collector answers 308 to
  // https with no Access-Control-Allow-Origin header, and the browser blocks
  // every event as a CORS failure. Forcing https is what prevents that.
  it("adds https:// to a bare hostname", () => {
    expect(normalizeCollectorUrl("trial-abcde-fghij.collector.snplow.net")).toBe(
      "https://trial-abcde-fghij.collector.snplow.net",
    );
  });

  it("upgrades http:// to https://", () => {
    expect(normalizeCollectorUrl("http://collector.example.com")).toBe(
      "https://collector.example.com",
    );
  });

  it("leaves an https:// URL unchanged", () => {
    expect(normalizeCollectorUrl("https://collector.example.com")).toBe(
      "https://collector.example.com",
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeCollectorUrl("https://collector.example.com/")).toBe(
      "https://collector.example.com",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeCollectorUrl("  collector.example.com  ")).toBe(
      "https://collector.example.com",
    );
  });

  it("preserves a port", () => {
    expect(normalizeCollectorUrl("collector.example.com:8080")).toBe(
      "https://collector.example.com:8080",
    );
  });

  it("returns an empty string for empty or whitespace-only input", () => {
    expect(normalizeCollectorUrl("")).toBe("");
    expect(normalizeCollectorUrl("   ")).toBe("");
    expect(normalizeCollectorUrl(undefined)).toBe("");
  });

  it("leaves an explicit http://localhost alone for local collectors", () => {
    // Snowplow Micro runs on plain http and is same-origin-ish in dev; forcing
    // https there would break local testing rather than fix it.
    expect(normalizeCollectorUrl("http://localhost:9090")).toBe("http://localhost:9090");
    expect(normalizeCollectorUrl("http://127.0.0.1:9090")).toBe("http://127.0.0.1:9090");
  });
});
