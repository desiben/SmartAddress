import type { CountryMetadata } from "../metadata.js";
import type { Field, Issue } from "../types.js";
import type { Plugin, PluginContext } from "../plugin.js";

/** Longest value we will accept in any single field, matching common carrier limits. */
const MAX_FIELD_LENGTH = 200;
/** C0 controls except tab and newline, plus DEL and the C1 range. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

function issue(
  code: Issue["code"],
  severity: Issue["severity"],
  message: string,
  field?: Field,
  meta?: Issue["meta"],
): Issue {
  return {
    code,
    severity,
    message,
    ...(field ? { field } : {}),
    ...(meta ? { meta } : {}),
    source: "core:structural",
  };
}

/** Values present on the address, as a plain field->string map. */
export function presentValues(ctx: PluginContext): Map<Field, string> {
  const a = ctx.address;
  const out = new Map<Field, string>();
  const put = (f: Field, v: string | undefined) => {
    if (v && v.trim()) out.set(f, v.trim());
  };
  put("countryCode", a.countryCode);
  put("name", a.name);
  put("organization", a.organization);
  put("dependentLocality", a.dependentLocality);
  put("locality", a.locality);
  put("administrativeArea", a.administrativeArea);
  put("postalCode", a.postalCode);
  put("sortingCode", a.sortingCode);
  const street = (a.streetAddress ?? []).filter((l) => l && l.trim()).join("\n");
  if (street) out.set("streetAddress", street);
  return out;
}

/**
 * Country-agnostic structural rules: presence of required fields, fields that
 * do not exist for the country, postal code shape, and value sanity.
 *
 * Everything here is driven by metadata rather than hardcoded per country, so
 * adding a country is a data change, not a code change.
 */
export const structuralPlugin: Plugin = {
  name: "core:structural",

  validate(ctx): Issue[] {
    const issues: Issue[] = [];
    const values = presentValues(ctx);
    const { metadata, options } = ctx;

    if (!ctx.address.countryCode || !ctx.address.countryCode.trim()) {
      issues.push(issue("COUNTRY_REQUIRED", "error", "A country code is required.", "countryCode"));
      return issues; // Nothing else can be judged without it.
    }
    if (!/^[A-Z]{2}$/.test(ctx.address.countryCode)) {
      issues.push(
        issue(
          "COUNTRY_UNKNOWN",
          "error",
          `"${ctx.address.countryCode}" is not an ISO 3166-1 alpha-2 code.`,
          "countryCode",
        ),
      );
      return issues;
    }

    for (const [field, value] of values) {
      if (value.length > MAX_FIELD_LENGTH) {
        issues.push(
          issue("VALUE_TOO_LONG", "error", `${field} exceeds ${MAX_FIELD_LENGTH} characters.`, field, {
            max: MAX_FIELD_LENGTH,
            actual: value.length,
          }),
        );
      }
      if (CONTROL_CHARS.test(value)) {
        issues.push(
          issue("VALUE_HAS_CONTROL_CHARACTERS", "error", `${field} contains control characters.`, field),
        );
      }
    }

    if (!metadata) {
      // Unknown country: we can still check shape, but not country rules. Say so
      // rather than silently passing an address we never actually checked.
      issues.push(
        issue(
          "COUNTRY_UNKNOWN",
          "warning",
          `No metadata for "${ctx.address.countryCode}"; only generic checks ran.`,
          "countryCode",
        ),
      );
      return issues;
    }

    // Required fields. `partial` downgrades these for progressive form validation.
    const requiredSeverity: Issue["severity"] = options.partial ? "warning" : "error";
    for (const field of metadata.required) {
      if (!values.has(field)) {
        issues.push(
          issue(
            "FIELD_REQUIRED",
            requiredSeverity,
            `${labelFor(ctx, field)} is required for ${metadata.name}.`,
            field,
          ),
        );
      }
    }

    // Fields the country does not use at all. A warning, not an error: carrying
    // a stray value is untidy but does not make the address undeliverable.
    for (const field of values.keys()) {
      if (field === "countryCode") continue;
      if (!metadata.supported.includes(field)) {
        issues.push(
          issue(
            "FIELD_UNSUPPORTED",
            "warning",
            `${metadata.name} addresses do not use ${labelFor(ctx, field)}.`,
            field,
          ),
        );
      }
    }

    const postalCode = values.get("postalCode");
    if (postalCode && metadata.postalCodePattern) {
      // Metadata patterns are unanchored by convention; anchor them so a
      // partial match cannot pass.
      const re = new RegExp(`^(?:${metadata.postalCodePattern})$`);
      if (!re.test(postalCode)) {
        issues.push(
          issue(
            "POSTAL_CODE_PATTERN_MISMATCH",
            "error",
            `"${postalCode}" is not a valid ${labelFor(ctx, "postalCode")} for ${metadata.name}.`,
            "postalCode",
            {
              pattern: metadata.postalCodePattern,
              ...(metadata.postalCodeExamples[0] ? { example: metadata.postalCodeExamples[0] } : {}),
            },
          ),
        );
      }
    }

    const admin = values.get("administrativeArea");
    if (admin && metadata.administrativeAreas?.length) {
      if (!matchAdministrativeArea(metadata.administrativeAreas, admin)) {
        issues.push(
          issue(
            "ADMIN_AREA_UNKNOWN",
            "error",
            `"${admin}" is not a recognised ${labelFor(ctx, "administrativeArea")} in ${metadata.name}.`,
            "administrativeArea",
          ),
        );
      }
    }

    return issues;
  },
};

/** Case- and accent-insensitive match against a code, name, latin name, or alias. */
export function matchAdministrativeArea(
  areas: NonNullable<CountryMetadata["administrativeAreas"]>,
  input: string,
): NonNullable<CountryMetadata["administrativeAreas"]>[number] | undefined {
  const needle = fold(input);
  for (const area of areas) {
    const candidates = [area.code, area.name, area.latinName, ...(area.aliases ?? [])];
    if (candidates.some((c) => c && fold(c) === needle)) return area;
  }
  return undefined;
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.\-_'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function labelFor(ctx: PluginContext, field: Field): string {
  return ctx.metadata?.labels[field] ?? field;
}
