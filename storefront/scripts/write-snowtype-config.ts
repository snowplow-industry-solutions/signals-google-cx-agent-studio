#!/usr/bin/env tsx
/**
 * Generates snowtype.config.json for whichever Snowplow org .env.local points at.
 *
 * The config names an organization ID and a data product ID, both of which belong
 * to one specific org — so the file is gitignored and built from the committed
 * snowtype.config.example.json instead. Re-pointing the repo at a fresh trial org
 * is then a regeneration, not a diff.
 *
 * The data product ID isn't copied out of Console: seed-tracking-plans.ts derives
 * every resource ID as a UUIDv5 of the org ID, so this derives the same one from
 * the same namespace. Anything else drifts.
 *
 * Usage (from storefront/): npm run snowtype:config
 * Runs automatically before `npm run snowtype:generate`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NAMESPACE, findMissingEnvVars, parseEnvFile, resolveEnv, uuidv5 } from "./seed-tracking-plans";

export const REQUIRED_ENV_VARS = ["SNOWPLOW_CONSOLE_ORG_ID"] as const;

/** Unindented `resourceName:` — the document's own ID, not a nested event spec's. */
const TOP_LEVEL_RESOURCE_NAME = /^resourceName:\s*([0-9a-fA-F-]{36})\s*$/m;

export function readTemplateDataProductId(yaml: string): string {
  const match = yaml.match(TOP_LEVEL_RESOURCE_NAME);
  if (!match) {
    throw new Error("No top-level resourceName found in the data product YAML");
  }
  return match[1];
}

export function deriveDataProductId(orgId: string, templateUuid: string): string {
  return uuidv5(FIXED_NAMESPACE, `${orgId}:${templateUuid}`);
}

export function buildSnowtypeConfig(exampleJson: string, orgId: string, dataProductId: string): string {
  const config = JSON.parse(exampleJson) as Record<string, unknown>;
  config.organizationId = orgId;
  config.dataProductIds = [dataProductId];
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
  const templateId = readTemplateDataProductId(readFileSync(DATA_PRODUCT_YAML, "utf8"));
  const dataProductId = deriveDataProductId(orgId, templateId);

  writeFileSync(CONFIG_PATH, buildSnowtypeConfig(readFileSync(EXAMPLE_PATH, "utf8"), orgId, dataProductId));

  console.log(`Wrote snowtype.config.json for org ${orgId}`);
  console.log(`  data product ${templateId} -> ${dataProductId}`);
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}
