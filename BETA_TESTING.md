# Bank Charge Auditor — Private Beta Testing Guide

Use this guide for controlled beta testers before broad public launch.

## Who should test

Start with real statements from at least 10 Nigerian bank layouts, including Access, Zenith, UBA, First Bank, GTBank proper, Kuda, Moniepoint, PalmPay, Stanbic, FCMB, Fidelity, OPay, and Wema/ALAT where available.

## Privacy promise

The app is client-side. Statements are read inside the browser and are not uploaded. Do not ask testers to send raw bank statements unless they have manually redacted them and explicitly choose to do so outside the app.

## Preferred test file order

1. CSV export from internet banking.
2. Excel/XLSX export from internet banking.
3. Text-based PDF statement.
4. Avoid scanned image PDFs for now.

## Tester steps

1. Open the hosted beta URL on a modern Chrome, Edge, Safari, or Firefox browser.
2. Select account type, holder type, and salary-account status correctly.
3. Upload the statement.
4. Confirm the app identified the right header row.
5. Confirm the Date, Narration, Debit/Credit or Amount, and Balance columns.
6. Check whether the balance checksum passes.
7. Run the CBN audit only if the read looks correct or the warning is understood.
8. Export the report and note any unexpected findings.

## If parsing fails

Ask the tester to download the anonymized parser diagnostic from the mapping screen and send only that JSON file. The diagnostic must not contain names, account numbers, narrations, amounts, balances, or raw statement rows.

## Feedback to collect

- Bank name and account type.
- File type used: CSV, XLSX, XLS, or PDF.
- Whether the header row was auto-detected correctly.
- Whether balance checksum passed.
- Number of excluded rows.
- Any charge that looked wrongly classified.
- Browser and device used.
- Whether the tester understood the privacy/no-upload message.

## Go/no-go criteria for public launch

Do not claim “any Nigerian bank” until at least 10+ bank layouts have fixtures or confirmed beta passes. Until then, use: “Supports major Nigerian bank statements, with guided import for other layouts.”
