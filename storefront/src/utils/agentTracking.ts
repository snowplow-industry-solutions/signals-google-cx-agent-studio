import { randomUUID } from "node:crypto";

import { newTracker, buildSelfDescribingEvent } from "@snowplow/node-tracker";
import type { NextRequest } from "next/server";

import { normalizeCollectorUrl } from "@/utils/collectorUrl";

/**
 * Server-side agent tracking. One request-scoped Node tracker is built per
 * call (never shared -- identity setters are instance-wide and route
 * handlers run concurrently), emits a `tool_execution` event carrying the
 * agent's shared entities, and flushes before the caller returns its
 * response.
 */

const HEADER_CHAT_SESSION_ID = "x-ces-session-id";
const HEADER_SNOWPLOW_SESSION_ID = "x-snowplow-session-id";
const HEADER_SNOWPLOW_USER_ID = "x-snowplow-user-id";
const HEADER_TURN_ID = "x-snowplow-turn-id";

const TOOL_EXECUTION_SCHEMA = "iglu:com.snowplow.agent.tracking/tool_execution/jsonschema/1-0-0";
const AGENT_CONTEXT_SCHEMA = "iglu:com.snowplow.agent.tracking/agent_context/jsonschema/1-0-0";
const TOOL_CONTEXT_SCHEMA = "iglu:com.snowplow.agent.tracking/tool_context/jsonschema/1-0-0";
const CONVERSATION_SCHEMA = "iglu:com.snowplow_demo.fashion/conversation/jsonschema/1-0-0";
const CONTEXT_LOOKUP_SCHEMA = "iglu:com.snowplow_demo.fashion/context_lookup/jsonschema/1-0-0";
const CATALOG_SEARCH_SCHEMA = "iglu:com.snowplow_demo.fashion/catalog_search/jsonschema/1-0-0";
const USER_INTENT_DETECTED_SCHEMA = "iglu:com.snowplow.agent.tracking/user_intent_detected/jsonschema/1-0-0";
const AGENT_DECISION_LOGGED_SCHEMA = "iglu:com.snowplow.agent.tracking/agent_decision_logged/jsonschema/1-0-0";
const CONSTRAINT_VIOLATION_SCHEMA = "iglu:com.snowplow.agent.tracking/constraint_violation/jsonschema/1-0-0";

const HEADER_DRY_RUN = "x-agent-tracking-dry-run";

/**
 * Self-tracking endpoints (issue #21) honour this header so deploy
 * verification can probe production without creating events: the request is
 * still validated and answered normally, it just skips the emit step.
 */
export function isDryRunTrackingRequest(request: NextRequest): boolean {
  return request.headers.get(HEADER_DRY_RUN) === "1";
}

// Fixed rather than configurable: this identifies the concierge persona
// itself, not a deployment detail.
const AGENT_TYPE = "Atelier Concierge";
const MODEL_PROVIDER = "google";
// Matches terraform/terraform.tfvars.example's model_name illustration.
const DEFAULT_MODEL_NAME = "gemini-3.0-flash-001";

const TRACKER_NAMESPACE = "fashion_demo_agent";

export const MAX_TRACKED_QUERY_LENGTH = 200;

// Mirrors tracking-assets/data-structures/entities/catalog_search.yml's
// maxLength/maximum bounds, which the OpenAPI tool schema leaves unbounded.
const MAX_TRACKED_CATEGORY_LENGTH = 64;
const MAX_TRACKED_DESIGNER_LENGTH = 128;
const MAX_TRACKED_OCCASION_LENGTH = 64;
const MAX_TRACKED_COLOR_LENGTH = 64;
const MAX_TRACKED_PRICE = 100000;

/** Caps a free-text field before it's recorded on a tracking entity. Does not affect business logic. */
export function capFreeTextQuery(query: string, maxLength: number = MAX_TRACKED_QUERY_LENGTH): string {
  return query.slice(0, maxLength);
}

/** Clamps a price into the catalog_search entity's schema range, or null when out of range. */
export function clampTrackedMaxPrice(maxPrice: number | null): number | null {
  if (maxPrice === null || maxPrice < 0 || maxPrice > MAX_TRACKED_PRICE) {
    return null;
  }
  return maxPrice;
}

export interface AgentIdentity {
  chatSessionId: string | null;
  domainSessionId: string | null;
  domainUserId: string | null;
  turnId: string | null;
}

/**
 * Identity fallback rules (spec #18, "Identity threading"): headers are the
 * platform-injected source of truth; `fallbackSessionId` is the context
 * endpoint's pre-existing `session_id` query parameter, kept as a fallback
 * for the shopper's domain session id so an agent running the old tool
 * schema (without the headers) keeps working.
 */
export function resolveAgentIdentity(
  request: NextRequest,
  fallbackSessionId?: string | null
): AgentIdentity {
  const chatSessionId = request.headers.get(HEADER_CHAT_SESSION_ID);
  const domainSessionId = request.headers.get(HEADER_SNOWPLOW_SESSION_ID) ?? fallbackSessionId ?? null;
  const domainUserId = request.headers.get(HEADER_SNOWPLOW_USER_ID);
  const turnId = request.headers.get(HEADER_TURN_ID);

  return { chatSessionId, domainSessionId, domainUserId, turnId };
}

interface TrackingConfig {
  collectorUrl: string;
  appId: string;
}

let warnedMissingConfig = false;

function getTrackingConfig(): TrackingConfig | null {
  const collectorUrl = normalizeCollectorUrl(process.env.NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL);
  const publicAppId = process.env.NEXT_PUBLIC_SNOWPLOW_APP_ID;
  const appId = process.env.AGENT_SNOWPLOW_APP_ID || (publicAppId ? `${publicAppId}-agent` : "");

  if (!collectorUrl || !appId) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        "[Agent Tracking] NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL or an app id (AGENT_SNOWPLOW_APP_ID / NEXT_PUBLIC_SNOWPLOW_APP_ID) is not set; agent tool-execution tracking disabled."
      );
    }
    return null;
  }

  return { collectorUrl, appId };
}

function buildAgentContext(identity: AgentIdentity, invocationId: string) {
  const data: Record<string, unknown> = {
    invocation_id: invocationId,
    session_id: identity.chatSessionId ?? identity.domainSessionId ?? randomUUID(),
    agent_type: AGENT_TYPE,
    model_provider: MODEL_PROVIDER,
    model_name: process.env.AGENT_MODEL_NAME || DEFAULT_MODEL_NAME,
  };

  if (identity.domainUserId) {
    data.user_id = identity.domainUserId;
  }

  return { schema: AGENT_CONTEXT_SCHEMA, data };
}

function buildToolContext(toolName: string, toolCategory: "business" | "self_tracking", toolDescription: string) {
  return {
    schema: TOOL_CONTEXT_SCHEMA,
    data: {
      tool_name: toolName,
      tool_category: toolCategory,
      tool_call_id: randomUUID(),
      tool_description: toolDescription,
    },
  };
}

function buildConversation(identity: AgentIdentity) {
  return {
    schema: CONVERSATION_SCHEMA,
    data: {
      chat_session_id: identity.chatSessionId,
      turn_id: identity.turnId,
      turn_index: null,
      // Server-side tool calls can't tell a widget conversation from a
      // simulator run -- that distinction is only observable client-side.
      channel: "unknown" as const,
    },
  };
}

interface ToolExecutionArgs {
  identity: AgentIdentity;
  toolName: string;
  toolDescription: string;
  success: boolean;
  durationMs: number;
  domainEntity: { schema: string; data: Record<string, unknown> };
}

async function emitToolExecution({
  identity,
  toolName,
  toolDescription,
  success,
  durationMs,
  domainEntity,
}: ToolExecutionArgs): Promise<void> {
  const config = getTrackingConfig();
  if (!config) {
    return;
  }

  const tracker = newTracker(
    { namespace: TRACKER_NAMESPACE, appId: config.appId, encodeBase64: false },
    { endpoint: config.collectorUrl, bufferSize: 1, eventMethod: "post" }
  );

  if (identity.domainSessionId) {
    tracker.setSessionId(identity.domainSessionId);
  }
  if (identity.domainUserId) {
    tracker.setDomainUserId(identity.domainUserId);
  }

  const invocationId = identity.turnId ?? randomUUID();

  tracker.track(
    buildSelfDescribingEvent({
      event: {
        schema: TOOL_EXECUTION_SCHEMA,
        data: {
          invocation_id: invocationId,
          execution_duration_ms: Math.round(durationMs),
          success,
          executed_at: new Date().toISOString(),
        },
      },
    }),
    [
      buildToolContext(toolName, "business", toolDescription),
      buildAgentContext(identity, invocationId),
      buildConversation(identity),
      domainEntity,
    ]
  );

  await tracker.flush();
}

export type ContextLookupDegradedReason = "none" | "missing_session" | "no_credentials" | "upstream_error";

export interface ContextLookupTracking {
  profileReturned: boolean;
  activityReturned: boolean;
  profileAttributeCount: number;
  activityEventCount: number;
  signalsRoundTripMs: number;
  degradedReason: ContextLookupDegradedReason;
}

export async function trackContextLookupToolExecution(args: {
  identity: AgentIdentity;
  success: boolean;
  durationMs: number;
  contextLookup: ContextLookupTracking;
}): Promise<void> {
  await emitToolExecution({
    ...args,
    toolName: "getUserContext",
    toolDescription: "Fetch merged Signals context for a shopper session.",
    domainEntity: {
      schema: CONTEXT_LOOKUP_SCHEMA,
      data: {
        profile_returned: args.contextLookup.profileReturned,
        activity_returned: args.contextLookup.activityReturned,
        profile_attribute_count: args.contextLookup.profileAttributeCount,
        activity_event_count: args.contextLookup.activityEventCount,
        signals_round_trip_ms: Math.round(args.contextLookup.signalsRoundTripMs),
        degraded_reason: args.contextLookup.degradedReason,
      },
    },
  });
}

export interface CatalogSearchTracking {
  category: string | null;
  designer: string | null;
  occasion: string | null;
  color: string | null;
  maxPrice: number | null;
  query: string | null;
  limit: number;
  resultCount: number;
  productIds: string[];
}

export async function trackCatalogSearchToolExecution(args: {
  identity: AgentIdentity;
  success: boolean;
  durationMs: number;
  catalogSearch: CatalogSearchTracking;
}): Promise<void> {
  await emitToolExecution({
    ...args,
    toolName: "searchCatalog",
    toolDescription: "Search the product catalog with optional filters.",
    domainEntity: {
      schema: CATALOG_SEARCH_SCHEMA,
      data: {
        category: args.catalogSearch.category
          ? capFreeTextQuery(args.catalogSearch.category, MAX_TRACKED_CATEGORY_LENGTH)
          : null,
        designer: args.catalogSearch.designer
          ? capFreeTextQuery(args.catalogSearch.designer, MAX_TRACKED_DESIGNER_LENGTH)
          : null,
        occasion: args.catalogSearch.occasion
          ? capFreeTextQuery(args.catalogSearch.occasion, MAX_TRACKED_OCCASION_LENGTH)
          : null,
        color: args.catalogSearch.color
          ? capFreeTextQuery(args.catalogSearch.color, MAX_TRACKED_COLOR_LENGTH)
          : null,
        max_price: clampTrackedMaxPrice(args.catalogSearch.maxPrice),
        query: args.catalogSearch.query ? capFreeTextQuery(args.catalogSearch.query) : null,
        limit: args.catalogSearch.limit,
        result_count: args.catalogSearch.resultCount,
        product_ids: args.catalogSearch.productIds,
      },
    },
  });
}

/**
 * Self-tracking events (issue #21): unlike `emitToolExecution`, these track
 * the model's own reported thinking as the event itself, under the
 * `self_tracking` tool category, with no domain entity of their own.
 */
interface SelfTrackingEventArgs {
  identity: AgentIdentity;
  dryRun: boolean;
  toolName: string;
  toolDescription: string;
  eventSchema: string;
  buildEventData: (invocationId: string) => Record<string, unknown>;
}

async function emitSelfTrackingEvent({
  identity,
  dryRun,
  toolName,
  toolDescription,
  eventSchema,
  buildEventData,
}: SelfTrackingEventArgs): Promise<void> {
  if (dryRun) {
    return;
  }

  const config = getTrackingConfig();
  if (!config) {
    return;
  }

  const tracker = newTracker(
    { namespace: TRACKER_NAMESPACE, appId: config.appId, encodeBase64: false },
    { endpoint: config.collectorUrl, bufferSize: 1, eventMethod: "post" }
  );

  if (identity.domainSessionId) {
    tracker.setSessionId(identity.domainSessionId);
  }
  if (identity.domainUserId) {
    tracker.setDomainUserId(identity.domainUserId);
  }

  const invocationId = identity.turnId ?? randomUUID();

  tracker.track(
    buildSelfDescribingEvent({
      event: { schema: eventSchema, data: buildEventData(invocationId) },
    }),
    [buildToolContext(toolName, "self_tracking", toolDescription), buildAgentContext(identity, invocationId), buildConversation(identity)]
  );

  await tracker.flush();
}

export async function trackUserIntentDetected(args: {
  identity: AgentIdentity;
  dryRun: boolean;
  intentId: string;
  intentCategory: string;
  confidence: number;
  reasoning: string | null;
  detectedAt: string;
}): Promise<void> {
  await emitSelfTrackingEvent({
    identity: args.identity,
    dryRun: args.dryRun,
    toolName: "trackUserIntent",
    toolDescription: "Log the shopper intent category the agent detected this turn.",
    eventSchema: USER_INTENT_DETECTED_SCHEMA,
    buildEventData: (invocationId) => ({
      invocation_id: invocationId,
      intent_id: args.intentId,
      intent_category: args.intentCategory,
      confidence: args.confidence,
      reasoning: args.reasoning,
      detected_at: args.detectedAt,
    }),
  });
}

export async function trackAgentDecisionLogged(args: {
  identity: AgentIdentity;
  dryRun: boolean;
  decisionId: string;
  decisionType: string;
  reasoning: string;
  considerations: string[] | null;
  loggedAt: string;
}): Promise<void> {
  await emitSelfTrackingEvent({
    identity: args.identity,
    dryRun: args.dryRun,
    toolName: "trackAgentDecision",
    toolDescription: "Log a decision the agent made this turn and why.",
    eventSchema: AGENT_DECISION_LOGGED_SCHEMA,
    buildEventData: (invocationId) => ({
      invocation_id: invocationId,
      decision_id: args.decisionId,
      decision_type: args.decisionType,
      reasoning: args.reasoning,
      considerations: args.considerations,
      logged_at: args.loggedAt,
    }),
  });
}

export async function trackConstraintViolationLogged(args: {
  identity: AgentIdentity;
  dryRun: boolean;
  violationId: string;
  constraintType: string;
  userRequirement: string;
  reasonNotMet: string;
  alternativesConsidered: string[] | null;
  recommendation: string | null;
  violatedAt: string;
}): Promise<void> {
  await emitSelfTrackingEvent({
    identity: args.identity,
    dryRun: args.dryRun,
    toolName: "trackConstraintViolation",
    toolDescription: "Log a shopper requirement the catalog could not satisfy this turn.",
    eventSchema: CONSTRAINT_VIOLATION_SCHEMA,
    buildEventData: (invocationId) => ({
      invocation_id: invocationId,
      violation_id: args.violationId,
      constraint_type: args.constraintType,
      user_requirement: args.userRequirement,
      reason_not_met: args.reasonNotMet,
      alternatives_considered: args.alternativesConsidered,
      recommendation: args.recommendation,
      violated_at: args.violatedAt,
    }),
  });
}
