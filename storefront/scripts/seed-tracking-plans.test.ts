import { describe, expect, it } from "vitest";

import {
  buildUuidMapping,
  findMissingEnvVars,
  parseEnvFile,
  replaceUuids,
  resolveEnv,
  scanTemplateUuids,
  uuidv5,
} from "./seed-tracking-plans";

describe("parseEnvFile", () => {
  it("parses simple key=value pairs", () => {
    expect(parseEnvFile("SNOWPLOW_CONSOLE_ORG_ID=abc123")).toEqual({
      SNOWPLOW_CONSOLE_ORG_ID: "abc123",
    });
  });

  it("strips matching single or double quotes around the value", () => {
    expect(parseEnvFile(`FOO="bar"\nBAZ='qux'`)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comment lines and blank lines", () => {
    const content = ["# a comment", "", "FOO=bar", "  # indented comment", "BAZ=qux"].join("\n");
    expect(parseEnvFile(content)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("trims whitespace around keys and unquoted values", () => {
    expect(parseEnvFile("  FOO  =  bar  ")).toEqual({ FOO: "bar" });
  });
});

describe("resolveEnv", () => {
  it("lets pre-existing process env win over .env.local values", () => {
    const parsed = { SNOWPLOW_CONSOLE_ORG_ID: "from-file" };
    const processEnv = { SNOWPLOW_CONSOLE_ORG_ID: "from-shell" };
    expect(resolveEnv(parsed, processEnv)).toMatchObject({ SNOWPLOW_CONSOLE_ORG_ID: "from-shell" });
  });

  it("falls back to the parsed value when process env doesn't set the key", () => {
    const parsed = { SNOWPLOW_CONSOLE_ORG_ID: "from-file" };
    expect(resolveEnv(parsed, {})).toMatchObject({ SNOWPLOW_CONSOLE_ORG_ID: "from-file" });
  });
});

describe("findMissingEnvVars", () => {
  it("names every required var missing from the env", () => {
    const missing = findMissingEnvVars({ FOO: "set" }, ["FOO", "BAR", "BAZ"]);
    expect(missing).toEqual(["BAR", "BAZ"]);
  });

  it("returns an empty list when every required var is present", () => {
    expect(findMissingEnvVars({ FOO: "1", BAR: "2" }, ["FOO", "BAR"])).toEqual([]);
  });

  it("treats an empty-string value as missing", () => {
    expect(findMissingEnvVars({ FOO: "" }, ["FOO"])).toEqual(["FOO"]);
  });
});

describe("uuidv5", () => {
  const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

  it("matches the well-known RFC 4122 DNS-namespace test vector", () => {
    expect(uuidv5(NAMESPACE_DNS, "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("is deterministic for the same inputs", () => {
    const a = uuidv5(NAMESPACE_DNS, "org-1:template-uuid");
    const b = uuidv5(NAMESPACE_DNS, "org-1:template-uuid");
    expect(a).toBe(b);
  });

  it("derives a different id for a different org", () => {
    const a = uuidv5(NAMESPACE_DNS, "org-1:template-uuid");
    const b = uuidv5(NAMESPACE_DNS, "org-2:template-uuid");
    expect(a).not.toBe(b);
  });
});

describe("scanTemplateUuids", () => {
  it("finds resourceName UUIDs and ignores other uuid-shaped values", () => {
    const text = [
      "resourceName: dfcf9c19-564c-4677-8af1-8079ac481ac4",
      "triggers:",
      "  - id: 8c01f009-5e14-43db-8922-9c391ebba9bc",
      "    resourceName: fc829dc5-648d-4978-a3f9-e28971499509",
    ].join("\n");
    expect(scanTemplateUuids(text)).toEqual([
      "dfcf9c19-564c-4677-8af1-8079ac481ac4",
      "fc829dc5-648d-4978-a3f9-e28971499509",
    ]);
  });

  it("de-duplicates repeated occurrences of the same template uuid", () => {
    const text = ["resourceName: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"].concat(
      ["resourceName: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
    ).join("\n");
    expect(scanTemplateUuids(text)).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
  });
});

describe("buildUuidMapping", () => {
  it("derives one consistent mapping entry per template uuid", () => {
    const templates = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"];
    const mapping = buildUuidMapping(templates, "org-1", "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    expect(mapping.size).toBe(2);
    expect(mapping.get(templates[0])).toBe(
      uuidv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", `org-1:${templates[0]}`),
    );
  });

  it("maps the same template uuid to the same derived id across the set", () => {
    const templates = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"];
    const namespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const mappingA = buildUuidMapping(templates, "org-1", namespace);
    const mappingB = buildUuidMapping(templates, "org-1", namespace);
    expect(mappingA.get(templates[0])).toBe(mappingB.get(templates[0]));
  });
});

describe("replaceUuids", () => {
  it("replaces every occurrence of each mapped uuid", () => {
    const mapping = new Map([["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "11111111-1111-1111-1111-111111111111"]]);
    const text = [
      "resourceName: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "otherRef: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ].join("\n");
    expect(replaceUuids(text, mapping)).toBe(
      ["resourceName: 11111111-1111-1111-1111-111111111111", "otherRef: 11111111-1111-1111-1111-111111111111"].join(
        "\n",
      ),
    );
  });

  it("leaves lines with unmapped uuids untouched", () => {
    const mapping = new Map([["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "11111111-1111-1111-1111-111111111111"]]);
    const text = "id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(replaceUuids(text, mapping)).toBe(text);
  });
});

import { replaceOwner, OWNER_PLACEHOLDER } from "./seed-tracking-plans";

describe("replaceOwner", () => {
  it("swaps the placeholder owner for the configured one", () => {
    const text = `data:\n  owner: ${OWNER_PLACEHOLDER}\n  name: x`;
    expect(replaceOwner(text, "me@corp.example")).toBe("data:\n  owner: me@corp.example\n  name: x");
  });

  it("leaves text without the placeholder untouched", () => {
    expect(replaceOwner("owner: someone@else.example", "me@corp.example")).toBe("owner: someone@else.example");
  });
});
