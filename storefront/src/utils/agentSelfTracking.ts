import { capFreeTextQuery } from "@/utils/agentTracking";

/**
 * Request-body validation for the three self-tracking tool endpoints
 * The Iglu Central `com.snowplow.agent.tracking` schemas leave
 * category/type fields as free-form strings; the vocabularies below are the
 * app's own constraint on top ("permissive schemas, strict code"). Enum and range violations are rejected (400); free-text
 * fields are capped to the Iglu schemas' maxLength rather than rejected.
 */

export const INTENT_CATEGORIES = [
  "browse_inspiration",
  "find_specific_item",
  "complete_look",
  "occasion_dressing",
  "gift",
  "price_check",
  "order_or_checkout_help",
  "other",
] as const;
export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

export const DECISION_TYPES = [
  "tool_selection",
  "recommendation_choice",
  "widget_choice",
  "clarification_needed",
  "constraint_handling",
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const CONSTRAINT_TYPES = [
  "budget",
  "availability",
  "category_mismatch",
  "designer_unavailable",
  "colour_mismatch",
  "other",
] as const;
export type ConstraintType = (typeof CONSTRAINT_TYPES)[number];

// Iglu Central com.snowplow.agent.tracking 1-0-0 maxLength bounds.
const MAX_REASONING_LENGTH = 2000;
const MAX_CONSIDERATION_LENGTH = 2000;
const MAX_REQUIREMENT_LENGTH = 1000;
const MAX_REASON_NOT_MET_LENGTH = 2000;
const MAX_ALTERNATIVE_LENGTH = 1000;
const MAX_RECOMMENDATION_LENGTH = 1000;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export interface UserIntentBody {
  intentCategory: IntentCategory;
  confidence: number;
  reasoning: string | null;
}

export function validateUserIntentBody(body: unknown): ValidationResult<UserIntentBody> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const { intent_category: intentCategory, confidence, reasoning } = body;

  if (typeof intentCategory !== "string" || !(INTENT_CATEGORIES as readonly string[]).includes(intentCategory)) {
    return { ok: false, error: `intent_category must be one of: ${INTENT_CATEGORIES.join(", ")}.` };
  }
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, error: "confidence must be a number between 0 and 1." };
  }
  if (reasoning !== undefined && reasoning !== null && typeof reasoning !== "string") {
    return { ok: false, error: "reasoning must be a string when provided." };
  }

  return {
    ok: true,
    value: {
      intentCategory: intentCategory as IntentCategory,
      confidence,
      reasoning: typeof reasoning === "string" ? capFreeTextQuery(reasoning, MAX_REASONING_LENGTH) : null,
    },
  };
}

export interface AgentDecisionBody {
  decisionType: DecisionType;
  reasoning: string;
  considerations: string[] | null;
}

export function validateAgentDecisionBody(body: unknown): ValidationResult<AgentDecisionBody> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const { decision_type: decisionType, reasoning, considerations } = body;

  if (typeof decisionType !== "string" || !(DECISION_TYPES as readonly string[]).includes(decisionType)) {
    return { ok: false, error: `decision_type must be one of: ${DECISION_TYPES.join(", ")}.` };
  }
  if (typeof reasoning !== "string" || reasoning.length === 0) {
    return { ok: false, error: "reasoning is required and must be a non-empty string." };
  }
  if (considerations !== undefined && considerations !== null && !isStringArray(considerations)) {
    return { ok: false, error: "considerations must be an array of strings when provided." };
  }

  return {
    ok: true,
    value: {
      decisionType: decisionType as DecisionType,
      reasoning: capFreeTextQuery(reasoning, MAX_REASONING_LENGTH),
      considerations: considerations
        ? considerations.map((consideration) => capFreeTextQuery(consideration, MAX_CONSIDERATION_LENGTH))
        : null,
    },
  };
}

export interface ConstraintViolationBody {
  constraintType: ConstraintType;
  requirement: string;
  reasonNotMet: string;
  alternativesConsidered: string[] | null;
  recommendation: string | null;
}

export function validateConstraintViolationBody(body: unknown): ValidationResult<ConstraintViolationBody> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const {
    constraint_type: constraintType,
    requirement,
    reason_not_met: reasonNotMet,
    alternatives_considered: alternativesConsidered,
    recommendation,
  } = body;

  if (typeof constraintType !== "string" || !(CONSTRAINT_TYPES as readonly string[]).includes(constraintType)) {
    return { ok: false, error: `constraint_type must be one of: ${CONSTRAINT_TYPES.join(", ")}.` };
  }
  if (typeof requirement !== "string" || requirement.length === 0) {
    return { ok: false, error: "requirement is required and must be a non-empty string." };
  }
  if (typeof reasonNotMet !== "string" || reasonNotMet.length === 0) {
    return { ok: false, error: "reason_not_met is required and must be a non-empty string." };
  }
  if (alternativesConsidered !== undefined && alternativesConsidered !== null && !isStringArray(alternativesConsidered)) {
    return { ok: false, error: "alternatives_considered must be an array of strings when provided." };
  }
  if (recommendation !== undefined && recommendation !== null && typeof recommendation !== "string") {
    return { ok: false, error: "recommendation must be a string when provided." };
  }

  return {
    ok: true,
    value: {
      constraintType: constraintType as ConstraintType,
      requirement: capFreeTextQuery(requirement, MAX_REQUIREMENT_LENGTH),
      reasonNotMet: capFreeTextQuery(reasonNotMet, MAX_REASON_NOT_MET_LENGTH),
      alternativesConsidered: alternativesConsidered
        ? alternativesConsidered.map((alternative) => capFreeTextQuery(alternative, MAX_ALTERNATIVE_LENGTH))
        : null,
      recommendation: typeof recommendation === "string" ? capFreeTextQuery(recommendation, MAX_RECOMMENDATION_LENGTH) : null,
    },
  };
}
