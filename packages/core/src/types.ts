/**
 * Core vocabulary for SmartAddress.
 *
 * Everything in this file is data, not behaviour. Ports in other languages are
 * expected to mirror these shapes exactly so that the shared conformance
 * vectors in `/conformance` can be run against them unchanged.
 */

/** ISO 3166-1 alpha-2, uppercase. */
export type CountryCode = string;

/**
 * The canonical field set. These names are deliberately neutral: what a field
 * is *called* in a given country (state / province / prefecture / emirate) is a
 * presentation concern resolved by {@link FieldLabels}, not a schema concern.
 *
 * The single-letter codes in Google's i18n metadata map onto these as:
 * N->name, O->organization, A->streetAddress, C->locality, S->administrativeArea,
 * Z->postalCode, X->sortingCode, D->dependentLocality.
 */
export type Field =
  | "name"
  | "organization"
  | "streetAddress"
  | "dependentLocality"
  | "locality"
  | "administrativeArea"
  | "postalCode"
  | "sortingCode"
  | "countryCode";

export const ALL_FIELDS: readonly Field[] = [
  "name",
  "organization",
  "streetAddress",
  "dependentLocality",
  "locality",
  "administrativeArea",
  "postalCode",
  "sortingCode",
  "countryCode",
];

/**
 * An address as supplied by a caller. Every field is optional except the
 * country, because you cannot validate anything without first knowing which
 * country's rules apply.
 *
 * `streetAddress` is an array because multi-line street addresses are the norm
 * outside the US and flattening them loses information.
 */
export interface Address {
  countryCode: CountryCode;
  name?: string;
  organization?: string;
  streetAddress?: string[];
  dependentLocality?: string;
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  sortingCode?: string;
}

/**
 * What kind of address this is. This is a first-class concept rather than a
 * derived detail because the type *gates the rules*: a PO Box is structurally
 * valid but undeliverable by most couriers, and a military address only looks
 * like a US address.
 */
export type AddressType =
  | "street"           // ordinary premise address
  | "po_box"           // post office box / Postfach / boîte postale
  | "military"         // APO / FPO / DPO (US), BFPO (UK)
  | "general_delivery" // poste restante
  | "rural_route"      // USPS "RR ## BOX ##"
  | "highway_contract" // USPS "HC ## BOX ##"
  | "parcel_locker"    // Packstation, InPost, Amazon Locker
  | "unknown";

/**
 * Capabilities implied by the address type. Callers use these to make real
 * decisions ("can I ship this with a courier?") without hardcoding a list of
 * address types they have to keep in sync with this library.
 */
export interface AddressCapabilities {
  /** Deliverable by private couriers (UPS/FedEx/DHL), which refuse PO Boxes. */
  courierDeliverable: boolean;
  /** Deliverable by the national postal operator. */
  postalDeliverable: boolean;
  /** Plausibly a place where a person actually lives. */
  residential: boolean;
  /** Crosses a customs border in a way that needs extra paperwork (e.g. APO). */
  requiresCustomsDeclaration: boolean;
}

/**
 * How specific the validation was able to get. Mirrors the vocabulary used by
 * Google's Address Validation API so that provider adapters can map onto it
 * without inventing a private scale.
 *
 * Ordered coarse -> fine; use {@link granularityRank} to compare.
 */
export type Granularity =
  | "none"
  | "country"
  | "administrative_area"
  | "locality"
  | "postal_code"
  | "street"
  | "premise"
  | "sub_premise";

const GRANULARITY_ORDER: readonly Granularity[] = [
  "none",
  "country",
  "administrative_area",
  "locality",
  "postal_code",
  "street",
  "premise",
  "sub_premise",
];

export function granularityRank(g: Granularity): number {
  return GRANULARITY_ORDER.indexOf(g);
}

/** Returns the coarser of two granularities. */
export function minGranularity(a: Granularity, b: Granularity): Granularity {
  return granularityRank(a) <= granularityRank(b) ? a : b;
}

/**
 * Per-component confidence. `inferred` and `replaced` exist so that a caller
 * can always tell whether a value came from the user or from us — SmartAddress
 * never silently rewrites an address, it reports what it would change.
 */
export type ConfirmationLevel =
  | "confirmed"    // matched against reference data
  | "plausible"    // consistent with the rules, but not confirmed against data
  | "unconfirmed"  // could not be checked
  | "suspicious"   // actively looks wrong
  | "inferred"     // we supplied a value the user omitted
  | "replaced";    // we would substitute a different value

export interface ComponentResult {
  field: Field;
  /** The value after normalization. */
  value: string;
  /** The value exactly as the caller supplied it, if it differed. */
  input?: string;
  confirmation: ConfirmationLevel;
}

export type IssueSeverity = "error" | "warning" | "info";

/**
 * A machine-readable finding. `code` is the stable contract — it is what
 * callers branch on and what the conformance vectors assert. `message` is a
 * developer-facing convenience and is explicitly NOT stable; user-facing text
 * belongs in the caller's own i18n layer, keyed off `code`.
 */
export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  field?: Field;
  message: string;
  /** Structured detail for building a message, e.g. `{ expected: "94043" }`. */
  meta?: Record<string, string | number | boolean>;
  /** Which plugin raised this, for debugging a rule you did not expect. */
  source?: string;
}

export type IssueCode =
  | "COUNTRY_REQUIRED"
  | "COUNTRY_UNKNOWN"
  | "FIELD_REQUIRED"
  | "FIELD_UNSUPPORTED"
  | "POSTAL_CODE_PATTERN_MISMATCH"
  | "POSTAL_CODE_PREFIX_MISMATCH"
  | "ADMIN_AREA_UNKNOWN"
  | "ADMIN_AREA_INFERRED"
  | "PO_BOX_NOT_ACCEPTED"
  | "MILITARY_ADMIN_AREA_INVALID"
  | "MILITARY_POSTAL_CODE_INVALID"
  | "TYPE_NOT_ACCEPTED"
  | "VALUE_TOO_LONG"
  | "VALUE_HAS_CONTROL_CHARACTERS";

/**
 * The result of validating an address.
 *
 * Deliberately not a boolean. A caller deciding whether to block a checkout
 * needs to distinguish "the postcode is malformed" from "we could not confirm
 * the building number", and those are different axes.
 */
export interface ValidationResult {
  /** True when there are no `error`-severity issues. */
  valid: boolean;
  /** How specific we managed to get. */
  granularity: Granularity;
  /** True when no required component is missing or unexpected. */
  complete: boolean;
  type: AddressType;
  capabilities: AddressCapabilities;
  /** Per-field outcome, keyed by field. */
  components: Partial<Record<Field, ComponentResult>>;
  issues: Issue[];
  /**
   * The address in canonical form. Callers should treat this as a *suggestion*
   * and diff it against their input rather than applying it blindly.
   */
  normalized: Address;
}

/** Human-facing names for fields in a particular country and language. */
export type FieldLabels = Partial<Record<Field, string>>;

/**
 * Everything a UI needs to render a correct address form for one country,
 * without the UI knowing anything about that country.
 */
export interface AddressFormSchema {
  countryCode: CountryCode;
  /** Fields grouped into visual rows, in the country's own reading order. */
  rows: Field[][];
  required: Field[];
  /** Fields that exist at all for this country. */
  supported: Field[];
  /** Fields the postal operator wants in uppercase. */
  uppercase: Field[];
  labels: FieldLabels;
  /** Example postal codes, straight from the metadata's `zipex`. */
  postalCodeExamples: string[];
  /** Allowed values for `administrativeArea`, when the country has a fixed set. */
  administrativeAreas?: { code: string; name: string; latinName?: string }[];
  /** Regex source for the postal code, if the country has one. */
  postalCodePattern?: string;
}
