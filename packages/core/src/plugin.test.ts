/**
 * These tests are the contract for third-party plugins. If a change here needs
 * a vector rewritten, it is a breaking change to everyone's plugins.
 */

import { describe, expect, it } from "vitest";
import { createValidator } from "./engine.js";
import { createMetadataSource, type CountryMetadata } from "./metadata.js";
import type { Plugin } from "./plugin.js";

const NARNIA: CountryMetadata = {
  countryCode: "NA",
  name: "Narnia",
  format: [{ fields: ["name"] }, { fields: ["streetAddress"] }, { fields: ["locality", "postalCode"], separators: [" ", ""] }],
  required: ["streetAddress", "locality"],
  supported: ["name", "streetAddress", "locality", "postalCode"],
  uppercase: [],
  postalCodePattern: "N\\d{4}",
  postalCodeExamples: ["N1234"],
  labels: { locality: "Township", postalCode: "Lantern code" },
};

const metadata = createMetadataSource({ NA: NARNIA });

describe("plugin extension points", () => {
  it("lets a plugin add a country-specific rule without touching core", () => {
    const noWardrobes: Plugin = {
      name: "test:no-wardrobes",
      countries: ["NA"],
      validate(ctx) {
        const street = (ctx.address.streetAddress ?? []).join(" ").toLowerCase();
        if (!street.includes("wardrobe")) return [];
        return [
          {
            code: "TYPE_NOT_ACCEPTED",
            severity: "error",
            field: "streetAddress",
            message: "Wardrobes are not a delivery point.",
            source: "test:no-wardrobes",
          },
        ];
      },
    };

    const validator = createValidator({ metadata, plugins: [noWardrobes] });
    const bad = validator.validate({
      countryCode: "NA",
      streetAddress: ["1 Wardrobe Lane"],
      locality: "Cair Paravel",
    });

    expect(bad.valid).toBe(false);
    expect(bad.issues.map((i) => i.source)).toContain("test:no-wardrobes");

    const good = validator.validate({
      countryCode: "NA",
      streetAddress: ["1 Lamppost Way"],
      locality: "Cair Paravel",
    });
    expect(good.valid).toBe(true);
  });

  it("scopes plugins by country so a rule cannot leak into another market", () => {
    const calls: string[] = [];
    const usOnly: Plugin = {
      name: "test:us-only",
      countries: ["US"],
      validate(ctx) {
        calls.push(ctx.address.countryCode);
        return [];
      },
    };

    const validator = createValidator({ metadata, plugins: [usOnly] });
    validator.validate({ countryCode: "NA", streetAddress: ["1 Lamppost Way"], locality: "Cair Paravel" });
    expect(calls).toEqual([]);
  });

  it("resolves competing classifiers by confidence, not registration order", () => {
    const weak: Plugin = { name: "weak", classify: () => ({ type: "po_box", confidence: 0.5 }) };
    const strong: Plugin = { name: "strong", classify: () => ({ type: "parcel_locker", confidence: 0.99 }) };

    // Registered weakest-last to prove order alone does not decide the winner.
    const validator = createValidator({ metadata, plugins: [strong, weak] });
    const result = validator.validate({
      countryCode: "NA",
      streetAddress: ["1 Lamppost Way"],
      locality: "Cair Paravel",
    });
    expect(result.type).toBe("parcel_locker");
  });

  it("lets a plugin override formatting for one country only", () => {
    const shout: Plugin = {
      name: "test:shout",
      countries: ["NA"],
      format: (ctx) => [`${(ctx.address.locality ?? "").toUpperCase()}!`],
    };

    const validator = createValidator({ metadata, plugins: [shout] });
    expect(validator.format({ countryCode: "NA", locality: "Cair Paravel" })).toEqual(["CAIR PARAVEL!"]);
    // A country the plugin is not scoped to keeps the default rendering.
    expect(validator.format({ countryCode: "US", locality: "Boston" })).toEqual(["Boston"]);
  });

  it("lets a plugin contribute normalization", () => {
    const expandSt: Plugin = {
      name: "test:expand-st",
      normalizeField(field, value) {
        if (field !== "streetAddress") return undefined;
        return value.replace(/\bSt\b/g, "Street");
      },
    };

    const validator = createValidator({ metadata, plugins: [expandSt] });
    const result = validator.validate({
      countryCode: "NA",
      streetAddress: ["1 Lamppost St"],
      locality: "Cair Paravel",
    });
    expect(result.normalized.streetAddress).toEqual(["1 Lamppost Street"]);
    // The caller can always see that we changed it.
    expect(result.components.streetAddress?.confirmation).toBe("replaced");
    expect(result.components.streetAddress?.input).toBe("1 Lamppost St");
  });

  it("uses metadata labels in messages, so errors speak the country's language of address", () => {
    const validator = createValidator({ metadata });
    const result = validator.validate({ countryCode: "NA", streetAddress: ["1 Lamppost Way"] });
    const missing = result.issues.find((i) => i.field === "locality");
    expect(missing?.message).toContain("Township");
  });

  it("degrades to generic checks, loudly, for a country it has no data for", () => {
    const validator = createValidator({ metadata });
    const result = validator.validate({ countryCode: "ZW", streetAddress: ["1 Somewhere Rd"] });
    expect(result.issues.map((i) => i.code)).toContain("COUNTRY_UNKNOWN");
    expect(result.valid).toBe(true);
  });

  it("swaps the metadata source without touching the engine", () => {
    const empty = createValidator({});
    const result = empty.validate({ countryCode: "NA", streetAddress: ["1 Lamppost Way"] });
    // No data at all: still runs, still reports what it could not check.
    expect(result.issues.map((i) => i.code)).toContain("COUNTRY_UNKNOWN");
  });
});
