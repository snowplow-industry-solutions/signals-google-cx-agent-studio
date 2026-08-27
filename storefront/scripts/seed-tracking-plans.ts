#!/usr/bin/env tsx
/**
 * Deterministic tracking-plan seeding for a Snowplow org.
 *
 * Committed `resourceName:` UUIDs under tracking-assets/tracking-plans are stable
 * template keys, never rewritten in place. At publish time this script copies that
 * tree to a temp dir and replaces each template UUID with a UUIDv5 derived from the
 * target org ID, so re-seeding a fresh org never collides with IDs a previous org
 * already claimed (they're global primary keys in the Snowplow backend), and
 * re-running against the same org re-derives the same IDs (idempotent update, not
 * duplication).
 *
 * Usage (from storefront/): npm run seed:tracking-plans [-- --dry-run]
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_ENV_VARS = [
  "SNOWPLOW_CONSOLE_API_KEY",
  "SNOWPLOW_CONSOLE_API_KEY_ID",
  "SNOWPLOW_CONSOLE_ORG_ID",
] as const;

// Fixed forever: changing this would re-derive every resource ID for every org.
// Exported so write-snowtype-config.ts derives the data product ID the same way
// rather than keeping its own copy that could drift.
export const FIXED_NAMESPACE = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

const DUMMY_ORG_ID = "00000000-dry-run-0000-000000000000";

export const OWNER_PLACEHOLDER = "demo-owner@example.com";

/** Replace the committed placeholder owner with the configured one. */
export function replaceOwner(text: string, owner: string): string {
  return text.split(OWNER_PLACEHOLDER).join(owner);
}

const RESOURCE_NAME_UUID =
  /resourceName:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

type Env = Record<string, string | undefined>;

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function resolveEnv(parsedEnv: Record<string, string>, processEnv: Env): Env {
  // Pre-existing process env wins over .env.local.
  return { ...parsedEnv, ...processEnv };
}

export function findMissingEnvVars(
  env: Env,
  required: readonly string[] = REQUIRED_ENV_VARS,
): string[] {
  return required.filter((name) => !env[name]);
}

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** RFC 4122 version 5 (SHA-1 namespaced) UUID derivation. */
export function uuidv5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.concat([uuidToBytes(namespace), Buffer.from(name, "utf8")]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

export function scanTemplateUuids(text: string): string[] {
  const uuids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(RESOURCE_NAME_UUID)) {
    const uuid = match[1];
    if (!seen.has(uuid)) {
      seen.add(uuid);
      uuids.push(uuid);
    }
  }
  return uuids;
}

export function buildUuidMapping(
  templateUuids: readonly string[],
  orgId: string,
  namespace: string = FIXED_NAMESPACE,
): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const uuid of templateUuids) {
    mapping.set(uuid, uuidv5(namespace, `${orgId}:${uuid}`));
  }
  return mapping;
}

export function replaceUuids(text: string, mapping: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [template, derived] of mapping) {
    result = result.split(template).join(derived);
  }
  return result;
}

function listYamlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listYamlFiles(full));
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      results.push(full);
    }
  }
  return results;
}

function buildTrackingPlansTree(
  sourceDir: string,
  orgId: string,
  owner: string,
): { dir: string; mapping: Map<string, string> } {
  const buildDir = mkdtempSync(path.join(tmpdir(), "seed-tracking-plans-"));
  cpSync(sourceDir, buildDir, { recursive: true });

  const files = listYamlFiles(buildDir);
  const templateUuids: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const uuid of scanTemplateUuids(readFileSync(file, "utf8"))) {
      if (!seen.has(uuid)) {
        seen.add(uuid);
        templateUuids.push(uuid);
      }
    }
  }

  const mapping = buildUuidMapping(templateUuids, orgId);

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const replaced = replaceOwner(replaceUuids(text, mapping), owner);
    if (replaced !== text) {
      writeFileSync(file, replaced);
    }
  }

  return { dir: buildDir, mapping };
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STOREFRONT_ROOT = path.resolve(SCRIPT_DIR, "..");
const TRACKING_PLANS_DIR = path.join(STOREFRONT_ROOT, "tracking-assets", "tracking-plans");
const DATA_STRUCTURES_REL = "./tracking-assets/data-structures";

function planCommands(buildDir: string): Array<{ command: string; args: string[] }> {
  return [
    { command: "snowplow-cli", args: ["data-structures", "validate", DATA_STRUCTURES_REL] },
    { command: "snowplow-cli", args: ["data-structures", "publish", "dev", DATA_STRUCTURES_REL] },
    { command: "snowplow-cli", args: ["data-structures", "publish", "prod", DATA_STRUCTURES_REL] },
    { command: "snowplow-cli", args: ["data-products", "publish", buildDir] },
  ];
}

function runCommand(command: string, args: string[], cwd: string, env: Env): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: env as NodeJS.ProcessEnv });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${command} ${args.join(" ")}`);
  }
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  const envLocalPath = path.join(STOREFRONT_ROOT, ".env.local");
  const parsedEnv = existsSync(envLocalPath) ? parseEnvFile(readFileSync(envLocalPath, "utf8")) : {};
  const env = resolveEnv(parsedEnv, process.env);

  let orgId: string;
  if (dryRun) {
    if (env.SNOWPLOW_CONSOLE_ORG_ID) {
      orgId = env.SNOWPLOW_CONSOLE_ORG_ID;
    } else {
      orgId = DUMMY_ORG_ID;
      console.log(
        `[dry-run] SNOWPLOW_CONSOLE_ORG_ID not set — using dummy org id "${DUMMY_ORG_ID}" for UUID derivation.`,
      );
    }
  } else {
    const missing = findMissingEnvVars(env);
    if (missing.length > 0) {
      console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    orgId = env.SNOWPLOW_CONSOLE_ORG_ID as string;
  }

  const owner = env.SNOWPLOW_OWNER_EMAIL ?? OWNER_PLACEHOLDER;
  const { dir: buildDir, mapping } = buildTrackingPlansTree(TRACKING_PLANS_DIR, orgId, owner);

  try {
    const commands = planCommands(buildDir);

    if (dryRun) {
      console.log("\nTemplate -> derived UUID mapping:");
      for (const [template, derived] of mapping) {
        console.log(`  ${template} -> ${derived}`);
      }
      console.log("\nPlanned commands (cwd: storefront/):");
      for (const { command, args } of commands) {
        console.log(`  ${command} ${args.join(" ")}`);
      }
      return;
    }

    for (const { command, args } of commands) {
      runCommand(command, args, STOREFRONT_ROOT, env);
    }
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main();
}
