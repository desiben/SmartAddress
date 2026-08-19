/**
 * Snapshots upstream address metadata into `packages/data/data/countries.json`.
 *
 * Run with `pnpm sync:data`. This is deliberately a *build-time* step: the
 * upstream service carries no uptime guarantee, so nothing at runtime may
 * depend on it. The output is committed, and every refresh lands as a
 * reviewable diff rather than a silent change in production behaviour.
 *
 * Usage:
 *   pnpm sync:data                 # all countries
 *   pnpm sync:data -- US JP GB     # just these
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CountryMetadata } from "../../core/src/metadata.js";
import { splitList, toMetadata, type RawCountry } from "./transform.js";

const BASE = "https://chromium-i18n.appspot.com/ssl-address";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../data/countries.json");

async function fetchJson(url: string): Promise<RawCountry | undefined> {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${url}`);
    return undefined;
  }
  return (await res.json()) as RawCountry;
}

async function main() {
  const only = process.argv.slice(2).filter((a) => /^[A-Z]{2}$/i.test(a)).map((a) => a.toUpperCase());

  console.log("Fetching country list...");
  const root = await fetchJson(`${BASE}/data`);
  const all = splitList(root?.countries).filter(Boolean);
  if (all.length === 0) {
    console.error(
      "Could not read the country list from the upstream service.\n" +
        "The existing committed snapshot has been left untouched.",
    );
    process.exit(1);
  }

  const targets = only.length ? only : all;
  console.log(`Fetching ${targets.length} countries...`);

  const out: Record<string, CountryMetadata> = {};
  for (const country of targets) {
    const raw = await fetchJson(`${BASE}/data/${country}`);
    if (!raw) continue;
    out[country] = toMetadata(country, raw);
    process.stdout.write(".");
  }
  console.log("");

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), source: BASE, countries: out }, null, 2) + "\n",
    "utf-8",
  );
  console.log(`Wrote ${Object.keys(out).length} countries to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
