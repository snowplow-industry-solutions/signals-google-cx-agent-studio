from snowplow_signals import (
    InterventionCriteriaAll,
    InterventionCriterion,
    LinkAttributeKey,
    RuleIntervention,
)

OWNER = "signals-demo@snowplowanalytics.com"
ATTRIBUTE_GROUP = "fashion_ecommerce_session_attributes"


def build_stylist_intervention():
    """Nudges a browsing shopper with a personalized product pairing
    after 3+ product views without an add-to-cart."""

    return RuleIntervention(
        name="stylistIntervention",
        version=2,
        description="Nudges a browsing shopper with a personalized product pairing after 3+ product views without an add-to-cart.",
        owner=OWNER,
        is_published=True,
        criteria=InterventionCriteriaAll(
            all=[
                InterventionCriterion(
                    attribute=f"{ATTRIBUTE_GROUP}:total_product_views",
                    operator=">=",
                    value=6,
                ),
                InterventionCriterion(
                    attribute=f"{ATTRIBUTE_GROUP}:total_add_to_cart",
                    operator="is null",
                ),
            ]
        ),
        target_attribute_keys=[
            LinkAttributeKey(name="domain_sessionid"),
        ],
    )
