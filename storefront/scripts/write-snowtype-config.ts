#!/usr/bin/env tsx
/**
 * Generates snowtype.config.json for whichever Snowplow org .env.local points at.
 *
 * The config names an organization ID and a list of event specification IDs,
 * all of which belong to one specific org — so the file is gitignored and built
 * from the committed snowtype.config.example.json instead. Re-pointing the repo
 * at a fresh trial org is then a regeneration, not a diff.
 *
 * Snowtype resolves every event specification's event schema against the org's
 * own schema registry, so it can only generate from specifications whose event
 * schema lives in this repo's own tracking-assets/data-structures (today the
 * com.snowplow_demo.fashion vendor) — never the agent's Iglu Central schemas.
 * This writer selects those own-schema specifications and derives their IDs the
 * same way seed-tracking-plans.ts derives every published resource ID (a UUIDv5
 * of the org ID and the specification's template resourceName), so the list
 * always matches what the seed publishes.
 *
 * Usage (from storefront/): npm run snowtype:config
 * Runs automatically before `npm run snowtype:generate`.
 */

import { load } from "js-yaml";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listDataStructureFiles, loadDataStructure } from "./render-iglu-schemas";
import { FIXED_NAMESPACE, findMissingEnvVars, parseEnvFile, resolveEnv, uuidv5 } from "./seed-tracking-plans";

export const REQUIRED_ENV_VARS = ["SNOWPLOW_CONSOLE_ORG_ID"] as const;

export interface EventSpecification {
  resourceName: string;
  name: string;
  event: { source: string };
}

export function readEventSpecifications(yaml: string): EventSpecification[] {
  const parsed = load(yaml) as { data?: { eventSpecifications?: EventSpecification[] } } | undefined;
  return parsed?.data?.eventSpecifications ?? [];
}

export function igluVendor(uri: string): string {
  const match = uri.match(/^iglu:([^/]+)\//);
  if (!match) {
    throw new Error(`Not a valid Iglu URI: ${uri}`);
  }
  return match[1];
}

/** Vendors with at least one local data structure under tracking-assets/data-structures. */
export function listLocalVendors(dataStructuresDir: string): Set<string> {
  const vendors = new Set<string>();
  for (const file of listDataStructureFiles(dataStructuresDir)) {
    vendors.add(loadDataStructure(file).schema.self.vendor);
  }
  return vendors;
}

export function deriveResourceId(orgId: string, templateUuid: string): string {
  return uuidv5(FIXED_NAMESPACE, `${orgId}:${templateUuid}`);
}

/**
 * Derived IDs of the event specifications whose event schema resolves against
 * this repo's own data structures. Excludes (with a warning, not a crash) any
 * specification whose event schema vendor Snowtype can never resolve, such as
 * the agent specifications' Iglu Central vendor.
 */
export function selectEventSpecificationIds(
  specs: readonly EventSpecification[],
  localVendors: ReadonlySet<string>,
  orgId: string,
): string[] {
  const ids: string[] = [];
  for (const spec of specs) {
    const vendor = igluVendor(spec.event.source);
    if (!localVendors.has(vendor)) {
      console.warn(
        `Excluding event specification "${spec.name}" (${spec.resourceName}) from snowtype.config.json: ` +
          `event schema vendor "${vendor}" has no local data structures under tracking-assets/data-structures.`,
      );
      continue;
    }
    ids.push(deriveResourceId(orgId, spec.resourceName));
  }
  return ids;
}

export function buildSnowtypeConfig(exampleJson: string, orgId: string, eventSpecificationIds: string[]): string {
  const config = JSON.parse(exampleJson) as Record<string, unknown>;
  config.organizationId = orgId;
  config.dataProductIds = [];
  config.eventSpecificationIds = eventSpecificationIds;
  return `${JSON.stringify(config, null, 2)}\n`;
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STOREFRONT_ROOT = path.resolve(SCRIPT_DIR, "..");
const EXAMPLE_PATH = path.join(STOREFRONT_ROOT, "snowtype.config.example.json");
const CONFIG_PATH = path.join(STOREFRONT_ROOT, "snowtype.config.json");
const DATA_PRODUCT_YAML = path.join(
  STOREFRONT_ROOT,
  "tracking-assets",
  "tracking-plans",
  "fashion_ecommerce.yml",
);
const DATA_STRUCTURES_DIR = path.join(STOREFRONT_ROOT, "tracking-assets", "data-structures");

function main(): void {
  const envLocalPath = path.join(STOREFRONT_ROOT, ".env.local");
  const parsedEnv = existsSync(envLocalPath) ? parseEnvFile(readFileSync(envLocalPath, "utf8")) : {};
  const env = resolveEnv(parsedEnv, process.env);

  const missing = findMissingEnvVars(env, REQUIRED_ENV_VARS);
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Set it in .env.local (see .env.example) — it names the org snowtype generates against.",
    );
    process.exitCode = 1;
    return;
  }

  const orgId = env.SNOWPLOW_CONSOLE_ORG_ID as string;
  const specs = readEventSpecifications(readFileSync(DATA_PRODUCT_YAML, "utf8"));
  const localVendors = listLocalVendors(DATA_STRUCTURES_DIR);
  const eventSpecificationIds = selectEventSpecificationIds(specs, localVendors, orgId);

  writeFileSync(CONFIG_PATH, buildSnowtypeConfig(readFileSync(EXAMPLE_PATH, "utf8"), orgId, eventSpecificationIds));

  console.log(`Wrote snowtype.config.json for org ${orgId}`);
  console.log(`  ${eventSpecificationIds.length} own-schema event specification(s) included`);
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}
