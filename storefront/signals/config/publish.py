import argparse
import os

from snowplow_signals import Signals

from signals.config.attribute_groups import build_stream_attribute_group
from signals.config.event_logs import build_event_log
from signals.config.interventions import build_stylist_intervention
from signals.config.services import build_service


REQUIRED_ENV_VARS = [
    "SIGNALS_DEPLOYED_URL",
    "SNOWPLOW_CONSOLE_API_KEY",
    "SNOWPLOW_CONSOLE_API_KEY_ID",
    "SNOWPLOW_CONSOLE_ORG_ID",
]


def build_client():
    missing = [name for name in REQUIRED_ENV_VARS if not os.environ.get(name)]
    if missing:
        raise SystemExit(
            "Missing required environment variable(s) for Signals publish: "
            f"{', '.join(missing)}. Set them in .env.local (see .env.example), "
            "or run with --dry-run to validate the config without credentials."
        )

    return Signals(
        api_url=os.environ["SIGNALS_DEPLOYED_URL"],
        api_key=os.environ["SNOWPLOW_CONSOLE_API_KEY"],
        api_key_id=os.environ["SNOWPLOW_CONSOLE_API_KEY_ID"],
        org_id=os.environ["SNOWPLOW_CONSOLE_ORG_ID"],
    )


def build_objects():
    attribute_group = build_stream_attribute_group()
    service = build_service(attribute_group)
    intervention = build_stylist_intervention()
    event_log = build_event_log()
    return [attribute_group, service, intervention, event_log]


def main():
    parser = argparse.ArgumentParser(description="Publish Snowplow Signals config for the ecommerce demo.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the objects that would be published instead of calling the Signals API.",
    )
    parser.add_argument(
        "--only",
        choices=["all", "intervention", "event_log"],
        default="all",
        help=(
            "Publish only a subset of objects. Use 'intervention' or 'event_log' to "
            "skip the already-published attribute group and service."
        ),
    )
    args = parser.parse_args()

    if args.only == "intervention":
        objects = [build_stylist_intervention()]
    elif args.only == "event_log":
        objects = [build_event_log()]
    else:
        objects = build_objects()

    if args.dry_run:
        for obj in objects:
            print(obj)
        return

    client = build_client()
    published = client.publish(objects)
    print(published)


if __name__ == "__main__":
    main()
