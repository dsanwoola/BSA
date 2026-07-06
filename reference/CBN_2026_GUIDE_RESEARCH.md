# CBN Guide to Charges 2026 — research notes (2026-07-06)

Verified via multiple sources on 2026-07-06. The app's rules were built on the
2020 Guide + 2025 circulars; the items below are the deltas the auditor must
encode. **Effective date: 1 May 2026** ("Guide to Charges by Banks and Other
Financial Institutions, 2026", signed Dr. Rita Sike, Director FPRD; exposure
draft 21 Apr 2026, industry compliance from 1 May 2026).

## Confirmed changes (multiple sources)

| Item | 2020 guide (pre 1 May 2026) | 2026 guide (from 1 May 2026) |
|---|---|---|
| EFT ≤ ₦5,000 | ₦10 + VAT | **FREE** |
| EFT ₦5,001–₦50,000 | ₦25 + VAT | **₦10** |
| EFT > ₦50,000 | ₦50 + VAT | ₦50 (unchanged) |
| Naira card maintenance | ₦50/quarter (savings) | **ABOLISHED — any charge is a violation** |
| Card issuance/replacement | ₦1,000 (+VAT = ₦1,075) | **₦1,500** |
| CAMF (current accounts) | ₦1/mille | **₦0.5/mille (2026); ₦0 from 2027** |
| Virtual cards | — | free |
| Email alerts | free | free (restated) |
| SMS alerts | cost recovery | cost recovery, explicitly no profit margin |
| POS/merchant MSC | 0.5% cap ₦1,000 | 0.5% cap **₦10,000**; POS payments free for customers |
| ATM (other bank) | ₦100/₦20k on-site; +≤₦500 off-site (Mar 2025 circular) | unchanged |
| Stamp duty ₦50 (≥₦10k) | receiver pays (pre-2026) | sender pays (NTA 2025, from 1 Jan 2026) |

## USSD End-User Billing (NCC/CBN, phased from mid-2025)

Under EUB, the bank must NOT charge the customer for USSD sessions; only the
MNO bills (airtime), with end-of-activity notification. USSD session-fee
debits on a bank statement after the bank migrated to EUB are disputable.
Migration dates vary per bank → implement as dated REVIEW flag, not a hard
violation (no-guessing policy).

## Unresolved (needs future verification)

- Cash-deposit processing fee (cashless policy 2%/3%) status after the
  suspension ended 31 Mar 2025 — no third extension found; 2026 bank pricing
  guides show only ₦50-type deposit stamp duty. Keep suspension windows as
  coded; revisit if a resumption/cancellation circular surfaces.
- Whether the 2026 guide's ₦10/₦50 EFT caps are VAT-inclusive or +VAT.
  Conservative: treat as +VAT allowance when auditing (avoids false
  positives).
- Exact CAMF step-down date (guide effective 1 May 2026 vs calendar 2026) —
  encoded at 1 May 2026, the guide's effective date. ₦0 from 1 Jan 2027.

## Sources

- https://techcabal.com/2026/04/27/why-transfers-above-%E2%82%A610000-will-cost-%E2%82%A660/
- https://crispng.com/cbn-new-bank-charges-2026-card-maintenance-fees/
- https://guardian.ng/news/cbn-unveils-revised-bank-charges-guide-tightens-disclosure-rules/
- https://nairametrics.com/2026/04/23/cbn-caps-bank-fees-mandates-transparency-in-proposed-guidelines/
- https://ncc.gov.ng/frequently-asked-questions/end-user-billing-eub-policy-ussd-banking-transactions-nigeria
- https://www.stanbicibtcbank.com/static_file/Nigeria/nigeriabank/Downloads/Pricing%20Guide/Stanbic%20IBTC%20Bank%202026%20Pricing%20Guide.pdf
- https://nairametrics.com/2024/09/27/cbn-extends-suspension-of-cash-deposit-processing-fees-till-march-31st-2025/
