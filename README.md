# SmartAddress

**A reusable, pluggable component for every address need in your code.**

International address validation, classification, normalization and formatting.
Zero dependencies, no network, no API keys, works in any JavaScript runtime — and
usable from any language at all through a language-neutral data package, a shared
conformance suite, and a CLI.

> **Status: early.** The engine and the plugin contract are real and tested. The
> bundled country data is a 14-country bootstrap seed until `pnpm sync:data` is
> run — see [Data](#data).

---

## Why this exists

Address entry is broken in most codebases in the same three ways:

1. **A boolean is the wrong answer.** "Is this address valid?" hides the
   difference between *this postcode is malformed* and *we couldn't confirm the
   building number*. Those need different behaviour at checkout.
2. **Address *type* is ignored.** A PO Box is a perfectly valid address that
   UPS, FedEx and DHL will all refuse. Military (APO/FPO/DPO) addresses look
   like US addresses and follow entirely different rules. Almost no library
   models this, so every team rediscovers it in production.
3. **The existing options don't fit.** `@shopify/address` makes `format()`
   *async* because it calls a hosted API. `@cpsdqs/google-i18n-address` was last
   published in 2022. `postcode-validator` only checks postcodes.

SmartAddress returns a **verdict**, models **address type** as a first-class
concept, and runs entirely offline.

## Install

```bash
npm install @smartaddress/core @smartaddress/data
```

## Use

```ts
import { createValidator } from "@smartaddress/core";
import { metadata } from "@smartaddress/data";

const validator = createValidator({ metadata });

const result = validator.validate({
  countryCode: "US",
  streetAddress: ["1600 Amphitheatre Pkwy"],
  locality: "Mountain View",
  administrativeArea: "California",
  postalCode: "94043",
});

result.valid;                    // true
result.type;                     // "street"
result.granularity;              // "street"
result.capabilities;             // { courierDeliverable: true, ... }
result.normalized;               // administrativeArea canonicalised to "CA"
result.components.administrativeArea;
// { value: "CA", input: "California", confirmation: "replaced" }
```

### Never a silent rewrite

SmartAddress reports what it *would* change and lets you decide. Every component
carries a `confirmation` (`confirmed` / `plausible` / `unconfirmed` /
`suspicious` / `inferred` / `replaced`) and its original `input`. Silently
"helpfully" rewriting addresses is how parcels end up in the wrong country.

### Address types

```ts
validator.validate({
  countryCode: "US",
  streetAddress: ["PO Box 1234"],
  locality: "Cupertino",
  administrativeArea: "CA",
  postalCode: "95014",
}, { requireCourierDeliverable: true });
// valid: false, issues: [{ code: "PO_BOX_NOT_ACCEPTED", ... }]
```

Recognised today: `street`, `po_box` (13 language patterns), `military`
(APO/FPO/DPO with AA/AE/AP ZIP-range checks, plus BFPO), `general_delivery`,
`rural_route`, `highway_contract`, `parcel_locker` (Packstation, InPost,
Amazon Locker).

### Build a form for any country

```ts
import { getAddressFormSchema } from "@smartaddress/core";

getAddressFormSchema("JP", metadata);
// rows:   [["name"], ["organization"], ["postalCode"],
//          ["administrativeArea", "locality"], ["streetAddress"], ["countryCode"]]
// labels: { administrativeArea: "Prefecture", ... }
```

The label is "Prefecture" in Japan, "Emirate" in the UAE, "County" in Ireland,
"State" in the US. Your form component never needs to know.

## Pluggable

Every stage is a plugin hook — `classify`, `normalizeField`, `validate`,
`granularity`, `format`. Adding a rule never means forking the library:

```ts
const noPastCutoff: Plugin = {
  name: "acme:no-remote-islands",
  countries: ["GB"],
  validate(ctx) {
    if (!ctx.address.postalCode?.startsWith("ZE")) return [];
    return [{
      code: "TYPE_NOT_ACCEPTED",
      severity: "error",
      field: "postalCode",
      message: "We do not ship to Shetland.",
      source: "acme:no-remote-islands",
    }];
  },
};

createValidator({ metadata, plugins: [noPastCutoff] });
```

Plugins are **country-scoped** (a US rule cannot leak into France), **pure**
(same result in a browser, a server, or a port), and **composable** (competing
classifiers resolve by confidence, not registration order).

Async work — real deliverability, DPV, geocoding — lives behind a separate
`AddressProvider` interface, deliberately kept out of the synchronous pipeline so
that one provider cannot make `validate()` async for everybody.

## Plugs into anything

| Consumer | How |
|---|---|
| React | `@smartaddress/react` → `useAddressForm()` |
| Vue / Svelte / Angular / Solid | same shape, ~150 lines each |
| Node / Deno / Bun / edge / browser | `@smartaddress/core` directly |
| Python / Go / Java / Ruby / PHP | native port against `@smartaddress/data` + `/conformance` |
| Anything else | `@smartaddress/cli` — JSON in, JSON out |

```bash
echo '{"countryCode":"US","streetAddress":["PO Box 9"],"locality":"Cupertino","administrativeArea":"CA","postalCode":"95014"}' \
  | npx smartaddress validate --courier
# exit code 1, full verdict on stdout
```

## Conformance suite

[`/conformance`](./conformance) holds the vectors that **are** the spec. A port in
any language is conforming when it passes them. This is the mechanism that keeps
ports from drifting — the problem that has bitten every multi-language library of
this shape.

Adding a country or an edge case needs no TypeScript at all: add a JSON vector,
run `pnpm test`, and a failure is the bug report.

## Data

`@smartaddress/data` is generated, never hand-edited, and contains no logic. It
is the language-neutral half of the project, shared by every port.

```bash
pnpm sync:data          # snapshot upstream metadata (~250 countries)
pnpm sync:data -- US JP # or just a few
```

The sync is a **build-time** step. The upstream service carries no uptime
guarantee, so nothing at runtime may depend on it, and every refresh lands as a
reviewable diff rather than a silent change in production behaviour.

Until you run it, the committed data is a hand-entered 14-country bootstrap seed
(`packages/data/scripts/bootstrap.ts`) chosen for structural variety: no postal
code (AE, HK), optional postal code (IE), sorting codes (FR), non-Latin postal
order (JP, CN), fixed subdivision lists (US, CA, AU). `snapshotInfo.isBootstrap`
tells you at runtime which you have.

> **Licensing note.** The upstream metadata's redistribution terms are not as
> clearly stated as this project's own MIT licence. This must be resolved before
> `@smartaddress/data` is published to npm. See [ROADMAP.md](./ROADMAP.md).

## Development

```bash
pnpm install
pnpm tsx packages/data/scripts/bootstrap.ts   # generate seed data
pnpm check                                    # typecheck + tests
```

## Contributing

The most valuable contribution is a conformance vector for an address format you
know first-hand. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Licence

MIT
