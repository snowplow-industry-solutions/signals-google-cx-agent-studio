import { describe, expect, it } from "vitest";

import { buildUuidMapping } from "./seed-tracking-plans";
import {
  buildSnowtypeConfig,
  deriveDataProductId,
  readTemplateDataProductId,
} from "./write-snowtype-config";

const EXAMPLE = JSON.stringify(
  {
    igluCentralSchemas: [],
    dataStructures: [],
    repositories: ["./tracking-assets/data-structures"],
    eventSpecificationIds: [],
    dataProductIds: ["<derived-data-product-id>"],
    organizationId: "<your-snowplow-org-id>",
    tracker: "@snowplow/browser-tracker",
    language: "typescript",
    outpath: "./snowtype",
  },
  null,
  2,
);

describe("readTemplateDataProductId", () => {
  it("reads the top-level resourceName of a data-product document", () => {
    const yaml = [
      "apiVersion: v1",
      "resourceType: data-product",
      "resourceName: 12361c29-df6c-5a64-b024-68557f6504ed",
      "data:",
      "  name: Atelier Signals Ecommerce Demo",
    ].join("\n");
    expect(readTemplateDataProductId(yaml)).toBe("12361c29-df6c-5a64-b024-68557f6504ed");
  });

  it("ignores the indented resourceNames of nested event specifications", () => {
    const yaml = [
      "resourceName: 12361c29-df6c-5a64-b024-68557f6504ed",
      "data:",
      "  eventSpecifications:",
      "    - resourceName: a71ae6fc-8dd2-5383-87b1-c30bc221ce3d",
      "    - resourceName: e7116964-2c08-5764-a67b-a75dca2546f8",
    ].join("\n");
    expect(readTemplateDataProductId(yaml)).toBe("12361c29-df6c-5a64-b024-68557f6504ed");
  });

  it("throws when the document has no top-level resourceName", () => {
    expect(() => readTemplateDataProductId("apiVersion: v1\ndata:\n  name: nope\n")).toThrow(
      /resourceName/,
    );
  });
});

describe("deriveDataProductId", () => {
  const TEMPLATE = "12361c29-df6c-5a64-b024-68557f6504ed";
  const ORG = "00a9e122-8865-4e3b-ac1d-648b50ad9483";

  // The whole point of deriving here rather than copying an ID out of Console:
  // snowtype must name the same data product the seeder publishes. If these two
  // ever disagree, generated tracking code points at a data product that
  // doesn't exist in the org.
  it("agrees with the mapping the tracking-plan seeder publishes", () => {
    expect(deriveDataProductId(ORG, TEMPLATE)).toBe(buildUuidMapping([TEMPLATE], ORG).get(TEMPLATE));
  });

  it("is deterministic for the same org", () => {
    expect(deriveDataProductId(ORG, TEMPLATE)).toBe(deriveDataProductId(ORG, TEMPLATE));
  });

  it("derives a different id for a different org", () => {
    const other = "b12539df-a711-42bd-bdfa-175308c55fd5";
    expect(deriveDataProductId(ORG, TEMPLATE)).not.toBe(deriveDataProductId(other, TEMPLATE));
  });
});

describe("buildSnowtypeConfig", () => {
  const ORG = "00a9e122-8865-4e3b-ac1d-648b50ad9483";
  const DATA_PRODUCT = "c8d4245b-bdb2-52d4-ac11-64b5d131d6c1";

  it("replaces both org-scoped placeholders", () => {
    const config = JSON.parse(buildSnowtypeConfig(EXAMPLE, ORG, DATA_PRODUCT));
    expect(config.organizationId).toBe(ORG);
    expect(config.dataProductIds).toEqual([DATA_PRODUCT]);
  });

  it("carries every non-org field through from the example unchanged", () => {
    const config = JSON.parse(buildSnowtypeConfig(EXAMPLE, ORG, DATA_PRODUCT));
    const example = JSON.parse(EXAMPLE);
    for (const key of Object.keys(example)) {
      if (key === "organizationId" || key === "dataProductIds") continue;
      expect(config[key]).toEqual(example[key]);
    }
  });

  it("ends with a single trailing newline", () => {
    const output = buildSnowtypeConfig(EXAMPLE, ORG, DATA_PRODUCT);
    expect(output.endsWith("}\n")).toBe(true);
  });

  it("is byte-identical on a second run, so re-seeding never churns the file", () => {
    expect(buildSnowtypeConfig(EXAMPLE, ORG, DATA_PRODUCT)).toBe(
      buildSnowtypeConfig(EXAMPLE, ORG, DATA_PRODUCT),
    );
  });
});
