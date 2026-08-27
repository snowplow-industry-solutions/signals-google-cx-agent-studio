from snowplow_signals import Service

from signals.config.owner import OWNER


def build_service(attribute_group):
    return Service(
        name="fashion_ecommerce_demo",
        description="Serves live fashion personalization attributes to the Atelier Signals storefront.",
        owner=OWNER,
        attribute_groups=[attribute_group],
    )
