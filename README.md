# SmartAddress

**A reusable, pluggable component for every address need in your code.**

International address **validation**, **classification**, **normalization** and **formatting** — for ~250 countries, with zero dependencies, no network calls, and no API keys.

Written in TypeScript so it runs anywhere JavaScript runs, and designed from the start so that any other language can use it too.

```ts
const result = validator.validate({
  countryCode: "US",
  streetAddress: ["PO Box 1234"],
  locality: "Cupertino",
  administrativeArea: "CA",
  postalCode: "95014",
}, { requireCourierDeliverable: true });

result.valid;        // false  — UPS/FedEx/DHL will not deliver here
result.type;         // "po_box"
result.issues[0].code; // "PO_BOX_NOT_ACCEPTED"
```

> **Status: early but real.** The engine, plugin system and conformance suite are complete and tested (42 tests). The bundled country data is currently a 14-country bootstrap seed — see [Data](#7-data-where-country-rules-come-from).

---

## Table of contents

1. [Why this exists](#1-why-this-exists)
2. [Core concepts](#2-core-concepts)
3. [Install and quick start](#3-install-and-quick-start)
4. [Architecture](#4-architecture)
5. [The plugin system](#5-the-plugin-system)
6. [Using it from any language](#6-using-it-from-any-language)
7. [Data](#7-data-where-country-rules-come-from)
8. [The conformance suite](#8-the-conformance-suite)
9. [API reference](#9-api-reference)
10. [Development](#10-development)

---

## 1. Why this exists

Address handling breaks in the same three ways in almost every codebase.

### A boolean is the wrong answer

`isValid(address)` collapses two completely different situations into one bit:

- *This postcode does not match the country's format* → block the user, show an error.
- *This street exists but we could not confirm the building number* → let it through, maybe flag it.

A checkout that treats those identically either loses orders or ships to nowhere. **SmartAddress returns a verdict**, not a boolean: how specific the match was, whether anything is missing, and a per-field confidence level.

### Address *type* is ignored

A PO Box is a perfectly well-formed address that **UPS, FedEx and DHL all refuse to deliver to.** A US military address (`APO AE 09123`) looks like a normal US address but its "state" is `AE`, not a real state, and its ZIP must fall in a specific range. Neither of these is caught by a postcode regex.

**SmartAddress makes address type a first-class concept** that *gates the rules*, and attaches real delivery capabilities to it.

### The existing options don't fit

Checked against the live npm registry:

| Package | Last publish | Issue |
|---|---|---|
| `@shopify/address` | 2024-06-10 | `format()` is `async` — it calls Shopify's hosted GraphQL API at runtime |
| `@cpsdqs/google-i18n-address` | 2022-03-31 | Effectively unmaintained |
| `i18n-postal-address` | 2026-04-10 | Formatting only, no validation |
| `postcode-validator` | 2026-08-02 | Maintained, but postcodes only |
| `google-i18n-address` (PyPI) | active | Python only; no type classification |

There is no maintained, offline, typed library that does the whole job in JavaScript.

---

## 2. Core concepts

Five ideas carry the whole design. Understanding these means understanding the library.

### 2.1 The verdict

`validate()` returns a `ValidationResult` with several independent axes:

| Field | Meaning |
|---|---|
| `valid` | Convenience: `true` when there are no `error`-severity issues |
| `granularity` | How specific the match got: `none` → `country` → `administrative_area` → `locality` → `postal_code` → `street` → `premise` → `sub_premise` |
| `complete` | No required field missing, no unexpected field present |
| `type` | The address type (see below) |
| `capabilities` | What can actually be done with it — `courierDeliverable`, `postalDeliverable`, `residential`, `requiresCustomsDeclaration` |
| `components` | Per-field value, original input, and confirmation level |
| `issues` | Machine-readable findings |
| `normalized` | The canonical form — **a suggestion, not applied automatically** |

This vocabulary intentionally mirrors Google's Address Validation API, so that provider adapters can map onto it without inventing a private scale.

### 2.2 Never a silent rewrite

This is the rule the whole library is built around.

SmartAddress will tell you `"California"` should be `"CA"`. It will **not** quietly swap it behind your back. Every component carries:

```jsonc
{
  "field": "administrativeArea",
  "value": "CA",              // what we think it should be
  "input": "California",      // what you gave us
  "confirmation": "replaced"  // and the fact that we changed it
}
```

`confirmation` is one of:

| Level | Meaning |
|---|---|
| `confirmed` | Matched against reference data we hold |
| `plausible` | Consistent with the country's rules, but not confirmed against data |
| `unconfirmed` | Could not be checked at all |
| `suspicious` | Actively looks wrong |
| `inferred` | We supplied a value you omitted |
| `replaced` | We would substitute a different value |

Silently "helpfully" correcting addresses is how parcels end up in the wrong country. You get the diff; you decide.

### 2.3 Address type gates the rules

```ts
type AddressType =
  | "street"            // ordinary premise
  | "po_box"            // PO Box / Postfach / Boîte Postale / 郵便私書箱 …
  | "military"          // APO / FPO / DPO (US), BFPO (UK)
  | "general_delivery"  // poste restante / lista de correos
  | "rural_route"       // USPS "RR ## BOX ##"
  | "highway_contract"  // USPS "HC ## BOX ##"
  | "parcel_locker"     // Packstation, InPost, Amazon Locker
  | "unknown";
```

Type does three things:

1. **Sets capabilities.** `po_box` ⇒ `courierDeliverable: false`.
2. **Caps granularity.** A PO Box has no street or premise, no matter how confident everything else is — so it can never report better than `postal_code`. A caller gating shipments on granularity is never misled.
3. **Triggers type-specific rules.** A `military` US address gets its AA/AE/AP state and ZIP range checked; a `street` address does not.

### 2.4 Country rules are data, not code

Adding a country is a **data change**. The engine contains no `if (country === "JP")` anywhere. Field order, required fields, postcode patterns, subdivision lists and local field names all come from metadata:

```ts
// Japan
{ administrativeArea: "Prefecture", postalCode: "Postal code" }
// United Arab Emirates
{ administrativeArea: "Emirate" }          // …and no postal code field at all
// Ireland
{ administrativeArea: "County", postalCode: "Eircode", dependentLocality: "Townland" }
```

### 2.5 Offline core, async at the edge

Layers 0–2 are **pure, synchronous, dependency-free**:

| Layer | What it does | Cost |
|---|---|---|
| **L0 Structural** | Required fields, postcode pattern, field sanity | offline, ~0 ms |
| **L1 Normalize** | Whitespace, casing, subdivision → canonical code, postcode shape | offline |
| **L2 Reference** | Consistency between components using bundled data | offline |
| **L3 Verify** | Real deliverability, DPV, geocoding | network, via a provider |

L3 lives behind a **separate `AddressProvider` interface**, deliberately kept out of the synchronous pipeline — so no provider can ever make `validate()` async for everybody else.

---

## 3. Install and quick start

```bash
npm install @smartaddress/core @smartaddress/data
```

### Validate

```ts
import { createValidator } from "@smartaddress/core";
import { metadata } from "@smartaddress/data";

// Create once at startup and share it — validators are cheap and immutable.
const validator = createValidator({ metadata });

const result = validator.validate({
  countryCode: "US",
  name: "Jane Doe",
  streetAddress: ["1600 Amphitheatre Pkwy"],
  locality: "Mountain View",
  administrativeArea: "California",   // note: full name
  postalCode: "94043",
});
```

Real output (abridged):

```jsonc
{
  "valid": true,
  "granularity": "street",
  "complete": true,
  "type": "street",
  "capabilities": {
    "courierDeliverable": true,
    "postalDeliverable": true,
    "residential": true,
    "requiresCustomsDeclaration": false
  },
  "components": {
    "locality":           { "value": "MOUNTAIN VIEW", "input": "Mountain View", "confirmation": "replaced" },
    "administrativeArea": { "value": "CA",            "input": "California",    "confirmation": "replaced" },
    "postalCode":         { "value": "94043",                                   "confirmation": "plausible" }
  },
  "issues": [],
  "normalized": {
    "countryCode": "US",
    "locality": "MOUNTAIN VIEW",
    "administrativeArea": "CA",
    "postalCode": "94043"
  }
}
```

Two normalizations happened, both reported rather than hidden: `California` → `CA`, and `Mountain View` → `MOUNTAIN VIEW` (the US metadata marks locality as an uppercase field, which is what USPS wants on a label).

### Reject undeliverable types

```ts
validator.validate(address, { requireCourierDeliverable: true });
// PO Box → valid: false, issues: [{ code: "PO_BOX_NOT_ACCEPTED" }]

validator.validate(address, { acceptTypes: ["street", "parcel_locker"] });
// anything else → { code: "TYPE_NOT_ACCEPTED" }
```

### Progressive form validation

```ts
validator.validate(partialAddress, { partial: true });
// missing required fields become warnings, not errors —
// so you don't shout "city is required" while someone types their street
```

### Format for an envelope

```ts
validator.format(result.normalized);
// [ "Jane Doe", "1600 Amphitheatre Pkwy", "MOUNTAIN VIEW, CA 94043" ]

validator.format(result.normalized, "oneline");
// [ "Jane Doe, 1600 Amphitheatre Pkwy, MOUNTAIN VIEW, CA 94043" ]
```

Japanese addresses come out in Japanese postal order, with the 〒 marker and no space between prefecture and ward:

```
〒100-8994
東京都目黒区
八重洲1-5-3
田中恵子
```

### Build a form for any country

```ts
import { getAddressFormSchema } from "@smartaddress/core";

getAddressFormSchema("DE", metadata);
```

```jsonc
{
  "rows": [["name"], ["organization"], ["streetAddress"],
           ["postalCode", "locality"],          // Germany puts postcode before city
           ["countryCode"]],
  "required": ["streetAddress", "locality", "postalCode"],
  "labels": { "locality": "City", "postalCode": "Postal code", … },
  "postalCodeExamples": ["26133", "53225"]
}
```

Compare the UAE — no postal code field exists at all, and the subdivision is an *Emirate*:

```jsonc
{
  "rows": [["name"], ["organization"], ["streetAddress"],
           ["administrativeArea"], ["countryCode"]],
  "required": ["streetAddress", "administrativeArea"],
  "labels": { "administrativeArea": "Emirate" }
}
```

Your form component loops over `rows` and reads `labels`. It never needs to know anything about any country.

### React

```tsx
import { useAddressForm } from "@smartaddress/react";
import { metadata } from "@smartaddress/data";

function AddressFields() {
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
```

Switch `initial.countryCode` to `"AE"` and the form re-renders with an Emirate field and no postcode — no changes to this component.

> This example is not aspirational: it lives at [`examples/react-form`](./examples/react-form) as a real workspace package, compiled by `pnpm typecheck` and in CI. If the API changes, the example breaks before the docs go stale.

---

## 4. Architecture

### 4.1 Packages

```
@smartaddress/core     the engine + plugin system.  zero dependencies, isomorphic
@smartaddress/data     generated country metadata.  data only, no logic
@smartaddress/react    headless useAddressForm() hook
@smartaddress/cli      JSON in / JSON out — the universal escape hatch
conformance/           JSON vectors that ARE the specification
examples/react-form    the README's React example, compiled in CI
```

**Why `data` is a separate package:** subdivisions and postal formats change on a completely different clock than engine code. A country reorganising its provinces should be a data release, not a release of the validation engine. It also means a consumer can swap in their own trimmed or patched data source without forking anything.

**Why `react` is a separate package:** the core has no framework dependency at all. A Vue, Svelte or Solid adapter is the same shape and roughly the same size (~150 lines). Keeping React out of core is what makes those adapters possible.

### 4.2 The validation pipeline

`validate()` runs five phases in a fixed order. Every phase is open to plugins.

```
   Address in
       │
  ┌────▼──────────────────────────────────────────────┐
  │ 1. NORMALIZE      plugin.normalizeField()         │
  │    Per field, threaded through every plugin.      │
  │    Records the original value for every change.   │
  └────┬──────────────────────────────────────────────┘
  ┌────▼──────────────────────────────────────────────┐
  │ 2. CLASSIFY       plugin.classify()               │
  │    Highest confidence wins, not registration      │
  │    order. Runs on normalized values.              │
  └────┬──────────────────────────────────────────────┘
  ┌────▼──────────────────────────────────────────────┐
  │ 3. VALIDATE       plugin.validate()               │
  │    Every plugin contributes Issues. Additive —    │
  │    no plugin can suppress another's finding.      │
  └────┬──────────────────────────────────────────────┘
  ┌────▼──────────────────────────────────────────────┐
  │ 4. GRANULARITY    plugin.granularity()            │
  │    Each plugin may only LOWER it, never raise it. │
  └────┬──────────────────────────────────────────────┘
  ┌────▼──────────────────────────────────────────────┐
  │ 5. ASSEMBLE       (engine only)                   │
  │    Build components, derive valid/complete.       │
  └────┬──────────────────────────────────────────────┘
       ▼
  ValidationResult
```

Three deliberate ordering decisions:

- **Normalize before classify** so classifiers see tidy values — a PO Box written `p.o.  box 12` still classifies.
- **Classify before validate** so validation rules can depend on the type.
- **Granularity can only be lowered.** A plugin knowing "this is a PO Box, so there is no premise" can cap the result, but nothing can inflate a claim of precision.

### 4.3 Why plugins can't fight each other

| Contribution | Resolution | Reason |
|---|---|---|
| `classify` | Highest confidence; ties broken by registration order | Prevents load-order from silently changing results |
| `normalizeField` | Threaded — each plugin sees the previous output | Composable cleanups |
| `validate` | Additive, all issues collected | No plugin can hide another's finding |
| `granularity` | Minimum wins | Precision claims can only shrink |
| `format` | **First** plugin to return wins | Lets you override one country without reimplementing the rest |

### 4.4 Metadata is the only country-specific thing

```ts
interface CountryMetadata {
  countryCode, name
  format:          FormatRow[]    // pre-parsed postal layout
  latinFormat?:    FormatRow[]    // for foreign carriers
  required:        Field[]
  supported:       Field[]        // fields the country uses at all
  uppercase:       Field[]        // fields the postal operator wants uppercased
  postalCodePattern?, postalCodeExamples
  labels:          LabelSet       // "Prefecture" / "Emirate" / "County"
  administrativeAreas?: AdministrativeArea[]
}
```

`MetadataSource` is a three-method interface (`get` / `has` / `countries`). `@smartaddress/data` ships one; you can provide your own:

```ts
import { subset } from "@smartaddress/data";

// Ship to five markets? Carry data for five markets.
createValidator({ metadata: subset(["US", "CA", "GB", "DE", "FR"]) });
```

### 4.5 Field model

Nine neutral field names, mapped from the single-letter codes used by upstream metadata:

| Field | Upstream | Notes |
|---|---|---|
| `name` | `%N` | |
| `organization` | `%O` | |
| `streetAddress` | `%A` | **`string[]`** — multi-line is the norm outside the US |
| `dependentLocality` | `%D` | district, neighborhood, townland |
| `locality` | `%C` | city, post town |
| `administrativeArea` | `%S` | state, province, prefecture, emirate, county |
| `postalCode` | `%Z` | ZIP, PIN, Eircode, CEP |
| `sortingCode` | `%X` | France's CEDEX — most libraries drop this entirely |
| `countryCode` | `%R` | ISO 3166-1 alpha-2 |

The names are deliberately neutral. What a field is *called* is a presentation concern resolved by `labels`, never a schema concern.

---

## 5. The plugin system

Every stage is a hook. All hooks are optional — implement only what you need.

```ts
interface Plugin {
  name: string;
  countries?: CountryCode[] | "*";      // scope; default "*"

  classify?(ctx): Classification | undefined;
  normalizeField?(field, value, ctx): string | undefined;
  validate?(ctx): Issue[] | undefined;
  granularity?(ctx): Granularity | undefined;
  format?(ctx, style): string[] | undefined;
}
```

### Example: a business rule

```ts
import { createValidator, type Plugin } from "@smartaddress/core";

const noShetland: Plugin = {
  name: "acme:no-shetland",
  countries: ["GB"],                    // scoped — cannot leak into other markets
  validate(ctx) {
    if (!ctx.address.postalCode?.startsWith("ZE")) return [];
    return [{
      code: "TYPE_NOT_ACCEPTED",
      severity: "error",
      field: "postalCode",
      message: "We do not ship to Shetland.",
      source: "acme:no-shetland",       // shows up on the Issue, so it is traceable
    }];
  },
};

const validator = createValidator({ metadata, plugins: [noShetland] });
```

### Example: override formatting for one country

```ts
const chineseEnvelope: Plugin = {
  name: "acme:cn-envelope",
  countries: ["CN"],
  format: (ctx) => [/* your lines */],
};
// Every other country keeps the default rendering.
```

### Plugin requirements

1. **Pure.** No I/O, no clock, no randomness. A plugin must behave identically in a browser, on a server, and in a Python port.
2. **Scoped.** If it is country-specific, set `countries`. An unscoped rule that only makes sense in one market is a bug.
3. **Stable issue codes.** `Issue.code` is a public contract callers branch on. Adding one is a minor release; changing or removing one is breaking. `Issue.message` is developer-facing and explicitly **not** stable — user-facing copy belongs in your own i18n layer, keyed off `code`.
4. **Covered by a conformance vector**, so every port inherits the rule.

### Replacing the built-ins

```ts
createValidator({ metadata, plugins: [...] });                    // append (usual)
createValidator({ metadata, basePlugins: [myClassifier] });       // replace entirely
```

### The provider seam (async)

```ts
interface AddressProvider {
  name: string;
  verify(address, signal?): Promise<ProviderResult>;
  suggest?(query, opts?): Promise<Address[]>;
}
```

Separate from `Plugin` on purpose. Adapters for Google Address Validation, USPS, Smarty, Loqate and Melissa are on the roadmap; the interface is defined now so the boundary is fixed.

---

## 6. Using it from any language

The TypeScript engine is the reference implementation, not the only intended one.

| Consumer | How | Effort |
|---|---|---|
| React | `@smartaddress/react` | done |
| Vue / Svelte / Angular / Solid | same shape as the React hook | ~150 lines each |
| Node / Deno / Bun / edge / browser | `@smartaddress/core` directly | none |
| Python / Go / Java / Ruby / PHP | native port against `@smartaddress/data` + `/conformance` | ~a weekend |
| **Anything else, today** | `@smartaddress/cli` | none |

### The CLI

Any language that can spawn a process and parse JSON can use SmartAddress right now, without waiting for a port.

```bash
$ echo '{"countryCode":"US","streetAddress":["PO Box 9"],"locality":"Cupertino","administrativeArea":"CA","postalCode":"95014"}' \
    | npx smartaddress validate --courier --pretty
# full verdict on stdout, exit code 1

$ npx smartaddress schema JP --pretty      # form schema for a country
$ npx smartaddress countries               # what's in the bundled data
$ npx smartaddress format --file addr.json # postal lines, plain text
$ cat many.ndjson | npx smartaddress validate --ndjson   # batch
```

| Exit code | Meaning |
|---|---|
| `0` | valid |
| `1` | invalid |
| `2` | usage or input error |

Options: `--file`, `--ndjson`, `--courier`, `--accept <types>`, `--partial`, `--oneline`, `--raw`, `--pretty`.

### Writing a port

The two artifacts a port needs are both language-neutral:

- **`packages/data/data/countries.json`** — the rules, as plain JSON
- **`conformance/vectors/*.json`** — the behaviour, as test vectors

A port is *conforming* when it passes every vector. That is the whole contract.

---

## 7. Data: where country rules come from

`@smartaddress/data` is **generated, never hand-edited**, and contains no logic.

```bash
pnpm sync:data              # snapshot upstream metadata (~250 countries)
pnpm sync:data -- US JP GB  # or just a few
```

### Why build-time and not runtime

The upstream service (`chromium-i18n.appspot.com`) carries **no uptime guarantee** — its own downstream packagers say so explicitly. Three consequences:

1. Nothing at runtime may depend on it. Your checkout does not go down because a Google App Engine instance did.
2. Every refresh lands as a **reviewable diff**. Upstream changing a country's rules is a PR you read, not a silent behaviour change in production.
3. CI re-runs the generator and asserts the output is byte-identical to what is committed — so nobody can hand-edit generated data.

This is the same approach `Boostport/address` takes in Go, and for the same reasons.

### The bootstrap seed

Until you run `sync:data`, the committed data is a hand-entered **14-country seed** (`packages/data/scripts/bootstrap.ts`), chosen for structural variety rather than coverage:

| Country | Why it's in the seed |
|---|---|
| AE, HK | **No postal code at all** — a validator that requires one is simply wrong |
| IE | Postal code exists but is **not required**; Eircode implies no locality |
| FR | **Sorting code** (CEDEX) — the field most libraries drop |
| JP, CN | **Non-Latin postal order**, largest-to-smallest, with a row prefix (〒) |
| US, CA, AU | **Fixed subdivision lists** with aliases and transliterations |
| GB | Genuinely hard postcode grammar |
| DE, NL, BR, IN | Postcode-before-city, and PIN/CEP naming |

The seed flows through **the same transform** as synced data, so it cannot encode a different interpretation of the format. `snapshotInfo.isBootstrap` tells you at runtime which you have.

> ⚠️ **Licensing.** This project's own code is MIT. The redistribution terms for the *upstream metadata* are not clearly stated on the service itself. Precedent exists (`mirumee/google-i18n-address` redistributes it under BSD-3; `Boostport/address` ships generated Go data), but **this must be resolved before `@smartaddress/data` is published to npm.** Fallback: CLDR + OpenCage `address-formatting` (MIT, confirmed) + a hand-curated subdivision base. Tracked in [ROADMAP.md](./ROADMAP.md).

---

## 8. The conformance suite

[`/conformance`](./conformance) holds JSON vectors that **are** the specification. The TypeScript code is just the first thing that passes them.

```jsonc
{
  "id": "type-military-zip-region-mismatch",
  "description": "An AE address with an AP-range ZIP is caught",
  "address": { "countryCode": "US", "locality": "APO",
               "administrativeArea": "AE", "postalCode": "96201", … },
  "expect": { "valid": false, "type": "military",
              "issueCodes": ["MILITARY_POSTAL_CODE_INVALID"] }
}
```

Assertion rules, identical in every port:

- `issueCodes` — **exact set**, order-insensitive. Asserting the full set is what stops an implementation from passing by raising nothing at all.
- `capabilities`, `normalized` — **subset** match.
- Everything else — exact equality. Omitted keys are not asserted.

**Why this matters.** Multi-language libraries drift. libphonenumber's Go port documents exactly this: regenerating metadata is only *half* a sync, because the ported logic still has to be reconciled against the reference implementation by hand. A shared executable spec is the fix.

**It also lowers the contribution bar to zero TypeScript.** If you receive post in a country and we get its format wrong, add a vector and run `pnpm test`. The failure *is* the bug report — open the PR even if you don't fix the engine.

---

## 9. API reference

### `createValidator(config)`

```ts
createValidator({
  metadata?:     MetadataSource,      // default: empty (degrades to generic checks)
  plugins?:      readonly Plugin[],   // appended after built-ins
  basePlugins?:  readonly Plugin[],   // replaces built-ins entirely
  defaults?:     ValidateOptions,     // applied to every call
}): Validator
```

Validators are cheap and immutable. Build one at startup and share it; build a second with stricter plugins if checkout needs different rules than signup.

### `Validator`

| Method | Returns |
|---|---|
| `validate(address, options?)` | `ValidationResult` |
| `classify(address)` | `{ type, capabilities }` |
| `format(address, style?)` | `string[]` — `style` is `"postal"` (default) or `"oneline"` |
| `plugins` | the resolved plugin list, in order |

### `ValidateOptions`

| Option | Effect |
|---|---|
| `acceptTypes?: AddressType[]` | Allow-list of address types; anything else raises `TYPE_NOT_ACCEPTED` |
| `requireCourierDeliverable?: boolean` | Shorthand for the common case — rejects PO Boxes, military, rural routes |
| `partial?: boolean` | Missing required fields become warnings instead of errors |
| `language?: string` | BCP 47 tag for label lookup |

### `getAddressFormSchema(country, source)`

Returns `rows`, `required`, `supported`, `uppercase`, `labels`, `postalCodeExamples`, `administrativeAreas?`, `postalCodePattern?`.

Note that **form order is not postal order**. Japan and China put the recipient's name *last* on an envelope, but every checkout form on earth asks for the name first — so `rows` hoists name and organization to the top while `format()` keeps true postal order.

### Issue codes

Stable identifiers. Branch on these, not on `message`.

| Code | Severity | Meaning |
|---|---|---|
| `COUNTRY_REQUIRED` | error | No country supplied — nothing else can be judged |
| `COUNTRY_UNKNOWN` | error / warning | Not an ISO alpha-2 code, or no metadata for it |
| `FIELD_REQUIRED` | error / warning | Required field missing (warning under `partial`) |
| `FIELD_UNSUPPORTED` | warning | Country does not use this field |
| `POSTAL_CODE_PATTERN_MISMATCH` | error | Fails the country's postcode grammar |
| `ADMIN_AREA_UNKNOWN` | error | Not a recognised subdivision |
| `PO_BOX_NOT_ACCEPTED` | error | PO Box where a courier-deliverable address is required |
| `MILITARY_ADMIN_AREA_INVALID` | error | Military address not using AA / AE / AP |
| `MILITARY_POSTAL_CODE_INVALID` | error | ZIP outside that military region's range |
| `TYPE_NOT_ACCEPTED` | error | Address type outside the caller's allow-list |
| `VALUE_TOO_LONG` | error | Field exceeds 200 characters |
| `VALUE_HAS_CONTROL_CHARACTERS` | error | Field contains control characters |

---

## 10. Development

```bash
pnpm install
pnpm tsx packages/data/scripts/bootstrap.ts   # generate the seed data
pnpm check                                    # typecheck + all tests
```

| Command | Does |
|---|---|
| `pnpm check` | typecheck + test |
| `pnpm test` | vitest, once |
| `pnpm test:watch` | vitest, watching |
| `pnpm typecheck` | `tsc -b` across all packages |
| `pnpm build` | build every package |
| `pnpm sync:data` | refresh country metadata from upstream |

CI runs on Node 18, 20 and 22, and additionally verifies that the committed generated data is reproducible.

### Contributing

The single most valuable contribution is a **conformance vector for an address format you know first-hand**. See [CONTRIBUTING.md](./CONTRIBUTING.md).

Design principles, in priority order:

1. Never silently rewrite an address.
2. A boolean is not a verdict — new signals go in `ValidationResult`, not folded into `valid`.
3. Core stays synchronous and dependency-free.
4. Data is generated; country rules are never hardcoded.

---

## Licence

MIT — see [LICENSE](./LICENSE). See the [licensing note](#7-data-where-country-rules-come-from) about upstream metadata.
