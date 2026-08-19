import type { Field } from "../types.js";
import type { Plugin, PluginContext } from "../plugin.js";
import { matchAdministrativeArea } from "./structural.js";

/** Collapse runs of whitespace and trim, without touching the script. */
function tidy(value: string): string {
  return value.replace(/[ \t  - 　]+/g, " ").trim();
}

/**
 * Country-agnostic normalization.
 *
 * Deliberately conservative. Whitespace tidying and metadata-driven uppercasing
 * are safe; anything that changes the *meaning* of a value (expanding "St" to
 * "Street", reordering lines) is not done here, because SmartAddress reports
 * corrections rather than applying them.
 */
export const normalizePlugin: Plugin = {
  name: "core:normalize",

  normalizeField(field, value, ctx): string | undefined {
    let out = tidy(value);

    if (field === "countryCode") return out.toUpperCase();

    // Resolve an administrative area to its canonical code when the country has
    // a fixed list. This is a genuine canonicalisation ("California" -> "CA"),
    // and the engine records it as `replaced` so the caller can see it happened.
    if (field === "administrativeArea" && ctx.metadata?.administrativeAreas?.length) {
      const match = matchAdministrativeArea(ctx.metadata.administrativeAreas, out);
      if (match) return match.code;
    }

    if (ctx.metadata?.uppercase.includes(field)) {
      out = out.toLocaleUpperCase(ctx.metadata.defaultLanguage ?? "en");
    }

    return out === value ? undefined : out;
  },
};

/**
 * Postal-code shape normalization for the countries whose canonical form is
 * unambiguous. Kept separate from {@link normalizePlugin} so a caller can drop
 * it if they need postal codes preserved byte-for-byte.
 */
export const postalCodeNormalizePlugin: Plugin = {
  name: "core:normalize-postal-code",

  normalizeField(field: Field, value: string, ctx): string | undefined {
    if (field !== "postalCode") return undefined;
    const raw = value.trim().toUpperCase().replace(/\s+/g, " ");

    switch (ctx.address.countryCode) {
      // "sw1a1aa" -> "SW1A 1AA": the space before the final three characters is
      // part of the canonical form, not decoration.
      case "GB": {
        const compact = raw.replace(/\s+/g, "");
        if (compact.length < 5 || compact.length > 7) return raw === value ? undefined : raw;
        const out = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
        return out === value ? undefined : out;
      }
      // Canada uses "A1A 1A1".
      case "CA": {
        const compact = raw.replace(/\s+/g, "");
        if (compact.length !== 6) return raw === value ? undefined : raw;
        const out = `${compact.slice(0, 3)} ${compact.slice(3)}`;
        return out === value ? undefined : out;
      }
      // Japan writes 123-4567; strip a leading 〒 marker if present.
      case "JP": {
        const digits = raw.replace(/^〒\s*/, "").replace(/[^0-9]/g, "");
        if (digits.length !== 7) return raw === value ? undefined : raw;
        const out = `${digits.slice(0, 3)}-${digits.slice(3)}`;
        return out === value ? undefined : out;
      }
      // Brazil writes 01310-100.
      case "BR": {
        const digits = raw.replace(/[^0-9]/g, "");
        if (digits.length !== 8) return raw === value ? undefined : raw;
        const out = `${digits.slice(0, 5)}-${digits.slice(5)}`;
        return out === value ? undefined : out;
      }
      default:
        return raw === value ? undefined : raw;
    }
  },
};
