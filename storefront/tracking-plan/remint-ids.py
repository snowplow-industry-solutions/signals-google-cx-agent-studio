#!/usr/bin/env python3
"""Re-mint every resourceName UUID under tracking-plan/data-products.

Source app / data product / event spec IDs are globally unique in the Snowplow
backend, so seeding a fresh org with IDs that were ever published from another
org fails with "Source application with given id already exists". Run this
before `snowplow-cli dp publish` when standing up a new org. Safe because the
data product references its source application by $ref file path, never by UUID.
"""

import re
import sys
import uuid
from pathlib import Path

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "data-products"
pattern = re.compile(r"(resourceName:\s*)[0-9a-fA-F-]{36}")

for file in sorted(root.rglob("*.yml")):
    text = file.read_text()
    new_text, count = pattern.subn(lambda m: m.group(1) + str(uuid.uuid4()), text)
    if count:
        file.write_text(new_text)
        print(f"{file.relative_to(root.parent)}: re-minted {count} id(s)")
