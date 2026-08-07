from snowplow_signals import Service

OWNER = "signals-demo@snowplowanalytics.com"


def build_service(attribute_group):
    return Service(
        name="fashion_ecommerce_demo",
        description="Serves live fashion personalization attributes to the Atelier Signals storefront.",
        owner=OWNER,
        attribute_groups=[attribute_group],
    )
