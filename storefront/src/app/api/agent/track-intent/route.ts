import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedAgentRequest } from "@/utils/agentAuth";
import { isDryRunTrackingRequest, resolveAgentIdentity, trackUserIntentDetected } from "@/utils/agentTracking";
import { validateUserIntentBody } from "@/utils/agentSelfTracking";

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

  const validated = validateUserIntentBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const identity = resolveAgentIdentity(request);
  const intentId = randomUUID();

  await trackUserIntentDetected({
    identity,
    dryRun: isDryRunTrackingRequest(request),
    intentId,
    intentCategory: validated.value.intentCategory,
    confidence: validated.value.confidence,
    reasoning: validated.value.reasoning,
    detectedAt: new Date().toISOString(),
  });

  return NextResponse.json({ intent_id: intentId });
}
