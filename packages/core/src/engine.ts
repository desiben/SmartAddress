import { formatAddress } from "./format.js";
import { EMPTY_METADATA, type MetadataSource } from "./metadata.js";
import { appliesTo, type FormatStyle, type Plugin, type PluginContext, type ValidateOptions, type Validator } from "./plugin.js";
import { capabilitiesFor, classifyPlugin } from "./plugins/classify.js";
import { normalizePlugin, postalCodeNormalizePlugin } from "./plugins/normalize.js";
import { structuralPlugin } from "./plugins/structural.js";
import { typeRulesPlugin } from "./plugins/typeRules.js";
import {
  ALL_FIELDS,
  minGranularity,
  type Address,
  type AddressCapabilities,
  type AddressType,
  type ComponentResult,
  type ConfirmationLevel,
  type Field,
  type Granularity,
  type Issue,
  type ValidationResult,
} from "./types.js";

/**
 * The plugins every validator gets unless the caller replaces them.
 *
 * Order matters only where two plugins can produce the same contribution:
 * classification confidence breaks ties, and `format` is first-wins so a later
 * plugin cannot silently steal rendering from an earlier one.
 */
export const DEFAULT_PLUGINS: readonly Plugin[] = [
  classifyPlugin,
  normalizePlugin,
  postalCodeNormalizePlugin,
  structuralPlugin,
  typeRulesPlugin,
];

export interface ValidatorConfig {
  /** Where country rules come from. Defaults to nothing, which degrades gracefully. */
  metadata?: MetadataSource;
  /**
   * Replace the built-in plugin set entirely. Most callers want `plugins`
   * (appended) instead; this is the escape hatch for building a minimal engine.
   */
  basePlugins?: readonly Plugin[];
  /** Extra plugins, run after the built-ins. */
  plugins?: readonly Plugin[];
  /** Options applied to every call, overridable per call. */
  defaults?: ValidateOptions;
}

/**
 * Builds a validator with a fixed plugin set.
 *
 * A validator is cheap and immutable, so an application typically makes one at
 * startup and shares it. Making a second one with different plugins is the
 * supported way to have, say, stricter rules on checkout than on signup.
 */
export function createValidator(config: ValidatorConfig = {}): Validator {
  const metadataSource = config.metadata ?? EMPTY_METADATA;
  const plugins: Plugin[] = [...(config.basePlugins ?? DEFAULT_PLUGINS), ...(config.plugins ?? [])];
  const defaults = config.defaults ?? {};

  const active = (country: string) => plugins.filter((p) => appliesTo(p, country));

  function classify(address: Address): { type: AddressType; capabilities: AddressCapabilities } {
    const country = (address.countryCode ?? "").toUpperCase();
    const ctx: PluginContext = {
      address,
      metadata: metadataSource.get(country),
      options: defaults,
    };

    let best: { type: AddressType; confidence: number; capabilities?: Partial<AddressCapabilities> } | undefined;
    for (const plugin of active(country)) {
      const result = plugin.classify?.(ctx);
      // Strictly greater keeps registration order as the tie-break, so a later
      // plugin has to be *more* confident to win, not merely equally confident.
      if (result && (!best || result.confidence > best.confidence)) best = result;
    }

    const type = best?.type ?? "unknown";
    return {
      type,
      capabilities: { ...capabilitiesFor(type), ...(best?.capabilities ?? {}) },
    };
  }

  function validate(address: Address, options: ValidateOptions = {}): ValidationResult {
    const merged: ValidateOptions = { ...defaults, ...options };
    const country = (address.countryCode ?? "").toUpperCase();
    const metadata = metadataSource.get(country);
    const scoped = active(country);

    // --- Phase 1: normalize -------------------------------------------------
    // Run before classification so that classifiers see tidy values, and record
    // what changed so the caller can diff their input against our suggestion.
    const normalized: Address = { ...address, countryCode: country };
    const changed = new Map<Field, string>(); // field -> original value

    for (const field of ALL_FIELDS) {
      if (field === "streetAddress") {
        const lines = address.streetAddress ?? [];
        const out = lines
          .map((line) => applyNormalizers(scoped, field, line, { address: normalized, metadata, options: merged }))
          .filter((line) => line.trim().length > 0);
        if (out.length) {
          if (out.join("\n") !== lines.join("\n")) changed.set(field, lines.join("\n"));
          normalized.streetAddress = out;
        }
        continue;
      }
      const original = (address[field] ?? "").toString();
      if (!original.trim()) continue;
      const out = applyNormalizers(scoped, field, original, { address: normalized, metadata, options: merged });
      if (out !== original) changed.set(field, original);
      // Every remaining field is a plain string on Address; streetAddress was
      // handled above and countryCode is set at construction.
      (normalized as Record<Exclude<Field, "streetAddress">, string>)[
        field as Exclude<Field, "streetAddress">
      ] = out;
    }

    // --- Phase 2: classify --------------------------------------------------
    const { type, capabilities } = classify(normalized);

    // --- Phase 3: validate --------------------------------------------------
    const ctx: PluginContext = { address: normalized, metadata, type, options: merged };
    const issues: Issue[] = [];
    for (const plugin of scoped) {
      const produced = plugin.validate?.(ctx);
      if (produced?.length) issues.push(...produced);
    }

    // --- Phase 4: granularity ----------------------------------------------
    let granularity = baseGranularity(normalized, metadata, issues);
    for (const plugin of scoped) {
      const cap = plugin.granularity?.(ctx);
      if (cap) granularity = minGranularity(granularity, cap);
    }

    // --- Phase 5: assemble --------------------------------------------------
    const components = buildComponents(normalized, changed, issues, metadata);
    const errors = issues.filter((i) => i.severity === "error");
    const missingRequired = issues.some((i) => i.code === "FIELD_REQUIRED");
    const unexpected = issues.some((i) => i.code === "FIELD_UNSUPPORTED");

    return {
      valid: errors.length === 0,
      granularity,
      complete: !missingRequired && !unexpected,
      type,
      capabilities,
      components,
      issues,
      normalized,
    };
  }

  function format(address: Address, style: FormatStyle = "postal"): string[] {
    const country = (address.countryCode ?? "").toUpperCase();
    const metadata = metadataSource.get(country);
    const ctx: PluginContext = { address, metadata, options: defaults };

    // First plugin to claim it wins, so overriding one country's layout does not
    // require reimplementing the rest.
    for (const plugin of active(country)) {
      const out = plugin.format?.(ctx, style);
      if (out) return out;
    }

    const lines = formatAddress(address, metadata);
    return style === "oneline" ? [lines.join(", ")] : lines;
  }

  return { validate, classify, format, plugins };
}

/** Runs every plugin's `normalizeField`, threading the value through in order. */
function applyNormalizers(
  plugins: readonly Plugin[],
  field: Field,
  value: string,
  ctx: Omit<PluginContext, "type">,
): string {
  let current = value;
  for (const plugin of plugins) {
    const out = plugin.normalizeField?.(field, current, ctx as PluginContext);
    if (typeof out === "string") current = out;
  }
  return current;
}

/**
 * How specific we got, based purely on which components survived validation.
 *
 * This is the offline ceiling: without a provider, we can never claim better
 * than `street`, because confirming a premise means checking real delivery data.
 */
function baseGranularity(
  address: Address,
  metadata: ReturnType<MetadataSource["get"]>,
  issues: Issue[],
): Granularity {
  const broken = new Set(issues.filter((i) => i.severity === "error").map((i) => i.field));
  const ok = (field: Field, value: string | undefined) => Boolean(value?.trim()) && !broken.has(field);

  if (!address.countryCode || broken.has("countryCode")) return "none";
  if (ok("streetAddress", (address.streetAddress ?? []).join(""))) return "street";
  if (ok("postalCode", address.postalCode)) return "postal_code";
  if (ok("locality", address.locality)) return "locality";
  if (ok("administrativeArea", address.administrativeArea)) return "administrative_area";
  // `metadata` is unused for now but kept in the signature: country-specific
  // granularity ceilings (e.g. HK has no postcode) belong here.
  void metadata;
  return "country";
}

/** Per-field outcome, including whether we changed the caller's value. */
function buildComponents(
  normalized: Address,
  changed: Map<Field, string>,
  issues: Issue[],
  metadata: ReturnType<MetadataSource["get"]>,
): Partial<Record<Field, ComponentResult>> {
  const failed = new Set(issues.filter((i) => i.severity === "error").map((i) => i.field));
  const out: Partial<Record<Field, ComponentResult>> = {};

  for (const field of ALL_FIELDS) {
    const value =
      field === "streetAddress"
        ? (normalized.streetAddress ?? []).join("\n")
        : (normalized[field] ?? "").toString();
    if (!value.trim()) continue;

    let confirmation: ConfirmationLevel;
    if (failed.has(field)) {
      confirmation = "suspicious";
    } else if (changed.has(field)) {
      confirmation = "replaced";
    } else if (field === "administrativeArea" && metadata?.administrativeAreas?.length) {
      // We hold a definitive list for this field and the value passed against it.
      confirmation = "confirmed";
    } else {
      // Offline validation can establish consistency, never existence.
      confirmation = "plausible";
    }

    const original = changed.get(field);
    out[field] = {
      field,
      value,
      confirmation,
      ...(original !== undefined ? { input: original } : {}),
    };
  }

  return out;
}
