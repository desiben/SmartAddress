# Contributing to SmartAddress

## The most useful thing you can do

Add a conformance vector for an address format you know first-hand.

This project's accuracy across ~250 countries cannot come from one maintainer.
It comes from people who actually receive post in a country noticing that we get
it wrong. **You do not need to write TypeScript to fix a country.**

1. Open `conformance/vectors/` and pick the file that fits (or add one).
2. Add a case with a real address shape and what you expect.
3. Run `pnpm test`.
4. If it fails, that failure *is* the bug report — open the PR with the failing
   vector even if you don't fix the engine.

See [conformance/README.md](./conformance/README.md) for the vector format.

## Adding a country

Do **not** hand-add countries to `packages/data/scripts/bootstrap.ts` — that file
is only a seed so the tests can run without network access. Country coverage
comes from `pnpm sync:data`, which snapshots the upstream metadata.

If a country's *upstream* data is wrong, the fix is a plugin (see below) plus a
vector proving it, not an edit to generated data.

## Adding a rule

Rules live in plugins, never in the engine. A plugin that only knows about one
country is scoped to it:

```ts
export const myRule: Plugin = {
  name: "core:my-rule",
  countries: ["NL"],
  validate(ctx) { /* return Issue[] */ },
};
```

Requirements:

- **Pure.** No I/O, no clock, no randomness. Plugins must produce the same result
  in a browser, on a server, and in a Python port.
- **Scoped.** If it is country-specific, set `countries`. An unscoped rule that
  only makes sense in one market is a bug.
- **Stable issue codes.** `Issue.code` is a public contract that callers branch
  on. Adding one is a minor release; changing or removing one is a breaking
  change. `Issue.message` is developer-facing and explicitly *not* stable.
- **Tested by a vector**, so every port inherits the rule.

## Principles

1. **Never silently rewrite an address.** Report the correction with
   `confirmation: "replaced"` and the original `input`. The caller decides.
2. **A boolean is not a verdict.** New signals belong in `ValidationResult`, not
   folded into `valid`.
3. **Core stays synchronous and dependency-free.** Anything needing the network
   is an `AddressProvider`, in its own package.
4. **Data is generated.** If you find yourself editing JSON in
   `packages/data/data/`, something has gone wrong.

## Checks

```bash
pnpm check    # typecheck + full test suite
```

Both must pass before a PR is reviewed.
