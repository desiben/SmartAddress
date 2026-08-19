/**
 * Runs every conformance vector against the TypeScript implementation.
 *
 * The assertion semantics implemented here are the ones documented in
 * `conformance/README.md`, and any port must match them exactly.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createValidator, type Address, type ValidateOptions } from "@smartaddress/core";
import { metadata } from "@smartaddress/data";

interface ExpectBlock {
  valid?: boolean;
  type?: string;
  granularity?: string;
  complete?: boolean;
  issueCodes?: string[];
  capabilities?: Record<string, boolean>;
  normalized?: Record<string, unknown>;
  formatted?: string[];
}

interface Case {
  id: string;
  description?: string;
  address: Address;
  options?: ValidateOptions;
  expect: ExpectBlock;
}

interface VectorFile {
  name: string;
  description?: string;
  cases: Case[];
}

const VECTOR_DIR = join(dirname(fileURLToPath(import.meta.url)), "vectors");
const validator = createValidator({ metadata });

const files = readdirSync(VECTOR_DIR).filter((f) => f.endsWith(".json")).sort();

// A missing vector directory would otherwise make the whole suite silently pass.
it("has conformance vectors to run", () => {
  expect(files.length).toBeGreaterThan(0);
});

for (const file of files) {
  const vectors = JSON.parse(readFileSync(join(VECTOR_DIR, file), "utf-8")) as VectorFile;

  describe(`${vectors.name} (${file})`, () => {
    const seen = new Set<string>();

    for (const testCase of vectors.cases) {
      it(`${testCase.id}: ${testCase.description ?? ""}`.trim(), () => {
        // Duplicated ids would make a failure impossible to trace back.
        expect(seen.has(testCase.id), `duplicate case id "${testCase.id}"`).toBe(false);
        seen.add(testCase.id);

        const result = validator.validate(testCase.address, testCase.options ?? {});
        const want = testCase.expect;

        if (want.valid !== undefined) {
          expect(result.valid, `issues: ${JSON.stringify(result.issues, null, 2)}`).toBe(want.valid);
        }
        if (want.type !== undefined) expect(result.type).toBe(want.type);
        if (want.granularity !== undefined) expect(result.granularity).toBe(want.granularity);
        if (want.complete !== undefined) expect(result.complete).toBe(want.complete);

        // Exact set comparison: asserting the full set is what stops an
        // implementation from passing by simply raising nothing.
        if (want.issueCodes !== undefined) {
          const actual = [...new Set(result.issues.map((i) => i.code))].sort();
          expect(actual).toEqual([...new Set(want.issueCodes)].sort());
        }

        // Subset comparisons.
        if (want.capabilities) {
          for (const [key, value] of Object.entries(want.capabilities)) {
            expect(result.capabilities[key as keyof typeof result.capabilities], `capability ${key}`).toBe(value);
          }
        }
        if (want.normalized) {
          for (const [key, value] of Object.entries(want.normalized)) {
            expect(result.normalized[key as keyof Address], `normalized.${key}`).toEqual(value);
          }
        }

        if (want.formatted) {
          expect(validator.format(result.normalized)).toEqual(want.formatted);
        }
      });
    }
  });
}
