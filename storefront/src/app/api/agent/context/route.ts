import { NextRequest, NextResponse } from "next/server";
import { Signals } from "@snowplow/signals-node";

import { isAuthorizedAgentRequest } from "@/utils/agentAuth";

const SERVICE_NAME = "fashion_ecommerce_demo";
const EVENT_LOG_NAME = "fashion_session_activity";
const ATTRIBUTE_KEY = "domain_sessionid";

type FlatProfile = Record<string, string | number | boolean>;

interface ContextPayload {
  profile: FlatProfile;
  recent_activity: string;
  agent_instructions: string;
}

const DEGRADED_PAYLOAD: ContextPayload = {
  profile: {},
  recent_activity: "",
  agent_instructions: "",
};

// The published SDK type for the default (JSON) getAgenticContext() response
// omits `summary`, but the underlying /api/v1/event_log endpoint always
// returns it -- the parallel Python SDK's AgenticContextResponse model
// declares it as a required field against the same endpoint. This interface
// just fills that typing gap.
interface AgenticContextJson {
  summary?: string;
  prompt?: string;
  events?: Record<string, unknown>[];
}

function getSignalsClient(): Signals | null {
  const baseUrl = process.env.SIGNALS_DEPLOYED_URL;
  const apiKey = process.env.SNOWPLOW_CONSOLE_API_KEY;
  const apiKeyId = process.env.SNOWPLOW_CONSOLE_API_KEY_ID;
  const organizationId = process.env.SNOWPLOW_CONSOLE_ORG_ID;

  if (!baseUrl || !apiKey || !apiKeyId || !organizationId) {
    return null;
  }

  return new Signals({ baseUrl, apiKey, apiKeyId, organizationId });
}

function renderEventValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(renderEventValue).join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => `${key}: ${renderEventValue(entryValue)}`)
      .join(", ");
  }
  return String(value);
}

function renderEventLines(events: Record<string, unknown>[]): string[] {
  return events.map((event) => {
    const pairs = Object.entries(event)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}: ${renderEventValue(value)}`);
    return `- ${pairs.join(", ")}`;
  });
}

function flattenProfile(attributes: Record<string, unknown>): FlatProfile {
  const flattened: FlatProfile = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        flattened[key] = value.join(", ");
      }
      continue;
    }

    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 0) {
        flattened[key] = entries
          .map(([entryKey, entryValue]) => `${entryKey}: ${entryValue}`)
          .join(", ");
      }
      continue;
    }

    flattened[key] = value as string | number | boolean;
  }

  return flattened;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAgentRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json(DEGRADED_PAYLOAD);
  }

  const signals = getSignalsClient();
  if (!signals) {
    return NextResponse.json(DEGRADED_PAYLOAD);
  }

  const [profileResult, contextResult] = await Promise.allSettled([
    signals.getServiceAttributes({
      name: SERVICE_NAME,
      attribute_key: ATTRIBUTE_KEY,
      identifier: sessionId,
    }),
    signals.getAgenticContext({
      name: EVENT_LOG_NAME,
      identifier: sessionId,
      format: "json",
    }),
  ]);

  let profile: FlatProfile = {};
  if (profileResult.status === "fulfilled") {
    profile = flattenProfile(profileResult.value);
  } else {
    console.error("[Signals Demo] Failed to fetch profile attributes", profileResult.reason);
  }

  let recentActivity = "";
  let agentInstructions = "";
  if (contextResult.status === "fulfilled") {
    const context = contextResult.value as AgenticContextJson;
    recentActivity = [context.summary ?? "", ...renderEventLines(context.events ?? [])]
      .filter(Boolean)
      .join("\n");
    agentInstructions = context.prompt ?? "";
  } else {
    console.error("[Signals Demo] Failed to fetch agentic context", contextResult.reason);
  }

  return NextResponse.json({
    profile,
    recent_activity: recentActivity,
    agent_instructions: agentInstructions,
  });
}
