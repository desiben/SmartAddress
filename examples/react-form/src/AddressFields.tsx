/**
 * The React example from the project README, as a real compiled package.
 *
 * It is built by `pnpm typecheck` and in CI, so the documented API cannot
 * silently drift away from the actual one. If you change `useAddressForm`,
 * this file breaks first — update both, and the README with them.
 *
 * Switch `countryCode` to "AE" and the form re-renders with an Emirate field
 * and no postal code, with no change to this component.
 */

import { useAddressForm } from "@smartaddress/react";
import { metadata } from "@smartaddress/data";

export function AddressFields() {
  const form = useAddressForm({ metadata, initial: { countryCode: "JP" } });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.validate(); }}>
      {form.schema.rows.map((row, i) => (
        <div key={i}>
          {row.map((field) => (
            <label key={field}>
              {form.schema.labels[field]}
              {form.schema.required.includes(field) && " *"}
              <input onChange={(e) => form.setField(field, e.target.value)} />
              {form.issuesFor(field).map((issue) => (
                <span key={issue.code} role="alert">{issue.message}</span>
              ))}
            </label>
          ))}
        </div>
      ))}
      <button>Check</button>
    </form>
  );
}
