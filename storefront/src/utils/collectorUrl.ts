/**
 * Normalizes NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL before it reaches the tracker.
 *
 * BDP Console shows a pipeline's collector endpoint as a bare hostname
 * (`trial-xxxxx-yyyyy.collector.snplow.net`). Pasted into .env.local as-is, the
 * browser tracker resolves it against the page protocol: on http://localhost the
 * request goes out over http, the collector responds 308 to https *without* an
 * Access-Control-Allow-Origin header, and — because browsers never follow
 * redirects on a CORS preflight — every event is blocked and surfaces only as a
 * console CORS error. Forcing https makes that failure impossible.
 *
 * Local collectors (Snowplow Micro) are exempt: they serve plain http, so
 * upgrading them would break local testing rather than fix it.
 */

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isLocal(url: string): boolean {
  const withoutScheme = url.replace(/^https?:\/\//, "");
  const host = withoutScheme.split("/")[0].split(":")[0];
  return LOCAL_HOSTS.includes(host);
}

export function normalizeCollectorUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("http://")) {
    return isLocal(trimmed) ? trimmed : `https://${trimmed.slice("http://".length)}`;
  }

  if (trimmed.startsWith("https://")) {
    return trimmed;
  }

  return isLocal(trimmed) ? `http://${trimmed}` : `https://${trimmed}`;
}
