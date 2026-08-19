import type { CountryMetadata, MetadataSource } from "./metadata.js";
import type { AddressFormSchema, CountryCode, Field, FieldLabels } from "./types.js";

/**
 * Fallback labels, used when the country metadata does not carry its own.
 * These are the neutral English terms; the local term ("prefecture", "emirate")
 * always wins when metadata supplies one.
 */
const DEFAULT_LABELS: Required<Pick<FieldLabels, Field>> = {
  name: "Name",
  organization: "Company",
  streetAddress: "Street address",
  dependentLocality: "District",
  locality: "City",
  administrativeArea: "State / Province",
  postalCode: "Postal code",
  sortingCode: "Sorting code",
  countryCode: "Country",
};

const FALLBACK_ROWS: Field[][] = [
  ["name"],
  ["organization"],
  ["streetAddress"],
  ["locality"],
  ["administrativeArea", "postalCode"],
  ["countryCode"],
];

/**
 * Everything a form needs to render correct fields, in the correct order, with
 * the correct local names — without the form knowing anything about the country.
 *
 * This is the API most consumers reach for first: a React/Vue/Svelte adapter is
 * a thin loop over `rows`, which is exactly why no framework code belongs in
 * this package.
 */
export function getAddressFormSchema(
  country: CountryCode,
  source: MetadataSource,
): AddressFormSchema {
  const code = country.toUpperCase();
  const metadata = source.get(code);

  if (!metadata) {
    return {
      countryCode: code,
      rows: FALLBACK_ROWS,
      required: ["streetAddress", "locality", "countryCode"],
      supported: FALLBACK_ROWS.flat(),
      uppercase: [],
      labels: { ...DEFAULT_LABELS },
      postalCodeExamples: [],
    };
  }

  return {
    countryCode: code,
    rows: rowsFrom(metadata),
    required: [...metadata.required],
    supported: [...metadata.supported],
    uppercase: [...metadata.uppercase],
    labels: { ...DEFAULT_LABELS, ...metadata.labels },
    postalCodeExamples: [...metadata.postalCodeExamples],
    ...(metadata.administrativeAreas
      ? {
          administrativeAreas: metadata.administrativeAreas.map((a) => ({
            code: a.code,
            name: a.name,
            ...(a.latinName ? { latinName: a.latinName } : {}),
          })),
        }
      : {}),
    ...(metadata.postalCodePattern ? { postalCodePattern: metadata.postalCodePattern } : {}),
  };
}

/**
 * Derives form rows from the postal format rows.
 *
 * Name and organization are hoisted to the top even when the postal format puts
 * them last (as Japan and China do). Postal order is for envelopes; form order
 * follows the order a person fills a form in, and every major checkout does the
 * same thing.
 */
function rowsFrom(metadata: CountryMetadata): Field[][] {
  const rows = metadata.format.map((row) => row.fields.filter((f) => f !== "countryCode"));

  const personal: Field[][] = [];
  const rest: Field[][] = [];
  for (const row of rows) {
    if (row.length === 0) continue;
    if (row.every((f) => f === "name" || f === "organization")) personal.push(row);
    else rest.push(row.filter((f) => f !== "name" && f !== "organization"));
  }

  // Japan and China put the recipient's name *last* on an envelope, but a form
  // always asks for the name before the company. Postal order governs the
  // label; form order governs the form.
  personal.sort((a, b) => rank(a) - rank(b));

  const out = [...personal, ...rest.filter((r) => r.length > 0)];
  out.push(["countryCode"]);
  return out;
}

/** Rows carrying the recipient name sort ahead of company-only rows. */
function rank(row: Field[]): number {
  return row.includes("name") ? 0 : 1;
}
