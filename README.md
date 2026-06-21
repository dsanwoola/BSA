# Bank Charge Auditor 🇳🇬

Audits major Nigerian bank statements against the **official CBN Guide to Bank Charges** — finds illegal and excess charges, proves every finding with arithmetic and a legal citation, computes the refund you can claim, and drafts the demand letter for you.

Built for individuals, businesses, corporates and government organisations.

## How to run it

**No installation needed.** Double-click `index.html` — it opens in your browser and works completely offline.

Everything runs on your own device: **your statement is never uploaded, stored or sent anywhere.** The app makes zero network requests with your data, which makes it safe for corporate and government accounts.

(Developers: any static server also works, e.g. `python -m http.server 8765`.)

## Using it

1. **Your account** — tell it the account type (savings / current / domiciliary), holder type, and whether it's a salary account. CBN rules differ by account type, so this is what makes the audit exact.
2. **Statement** — drop in a CSV, Excel or text-based PDF statement from supported major banks, with guided import for other layouts. FCMB PDF layouts are now covered by the parser regression suite. CSV/Excel exports from internet banking are the most reliable. (Try the built-in **demo statement** first.)
3. **Verify the read** — the app shows you how it understood your file's columns, and runs a **balance integrity check**: it re-adds every debit/credit against the running balance. Only a statement that reconciles is audited at full confidence.
4. **Audit report** — violations with refund amounts, cross-checks, items needing review, the demand letter, CSV export and a printable report.

## The accuracy design (why it doesn't make mistakes)

1. **It never guesses.** Every detected charge gets one of four verdicts:
   - ⛔ **Violation** — provably above the CBN cap (or a charge that must be free). Carries the refund amount, the arithmetic, and the citation.
   - ✓ **Compliant** — provably within the cap in force on that date.
   - ❓ **Needs review** — the auditor cannot decide from the statement alone, and says so instead of guessing.
   - ℹ **Advisory** — recognized charges the CBN sets at "cost recovery" or per-unit rates the statement can't reveal (e.g. SMS counts, statement pages).

2. **Zero-false-positive policy.** A violation is only declared when the charge exceeds the cap under the *most generous lawful reading* — VAT-inclusive interpretation, largest candidate transfer, every credit counted as levy-eligible, same-name exclusions conceded to the bank. That's what makes the report safe to send to a bank.

3. **Date-aware rules.** CBN rules changed over time. Each transaction is judged by the rule in force *on its date*:
   - ATM fees: ₦35-after-3-free until 28 Feb 2025 → ₦100 per ₦20,000 from 1 Mar 2025 (CBN circular of 10 Feb 2025)
   - EMTL on receipts (Finance Act 2020) → sender-side stamp duty from 1 Jan 2026 (Nigeria Tax Act 2025)
   - VAT 5% → 7.5% on 1 Feb 2020; SMS cost-recovery benchmark ₦4 → ₦6 after the 2025 telco tariff review
   - Cash-deposit fee suspension windows (Dec 2023–Apr 2024, Sep 2024–Mar 2025)
   - Transactions before 1 Jan 2020 are sent to review, not judged with the wrong rules.

4. **Smart cross-checks** — rules that can't be judged one charge at a time are recomputed across the whole statement:
   - **CAMF recomputation**: the ₦1/mille maintenance cap is recomputed from your statement's actual customer-induced debit turnover, month by month (only for fully-covered months).
   - **Levy counting**: total ₦50 levies vs your actual number of qualifying ₦10,000+ transfers.
   - **ATM monthly allowance** (pre-Mar-2025): fees vs the 3-free-withdrawals rule.
   - **Quarterly card fee**: card maintenance charged more than once a quarter is flagged.

5. **Parse verification before audit.** The running-balance integrity check mathematically proves the statement was read correctly before any rule is applied. Unreadable rows are excluded *and reported*, never silently guessed.

5b. **The hero section becomes a checksum.** Nigerian bank statements open with a summary "hero" block (Account Name/No, Account Type, Statement Period, Opening/Closing Balance, Total Debit/Credit) before the transaction table. The parser:
   - finds the real table header anywhere in the file with a **5-label quorum rule**: any row carrying at least 5 recognised column labels (Value Date, Reference, Remarks, Credit, Debit, Balance, Posted Date, Description, Trans Date, Money In/Out, Lodgement, Withdrawals, Particulars…) is the transaction header — statements differ, but their table header always shows ≥5 of these, while hero rows and transaction rows never do. Labels match **in any order and under any known spelling** (longest-label-first, so "Value Date" is never mistaken for "Date"), and a quorum header whose narration column uses a label we've never seen still wins — the app then asks the user to assign just that one dropdown instead of mis-reading the hero section. A core-trio fallback (Date + Narration + Debit/Amount) covers minimal files, and a manual header-row picker covers everything else;
   - mines the hero for the statement's own summary figures, then **proves the parse against them**: Total Debits, Total Credits, `Opening + Credits − Debits = Closing`, and first/last running balance — five independent equations. If they all hold, the read is provably complete; if any fails, the app warns that rows are missing or misread *before* any audit verdict is issued;
   - uses the declared statement period to know a month is fully covered even when its first transaction falls mid-month (this unlocks the CAMF/ATM monthly cross-checks);
   - and if the hero says "SAVINGS" while you selected "Current", offers a one-click fix — account type decides which CBN rules apply.

6. **You stay in control.** Banks invent creative narrations; anything missed can be manually reclassified in the *All transactions* tab and the entire audit recomputes instantly.

## What it audits

Electronic transfer fees (NIP/USSD/app tiers ₦10/₦25/₦50 + VAT) • EMTL / stamp duty (₦50) • current account maintenance fee (₦1/mille, current accounts only) • card maintenance (₦50/quarter, savings only) • card issuance (₦1,000 + VAT) • ATM fees (both regimes) • SMS alerts (cost recovery) • VAT correctness on every fee • COT (abolished — always a violation) • account closure/reactivation/dormancy fees (must be free) • PIN reset & email alert fees (must be free) • hardware token (≤₦2,500) • bills payment (≤₦500) • RTGS (₦950+VAT) • standing orders (≤₦50) • stop-cheque (₦500+VAT) • statement requests (₦20/page) • bulk payments (₦15/beneficiary) • cash-back purchases (₦100/₦20,000) • cashless-policy cash handling fees & suspension windows • plus advisory coverage of cheque books, drafts, returned cheques, domiciliary/SWIFT, loan fees, POS merchant commissions and more.

## Rule sources

- CBN *Guide to Charges by Banks, Other Financial and Non-Bank Financial Institutions* (effective 1 Jan 2020)
- CBN Circular on Review of ATM Transaction Fees (10 Feb 2025, effective 1 Mar 2025)
- Finance Act 2020 & EMTL Regulations; Nigeria Tax Act 2025 (stamp duty from 1 Jan 2026)
- CBN Cashless Policy circulars; Finance Act 2019 (VAT 7.5%)
- Cross-verified against bank pricing guides published "in line with the CBN Guide" (see `reference/`)

All rules live in **`js/rules.js`** as data with citations — when the CBN issues a new circular, update that one file.

## Tests

```
node tests/run_tests.js
```

273+ committed tests cover the parser (amounts, day-first dates, CSV quoting, column detection), the classifier (including merchant names that *look* like fees), every charge family, the cross-checks, VAT pairing, the 2026 stamp-duty regime switch, manual overrides, encrypted PDFs, bank-specific PDF layouts, and integrity/checksum verification.

## Files

```
index.html          the app (open this)
js/rules.js         CBN rules knowledge base (amounts, dates, citations)
js/patterns.js      narration classifier for Nigerian bank statement wordings
js/engine.js        deterministic audit engine + cross-checks
js/parser.js        CSV/Excel/PDF parsing + integrity check
js/report.js        report rendering, CSV export, demand letter
js/app.js           UI flow
samples/            demo statement with planted violations
tests/run_tests.js  test suite
vendor/             SheetJS + pdf.js (vendored — works offline)
reference/          source documents used to build the rules
```

## Known limits (stated, not hidden)

- Scanned/image PDFs are rejected with a clear message (export CSV/Excel instead) — OCR guessing would violate the accuracy policy.
- Same-name transfer exclusions (CAMF, levy) can't be detected from narration alone; the engine concedes them to the bank, so violations are understated, never overstated.
- "Cost recovery" and "negotiable" charges are reported as advisory with the governing rule, because the statement alone cannot prove them right or wrong.

⚖ This tool produces a documented audit, not legal advice. Unresolved complaints escalate to the CBN Consumer Protection Department: **cpd@cbn.gov.ng**.

## Launch / beta feedback

For controlled testing, use `BETA_TESTING.md` to guide testers, collect parser failures safely, and preserve the no-upload privacy promise. Public-facing copy should continue to say “Supports major Nigerian bank statements, with guided import for other layouts” rather than claiming every Nigerian bank layout is guaranteed.
