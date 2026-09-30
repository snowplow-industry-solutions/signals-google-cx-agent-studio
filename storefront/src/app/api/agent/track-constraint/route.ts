import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedAgentRequest } from "@/utils/agentAuth";
import { isDryRunTrackingRequest, resolveAgentIdentity, trackConstraintViolationLogged } from "@/utils/agentTracking";
import { validateConstraintViolationBody } from "@/utils/agentSelfTracking";

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

  const validated = validateConstraintViolationBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const identity = resolveAgentIdentity(request);
  const violationId = randomUUID();

  await trackConstraintViolationLogged({
    identity,
    dryRun: isDryRunTrackingRequest(request),
    violationId,
    constraintType: validated.value.constraintType,
    userRequirement: validated.value.requirement,
    reasonNotMet: validated.value.reasonNotMet,
    alternativesConsidered: validated.value.alternativesConsidered,
    recommendation: validated.value.recommendation,
    violatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ violation_id: violationId });
}
