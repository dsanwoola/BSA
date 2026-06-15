# CBN Bank Charges Rule Implementation Report

Source: uploaded `BANK CHARGES Inline with CBN Rule.pdf`.
App build: 46.
Date implemented: 2026-06-15.

## Privacy / source handling

The uploaded guide was extracted locally and used as the implementation source. The PDF itself was not committed. This report records the rule items and how each item is represented in the Bank Statement Auditor.

## Implementation summary

Implemented in:

- `js/rules.js` — rule amounts, caps, citations, advisory categories, display names.
- `js/patterns.js` — narration classification patterns for newly covered charge types.
- `js/engine.js` — deterministic evaluation logic for newly enforceable caps.
- `tests/run_tests.js` — regression tests for newly added classifications and caps.

The auditor still follows a no-guessing policy: if a rule depends on data not visible in a bank statement — for example loan principal, draft value, merchant category, bond value, number of beneficiaries, number of pages, or whether a fee was negotiated in writing — it is implemented as an advisory/review item rather than falsely marked compliant or illegal.

## Rule-by-rule coverage

### General VAT rule

- Guide item: all charges are subject to 7.5% VAT unless stated VAT-inclusive.
- Implementation: existing `RULES.vatRate()` and `capWithVat()` remain the common VAT logic. Newly added caps mark whether VAT applies or whether the quoted cap is VAT-inclusive.
- Status: implemented.

### Current account CAMF

- Guide item: Current Account Maintenance Fee at ₦1 per mille on every ₦1,000 of customer-induced debit transactions.
- Implementation: already implemented through `RULES.camf` and monthly aggregate recomputation in `aggCamf()`.
- Status: already implemented.

### Premium account minimum-balance forfeiture

- Guide item: Gold/Platinum premium account fee waived if minimum balance is maintained; if not, Gold ₦2,500/month or Platinum ₦1/mille.
- Implementation: added `premium_account_forfeiture` advisory type and classifier. The statement alone may not show daily minimum-balance qualification, so the auditor flags it for review with the correct rule.
- Status: implemented as advisory.

### Statements

- Guide item: mandatory monthly statement free; interim/on-request statement maximum ₦20 per page.
- Implementation: existing `statement_request` fixed cap remains at ₦20 per page, VAT-aware; monthly statement charges remain disputable through the same classification/manual reclassification path.
- Status: already implemented.

### Cheque books and forms

- Guide item: cheque book 50 leaves ₦1,500 + VAT; cheque book 100 leaves ₦3,000 + VAT; counter cheque ₦50 per leaflet; stop cheque order ₦537.50 VAT-inclusive; non-clearing withdrawal slips 50 leaves ₦1,500 + VAT; 100 leaves ₦3,150 VAT-inclusive.
- Implementation:
  - Added fixed caps: `cheque_book_50`, `cheque_book_100`, `nonclearing_slip_50`, `nonclearing_slip_100`.
  - Added `nonclearing_slip` classifier.
  - Added `evalLeafBook()` to enforce 50/100-leaf caps when the narration says the leaf count; where the count is not visible, it uses the most generous 100-leaf cap to avoid false positives.
  - Existing `counter_cheque` and `stopped_cheque` caps remain active.
- Status: implemented.

### Electronic transfers: NIP/EFT/USSD

- Guide item: below ₦5,000 = ₦10 + VAT; ₦5,001–₦50,000 = ₦25 + VAT; above ₦50,000 = ₦50 + VAT; RTGS ₦950 + VAT; USSD uses current NIP charges.
- Implementation: already implemented with `RULES.eftFeeFor()`, `RULES.fixedCaps.rtgs`, transfer-linking logic, and VAT pairing.
- Status: already implemented.

### ATM withdrawals

- Guide item: own-bank ATM free; other-bank on-site ATM ₦100 per ₦20,000; other-bank off-site ATM ₦100 fee plus surcharge up to ₦500 per ₦20,000.
- Implementation: already implemented in post-2025 ATM evaluator, with matched withdrawal chunking by ₦20,000 and off-site ceiling.
- Status: already implemented.

### Debit and credit cards

- Guide item: debit card issuance/replacement/renewal ₦1,075 VAT-inclusive; naira card maintenance on savings maximum ₦50 per quarter; foreign-currency card maintenance $10/year; credit card issuance ₦1,075 VAT-inclusive; credit card interest 2.5%/month naira or 30%/annum.
- Implementation:
  - Existing card issuance and naira card maintenance logic remains active.
  - Added `fx_card_maintenance` advisory type.
  - Added `credit_card_interest` advisory type.
  - Foreign-currency and credit-card interest are advisory because currency/account card type and outstanding principal are not reliably derivable from a naira bank statement.
- Status: implemented; some items advisory where statement data is insufficient.

### Transaction alerts

- Guide item: SMS alert is cost recovery for customer-induced transactions; bank-induced alerts free; email notifications free; PIN reissue/reset free.
- Implementation: existing SMS cost-recovery logic, email-free rule, and PIN-reset-free rule remain active.
- Status: already implemented.

### Stamp duty / transfer levy

- Guide item: ₦50 flat on transfers of ₦10,000 and above.
- Implementation: existing EMTL/stamp-duty logic and aggregate count checks remain active, including no VAT on levy.
- Status: already implemented.

### OTC cash transactions / cashless policy

- Guide item: individual OTC cash withdrawal above ₦500,000/week = 3%; corporate OTC cash withdrawal above ₦5,000,000/week = 5%; cheque deposit own account free; cheque withdrawal own account free; third-party cheque withdrawal above ₦100,000 has no charge/no cash withdrawal allowed.
- Implementation:
  - Updated corporate cash-withdrawal threshold to ₦5,000,000 at 5%.
  - Existing individual threshold remains ₦500,000 at 3%.
  - Existing own-cheque deposit free rule remains active.
  - Cash withdrawal processing remains review/advisory unless the matching OTC cash withdrawal is visible.
- Status: implemented.

### Bank drafts

- Guide item: customer current account ₦350; customer savings account ₦550; non-customer ₦550 + 0.1% of draft value; draft repurchase free.
- Implementation: added `evalBankDraft()`.
  - Current-account cap: ₦350 + VAT allowance.
  - Savings-account cap: ₦550 + VAT allowance.
  - Non-customer draft: advisory because draft value is needed for the 0.1% formula.
  - Draft repurchase remains prohibited/free.
- Status: implemented.

### Standing orders and direct debits

- Guide item: standing order within same bank bank-specific; standing order to other banks max ₦50; direct debit same as platform cost; failed direct debit not due to insufficient funds free; failed direct debit due to insufficient funds 1% or ₦5,000 whichever is higher.
- Implementation:
  - Existing standing-order cap remains active.
  - `returned_unfunded` advisory citation updated to include failed direct debit rule.
  - Failed direct debit not due to insufficient funds can be manually reclassified as a no-charge dispute if visible.
- Status: implemented as fixed cap for standing order and advisory for insufficient-funds formula.

### Internet and mobile banking

- Guide item: sign-up/registration free; hardware token max ₦2,500; token replacement max ₦2,500; software token/OTP free except SMS cost recovery; bills payment max ₦500 per beneficiary; USSD uses NIP charges; purchase with cashback ₦100 per ₦20,000, max ₦100,000 daily withdrawal.
- Implementation:
  - Existing hardware token, bills payment, USSD/EFT, and SMS logic remain active.
  - Updated cashback citation and max daily withdrawal metadata to ₦100,000.
- Status: implemented.

### Personal lending charges

- Guide item: interest negotiable; authorized overdraft negotiable; penal late repayment max 1% flat/month plus current interest; total lending fees shall not exceed 2%; management fee max 1%; facility enhancement max 1%; restructuring max 0.5%; commitment max 1%.
- Implementation: existing `loan_fee` advisory type remains; citation covers caps. Statement alone does not reveal principal/outstanding/undisbursed amount or negotiated agreements.
- Status: implemented as advisory.

### Savings account differences

- Guide item: no CAMF on savings; naira debit card maintenance max ₦50/quarter; 5th withdrawal onward may forfeit interest; fixed deposit early liquidation penalty schedule.
- Implementation:
  - Existing savings CAMF violation and card maintenance quarter logic remain active.
  - Added `savings_withdrawal_interest_forfeiture` advisory type.
  - Added `fixed_deposit_early_liquidation` advisory type with full penalty schedule.
- Status: implemented; interest/FD items advisory because statement alone does not expose product terms or accrued interest.

### Corporate current account charges

- Guide item: corporate current CAMF same ₦1/mille; BizSmart/BizSmart Plus minimum-balance package rules; monthly subscriptions ₦2,000–₦7,500; bulk payment max ₦15/beneficiary + VAT.
- Implementation:
  - Existing CAMF recomputation applies to corporate current accounts.
  - Existing bulk-payment cap remains active.
  - Premium/bundle/minimum-balance fees handled through `premium_account_forfeiture` advisory.
- Status: implemented.

### Corporate lending charges

- Guide item: local/foreign currency loans and overdraft negotiable; management fee max 1%; facility enhancement max 1%; restructuring max 0.5%; commitment max 1%; advisory/consultancy negotiable by written agreement; penal rate max 1% flat/month; total lending fees max 2%.
- Implementation: covered under `loan_fee` advisory because principal/outstanding amount and negotiated agreements are not visible from statement lines.
- Status: implemented as advisory.

### Consortium / syndicated lending

- Guide item: agency fee negotiable; management fee max 1%; commitment/non-drawing fee max 0.5%; underwriting commission negotiable.
- Implementation: added `syndicated_lending_fee` advisory type and classifier.
- Status: implemented as advisory.

### Bonds and guarantees

- Guide item: performance bond / advance payment guarantee / bank guarantee negotiable, max 1% of bond value.
- Implementation: added `bond_guarantee` advisory type and classifier.
- Status: implemented as advisory.

### Treasury bills and money market

- Guide item: treasury bill purchase/sale processing fee ₦100 per form; custodian fee per CBN guideline; S4 platform cost recovery.
- Implementation: added `treasury_bill_processing` advisory type and classifier. It is advisory because the statement may not reveal form count/custody/S4 cost basis.
- Status: implemented as advisory.

### Foreign currency / domiciliary account

- Guide item: commission on domiciliary withdrawals 0.05% or $10 whichever is lower; credit interest negotiable.
- Implementation: existing `fx_commission` advisory type remains active with the 0.05%/$10 rule.
- Status: implemented as advisory.

### POS merchant service fees

- Guide item: category/scheme-specific merchant fees: 0.5% capped ₦1,000 for certain local categories; hotels 1.25%/2% local; restaurants/NGOs/religious orgs 1.25% capped ₦100 on Interswitch; fuel 0.6875%; international cards 3%–5.5%.
- Implementation: expanded `pos_merchant` advisory citation with category-specific schedule. It remains advisory because statement lines generally do not reveal merchant category and card scheme.
- Status: implemented as advisory.

## Regression coverage added

New tests cover:

- Classifier recognition for non-clearing withdrawal slips.
- Classifier recognition for credit-card interest.
- Classifier recognition for premium minimum-balance forfeiture.
- Classifier recognition for treasury-bill processing.
- 50-leaf cheque book cap compliance and violation.
- 100-leaf non-clearing withdrawal slip VAT-inclusive cap.
- Current-account customer bank draft cap compliance and violation.
- Advisory classification for credit-card interest and treasury-bill processing.

## Verification result

Full test suite after implementation:

```text
PASSED: 238
FAILED: 0
```

## Notes / limitations

Some guide items cannot be proven from a bank statement alone. The auditor does not guess; it either enforces a fixed cap or produces a review/advisory finding that tells the user what supporting document to request from the bank.
