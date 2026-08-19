/**
 * Generated country metadata for SmartAddress.
 *
 * This package contains data and nothing else — no validation logic lives here.
 * That separation is deliberate: subdivisions and postal formats change on a
 * different clock than engine code, and a country reorganising its provinces
 * should not require a release of `@smartaddress/core`.
 *
 * The same JSON is what any port (Python, Go, ...) consumes, so it is the
 * language-neutral half of the project.
 */

import { createMetadataSource, type CountryMetadata, type MetadataSource } from "@smartaddress/core";
import snapshot from "../data/countries.json" with { type: "json" };

interface Snapshot {
  generatedAt: string;
  source: string;
  bootstrap?: boolean;
  note?: string;
  countries: Record<string, CountryMetadata>;
}

const data = snapshot as unknown as Snapshot;

/** When the committed snapshot was generated, and where it came from. */
export const snapshotInfo = {
  generatedAt: data.generatedAt,
  source: data.source,
  /** True while the shipped data is the partial hand-entered seed. */
  isBootstrap: data.bootstrap === true,
  countryCount: Object.keys(data.countries).length,
} as const;

/** Raw metadata table, keyed by ISO 3166-1 alpha-2. */
export const countries: Readonly<Record<string, CountryMetadata>> = data.countries;

/** The default metadata source, covering every country in the snapshot. */
export const metadata: MetadataSource = createMetadataSource(data.countries);

/**
 * Builds a source limited to the given countries.
 *
 * Use this in bundle-size-sensitive frontends that only ship to a few markets —
 * it keeps the engine identical while cutting the data it carries.
 */
export function subset(codes: string[]): MetadataSource {
  const table: Record<string, CountryMetadata> = {};
  for (const code of codes) {
    const entry = data.countries[code.toUpperCase()];
    if (entry) table[code.toUpperCase()] = entry;
  }
  return createMetadataSource(table);
}

export default metadata;
