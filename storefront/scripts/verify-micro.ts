#!/usr/bin/env tsx
/**
 * Local tracking smoke test (issue #20): fires the agent tool endpoints
 * against a running dev server pointed at Snowplow Micro, then reads
 * Micro's good/bad event store and asserts that the expected events landed,
 * with the right schema and the shopper's identity attached.
 *
 * A human runs this after `npm run dev` (with the dev server's
 * NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL pointed at Micro) and `npm run
 * micro:up` — see storefront/README.md's Micro workflow. It needs both a
 * live dev server and a live Micro, so it is not run in CI.
 *
 * Add an entry to AGENT_ENDPOINTS to cover another instrumented endpoint —
 * the self-tracking tool endpoints (issue #21) will add three.
 *
 * Usage: AGENT_SHARED_SECRET=<secret> npm run verify:micro -- [devServerUrl] [microUrl]
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_HEADER = "x-agent-api-key";
const HEADER_CHAT_SESSION_ID = "x-ces-session-id";
const HEADER_SNOWPLOW_SESSION_ID = "x-snowplow-session-id";
const HEADER_SNOWPLOW_USER_ID = "x-snowplow-user-id";
const HEADER_TURN_ID = "x-snowplow-turn-id";

// Mirrors the schema constants in src/utils/agentTracking.ts. Duplicated
// rather than imported so this script stays a standalone Node process, like
// the existing verify-deploy.ts.
export const TOOL_EXECUTION_SCHEMA = "iglu:com.snowplow.agent.tracking/tool_execution/jsonschema/1-0-0";

export interface AgentIdentity {
  chatSessionId: string;
  domainSessionId: string;
  domainUserId: string;
  turnId: string;
}

export interface ExpectedGoodEvent {
  schema: string;
  count: number;
}

export interface AgentEndpointSpec {
  name: string;
  request: (devServerUrl: string, apiKey: string, identity: AgentIdentity) => { url: string; init: RequestInit };
  expectedGoodEvents: ExpectedGoodEvent[];
}

function identityHeaders(apiKey: string, identity: AgentIdentity): Record<string, string> {
  return {
    [AUTH_HEADER]: apiKey,
    [HEADER_CHAT_SESSION_ID]: identity.chatSessionId,
    [HEADER_SNOWPLOW_SESSION_ID]: identity.domainSessionId,
    [HEADER_SNOWPLOW_USER_ID]: identity.domainUserId,
    [HEADER_TURN_ID]: identity.turnId,
  };
}

export const AGENT_ENDPOINTS: AgentEndpointSpec[] = [
  {
    name: "getUserContext tool execution",
    request: (devServerUrl, apiKey, identity) => ({
      url: new URL(
        `/api/agent/context?session_id=${encodeURIComponent(identity.domainSessionId)}`,
        devServerUrl,
      ).toString(),
      init: { headers: identityHeaders(apiKey, identity) },
    }),
    expectedGoodEvents: [{ schema: TOOL_EXECUTION_SCHEMA, count: 1 }],
  },
  {
    name: "searchCatalog tool execution",
    request: (devServerUrl, apiKey, identity) => ({
      url: new URL("/api/agent/catalog?category=dresses", devServerUrl).toString(),
      init: { headers: identityHeaders(apiKey, identity) },
    }),
    expectedGoodEvents: [{ schema: TOOL_EXECUTION_SCHEMA, count: 1 }],
  },
];

export function aggregateExpectedCounts(specs: readonly AgentEndpointSpec[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const spec of specs) {
    for (const { schema, count } of spec.expectedGoodEvents) {
      totals.set(schema, (totals.get(schema) ?? 0) + count);
    }
  }
  return totals;
}

export interface MicroGoodEvent {
  event?: Record<string, unknown>;
}

/** Micro's good-event JSON nests the tracked self-describing event under event.unstruct_event.data. */
export function extractGoodEventSchema(goodEvent: MicroGoodEvent): string | null {
  const unstructEvent = goodEvent.event?.unstruct_event as { data?: { schema?: string } } | undefined;
  return unstructEvent?.data?.schema ?? null;
}

export function extractGoodEventIdentity(goodEvent: MicroGoodEvent): {
  domainSessionId: string | null;
  domainUserId: string | null;
} {
  const event = goodEvent.event ?? {};
  return {
    domainSessionId: (event.domain_sessionid as string | undefined) ?? null,
    domainUserId: (event.domain_userid as string | undefined) ?? null,
  };
}

export function countGoodEventsBySchema(goodEvents: readonly MicroGoodEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const goodEvent of goodEvents) {
    const schema = extractGoodEventSchema(goodEvent);
    if (!schema) continue;
    counts.set(schema, (counts.get(schema) ?? 0) + 1);
  }
  return counts;
}

export interface SchemaCountMismatch {
  schema: string;
  expected: number;
  actual: number;
}

export function diffSchemaCounts(
  expected: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
): SchemaCountMismatch[] {
  const mismatches: SchemaCountMismatch[] = [];
  for (const [schema, expectedCount] of expected) {
    const actualCount = actual.get(schema) ?? 0;
    if (actualCount !== expectedCount) {
      mismatches.push({ schema, expected: expectedCount, actual: actualCount });
    }
  }
  return mismatches;
}

/** Every server-side agent event should carry the shopper's identity (spec #18), not just tool_execution. */
export function findIdentityMismatches(goodEvents: readonly MicroGoodEvent[], identity: AgentIdentity): string[] {
  const problems: string[] = [];

  goodEvents.forEach((goodEvent, index) => {
    const schema = extractGoodEventSchema(goodEvent) ?? "(unknown schema)";
    const { domainSessionId, domainUserId } = extractGoodEventIdentity(goodEvent);

    if (domainSessionId !== identity.domainSessionId) {
      problems.push(
        `good event ${index} (${schema}): expected domain_sessionid "${identity.domainSessionId}", got "${domainSessionId}"`,
      );
    }
    if (domainUserId !== identity.domainUserId) {
      problems.push(
        `good event ${index} (${schema}): expected domain_userid "${identity.domainUserId}", got "${domainUserId}"`,
      );
    }
  });

  return problems;
}

export interface RunResult {
  requestFailures: string[];
  schemaMismatches: SchemaCountMismatch[];
  badEventCount: number;
  identityProblems: string[];
}

export function evaluateRun(result: RunResult): { pass: boolean; lines: string[] } {
  const lines: string[] = [];
  let pass = true;

  if (result.requestFailures.length > 0) {
    pass = false;
    for (const failure of result.requestFailures) lines.push(`FAIL - ${failure}`);
  } else {
    lines.push("PASS - every endpoint request completed");
  }

  if (result.schemaMismatches.length > 0) {
    pass = false;
    for (const mismatch of result.schemaMismatches) {
      lines.push(`FAIL - ${mismatch.schema}: expected ${mismatch.expected} good event(s), found ${mismatch.actual}`);
    }
  } else {
    lines.push("PASS - good event counts matched expectations for every schema");
  }

  if (result.badEventCount !== 0) {
    pass = false;
    lines.push(`FAIL - ${result.badEventCount} bad event(s) in Micro`);
  } else {
    lines.push("PASS - zero bad events in Micro");
  }

  if (result.identityProblems.length > 0) {
    pass = false;
    for (const problem of result.identityProblems) lines.push(`FAIL - ${problem}`);
  } else {
    lines.push("PASS - identity fields arrived on every good event");
  }

  return { pass, lines };
}

export async function fireEndpoints(
  devServerUrl: string,
  apiKey: string,
  identity: AgentIdentity,
  specs: readonly AgentEndpointSpec[],
): Promise<string[]> {
  const failures: string[] = [];
  for (const spec of specs) {
    const { url, init } = spec.request(devServerUrl, apiKey, identity);
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        failures.push(`${spec.name}: ${url} responded ${response.status}`);
      }
    } catch (error) {
      failures.push(`${spec.name}: ${url} request failed (${(error as Error).message})`);
    }
  }
  return failures;
}

export async function fetchMicroGoodEvents(microUrl: string): Promise<MicroGoodEvent[]> {
  const response = await fetch(new URL("/micro/good", microUrl));
  return (await response.json()) as MicroGoodEvent[];
}

export async function fetchMicroBadCount(microUrl: string): Promise<number> {
  const response = await fetch(new URL("/micro/bad", microUrl));
  const bad = (await response.json()) as unknown[];
  return bad.length;
}

export async function resetMicro(microUrl: string): Promise<void> {
  await fetch(new URL("/micro/reset", microUrl));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_POLL_ATTEMPTS = 10;
const DEFAULT_POLL_DELAY_MS = 500;

export async function waitForExpectedCount(
  microUrl: string,
  expectedTotal: number,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<MicroGoodEvent[]> {
  const attempts = options.attempts ?? DEFAULT_POLL_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_POLL_DELAY_MS;

  let goodEvents: MicroGoodEvent[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    goodEvents = await fetchMicroGoodEvents(microUrl);
    if (goodEvents.length >= expectedTotal) {
      break;
    }
    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }
  return goodEvents;
}

async function main(): Promise<void> {
  const [devServerUrlArg, microUrlArg] = process.argv.slice(2);
  const devServerUrl = devServerUrlArg ?? "http://localhost:3001";
  const microUrl = microUrlArg ?? "http://localhost:9090";

  const apiKey = process.env.AGENT_SHARED_SECRET;
  if (!apiKey) {
    console.error("Missing required environment variable: AGENT_SHARED_SECRET");
    process.exitCode = 1;
    return;
  }

  const identity: AgentIdentity = {
    chatSessionId: randomUUID(),
    domainSessionId: randomUUID(),
    domainUserId: randomUUID(),
    turnId: randomUUID(),
  };

  await resetMicro(microUrl);

  const requestFailures = await fireEndpoints(devServerUrl, apiKey, identity, AGENT_ENDPOINTS);

  const expectedCounts = aggregateExpectedCounts(AGENT_ENDPOINTS);
  const expectedTotal = [...expectedCounts.values()].reduce((sum, count) => sum + count, 0);
  const goodEvents = await waitForExpectedCount(microUrl, expectedTotal);
  const badEventCount = await fetchMicroBadCount(microUrl);

  const actualCounts = countGoodEventsBySchema(goodEvents);
  const schemaMismatches = diffSchemaCounts(expectedCounts, actualCounts);
  const identityProblems = findIdentityMismatches(goodEvents, identity);

  const { pass, lines } = evaluateRun({ requestFailures, schemaMismatches, badEventCount, identityProblems });

  console.log(`Agent tracking smoke test — dev server ${devServerUrl}, Micro ${microUrl}\n`);
  for (const line of lines) {
    console.log(line);
  }
  console.log(`\n${pass ? "PASS" : "FAIL"} overall (${goodEvents.length} good, ${badEventCount} bad in Micro)`);

  process.exitCode = pass ? 0 : 1;
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}
