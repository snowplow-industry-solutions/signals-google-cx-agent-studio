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

export async function GET(request: NextRequest) {
  const signals = getSignalsClient();
  if (!signals) {
    return NextResponse.json(
      { error: "Signals credentials are not configured on the server." },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const identifier = searchParams.get("identifier");
  const serviceName = searchParams.get("serviceName") ?? "fashion_ecommerce_demo";
  const attributeKey = searchParams.get("attributeKey") ?? "domain_sessionid";

  if (!identifier) {
    return NextResponse.json({ error: "Identifier is required." }, { status: 400 });
  }

  try {
    const attributes = await signals.getServiceAttributes({
      name: serviceName,
      attribute_key: attributeKey,
      identifier,
    });

    return NextResponse.json({ attributes });
  } catch (error) {
    console.error("[Signals Demo] Failed to fetch service attributes", error);
    return NextResponse.json(
      { error: "Failed to retrieve Signals attributes." },
      { status: 500 }
    );
  }
}
