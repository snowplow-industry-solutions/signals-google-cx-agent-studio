#!/usr/bin/env bash
#
# Prints what Signals holds for one shopper session: the recent event stream
# from the fashion_session_activity Agentic Context event log, and the live
# attributes the fashion_ecommerce_demo service serves for that session.
#
# Usage: scripts/get-info-from-signals.sh <domain_sessionid>
#
# The session id is the storefront's Snowplow domain_sessionid (the widget's
# "Passed Snowplow identity variables" console line prints it). Credentials
# come from storefront/.env.local: SNOWPLOW_CONSOLE_ORG_ID,
# SNOWPLOW_CONSOLE_API_KEY_ID, SNOWPLOW_CONSOLE_API_KEY and
# SIGNALS_DEPLOYED_URL. Requires curl and jq.

set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: $0 <domain_sessionid>" >&2
  exit 2
fi
session_id="$1"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/storefront/.env.local"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file -- copy storefront/.env.example and fill it in first." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
. "$env_file"
set +a

for var in SNOWPLOW_CONSOLE_ORG_ID SNOWPLOW_CONSOLE_API_KEY_ID SNOWPLOW_CONSOLE_API_KEY SIGNALS_DEPLOYED_URL; do
  if [[ -z "${!var:-}" ]]; then
    echo "$var is not set in $env_file" >&2
    exit 1
  fi
done

token="$(curl -sf \
  -H "X-API-Key-Id: $SNOWPLOW_CONSOLE_API_KEY_ID" \
  -H "X-API-Key: $SNOWPLOW_CONSOLE_API_KEY" \
  "https://console.snowplowanalytics.com/api/msc/v1/organizations/$SNOWPLOW_CONSOLE_ORG_ID/credentials/v3/token" \
  | jq -r .accessToken)"

echo "Agentic Context endpoint - recent stream of events and agent instructions"
curl -sf -G \
  -H "Authorization: Bearer $token" \
  --data-urlencode "name=fashion_session_activity" \
  --data-urlencode "identifier=$session_id" \
  --data-urlencode "format=json" \
  "$SIGNALS_DEPLOYED_URL/api/v1/event_log" \
  | jq

echo "Profile Store - live session attributes"
curl -sf -X POST \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$session_id" \
    '{service: "fashion_ecommerce_demo", attribute_keys: {domain_sessionid: [$id]}}')" \
  "$SIGNALS_DEPLOYED_URL/api/v1/get-online-attributes" \
  | jq
