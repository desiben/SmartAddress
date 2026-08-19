#!/usr/bin/env node
/**
 * SmartAddress CLI — the universal escape hatch.
 *
 * Any language that can spawn a process and parse JSON can use SmartAddress
 * through this, without waiting for a native port. That is what makes the
 * "plugs into anything" claim true today rather than eventually.
 *
 *   echo '{"countryCode":"US","postalCode":"94043"}' | smartaddress validate
 *   smartaddress schema JP
 *   smartaddress format --file address.json
 *   cat many.ndjson | smartaddress validate --ndjson
 */

import { readFileSync } from "node:fs";
import { createValidator, getAddressFormSchema, type Address, type ValidateOptions } from "@smartaddress/core";
import { metadata, snapshotInfo } from "@smartaddress/data";

const USAGE = `smartaddress <command> [options]

Commands:
  validate            Validate an address. Reads JSON on stdin unless --file is given.
  format              Render an address to postal lines.
  schema <COUNTRY>    Print the address form schema for a country.
  countries           List the countries in the bundled metadata.

Options:
  --file <path>       Read input JSON from a file instead of stdin.
  --ndjson            Treat input as newline-delimited JSON; emit one result per line.
  --courier           Require the address to be courier-deliverable.
  --accept <types>    Comma-separated address types to allow (e.g. street,po_box).
  --partial           Downgrade missing required fields to warnings.
  --oneline           format only: emit a single comma-joined line.
  --raw               format only: render input as-is, skipping normalization.
  --pretty            Pretty-print JSON output.

Exit codes:
  0  valid   1  invalid   2  usage or input error
`;

const validator = createValidator({ metadata });

function readStdin(): string {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function parseFlags(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { flags, positional };
}

function optionsFrom(flags: Map<string, string | boolean>): ValidateOptions {
  const options: ValidateOptions = {};
  if (flags.get("courier")) options.requireCourierDeliverable = true;
  if (flags.get("partial")) options.partial = true;
  const accept = flags.get("accept");
  if (typeof accept === "string") {
    options.acceptTypes = accept.split(",").map((t) => t.trim()) as ValidateOptions["acceptTypes"];
  }
  return options;
}

function emit(value: unknown, pretty: boolean): void {
  process.stdout.write(JSON.stringify(value, null, pretty ? 2 : 0) + "\n");
}

function fail(message: string): never {
  process.stderr.write(`smartaddress: ${message}\n`);
  process.exit(2);
  // `process.exit` is typed as `never`, but TS needs the explicit throw to see
  // that this function cannot fall through.
  throw new Error(message);
}

function loadInput(flags: Map<string, string | boolean>): string {
  const file = flags.get("file");
  const raw = typeof file === "string" ? readFileSync(file, "utf-8") : readStdin();
  if (!raw.trim()) fail("no input. Pipe JSON on stdin or pass --file <path>.");
  return raw;
}

function parseAddress(raw: string): Address {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`could not parse JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) fail("input must be a JSON object.");
  return parsed as Address;
}

function main(): void {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseFlags(argv);
  const command = positional[0];
  const pretty = Boolean(flags.get("pretty"));

  if (!command || flags.get("help") || command === "help") {
    process.stdout.write(USAGE);
    process.exit(command ? 0 : 2);
  }

  switch (command) {
    case "countries": {
      emit({ ...snapshotInfo, countries: metadata.countries() }, pretty);
      return;
    }

    case "schema": {
      const country = positional[1];
      if (!country) fail("schema requires a country code, e.g. `smartaddress schema JP`.");
      emit(getAddressFormSchema(country, metadata), pretty);
      return;
    }

    case "validate": {
      const options = optionsFrom(flags);
      const raw = loadInput(flags);

      if (flags.get("ndjson")) {
        let allValid = true;
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          const result = validator.validate(parseAddress(line), options);
          allValid &&= result.valid;
          emit(result, false);
        }
        process.exit(allValid ? 0 : 1);
      }

      const result = validator.validate(parseAddress(raw), options);
      emit(result, pretty);
      process.exit(result.valid ? 0 : 1);
      return;
    }

    case "format": {
      const raw = loadInput(flags);
      const address = parseAddress(raw);
      // Render the canonical form: a mailing label wants "100-8994", not
      // whatever shape the postcode arrived in. `--raw` opts out.
      const source = flags.get("raw") ? address : validator.validate(address).normalized;
      const lines = validator.format(source, flags.get("oneline") ? "oneline" : "postal");
      // Plain text, so this composes with ordinary shell tools.
      process.stdout.write(lines.join("\n") + "\n");
      return;
    }

    default:
      fail(`unknown command "${command}". Run \`smartaddress help\`.`);
  }
}

main();
