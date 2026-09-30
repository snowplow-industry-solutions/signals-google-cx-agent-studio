#!/usr/bin/env tsx
/**
 * Post-deploy smoke test for the agent-facing tool endpoints, the three
 * self-tracking endpoints, and the ces-messenger widget embed.
 *
 * A human runs this after triggering the Vercel deploy, against the public
 * HTTPS URL Vercel assigns, to confirm the site is reachable, that
 * /api/agent/context + /api/agent/catalog enforce the shared-secret header
 * and return the expected payload shape, that /api/agent/track-intent +
 * /track-decision + /track-constraint enforce the same shared-secret header
 * and accept a well-formed body, and that the homepage HTML embeds the
 * ces-messenger script and element. The three self-tracking checks always
 * send `x-agent-tracking-dry-run: 1` so the probe validates the deployment
 * without sending a real event to the collector. It does not replace the
 * browser walkthrough (browse -> context reflects that session, widget
 * delivers the session id to a live agent turn) from
 * docs/setup-cx-agent-studio.md.
 *
 * Usage: AGENT_SHARED_SECRET=<secret> npm run verify:deploy -- <base-url> [session_id]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_HEADER = "x-agent-api-key";
const DRY_RUN_HEADER = "x-agent-tracking-dry-run";

// Bodies drawn from the enums in agent/tools/self-tracking.openapi.yaml so a
// probe always satisfies validation.
const TRACK_INTENT_BODY = { intent_category: "browse_inspiration", confidence: 0.5 };
const TRACK_DECISION_BODY = { decision_type: "tool_selection", reasoning: "verify-deploy smoke test." };
const TRACK_CONSTRAINT_BODY = {
  constraint_type: "budget",
  requirement: "verify-deploy smoke test.",
  reason_not_met: "verify-deploy smoke test.",
};

export interface Check {
  name: string;
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus: number;
  bodyFormat?: "json" | "text";
  validateBody?: (body: unknown) => string | null;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

// Keep this substring in sync with WIDGET_SCRIPT_SRC in
// src/components/Widget/CesMessengerWidget.tsx.
const WIDGET_SCRIPT_MARKER = "ces-messenger.js";

function checkWidgetEmbed(html: unknown): string | null {
  const body = typeof html === "string" ? html : "";
  const hasScript = body.includes(WIDGET_SCRIPT_MARKER);
  const hasElement = /<ces-messenger[\s>]/i.test(body);

  if (hasScript && hasElement) {
    return null;
  }

  return `expected the homepage HTML to include both the ces-messenger script (found: ${hasScript}) and a <ces-messenger> element (found: ${hasElement})`;
}

function hasKeys(body: unknown, keys: readonly string[]): string | null {
  if (typeof body !== "object" || body === null) {
    return "response body is not a JSON object";
  }
  const payload = body as Record<string, unknown>;
  const missing = keys.filter((key) => !(key in payload));
  return missing.length > 0 ? `missing key(s) in response body: ${missing.join(", ")}` : null;
}

interface SelfTrackingEndpoint {
  name: string;
  path: string;
  body: Record<string, unknown>;
  confirmationKey: string;
}

const SELF_TRACKING_ENDPOINTS: readonly SelfTrackingEndpoint[] = [
  { name: "track-intent", path: "/api/agent/track-intent", body: TRACK_INTENT_BODY, confirmationKey: "intent_id" },
  {
    name: "track-decision",
    path: "/api/agent/track-decision",
    body: TRACK_DECISION_BODY,
    confirmationKey: "decision_id",
  },
  {
    name: "track-constraint",
    path: "/api/agent/track-constraint",
    body: TRACK_CONSTRAINT_BODY,
    confirmationKey: "violation_id",
  },
];

function buildSelfTrackingChecks(apiKey: string): Check[] {
  const checks: Check[] = [];
  for (const endpoint of SELF_TRACKING_ENDPOINTS) {
    checks.push({
      name: `${endpoint.name} endpoint rejects requests without the shared secret`,
      path: endpoint.path,
      method: "POST",
      body: endpoint.body,
      expectedStatus: 401,
    });
    checks.push({
      name: `${endpoint.name} endpoint responds for an authorized dry-run request`,
      path: endpoint.path,
      method: "POST",
      headers: { [AUTH_HEADER]: apiKey, [DRY_RUN_HEADER]: "1" },
      body: endpoint.body,
      expectedStatus: 200,
      validateBody: (body) => hasKeys(body, [endpoint.confirmationKey]),
    });
  }
  return checks;
}

export function buildChecks(apiKey: string, sessionId: string): Check[] {
  const authHeaders = { [AUTH_HEADER]: apiKey };

  return [
    {
      name: "Site is publicly reachable",
      path: "/",
      expectedStatus: 200,
    },
    {
      name: "ces-messenger widget embed is present on the homepage",
      path: "/",
      expectedStatus: 200,
      bodyFormat: "text",
      validateBody: checkWidgetEmbed,
    },
    {
      name: "Context endpoint rejects requests without the shared secret",
      path: `/api/agent/context?session_id=${encodeURIComponent(sessionId)}`,
      expectedStatus: 401,
    },
    {
      name: "Context endpoint responds for an authorized request",
      path: `/api/agent/context?session_id=${encodeURIComponent(sessionId)}`,
      headers: authHeaders,
      expectedStatus: 200,
      validateBody: (body) => hasKeys(body, ["profile", "recent_activity", "agent_instructions"]),
    },
    {
      name: "Catalog endpoint rejects requests without the shared secret",
      path: "/api/agent/catalog",
      expectedStatus: 401,
    },
    {
      name: "Catalog endpoint responds for an authorized request",
      path: "/api/agent/catalog",
      headers: authHeaders,
      expectedStatus: 200,
      validateBody: (body) => {
        const missing = hasKeys(body, ["results"]);
        if (missing) return missing;
        return Array.isArray((body as Record<string, unknown>).results) ? null : '"results" is not an array';
      },
    },
    ...buildSelfTrackingChecks(apiKey),
  ];
}

export function evaluateResult(check: Check, status: number, body: unknown): CheckResult {
  if (status !== check.expectedStatus) {
    return { name: check.name, pass: false, detail: `expected status ${check.expectedStatus}, got ${status}` };
  }

  const failure = check.validateBody?.(body);
  if (failure) {
    return { name: check.name, pass: false, detail: failure };
  }

  return { name: check.name, pass: true, detail: `status ${status}` };
}

async function runCheck(baseUrl: string, check: Check): Promise<CheckResult> {
  const response = await fetch(new URL(check.path, baseUrl), {
    method: check.method ?? "GET",
    headers: check.body !== undefined ? { "Content-Type": "application/json", ...check.headers } : check.headers,
    body: check.body !== undefined ? JSON.stringify(check.body) : undefined,
  });
  let body: unknown = null;
  try {
    body = check.bodyFormat === "text" ? await response.text() : await response.json();
  } catch {
    body = null;
  }
  return evaluateResult(check, response.status, body);
}

async function main(): Promise<void> {
  const [baseUrl, sessionIdArg] = process.argv.slice(2);
  if (!baseUrl) {
    console.error("Usage: AGENT_SHARED_SECRET=<secret> npm run verify:deploy -- <base-url> [session_id]");
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.AGENT_SHARED_SECRET;
  if (!apiKey) {
    console.error("Missing required environment variable: AGENT_SHARED_SECRET");
    process.exitCode = 1;
    return;
  }

  const sessionId = sessionIdArg ?? "verify-deploy-smoke-test";
  const results: CheckResult[] = [];
  for (const check of buildChecks(apiKey, sessionId)) {
    results.push(await runCheck(baseUrl, check));
  }

  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"} — ${result.name} (${result.detail})`);
  }

  process.exitCode = results.every((result) => result.pass) ? 0 : 1;
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}
