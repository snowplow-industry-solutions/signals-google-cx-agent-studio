import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { listDataStructureFiles, loadDataStructure, renderSchemas, schemaOutputPath } from "./render-iglu-schemas";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STOREFRONT_ROOT = path.resolve(SCRIPT_DIR, "..");
const REAL_DATA_STRUCTURES_DIR = path.join(STOREFRONT_ROOT, "tracking-assets", "data-structures");

function writeFixture(dir: string, relPath: string, contents: string): string {
  const full = path.join(dir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
  return full;
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("listDataStructureFiles / loadDataStructure", () => {
  it("finds .yml files recursively and parses the self-describing data field", () => {
    const sourceDir = makeTempDir("render-iglu-source-");
    writeFixture(
      sourceDir,
      "entities/widget.yml",
      [
        "apiVersion: v1",
        "resourceType: data-structure",
        "meta:",
        "  hidden: false",
        "  schemaType: entity",
        "data:",
        "  $schema: http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#",
        "  self:",
        "    vendor: com.example.test",
        "    name: widget",
        "    format: jsonschema",
        "    version: 1-0-0",
        "  type: object",
        "  properties: {}",
      ].join("\n"),
    );

    const files = listDataStructureFiles(sourceDir);
    expect(files).toHaveLength(1);

    const { schema } = loadDataStructure(files[0]);
    expect(schema.self).toEqual({
      vendor: "com.example.test",
      name: "widget",
      format: "jsonschema",
      version: "1-0-0",
    });
  });

  it("ignores non-yaml files", () => {
    const sourceDir = makeTempDir("render-iglu-source-");
    writeFixture(sourceDir, "entities/README.md", "not a data structure");
    writeFixture(
      sourceDir,
      "entities/widget.yaml",
      ["data:", "  self:", "    vendor: com.example.test", "    name: widget", "    format: jsonschema", "    version: 1-0-0"].join(
        "\n",
      ),
    );

    expect(listDataStructureFiles(sourceDir)).toHaveLength(1);
  });

  it("throws a clear error when data.self is missing a required field", () => {
    const sourceDir = makeTempDir("render-iglu-source-");
    const file = writeFixture(
      sourceDir,
      "entities/broken.yml",
      ["data:", "  self:", "    vendor: com.example.test", "    name: broken"].join("\n"),
    );

    expect(() => loadDataStructure(file)).toThrow(/missing or incomplete/);
  });
});

describe("schemaOutputPath", () => {
  it("nests vendor/name/format/version under a schemas/ root", () => {
    const outputPath = schemaOutputPath("/out", {
      $schema: "http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#",
      self: { vendor: "com.example.test", name: "widget", format: "jsonschema", version: "1-0-0" },
    });
    expect(outputPath).toBe(path.join("/out", "schemas", "com.example.test", "widget", "jsonschema", "1-0-0"));
  });
});

describe("renderSchemas", () => {
  it("writes one file per data structure at its vendor/name/format/version path, containing the full self-describing envelope", () => {
    const sourceDir = makeTempDir("render-iglu-source-");
    const outputDir = makeTempDir("render-iglu-output-");

    writeFixture(
      sourceDir,
      "entities/widget.yml",
      [
        "data:",
        "  $schema: http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#",
        "  description: A widget.",
        "  self:",
        "    vendor: com.example.test",
        "    name: widget",
        "    format: jsonschema",
        "    version: 1-0-0",
        "  type: object",
        "  properties:",
        "    color:",
        "      type: string",
        "  required:",
        "    - color",
        "  additionalProperties: false",
      ].join("\n"),
    );

    const written = renderSchemas(sourceDir, outputDir);
    expect(written).toHaveLength(1);

    const outputPath = path.join(outputDir, "schemas", "com.example.test", "widget", "jsonschema", "1-0-0");
    expect(written[0]).toBe(outputPath);

    const rendered = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(rendered).toEqual({
      $schema: "http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#",
      description: "A widget.",
      self: { vendor: "com.example.test", name: "widget", format: "jsonschema", version: "1-0-0" },
      type: "object",
      properties: { color: { type: "string" } },
      required: ["color"],
      additionalProperties: false,
    });
  });

  it("clears previously rendered schemas so a renamed data structure doesn't leave a stale file behind", () => {
    const sourceDir = makeTempDir("render-iglu-source-");
    const outputDir = makeTempDir("render-iglu-output-");

    const stalePath = path.join(outputDir, "schemas", "com.example.test", "stale", "jsonschema", "1-0-0");
    mkdirSync(path.dirname(stalePath), { recursive: true });
    writeFileSync(stalePath, "{}");

    writeFixture(
      sourceDir,
      "entities/widget.yml",
      [
        "data:",
        "  $schema: http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#",
        "  self:",
        "    vendor: com.example.test",
        "    name: widget",
        "    format: jsonschema",
        "    version: 1-0-0",
        "  type: object",
        "  properties: {}",
      ].join("\n"),
    );

    renderSchemas(sourceDir, outputDir);

    expect(existsSync(stalePath)).toBe(false);
  });

  it("renders every real data structure in tracking-assets/data-structures into a valid embedded Iglu layout", () => {
    const outputDir = makeTempDir("render-iglu-output-");
    const sourceFiles = listDataStructureFiles(REAL_DATA_STRUCTURES_DIR);
    expect(sourceFiles.length).toBeGreaterThan(0);

    const written = renderSchemas(REAL_DATA_STRUCTURES_DIR, outputDir);
    expect(written).toHaveLength(sourceFiles.length);

    for (const file of sourceFiles) {
      const { schema } = loadDataStructure(file);
      const expectedPath = schemaOutputPath(outputDir, schema);
      expect(written).toContain(expectedPath);

      const rendered = JSON.parse(readFileSync(expectedPath, "utf8"));
      expect(rendered).toEqual(schema);
      expect(rendered.self.format).toBe("jsonschema");
    }
  });
});
