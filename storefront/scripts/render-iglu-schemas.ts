#!/usr/bin/env tsx
/**
 * Renders the repo's tracking-assets data structures into the embedded Iglu
 * repository layout Snowplow Micro expects, so the custom
 * com.snowplow_demo.fashion schemas validate locally without a network
 * round-trip to a hosted registry. Iglu Central schemas (the
 * com.snowplow.agent.tracking vendor) still resolve over the network, per
 * micro/resolver.json.
 *
 * Generation, not hand-copying: this always reflects the current tracking
 * assets, so Micro can never drift from what the seed script publishes.
 *
 * Usage (from storefront/): npm run micro:schemas
 */

import { load } from "js-yaml";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SelfDescribingSchema {
  $schema: string;
  self: { vendor: string; name: string; format: string; version: string };
  [key: string]: unknown;
}

interface DataStructureFile {
  path: string;
  schema: SelfDescribingSchema;
}

export function listDataStructureFiles(sourceDir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const full = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listDataStructureFiles(full));
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      results.push(full);
    }
  }
  return results.sort();
}

export function loadDataStructure(filePath: string): DataStructureFile {
  const parsed = load(readFileSync(filePath, "utf8")) as { data?: SelfDescribingSchema } | undefined;
  const schema = parsed?.data;

  if (!schema || !schema.self?.vendor || !schema.self.name || !schema.self.format || !schema.self.version) {
    throw new Error(`${filePath}: missing or incomplete data.self.{vendor,name,format,version}`);
  }

  return { path: filePath, schema };
}

/** Iglu's embedded-repository layout: schemas/<vendor>/<name>/<format>/<version>. */
export function schemaOutputPath(outputRoot: string, schema: SelfDescribingSchema): string {
  const { vendor, name, format, version } = schema.self;
  return path.join(outputRoot, "schemas", vendor, name, format, version);
}

export function renderSchemas(sourceDir: string, outputRoot: string): string[] {
  const schemasRoot = path.join(outputRoot, "schemas");
  if (existsSync(schemasRoot)) {
    // Clear first so a renamed or removed data structure doesn't leave a
    // stale schema file behind for Micro to resolve.
    rmSync(schemasRoot, { recursive: true, force: true });
  }

  const written: string[] = [];
  for (const file of listDataStructureFiles(sourceDir)) {
    const { schema } = loadDataStructure(file);
    const outputPath = schemaOutputPath(outputRoot, schema);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(schema, null, 2));
    written.push(outputPath);
  }
  return written;
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STOREFRONT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DATA_STRUCTURES_DIR = path.join(STOREFRONT_ROOT, "tracking-assets", "data-structures");
const OUTPUT_ROOT = path.join(STOREFRONT_ROOT, "micro", "iglu-client-embedded");

function main(): void {
  const written = renderSchemas(DATA_STRUCTURES_DIR, OUTPUT_ROOT);
  console.log(`Rendered ${written.length} schema(s) into ${path.relative(STOREFRONT_ROOT, OUTPUT_ROOT)}/:`);
  for (const file of written) {
    console.log(`  ${path.relative(OUTPUT_ROOT, file)}`);
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}
