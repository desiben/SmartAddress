/**
 * Headless React bindings for SmartAddress.
 *
 * Deliberately tiny. All the intelligence lives in `@smartaddress/core`; this
 * package only wires it to React state. A Vue, Svelte or Solid adapter is the
 * same shape and about the same size — which is the point of keeping the core
 * framework-free.
 */

import { useCallback, useMemo, useState } from "react";
import {
  createValidator,
  getAddressFormSchema,
  type Address,
  type AddressFormSchema,
  type Field,
  type Issue,
  type MetadataSource,
  type Plugin,
  type ValidateOptions,
  type ValidationResult,
} from "@smartaddress/core";

export interface UseAddressFormConfig {
  metadata: MetadataSource;
  /** Starting values. Only `countryCode` is really needed. */
  initial?: Partial<Address> & { countryCode: string };
  plugins?: readonly Plugin[];
  options?: ValidateOptions;
  /**
   * Validate on every change. Off by default: showing "city is required" while
   * someone is still typing their street is the most common address-form
   * annoyance, so the default is to validate when you ask.
   */
  validateOnChange?: boolean;
}

export interface UseAddressForm {
  address: Address;
  /** Form layout for the current country: rows, labels, required flags. */
  schema: AddressFormSchema;
  /** Null until `validate()` runs (or on every change if enabled). */
  result: ValidationResult | null;
  /** Issues for one field, ready to render under the input. */
  issuesFor(field: Field): Issue[];
  setField(field: Field, value: string | string[]): void;
  setCountry(countryCode: string): void;
  validate(): ValidationResult;
  /** Apply the engine's canonical form — an explicit user action, never automatic. */
  acceptNormalized(): void;
  reset(): void;
}

/**
 * Drives an address form for any country.
 *
 * ```tsx
 * const form = useAddressForm({ metadata, initial: { countryCode: "JP" } });
 * return form.schema.rows.map((row) => row.map((field) => (
 *   <input
 *     key={field}
 *     placeholder={form.schema.labels[field]}
 *     onChange={(e) => form.setField(field, e.target.value)}
 *   />
 * )));
 * ```
 */
export function useAddressForm(config: UseAddressFormConfig): UseAddressForm {
  const { metadata, plugins, options, validateOnChange = false } = config;
  const initial = useMemo<Address>(
    () => ({ countryCode: "US", ...config.initial }),
    // Only the first render's initial value seeds state; later changes go
    // through setCountry/setField, as with any uncontrolled form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const validator = useMemo(
    () => createValidator({ metadata, ...(plugins ? { plugins } : {}), ...(options ? { defaults: options } : {}) }),
    [metadata, plugins, options],
  );

  const [address, setAddress] = useState<Address>(initial);
  const [result, setResult] = useState<ValidationResult | null>(null);

  const schema = useMemo(
    () => getAddressFormSchema(address.countryCode, metadata),
    [address.countryCode, metadata],
  );

  const runValidation = useCallback(
    (next: Address) => {
      const outcome = validator.validate(next);
      setResult(outcome);
      return outcome;
    },
    [validator],
  );

  const setField = useCallback(
    (field: Field, value: string | string[]) => {
      setAddress((prev) => {
        const next: Address =
          field === "streetAddress"
            ? { ...prev, streetAddress: Array.isArray(value) ? value : [value] }
            : { ...prev, [field]: Array.isArray(value) ? value.join(" ") : value };
        if (validateOnChange) runValidation(next);
        return next;
      });
    },
    [runValidation, validateOnChange],
  );

  const setCountry = useCallback((countryCode: string) => {
    // Country-specific fields are cleared: a US state is meaningless once the
    // country becomes France, and carrying it over produces confusing errors.
    setAddress((prev) => ({
      countryCode: countryCode.toUpperCase(),
      ...(prev.name ? { name: prev.name } : {}),
      ...(prev.organization ? { organization: prev.organization } : {}),
      ...(prev.streetAddress ? { streetAddress: prev.streetAddress } : {}),
    }));
    setResult(null);
  }, []);

  const validate = useCallback(() => runValidation(address), [address, runValidation]);

  const acceptNormalized = useCallback(() => {
    setResult((current) => {
      if (current) setAddress(current.normalized);
      return current;
    });
  }, []);

  const reset = useCallback(() => {
    setAddress(initial);
    setResult(null);
  }, [initial]);

  const issuesFor = useCallback(
    (field: Field) => (result?.issues ?? []).filter((issue) => issue.field === field),
    [result],
  );

  return { address, schema, result, issuesFor, setField, setCountry, validate, acceptNormalized, reset };
}
