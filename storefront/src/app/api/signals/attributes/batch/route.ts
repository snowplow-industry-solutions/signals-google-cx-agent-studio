import { NextRequest, NextResponse } from "next/server";
import { Signals } from "@snowplow/signals-node";

function getSignalsClient() {
  const baseUrl = process.env.SIGNALS_DEPLOYED_URL;
  const apiKey = process.env.SNOWPLOW_CONSOLE_API_KEY;
  const apiKeyId = process.env.SNOWPLOW_CONSOLE_API_KEY_ID;
  const organizationId = process.env.SNOWPLOW_CONSOLE_ORG_ID;

  if (!baseUrl || !apiKey || !apiKeyId || !organizationId) {
    return null;
  }

  return new Signals({
    baseUrl,
    apiKey,
    apiKeyId,
    organizationId,
  });
}

export async function POST(request: NextRequest) {
  const signals = getSignalsClient();
  if (!signals) {
    return NextResponse.json(
      { error: "Signals credentials are not configured on the server." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const identifiers = body.identifiers as string[] | undefined;
  const serviceName = body.serviceName ?? "fashion_ecommerce_demo";
  const attributeKey = body.attributeKey ?? "domain_sessionid";

  if (!identifiers || identifiers.length === 0) {
    return NextResponse.json(
      { error: "A non-empty identifiers array is required." },
      { status: 400 }
    );
  }

  try {
    const attributes = await signals.getBatchServiceAttributes({
      name: serviceName,
      attribute_key: attributeKey,
      identifiers: identifiers as [string, ...string[]],
    });

    return NextResponse.json({ attributes });
  } catch (error) {
    console.error("[Signals Demo] Failed to fetch batch Signals attributes", error);
    return NextResponse.json(
      { error: "Failed to retrieve batch Signals attributes." },
      { status: 500 }
    );
  }
}
