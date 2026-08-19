# SmartAddress conformance vectors

These JSON files are **the specification**. The TypeScript implementation is
just the first thing that passes them.

Any port — Python, Go, Rust, Java — is considered a conforming SmartAddress
implementation when it runs every vector in `vectors/` and produces the asserted
outcome. That is what keeps ports from silently drifting away from each other,
which is the failure mode that has bitten every multi-language library of this
shape (libphonenumber's Go port documents exactly this problem: regenerating
metadata is only half a sync, because the ported *logic* also has to be
reconciled by hand).

## Format

Each file is a JSON object:

```jsonc
{
  "name": "United States",
  "cases": [
    {
      "id": "us-basic-valid",              // stable, referenced in bug reports
      "description": "A well-formed California address",
      "address": { "countryCode": "US", "...": "..." },
      "options": { "requireCourierDeliverable": true },   // optional
      "expect": {
        "valid": true,
        "type": "street",
        "granularity": "street",
        "complete": true,
        "issueCodes": [],                  // exact set, order-insensitive
        "capabilities": { "courierDeliverable": true },   // subset match
        "normalized": { "administrativeArea": "CA" },     // subset match
        "formatted": ["...", "..."]        // exact lines, optional
      }
    }
  ]
}
```

Assertion rules, which every port must implement identically:

- `issueCodes` is an **exact set** comparison, ignoring order and duplicates.
  Asserting the exact set is what stops a port from quietly passing by raising
  no issues at all.
- `capabilities` and `normalized` are **subset** comparisons — only the keys
  present in the vector are checked.
- Any other `expect` key is an exact equality check.
- Omitted keys are not asserted.

## Adding a case

Adding a country or an edge case is the most useful contribution to this
project, and it needs no TypeScript. Add a vector, run `pnpm test`, and if it
fails, that failure is the bug report.
