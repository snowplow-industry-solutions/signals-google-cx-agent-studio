from datetime import timedelta

from snowplow_signals import AttributeKey, domain_sessionid

from signals.config.owner import OWNER

DOMAIN_SESSION_ATTRIBUTE_KEY = domain_sessionid

APP_ID_ATTRIBUTE_KEY = AttributeKey(
    name="fashion_app_id",
    description="Application identifier for the Atelier Signals storefront.",
    key="app_id",
    owner=OWNER,
    ttl=timedelta(days=365),
)
