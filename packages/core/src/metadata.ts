import type { CountryCode, Field } from "./types.js";

/**
 * Per-country rules, in a shape derived from Google's i18n address metadata but
 * with the single-letter field codes expanded and the format string pre-parsed.
 *
 * This type is the contract between `@smartaddress/core` and any data source.
 * Swapping the data package for your own (a subset, a patched copy, an internal
 * one) means producing this shape — nothing else in the engine changes.
 */
export interface CountryMetadata {
  countryCode: CountryCode;
  name: string;
  /** Rows of fields in the country's own postal reading order. */
  format: FormatRow[];
  /** Latinized format, used when writing the address for a foreign carrier. */
  latinFormat?: FormatRow[];
  required: Field[];
  /** Fields that exist for this country at all. */
  supported: Field[];
  /** Fields the postal operator prefers uppercase. */
  uppercase: Field[];
  /** Regex source (anchored by the engine) for the postal code. */
  postalCodePattern?: string;
  postalCodeExamples: string[];
  /** e.g. "SW1A 1AA" style prefix some countries prepend, like "PR " for Puerto Rico. */
  postalCodePrefix?: string;
  /** What this country calls each variable field. */
  labels: LabelSet;
  administrativeAreas?: AdministrativeArea[];
  defaultLanguage?: string;
  /** National postal operator's lookup page, useful in error messages. */
  postalServiceUrl?: string;
}

/** One visual/postal line, as a list of fields plus the literal separators. */
export interface FormatRow {
  fields: Field[];
  /**
   * Literal text before the first field on the row, e.g. Japan's postal marker
   * in `〒%Z`. Emitted only when the row produces any content.
   */
  prefix?: string;
  /** Literal text between fields, `separators[i]` follows `fields[i]`. */
  separators?: string[];
}

/**
 * The name each country uses for its variable fields. Keys are the neutral
 * field names; values are the local term ("prefecture", "emirate", "county").
 */
export type LabelSet = Partial<Record<Field, string>>;

export interface AdministrativeArea {
  /** The code used in addresses, e.g. "CA", "JP-13". */
  code: string;
  /** Local-script name. */
  name: string;
  /** Latin transliteration, when the local name is not Latin script. */
  latinName?: string;
  /** Alternative spellings and abbreviations we accept on input. */
  aliases?: string[];
}

/**
 * The pluggable data source. `@smartaddress/data` ships one, but a caller can
 * provide their own — a trimmed 5-country build for bundle size, or an
 * internal one with corrections applied.
 */
export interface MetadataSource {
  get(country: CountryCode): CountryMetadata | undefined;
  has(country: CountryCode): boolean;
  countries(): CountryCode[];
}

/** Builds a {@link MetadataSource} from a plain record. */
export function createMetadataSource(
  table: Readonly<Record<string, CountryMetadata>>,
): MetadataSource {
  return {
    get: (c) => table[c.toUpperCase()],
    has: (c) => c.toUpperCase() in table,
    countries: () => Object.keys(table).sort(),
  };
}

/** A source that knows nothing. The engine degrades to generic rules. */
export const EMPTY_METADATA: MetadataSource = createMetadataSource({});
