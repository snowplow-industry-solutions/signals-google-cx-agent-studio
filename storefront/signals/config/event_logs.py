from snowplow_signals import (
    EventLog,
    EventLogEntityProperty,
    EventLogEvent,
    EventLogEventProperty,
    EventSelection,
)

from signals.config.attribute_keys import DOMAIN_SESSION_ATTRIBUTE_KEY
from signals.config.owner import OWNER

VENDOR = "com.snowplow_demo.fashion"

# Every event below always carries the `product` entity affected by the
# interaction at context index 0 (see createProductContext usage in
# storefront/src/utils/snowtypeTracking.ts) -- the default index=0 on
# EventLogEntityProperty is correct without an override.
product_viewed = EventLogEvent(vendor=VENDOR, name="product_viewed", version="1-0-0")
cart_updated = EventLogEvent(vendor=VENDOR, name="cart_updated", version="1-0-0")
checkout_started = EventLogEvent(vendor=VENDOR, name="checkout_started", version="1-0-0")


def product_properties():
    return [
        EventLogEntityProperty(vendor=VENDOR, name="product", major_version=1, path="product_name"),
        EventLogEntityProperty(vendor=VENDOR, name="product", major_version=1, path="designer"),
        EventLogEntityProperty(vendor=VENDOR, name="product", major_version=1, path="category"),
        EventLogEntityProperty(vendor=VENDOR, name="product", major_version=1, path="occasion"),
        EventLogEntityProperty(vendor=VENDOR, name="product", major_version=1, path="price"),
    ]


cart_action = EventLogEventProperty(vendor=VENDOR, name="cart_updated", major_version=1, path="action")
checkout_step = EventLogEntityProperty(vendor=VENDOR, name="checkout", major_version=1, path="checkout_step")

CONCIERGE_PROMPT = (
    "You are interpreting a shopper's live browsing session for a luxury fashion "
    "concierge agent. Each event below happened just now, in order. Summarize the "
    "shopper's taste and intent in plain language: which designers, categories, and "
    "occasions they're drawn to; what they've added to or removed from their cart; "
    "and how far they've progressed through checkout. Refer to the shopper in the "
    "third person, keep it concise, and only state what the events actually show."
)


def build_event_log():
    return EventLog(
        name="fashion_session_activity",
        attribute_key=DOMAIN_SESSION_ATTRIBUTE_KEY,
        owner=OWNER,
        description=(
            "Live per-session narrative of browsing, cart, and checkout activity "
            "for the Atelier Signals concierge agent."
        ),
        prompt=CONCIERGE_PROMPT,
        max_events=100,
        max_age_seconds=3600,
        events=[
            EventSelection(event=product_viewed, properties=product_properties()),
            EventSelection(event=cart_updated, properties=[cart_action, *product_properties()]),
            EventSelection(event=checkout_started, properties=[checkout_step]),
        ],
    )
