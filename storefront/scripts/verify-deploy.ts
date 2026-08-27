#!/usr/bin/env tsx
/**
 * Post-deploy smoke test for the agent-facing tool endpoints and the
 * ces-messenger widget embed.
 *
 * A human runs this after triggering the Vercel deploy, against the public
 * HTTPS URL Vercel assigns, to confirm the site is reachable, that
 * /api/agent/context + /api/agent/catalog enforce the shared-secret header
 * and return the expected payload shape, and that the homepage HTML embeds
 * the ces-messenger script and element. It does not replace the browser
 * walkthrough (browse -> context reflects that session, widget delivers the
 * session id to a live agent turn) from docs/setup-cx-agent-studio.md.
 *
 * Usage: AGENT_SHARED_SECRET=<secret> npm run verify:deploy -- <base-url> [session_id]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_HEADER = "x-agent-api-key";

export interface Check {
  name: string;
  path: string;
  headers?: Record<string, string>;
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
  const response = await fetch(new URL(check.path, baseUrl), { headers: check.headers });
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
