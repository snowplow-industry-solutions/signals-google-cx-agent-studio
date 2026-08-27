import os

DEFAULT_OWNER = "demo-owner@example.com"

# Owner recorded on every published Signals object. Set SNOWPLOW_OWNER_EMAIL in
# .env.local to attribute the objects to yourself in Console.
OWNER = os.environ.get("SNOWPLOW_OWNER_EMAIL", DEFAULT_OWNER)
