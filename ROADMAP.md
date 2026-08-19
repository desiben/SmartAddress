# SmartAddress roadmap

## Now (M0/M1 — done)

- [x] Monorepo, TypeScript, zero-dependency core
- [x] `ValidationResult` verdict contract (granularity, per-component confirmation, stable issue codes)
- [x] Plugin system: `classify` / `normalizeField` / `validate` / `granularity` / `format`, country-scoped
- [x] Structural validation driven entirely by metadata
- [x] Address type classifier: PO Box (13 languages), military, rural route, highway contract, general delivery, parcel locker
- [x] US military AA/AE/AP ZIP-range validation
- [x] Postal-code normalization for GB, CA, JP, BR
- [x] `getAddressFormSchema()` with country-correct field order and local labels
- [x] Postal formatting, including non-Latin ordering and row prefixes (Japan's 〒)
- [x] Language-neutral conformance suite + runner
- [x] `@smartaddress/react` headless hook
- [x] `@smartaddress/cli` universal escape hatch
- [x] Data generator (`sync.ts`) + bootstrap seed

## Blocking publication

- [ ] **Resolve upstream metadata licensing.** The engine is MIT and clean. The
      redistribution terms for Google's i18n address metadata are not clearly
      stated on the service itself. Precedent exists (`mirumee/google-i18n-address`
      redistributes it under BSD-3; `Boostport/address` ships generated Go data),
      but this needs a definite answer before `@smartaddress/data` goes to npm.
      Fallback: CLDR + OpenCage `address-formatting` (MIT, confirmed) + a
      hand-curated subdivision base.
- [ ] Reserve `smartaddress` / `@smartaddress` on npm (both currently unclaimed).
- [ ] Run `pnpm sync:data` for full ~250-country coverage.

## Next

- [ ] `AddressProvider` adapters: Google Address Validation, USPS, Smarty, Loqate, Melissa, plus a `MockProvider` for tests
- [ ] Locality ↔ postal code ↔ subdivision consistency checks (L2) from bundled data
- [ ] OpenCage `address-formatting` templates for richer display formatting
- [ ] Per-country confidence tiers published in the docs, so coverage claims stay honest
- [ ] i18n message bundles keyed off `Issue.code`
- [ ] Vue / Svelte / Solid adapters
- [ ] Bundle-size budget in CI, and a per-region data build

## Later

- [ ] Python port (demand proven by `google-i18n-address`)
- [ ] Go port
- [ ] Optional `libpostal` adapter for freeform parsing — as an adapter only; it
      needs ~2 GB of RAM and must never become a core dependency
- [ ] Docs site with an interactive playground
