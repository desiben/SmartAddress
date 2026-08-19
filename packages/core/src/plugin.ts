import type { CountryMetadata } from "./metadata.js";
import type {
  Address,
  AddressCapabilities,
  AddressType,
  CountryCode,
  Field,
  Granularity,
  Issue,
  ValidationResult,
} from "./types.js";

/**
 * Read-only context handed to every plugin hook.
 *
 * Plugins never mutate the address directly. They return contributions, and the
 * engine composes them. This keeps plugin order from silently changing results
 * and makes each hook independently testable.
 */
export interface PluginContext {
  /** The address as it stands at this point in the pipeline. */
  address: Address;
  /** Metadata for `address.countryCode`, if the data package has any. */
  metadata: CountryMetadata | undefined;
  /** Type decided by the classify phase. Undefined during classify itself. */
  type?: AddressType;
  options: ValidateOptions;
}

/** What a classify hook may return. Highest confidence wins. */
export interface Classification {
  type: AddressType;
  /** 0..1. Ties are broken by plugin registration order. */
  confidence: number;
  /** Overrides for the capabilities implied by `type`. */
  capabilities?: Partial<AddressCapabilities>;
}

/**
 * A SmartAddress plugin.
 *
 * Every hook is optional — a plugin that only knows how to classify Japanese
 * parcel lockers implements `classify` and nothing else. Hooks are pure
 * functions so they run identically in a browser, on a server, or in a port.
 */
export interface Plugin {
  /** Stable identifier, surfaced on `Issue.source`. */
  name: string;
  /**
   * Restrict this plugin to certain countries. `"*"` (the default) runs it
   * everywhere. Scoping is a performance and a correctness tool: a US-specific
   * rule that runs in France is a bug waiting to happen.
   */
  countries?: CountryCode[] | "*";

  /** Decide what kind of address this is. */
  classify?(ctx: PluginContext): Classification | undefined;

  /**
   * Clean up a single field's value. Called per field, before validation.
   * Return `undefined` to leave the value untouched.
   */
  normalizeField?(field: Field, value: string, ctx: PluginContext): string | undefined;

  /** Contribute validation findings. Must not mutate `ctx`. */
  validate?(ctx: PluginContext): Issue[] | undefined;

  /**
   * Cap the reported granularity. Used by rules that know an address cannot be
   * resolved past a certain point (e.g. a PO Box has no street).
   */
  granularity?(ctx: PluginContext): Granularity | undefined;

  /**
   * Render the address to lines. First plugin to return wins, so a caller can
   * override formatting for one country without forking the library.
   */
  format?(ctx: PluginContext, style: FormatStyle): string[] | undefined;
}

export type FormatStyle = "postal" | "oneline";

/**
 * The async seam. Deliberately separate from {@link Plugin}: everything in the
 * plugin pipeline is synchronous and offline, and we do not want a provider to
 * be able to make `validate()` async for everyone.
 */
export interface AddressProvider {
  name: string;
  verify(address: Address, signal?: AbortSignal): Promise<ProviderResult>;
  suggest?(query: string, opts?: { country?: CountryCode; signal?: AbortSignal }): Promise<Address[]>;
}

export interface ProviderResult {
  granularity: Granularity;
  complete: boolean;
  issues: Issue[];
  corrected?: Address;
}

export interface ValidateOptions {
  /**
   * Address types the caller is willing to accept. An address whose type is not
   * listed gets a `TYPE_NOT_ACCEPTED` error. Omit to accept every type.
   */
  acceptTypes?: AddressType[];
  /** Reject addresses a courier cannot deliver to. Shorthand for the common case. */
  requireCourierDeliverable?: boolean;
  /** Treat missing-but-required fields as warnings. Useful for partial forms. */
  partial?: boolean;
  /** Language for label lookup, BCP 47. Defaults to the country's own. */
  language?: string;
}

/** A validator instance with a fixed plugin set. */
export interface Validator {
  validate(address: Address, options?: ValidateOptions): ValidationResult;
  classify(address: Address): { type: AddressType; capabilities: AddressCapabilities };
  format(address: Address, style?: FormatStyle): string[];
  /** The plugins in effect, in resolution order. */
  readonly plugins: readonly Plugin[];
}

/** True when `plugin` is scoped to run for `country`. */
export function appliesTo(plugin: Plugin, country: CountryCode): boolean {
  const scope = plugin.countries ?? "*";
  return scope === "*" || scope.includes(country);
}
