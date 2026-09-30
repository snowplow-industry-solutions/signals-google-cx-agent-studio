import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedAgentRequest } from "@/utils/agentAuth";
import { isDryRunTrackingRequest, resolveAgentIdentity, trackAgentDecisionLogged } from "@/utils/agentTracking";
import { validateAgentDecisionBody } from "@/utils/agentSelfTracking";

export async function POST(request: NextRequest) {
  if (!isAuthorizedAgentRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const validated = validateAgentDecisionBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const identity = resolveAgentIdentity(request);
  const decisionId = randomUUID();

  await trackAgentDecisionLogged({
    identity,
    dryRun: isDryRunTrackingRequest(request),
    decisionId,
    decisionType: validated.value.decisionType,
    reasoning: validated.value.reasoning,
    considerations: validated.value.considerations,
    loggedAt: new Date().toISOString(),
  });

  return NextResponse.json({ decision_id: decisionId });
}
