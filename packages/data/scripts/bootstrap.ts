/**
 * Generates the committed bootstrap snapshot in `packages/data/data/countries.json`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The authoritative data comes from `pnpm sync:data`, which fetches Google's
 * i18n address service. That service is unreachable from some CI and sandbox
 * networks, and carries no uptime guarantee at all. Shipping a repo whose test
 * suite cannot run without it would be a bad trade.
 *
 * So this file holds a hand-entered seed covering a spread of the structurally
 * *interesting* countries — ones with no postal code (AE, HK), no required
 * postal code (IE), a sorting code (FR), non-Latin postal order (JP, CN), and
 * fixed subdivision lists (US, CA, AU).
 *
 * It is a SEED, not a source of truth. Running `pnpm sync:data` overwrites it
 * with the full ~250-country upstream set. Do not add countries here to grow
 * coverage; run the sync instead.
 *
 * Run with: pnpm tsx packages/data/scripts/bootstrap.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CountryMetadata } from "../../core/src/metadata.js";
import { toMetadata, type RawCountry } from "./transform.js";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../data/countries.json");

const US_STATES =
  "AL~AK~AS~AZ~AR~AA~AE~AP~CA~CO~CT~DE~DC~FL~GA~GU~HI~ID~IL~IN~IA~KS~KY~LA~ME~MH~MD~MA~MI~FM~MN~MS~MO~MT~NE~NV~NH~NJ~NM~NY~NC~ND~MP~OH~OK~OR~PW~PA~PR~RI~SC~SD~TN~TX~UT~VT~VI~VA~WA~WV~WI~WY";
const US_STATE_NAMES =
  "Alabama~Alaska~American Samoa~Arizona~Arkansas~Armed Forces (AA)~Armed Forces (AE)~Armed Forces (AP)~California~Colorado~Connecticut~Delaware~District of Columbia~Florida~Georgia~Guam~Hawaii~Idaho~Illinois~Indiana~Iowa~Kansas~Kentucky~Louisiana~Maine~Marshall Islands~Maryland~Massachusetts~Michigan~Micronesia~Minnesota~Mississippi~Missouri~Montana~Nebraska~Nevada~New Hampshire~New Jersey~New Mexico~New York~North Carolina~North Dakota~Northern Mariana Islands~Ohio~Oklahoma~Oregon~Palau~Pennsylvania~Puerto Rico~Rhode Island~South Carolina~South Dakota~Tennessee~Texas~Utah~Vermont~Virgin Islands~Virginia~Washington~West Virginia~Wisconsin~Wyoming";

const CA_PROVINCES = "AB~BC~MB~NB~NL~NT~NS~NU~ON~PE~QC~SK~YT";
const CA_PROVINCE_NAMES =
  "Alberta~British Columbia~Manitoba~New Brunswick~Newfoundland and Labrador~Northwest Territories~Nova Scotia~Nunavut~Ontario~Prince Edward Island~Quebec~Saskatchewan~Yukon";

const AU_STATES = "ACT~NSW~NT~QLD~SA~TAS~VIC~WA";
const AU_STATE_NAMES =
  "Australian Capital Territory~New South Wales~Northern Territory~Queensland~South Australia~Tasmania~Victoria~Western Australia";

/**
 * Raw upstream-shaped records. Keeping them in upstream shape (rather than
 * pre-built `CountryMetadata`) means they flow through exactly the same
 * transform as synced data, so the seed cannot encode a different
 * interpretation of the format than production data does.
 */
const SEED: Record<string, RawCountry> = {
  US: {
    name: "United States",
    fmt: "%N%n%O%n%A%n%C, %S %Z",
    require: "ACSZ",
    upper: "CS",
    zip: "(\\d{5})(?:[ \\-](\\d{4}))?",
    zipex: "95014,22162-1010",
    zip_name_type: "zip",
    state_name_type: "state",
    sub_keys: US_STATES,
    sub_names: US_STATE_NAMES,
    lang: "en",
    posturl: "https://tools.usps.com/go/ZipLookupAction!input.action",
  },
  CA: {
    name: "Canada",
    fmt: "%N%n%O%n%A%n%C %S %Z",
    require: "ACSZ",
    upper: "ACNOSZ",
    zip: "[ABCEGHJKLMNPRSTVXY]\\d[ABCEGHJ-NPRSTV-Z][ ]?\\d[ABCEGHJ-NPRSTV-Z]\\d",
    zipex: "H3Z 2Y7,V8X 3X4,T0L 1K0",
    state_name_type: "province",
    sub_keys: CA_PROVINCES,
    sub_names: CA_PROVINCE_NAMES,
    lang: "en",
  },
  GB: {
    name: "United Kingdom",
    fmt: "%N%n%O%n%A%n%C%n%Z",
    require: "ACZ",
    upper: "CZ",
    zip: "GIR ?0AA|(?:(?:AB|AL|B|BA|BB|BD|BF|BH|BL|BN|BR|BS|BT|BX|CA|CB|CF|CH|CM|CO|CR|CT|CV|CW|DA|DD|DE|DG|DH|DL|DN|DT|DY|E|EC|EH|EN|EX|FK|FY|G|GL|GY|GU|HA|HD|HG|HP|HR|HS|HU|HX|IG|IM|IP|IV|JE|KA|KT|KW|KY|L|LA|LD|LE|LL|LN|LS|LU|M|ME|MK|ML|N|NE|NG|NN|NP|NR|NW|OL|OX|PA|PE|PH|PL|PO|PR|RG|RH|RM|S|SA|SE|SG|SK|SL|SM|SN|SO|SP|SR|SS|ST|SW|SY|TA|TD|TF|TN|TQ|TR|TS|TW|UB|W|WA|WC|WD|WF|WN|WR|WS|WV|YO|ZE)(?:\\d[\\dA-Z]? ?\\d[ABD-HJLN-UW-Z]{2}))",
    zipex: "EC1Y 8SY,GIR 0AA,M2 5BQ,SW1A 1AA",
    locality_name_type: "post_town",
    lang: "en",
    posturl: "https://www.royalmail.com/find-a-postcode",
  },
  DE: {
    name: "Germany",
    fmt: "%N%n%O%n%A%n%Z %C",
    require: "ACZ",
    zip: "\\d{5}",
    zipex: "26133,53225",
    lang: "de",
  },
  FR: {
    // France uses a sorting code (CEDEX), which is why %X exists at all.
    name: "France",
    fmt: "%N%n%O%n%A%n%Z %C %X",
    require: "ACZ",
    upper: "CX",
    zip: "\\d{2} ?\\d{3}",
    zipex: "11000,33380,99300",
    lang: "fr",
  },
  JP: {
    // Postal order runs largest-to-smallest and leads with the 〒 marker.
    name: "Japan",
    fmt: "〒%Z%n%S%C%n%A%n%O%n%N",
    lfmt: "%N%n%O%n%A%n%C, %S%n%Z",
    require: "ASZ",
    zip: "\\d{3}-?\\d{4}",
    zipex: "154-0023,350-1106",
    state_name_type: "prefecture",
    lang: "ja",
  },
  CN: {
    name: "China",
    fmt: "%Z%n%S%C%D%n%A%n%O%n%N",
    lfmt: "%N%n%O%n%A%n%D%n%C%n%S, %Z",
    require: "ACSZ",
    zip: "\\d{6}",
    zipex: "266033,317204",
    state_name_type: "province",
    sublocality_name_type: "district",
    lang: "zh",
  },
  AU: {
    name: "Australia",
    fmt: "%O%n%N%n%A%n%C %S %Z",
    require: "ACSZ",
    upper: "CS",
    zip: "\\d{4}",
    zipex: "2060,3000,6532",
    state_name_type: "state",
    sub_keys: AU_STATES,
    sub_names: AU_STATE_NAMES,
    lang: "en",
  },
  IN: {
    name: "India",
    fmt: "%N%n%O%n%A%n%D%n%C %Z%n%S",
    require: "ACSZ",
    zip: "\\d{6}",
    zipex: "110034,110001",
    zip_name_type: "pin",
    state_name_type: "state",
    lang: "en",
  },
  IE: {
    // No required postal code: Eircode exists but is optional, and there is no
    // postal-code-implies-locality relationship of the kind most validators assume.
    name: "Ireland",
    fmt: "%N%n%O%n%A%n%D%n%C%n%S%n%Z",
    require: "AC",
    zip: "[\\dA-Z]{3} ?[\\dA-Z]{4}",
    zipex: "A65 F4E2",
    zip_name_type: "eircode",
    state_name_type: "county",
    sublocality_name_type: "townland",
    lang: "en",
  },
  AE: {
    // No postal code at all. A validator that requires one is simply wrong here.
    name: "United Arab Emirates",
    fmt: "%N%n%O%n%A%n%S",
    require: "AS",
    state_name_type: "emirate",
    lang: "ar",
  },
  HK: {
    name: "Hong Kong",
    fmt: "%S%n%C%n%A%n%O%n%N",
    lfmt: "%N%n%O%n%A%n%C%n%S",
    require: "AS",
    state_name_type: "area",
    locality_name_type: "district",
    lang: "zh-Hant",
  },
  BR: {
    name: "Brazil",
    fmt: "%O%n%N%n%A%n%D%n%C-%S%n%Z",
    require: "ASCZ",
    upper: "CS",
    zip: "\\d{5}-?\\d{3}",
    zipex: "40301-110,70002-900",
    state_name_type: "state",
    sublocality_name_type: "neighborhood",
    lang: "pt",
  },
  NL: {
    name: "Netherlands",
    fmt: "%N%n%O%n%A%n%Z %C",
    require: "ACZ",
    zip: "\\d{4} ?[A-Z]{2}",
    zipex: "1234 AB,2490 AA",
    lang: "nl",
  },
};

async function main() {
  const countries: Record<string, CountryMetadata> = {};
  for (const [code, raw] of Object.entries(SEED)) {
    countries[code] = toMetadata(code, raw);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        // Deliberately not a wall-clock timestamp: CI re-runs this generator and
        // asserts the output is byte-identical to what is committed, which is
        // what stops anyone hand-editing generated data.
        generatedAt: "bootstrap",
        source: "bootstrap seed (packages/data/scripts/bootstrap.ts)",
        bootstrap: true,
        note: "Partial hand-entered seed. Run `pnpm sync:data` to replace with the full upstream set.",
        countries,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  console.log(`Wrote ${Object.keys(countries).length} bootstrap countries to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
