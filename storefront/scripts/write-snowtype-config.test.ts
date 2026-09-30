import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildUuidMapping } from "./seed-tracking-plans";
import {
  buildSnowtypeConfig,
  deriveResourceId,
  igluVendor,
  listLocalVendors,
  readEventSpecifications,
  selectEventSpecificationIds,
  type EventSpecification,
} from "./write-snowtype-config";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STOREFRONT_ROOT = path.resolve(SCRIPT_DIR, "..");
const TRACKING_PLAN_YAML = path.join(STOREFRONT_ROOT, "tracking-assets", "tracking-plans", "fashion_ecommerce.yml");
const DATA_STRUCTURES_DIR = path.join(STOREFRONT_ROOT, "tracking-assets", "data-structures");

const EXAMPLE = JSON.stringify(
  {
    igluCentralSchemas: [],
    dataStructures: [],
    repositories: ["./tracking-assets/data-structures"],
    eventSpecificationIds: ["<derived-event-specification-id>"],
    dataProductIds: [],
    organizationId: "<your-snowplow-org-id>",
    tracker: "@snowplow/browser-tracker",
    language: "typescript",
    outpath: "./snowtype",
  },
  null,
  2,
);

const OWN_SCHEMA_SPEC: EventSpecification = {
  resourceName: "a71ae6fc-8dd2-5383-87b1-c30bc221ce3d",
  name: "Product list viewed",
  event: { source: "iglu:com.snowplow_demo.fashion/product_list_viewed/jsonschema/1-0-0" },
};

const AGENT_SPEC: EventSpecification = {
  resourceName: "c746572a-fc8d-5d52-908a-cdd060aaf81e",
  name: "Tool execution: search catalog",
  event: { source: "iglu:com.snowplow.agent.tracking/tool_execution/jsonschema/1-0-0" },
};

describe("igluVendor", () => {
  it("extracts the vendor segment of an Iglu URI", () => {
    expect(igluVendor("iglu:com.snowplow_demo.fashion/product_viewed/jsonschema/1-0-0")).toBe(
      "com.snowplow_demo.fashion",
    );
  });

  it("throws on a malformed URI", () => {
    expect(() => igluVendor("not-an-iglu-uri")).toThrow(/Iglu URI/);
  });
});

describe("readEventSpecifications", () => {
  it("reads every event specification from the tracking plan", () => {
    const specs = readEventSpecifications(readFileSync(TRACKING_PLAN_YAML, "utf8"));
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.map((spec) => spec.name)).toContain("Product list clicked");
  });

  it("returns an empty list when the document has no event specifications", () => {
    expect(readEventSpecifications("apiVersion: v1\ndata:\n  name: nope\n")).toEqual([]);
  });
});

describe("listLocalVendors", () => {
  it("finds the vendor of every local data structure", () => {
    expect(listLocalVendors(DATA_STRUCTURES_DIR)).toEqual(new Set(["com.snowplow_demo.fashion"]));
  });
});

describe("selectEventSpecificationIds", () => {
  const ORG = "11111111-2222-4333-8444-555555555555";
  const LOCAL_VENDORS = new Set(["com.snowplow_demo.fashion"]);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes own-schema specifications and excludes Iglu Central ones", () => {
    const ids = selectEventSpecificationIds([OWN_SCHEMA_SPEC, AGENT_SPEC], LOCAL_VENDORS, ORG);
    expect(ids).toEqual([deriveResourceId(ORG, OWN_SCHEMA_SPEC.resourceName)]);
  });

  it("warns and excludes a specification with an unknown vendor instead of crashing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ids = selectEventSpecificationIds([AGENT_SPEC], LOCAL_VENDORS, ORG);
    expect(ids).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("com.snowplow.agent.tracking"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(AGENT_SPEC.name));
  });

  it("emits ids equal to the seed script's derived ids for the same org", () => {
    const ids = selectEventSpecificationIds([OWN_SCHEMA_SPEC], LOCAL_VENDORS, ORG);
    expect(ids).toEqual([buildUuidMapping([OWN_SCHEMA_SPEC.resourceName], ORG).get(OWN_SCHEMA_SPEC.resourceName)]);
  });

  it("selects exactly the eight own-schema specifications from the real tracking plan, none of the seven agent ones", () => {
    const specs = readEventSpecifications(readFileSync(TRACKING_PLAN_YAML, "utf8"));
    const localVendors = listLocalVendors(DATA_STRUCTURES_DIR);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ownSchemaSpecs = specs.filter((spec) => localVendors.has(igluVendor(spec.event.source)));
    expect(ownSchemaSpecs).toHaveLength(8);
    expect(ownSchemaSpecs.map((spec) => spec.name)).toContain("Product list clicked");
    expect(specs.length - ownSchemaSpecs.length).toBe(7);

    const ids = selectEventSpecificationIds(specs, localVendors, ORG);
    expect(ids).toHaveLength(8);
    expect(warn).toHaveBeenCalledTimes(7);
  });
});

describe("deriveResourceId", () => {
  const TEMPLATE = "a71ae6fc-8dd2-5383-87b1-c30bc221ce3d";
  const ORG = "11111111-2222-4333-8444-555555555555";

  // The whole point of deriving here rather than copying an ID out of Console:
  // snowtype must name the same event specifications the seeder publishes. If
  // these two ever disagree, generated tracking code points at resources that
  // don't exist in the org.
  it("agrees with the mapping the tracking-plan seeder publishes", () => {
    expect(deriveResourceId(ORG, TEMPLATE)).toBe(buildUuidMapping([TEMPLATE], ORG).get(TEMPLATE));
  });

  it("is deterministic for the same org", () => {
    expect(deriveResourceId(ORG, TEMPLATE)).toBe(deriveResourceId(ORG, TEMPLATE));
  });

  it("derives a different id for a different org", () => {
    const other = "99999999-8888-4777-8666-555555555555";
    expect(deriveResourceId(ORG, TEMPLATE)).not.toBe(deriveResourceId(other, TEMPLATE));
  });
});

describe("buildSnowtypeConfig", () => {
  const ORG = "11111111-2222-4333-8444-555555555555";
  const EVENT_SPECIFICATION_IDS = ["c8d4245b-bdb2-52d4-ac11-64b5d131d6c1", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"];

  it("sets the org id, the event specification ids, and an empty dataProductIds", () => {
    const config = JSON.parse(buildSnowtypeConfig(EXAMPLE, ORG, EVENT_SPECIFICATION_IDS));
    expect(config.organizationId).toBe(ORG);
    expect(config.eventSpecificationIds).toEqual(EVENT_SPECIFICATION_IDS);
    expect(config.dataProductIds).toEqual([]);
  });

  it("carries every non-org field through from the example unchanged", () => {
    const config = JSON.parse(buildSnowtypeConfig(EXAMPLE, ORG, EVENT_SPECIFICATION_IDS));
    const example = JSON.parse(EXAMPLE);
    for (const key of Object.keys(example)) {
      if (key === "organizationId" || key === "dataProductIds" || key === "eventSpecificationIds") continue;
      expect(config[key]).toEqual(example[key]);
    }
  });

  it("ends with a single trailing newline", () => {
    const output = buildSnowtypeConfig(EXAMPLE, ORG, EVENT_SPECIFICATION_IDS);
    expect(output.endsWith("}\n")).toBe(true);
  });

  it("is byte-identical on a second run, so re-seeding never churns the file", () => {
    expect(buildSnowtypeConfig(EXAMPLE, ORG, EVENT_SPECIFICATION_IDS)).toBe(
      buildSnowtypeConfig(EXAMPLE, ORG, EVENT_SPECIFICATION_IDS),
    );
  });
});
