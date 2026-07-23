from datetime import timedelta

from snowplow_signals import (
    Attribute,
    Criteria,
    Criterion,
    EntityProperty,
    Event,
    EventProperty,
    StreamAttributeGroup,
)

from signals.config.attribute_keys import DOMAIN_SESSION_ATTRIBUTE_KEY

OWNER = "signals-demo@snowplowanalytics.com"
VENDOR = "com.snowplow_demo.fashion"

product_viewed = Event(vendor=VENDOR, name="product_viewed", version="1-0-0")
product_list_clicked = Event(vendor=VENDOR, name="product_list_clicked", version="1-0-0")
cart_updated = Event(vendor=VENDOR, name="cart_updated", version="1-0-0")
cart_viewed = Event(vendor=VENDOR, name="cart_viewed", version="1-0-0")
checkout_started = Event(vendor=VENDOR, name="checkout_started", version="1-0-0")
checkout_step_viewed = Event(vendor=VENDOR, name="checkout_step_viewed", version="1-0-0")

product_category = EntityProperty(
    vendor=VENDOR,
    name="product",
    major_version=1,
    path="category",
)
product_designer = EntityProperty(
    vendor=VENDOR,
    name="product",
    major_version=1,
    path="designer",
)
product_color_family = EntityProperty(
    vendor=VENDOR,
    name="product",
    major_version=1,
    path="color_family",
)
product_occasion = EntityProperty(
    vendor=VENDOR,
    name="product",
    major_version=1,
    path="occasion",
)
product_id = EntityProperty(
    vendor=VENDOR,
    name="product",
    major_version=1,
    path="product_id",
)
checkout_step = EntityProperty(
    vendor=VENDOR,
    name="checkout",
    major_version=1,
    path="checkout_step",
)
cart_value = EventProperty(vendor=VENDOR, name="cart_viewed", major_version=1, path="cart_value")
cart_line_count = EventProperty(
    vendor=VENDOR, name="cart_viewed", major_version=1, path="cart_line_count"
)
cart_value_band_property = EventProperty(
    vendor=VENDOR, name="cart_viewed", major_version=1, path="cart_value_band"
)
cart_action = EventProperty(vendor=VENDOR, name="cart_updated", major_version=1, path="action")

favorite_category = Attribute(
    name="favorite_category",
    description="Most frequently viewed or selected category in-session.",
    type="string",
    events=[product_viewed, product_list_clicked, cart_updated],
    aggregation="most_frequent",
    property=product_category,
)

favorite_designer = Attribute(
    name="favorite_designer",
    description="Most frequently viewed or selected designer in-session.",
    type="string",
    events=[product_viewed, product_list_clicked, cart_updated],
    aggregation="most_frequent",
    property=product_designer,
)

favorite_occasion = Attribute(
    name="favorite_occasion",
    description="Most frequent occasion signal inferred from browsed products.",
    type="string",
    events=[product_viewed, product_list_clicked, cart_updated],
    aggregation="most_frequent",
    property=product_occasion,
)

favorite_color_family = Attribute(
    name="favorite_color_family",
    description="Most frequent color family in the current session.",
    type="string",
    events=[product_viewed, product_list_clicked],
    aggregation="most_frequent",
    property=product_color_family,
)

recently_viewed_product_ids = Attribute(
    name="recently_viewed_product_ids",
    description="Unique list of product ids viewed in the current session window.",
    type="string_list",
    events=[product_viewed],
    aggregation="unique_list",
    property=product_id,
    period=timedelta(days=1),
)

high_intent_product_ids = Attribute(
    name="high_intent_product_ids",
    description="Products that were explicitly added to cart during the session.",
    type="string_list",
    events=[cart_updated],
    aggregation="unique_list",
    property=product_id,
    criteria=Criteria(
        all=[Criterion.eq(cart_action, "add_to_cart")]
    ),
    period=timedelta(days=1),
)

category_interest_counts = Attribute(
    name="category_interest_counts",
    description="Weighted category distribution for the session.",
    type="dict",
    events=[product_viewed, product_list_clicked, cart_updated],
    aggregation="category_count",
    property=product_category,
)

designer_interest_counts = Attribute(
    name="designer_interest_counts",
    description="Weighted designer distribution for the session.",
    type="dict",
    events=[product_viewed, product_list_clicked, cart_updated],
    aggregation="category_count",
    property=product_designer,
)

occasion_interest_counts = Attribute(
    name="occasion_interest_counts",
    description="Weighted occasion distribution for the session.",
    type="dict",
    events=[product_viewed, product_list_clicked, cart_updated],
    aggregation="category_count",
    property=product_occasion,
)

color_family_interest_counts = Attribute(
    name="color_family_interest_counts",
    description="Weighted color family distribution for the session.",
    type="dict",
    events=[product_viewed, product_list_clicked],
    aggregation="category_count",
    property=product_color_family,
)

total_product_views = Attribute(
    name="total_product_views",
    description="Count of product detail views in the session.",
    type="int32",
    events=[product_viewed],
    aggregation="counter",
)

total_add_to_cart = Attribute(
    name="total_add_to_cart",
    description="Count of add to cart interactions in the session.",
    type="int32",
    events=[cart_updated],
    aggregation="counter",
    criteria=Criteria(
        all=[Criterion.eq(cart_action, "add_to_cart")]
    ),
)

checkout_stage = Attribute(
    name="checkout_stage",
    description="Most recent checkout step reached in the session.",
    type="string",
    events=[checkout_started, checkout_step_viewed],
    aggregation="last",
    property=checkout_step,
)

cart_value_band = Attribute(
    name="cart_value_band",
    description="Banding of cart value derived from the most recent cart snapshot.",
    type="string",
    events=[cart_viewed],
    aggregation="last",
    property=cart_value_band_property,
    default_value="entry",
)

active_cart_line_count = Attribute(
    name="active_cart_line_count",
    description="Most recent cart line count for the session.",
    type="int32",
    events=[cart_viewed],
    aggregation="last",
    property=cart_line_count,
    default_value=0,
)


def build_stream_attribute_group():
    return StreamAttributeGroup(
        name="fashion_ecommerce_session_attributes",
        version=1,
        attribute_key=DOMAIN_SESSION_ATTRIBUTE_KEY,
        owner=OWNER,
        description="Session-scoped Signals attributes for the Atelier Signals ecommerce demo.",
        ttl=timedelta(days=7),
        attributes=[
            favorite_category,
            favorite_designer,
            favorite_occasion,
            favorite_color_family,
            recently_viewed_product_ids,
            high_intent_product_ids,
            category_interest_counts,
            designer_interest_counts,
            occasion_interest_counts,
            color_family_interest_counts,
            total_product_views,
            total_add_to_cart,
            checkout_stage,
            cart_value_band,
            active_cart_line_count,
        ],
    )
