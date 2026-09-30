import { describe, expect, it } from "vitest";

import {
  validateAgentDecisionBody,
  validateConstraintViolationBody,
  validateUserIntentBody,
} from "./agentSelfTracking";

describe("validateUserIntentBody", () => {
  it.each([
    [{ intent_category: "gift", confidence: 0.5 }, true],
    [{ intent_category: "gift", confidence: 0 }, true],
    [{ intent_category: "gift", confidence: 1 }, true],
    [{ intent_category: "gift", confidence: 0.5, reasoning: "Because." }, true],
    [{ intent_category: "gift", confidence: 0.5, reasoning: null }, true],
    [null, false],
    ["not an object", false],
    [{ confidence: 0.5 }, false],
    [{ intent_category: "not_a_real_category", confidence: 0.5 }, false],
    [{ intent_category: "gift" }, false],
    [{ intent_category: "gift", confidence: -0.01 }, false],
    [{ intent_category: "gift", confidence: 1.01 }, false],
    [{ intent_category: "gift", confidence: "0.5" }, false],
    [{ intent_category: "gift", confidence: 0.5, reasoning: 42 }, false],
  ])("validates %j -> ok=%s", (body, expectedOk) => {
    expect(validateUserIntentBody(body).ok).toBe(expectedOk);
  });

  it("caps reasoning to the Iglu schema's maxLength", () => {
    const overLength = "x".repeat(2100);
    const result = validateUserIntentBody({ intent_category: "gift", confidence: 0.5, reasoning: overLength });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reasoning?.length).toBe(2000);
    }
  });

  it("defaults reasoning to null when absent", () => {
    const result = validateUserIntentBody({ intent_category: "gift", confidence: 0.5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reasoning).toBeNull();
    }
  });
});

describe("validateAgentDecisionBody", () => {
  it.each([
    [{ decision_type: "tool_selection", reasoning: "Because." }, true],
    [{ decision_type: "tool_selection", reasoning: "Because.", considerations: ["a", "b"] }, true],
    [{ decision_type: "tool_selection", reasoning: "Because.", considerations: null }, true],
    [null, false],
    [{ reasoning: "Because." }, false],
    [{ decision_type: "not_a_real_type", reasoning: "Because." }, false],
    [{ decision_type: "tool_selection" }, false],
    [{ decision_type: "tool_selection", reasoning: "" }, false],
    [{ decision_type: "tool_selection", reasoning: 42 }, false],
    [{ decision_type: "tool_selection", reasoning: "Because.", considerations: "not-an-array" }, false],
    [{ decision_type: "tool_selection", reasoning: "Because.", considerations: [1, 2] }, false],
  ])("validates %j -> ok=%s", (body, expectedOk) => {
    expect(validateAgentDecisionBody(body).ok).toBe(expectedOk);
  });

  it("caps each consideration to the Iglu schema's maxLength", () => {
    const overLength = "x".repeat(2100);
    const result = validateAgentDecisionBody({
      decision_type: "tool_selection",
      reasoning: "Because.",
      considerations: [overLength],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.considerations?.[0].length).toBe(2000);
    }
  });
});

describe("validateConstraintViolationBody", () => {
  const VALID = { constraint_type: "budget", requirement: "Under $200.", reason_not_met: "Nothing in stock." };

  it.each([
    [VALID, true],
    [{ ...VALID, alternatives_considered: ["a"] }, true],
    [{ ...VALID, alternatives_considered: null }, true],
    [{ ...VALID, recommendation: "Try this instead." }, true],
    [{ ...VALID, recommendation: null }, true],
    [null, false],
    [{ ...VALID, constraint_type: "not_a_real_type" }, false],
    [{ requirement: VALID.requirement, reason_not_met: VALID.reason_not_met }, false],
    [{ constraint_type: VALID.constraint_type, reason_not_met: VALID.reason_not_met }, false],
    [{ ...VALID, requirement: "" }, false],
    [{ ...VALID, reason_not_met: "" }, false],
    [{ ...VALID, alternatives_considered: "not-an-array" }, false],
    [{ ...VALID, alternatives_considered: [1, 2] }, false],
    [{ ...VALID, recommendation: 42 }, false],
  ])("validates %j -> ok=%s", (body, expectedOk) => {
    expect(validateConstraintViolationBody(body).ok).toBe(expectedOk);
  });

  it("caps requirement, reason_not_met, alternatives, and recommendation to the Iglu schema's maxLengths", () => {
    const result = validateConstraintViolationBody({
      constraint_type: "budget",
      requirement: "x".repeat(1100),
      reason_not_met: "y".repeat(2100),
      alternatives_considered: ["z".repeat(1100)],
      recommendation: "w".repeat(1100),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requirement.length).toBe(1000);
      expect(result.value.reasonNotMet.length).toBe(2000);
      expect(result.value.alternativesConsidered?.[0].length).toBe(1000);
      expect(result.value.recommendation?.length).toBe(1000);
    }
  });

  it("defaults alternatives_considered and recommendation to null when absent", () => {
    const result = validateConstraintViolationBody(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alternativesConsidered).toBeNull();
      expect(result.value.recommendation).toBeNull();
    }
  });
});
