import type { CountryMetadata, FormatRow } from "./metadata.js";
import type { Address, Field } from "./types.js";

/**
 * Google's metadata encodes address layout as a format string like
 * `%N%n%O%n%A%n%C, %S %Z`. This maps the single-letter codes onto our neutral
 * field names.
 */
const TOKEN_TO_FIELD: Record<string, Field> = {
  N: "name",
  O: "organization",
  A: "streetAddress",
  D: "dependentLocality",
  C: "locality",
  S: "administrativeArea",
  Z: "postalCode",
  X: "sortingCode",
  R: "countryCode",
};

/**
 * Parses a `fmt` string into rows of fields plus their literal separators.
 *
 * Exported because this is what the data generator uses at build time — the
 * shipped metadata carries pre-parsed rows so that no consumer pays the parse
 * cost at runtime.
 */
export function parseFormatString(fmt: string): FormatRow[] {
  const rows: FormatRow[] = [];
  let fields: Field[] = [];
  let separators: string[] = [];
  let literal = "";
  let prefix = "";

  const flushRow = () => {
    // Trailing literal after the last field on the row.
    if (fields.length > 0) {
      separators[fields.length - 1] = literal;
      rows.push({ fields, separators, ...(prefix ? { prefix } : {}) });
    }
    fields = [];
    separators = [];
    literal = "";
    prefix = "";
  };

  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch !== "%") {
      literal += ch;
      continue;
    }
    const token = fmt[++i];
    if (token === undefined) break;
    if (token === "n") {
      flushRow();
      continue;
    }
    const field = TOKEN_TO_FIELD[token];
    if (!field) {
      // Unknown token: keep it as literal text rather than dropping data.
      literal += `%${token}`;
      continue;
    }
    // Literal text before the first field is a row prefix (Japan's 〒), not a
    // separator between two values.
    if (fields.length > 0) separators[fields.length - 1] = literal;
    else prefix = literal;
    literal = "";
    fields.push(field);
  }
  flushRow();
  return rows;
}

/** The printable string for one field, or "" when absent. */
function valueOf(address: Address, field: Field): string {
  switch (field) {
    case "streetAddress":
      return (address.streetAddress ?? []).filter((l) => l && l.trim()).join("\n");
    case "countryCode":
      return address.countryCode ?? "";
    default:
      return (address[field] ?? "").toString();
  }
}

/**
 * Renders an address to postal lines using the country's own field order.
 *
 * Rows whose fields are all empty are dropped, and separators adjacent to an
 * empty field are collapsed — otherwise an address with no organization comes
 * out with a stray comma, which is the classic tell of a naive formatter.
 */
export function formatAddress(
  address: Address,
  metadata: CountryMetadata | undefined,
  opts: { latin?: boolean; includeCountry?: boolean; countryName?: string } = {},
): string[] {
  const rows =
    (opts.latin ? metadata?.latinFormat : undefined) ?? metadata?.format ?? FALLBACK_FORMAT;

  const lines: string[] = [];
  for (const row of rows) {
    let line = "";
    row.fields.forEach((field, index) => {
      const value = valueOf(address, field);
      if (!value) return;
      if (line === "") {
        // The prefix belongs to the row's first field (Japan's 〒 marks the
        // postal code). If that field is absent, the prefix goes with it.
        if (index === 0) line += row.prefix ?? "";
      } else {
        // Only emit the separator that sits between two *present* values.
        // An explicitly empty separator means "join directly" — Japanese
        // addresses concatenate prefecture and ward with no space — so only an
        // *absent* separator falls back to a space.
        line += row.separators?.[index - 1] ?? " ";
      }
      line += value;
    });
    // A street address may itself be multi-line.
    for (const part of line.split("\n")) {
      const trimmed = part.trim().replace(/\s+,/g, ",").replace(/,\s*$/, "");
      if (trimmed) lines.push(trimmed);
    }
  }

  if (opts.includeCountry) {
    const country = opts.countryName ?? metadata?.name ?? address.countryCode;
    if (country) lines.push(country.toUpperCase());
  }

  return lines;
}

/** Used when we have no metadata: a reasonable Western default. */
const FALLBACK_FORMAT: FormatRow[] = [
  { fields: ["name"] },
  { fields: ["organization"] },
  { fields: ["streetAddress"] },
  { fields: ["dependentLocality"] },
  { fields: ["locality", "administrativeArea", "postalCode"], separators: [", ", " ", ""] },
];

/** Collapses formatted lines onto one line, for tables and log output. */
export function formatOneLine(lines: string[]): string {
  return lines.join(", ");
}
