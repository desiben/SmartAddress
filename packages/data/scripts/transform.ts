/**
 * Shared transform from upstream raw metadata into {@link CountryMetadata}.
 *
 * Used by both `sync.ts` (fetches live data) and `bootstrap.ts` (generates the
 * committed seed), so the two can never drift apart in how they interpret the
 * upstream format.
 */

import { parseFormatString } from "../../core/src/format.js";
import type { AdministrativeArea, CountryMetadata } from "../../core/src/metadata.js";
import type { Field } from "../../core/src/types.js";

/** Google encodes required fields as a string of single-letter codes. */
const CODE_TO_FIELD: Record<string, Field> = {
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

/** Raw shape of a `data/XX` document. Only the keys we consume are typed. */
export interface RawCountry {
  id?: string;
  key?: string;
  name?: string;
  fmt?: string;
  lfmt?: string;
  require?: string;
  upper?: string;
  zip?: string;
  zipex?: string;
  postprefix?: string;
  state_name_type?: string;
  locality_name_type?: string;
  sublocality_name_type?: string;
  zip_name_type?: string;
  sub_keys?: string;
  sub_names?: string;
  sub_lnames?: string;
  sub_isoids?: string;
  lang?: string;
  languages?: string;
  posturl?: string;
  /** Only present on the root `data` document: `~`-delimited country list. */
  countries?: string;
}

export function expandCodes(codes: string | undefined): Field[] {
  if (!codes) return [];
  const out: Field[] = [];
  for (const ch of codes) {
    const field = CODE_TO_FIELD[ch];
    if (field && !out.includes(field)) out.push(field);
  }
  return out;
}

/**
 * Google names field types with terms like "state", "prefecture", "do_si".
 * These map onto the label a form should show. Unknown values are title-cased
 * rather than dropped, so a new upstream term degrades to something readable.
 */
const NAME_TYPE_LABELS: Record<string, string> = {
  area: "Area",
  county: "County",
  department: "Department",
  district: "District",
  do_si: "Province",
  emirate: "Emirate",
  island: "Island",
  oblast: "Oblast",
  parish: "Parish",
  prefecture: "Prefecture",
  province: "Province",
  state: "State",
  city: "City",
  post_town: "Post town",
  suburb: "Suburb",
  township: "Township",
  neighborhood: "Neighborhood",
  village_township: "Village / Township",
  zip: "ZIP code",
  postal: "Postal code",
  pin: "PIN code",
  eircode: "Eircode",
};

function label(nameType: string | undefined, fallback: string): string {
  if (!nameType) return fallback;
  return (
    NAME_TYPE_LABELS[nameType] ??
    nameType.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

async function fetchJson(url: string): Promise<RawCountry | undefined> {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${url}`);
    return undefined;
  }
  return (await res.json()) as RawCountry;
}

/** Splits an upstream `~`-delimited list, tolerating an absent value. */
export function splitList(value: string | undefined): string[] {
  return value ? value.split("~") : [];
}

function buildAdministrativeAreas(raw: RawCountry): AdministrativeArea[] | undefined {
  const keys = splitList(raw.sub_keys);
  if (keys.length === 0) return undefined;
  const names = splitList(raw.sub_names);
  const latin = splitList(raw.sub_lnames);
  const isoIds = splitList(raw.sub_isoids);

  return keys.map((key, i) => {
    const name = names[i] ?? key;
    const latinName = latin[i];
    // The code and the canonical name are matched directly, so only genuinely
    // *alternative* spellings belong in `aliases`.
    const aliases = new Set<string>();
    if (isoIds[i]) aliases.add(isoIds[i]!);
    if (latinName) aliases.add(latinName);
    aliases.delete(name);
    aliases.delete(key);

    return {
      code: key,
      name,
      ...(latinName && latinName !== name ? { latinName } : {}),
      ...(aliases.size ? { aliases: [...aliases] } : {}),
    };
  });
}

export function toMetadata(country: string, raw: RawCountry): CountryMetadata {
  const required = expandCodes(raw.require);
  const format = parseFormatString(raw.fmt ?? "%N%n%O%n%A%n%C");
  const latinFormat = raw.lfmt ? parseFormatString(raw.lfmt) : undefined;

  // A field is supported if the country's own format string mentions it.
  const supported = [...new Set(format.flatMap((r) => r.fields))];
  for (const f of required) if (!supported.includes(f)) supported.push(f);

  return {
    countryCode: country,
    name: raw.name ?? country,
    format,
    ...(latinFormat ? { latinFormat } : {}),
    required,
    supported,
    uppercase: expandCodes(raw.upper),
    ...(raw.zip ? { postalCodePattern: raw.zip } : {}),
    postalCodeExamples: raw.zipex ? raw.zipex.split(",") : [],
    ...(raw.postprefix ? { postalCodePrefix: raw.postprefix } : {}),
    labels: {
      administrativeArea: label(raw.state_name_type, "State / Province"),
      locality: label(raw.locality_name_type, "City"),
      dependentLocality: label(raw.sublocality_name_type, "District"),
      postalCode: label(raw.zip_name_type, "Postal code"),
    },
    ...(buildAdministrativeAreas(raw) ? { administrativeAreas: buildAdministrativeAreas(raw) } : {}),
    ...(raw.lang ? { defaultLanguage: raw.lang } : {}),
    ...(raw.posturl ? { postalServiceUrl: raw.posturl } : {}),
  };
}

