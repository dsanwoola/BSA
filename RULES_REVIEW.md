# Bank Charge Auditor — Rules Review Checklist

The product's credibility depends on keeping `js/rules.js` current with Nigerian bank-charge regulation. Review quarterly and immediately after any CBN circular, tax-law change, or major bank tariff update.

## Current rule metadata

- Rules version: `2026.06`
- Last reviewed: June 2026
- Source of truth in app: `window.CBN_RULES.metadata` in `js/rules.js`

## Quarterly review steps

1. Check CBN publications for new circulars affecting bank charges, ATM fees, cashless-policy processing fees, transfer charges, consumer protection, or electronic levies.
2. Check FIRS / tax-law updates for EMTL, stamp duty, VAT, and related transaction taxes.
3. Cross-check at least 3 current Nigerian bank tariff guides against the encoded caps.
4. Update `js/rules.js` and its `metadata.version` / `metadata.lastReviewed`.
5. Add or update test cases in `tests/run_tests.js` for every changed rule.
6. Run `node tests/run_tests.js` and document the passing count before release.
7. Bump `APP_BUILD` in `js/app.js` and all `?v=N` query strings in `index.html`.

## Review-sensitive areas

- SMS alert cost-recovery benchmark.
- ATM post-March-2025 fee regime.
- Cashless-policy deposit/withdrawal fee suspensions.
- EMTL / stamp-duty treatment from 1 January 2026.
- VAT rate and VAT applicability to charge families.
- Transfer fee tiers and e-channel rules.

## Release note template

```text
Rules review: YYYY-MM
Sources checked:
- ...
Changes made:
- ...
Tests added/updated:
- ...
Test result: X/X passing
Reviewer:
```
