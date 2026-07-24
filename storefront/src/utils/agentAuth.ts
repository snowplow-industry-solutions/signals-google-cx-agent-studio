import { NextRequest } from "next/server";

const AGENT_API_KEY_HEADER = "x-agent-api-key";

/**
 * Shared-secret check for the agent-facing tool endpoints (context, catalog).
 * The secret is configured server-side only and mirrored in the OpenAPI
 * tool's API-key auth config — never exposed client-side.
 */
export function isAuthorizedAgentRequest(request: NextRequest): boolean {
  const expected = process.env.AGENT_SHARED_SECRET;
  if (!expected) {
    return false;
  }

  const provided = request.headers.get(AGENT_API_KEY_HEADER);
  return provided === expected;
}
