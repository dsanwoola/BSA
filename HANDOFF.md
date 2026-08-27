# Bank Statement Auditor — Handoff

## Payment launch update — 27 August 2026

This update supersedes the older deployment notes below. Build **76** enables
checkout at `https://checkam.ng` with `data-payments-live="true"` after the
approved dashboard webhook cutover. Build 75 was deliberately paused.
Firebase project `bank-statement-auditor` now has `payQuote`, `payVerify`,
`payStatus`, `flwWebhook`, and `flwRouter` deployed in `us-central1` (Node 22).
Analytics was left unchanged. All three `FLW_*` secrets are enabled at version 1.
The existing deny-all Firestore rules were compiled and deployed to the
Standard `(default)` database in `europe-west2`.

The user approved sharing the Neighbours NG Technologies Nigeria Limited
Flutterwave merchant (100819022), while preserving FoodCard notifications.
Checkam's live secret key and webhook hash reuse FoodCard's deployed version 3;
the public key came from the merchant's Live API keys page. No key was rotated.
**The live Flutterwave dashboard webhook was saved with the user's approval**
on 27 August 2026 and verified to persist after a page reload. The original
FoodCard URL (also the rollback destination) is:
`https://europe-west1-foodcard-ng-dev.cloudfunctions.net/handleFlutterwaveWebhook`
The saved shared gateway is:
`https://us-central1-bank-statement-auditor.cloudfunctions.net/flwRouter`
The gateway authenticates the existing hash, handles Checkam references locally,
and forwards other events to that fixed FoodCard endpoint with the original
request bytes, hash, and optional signature. Non-200 downstream responses return
503. FoodCard now depends on the gateway. The EXISTING webhook hash was
re-entered securely when saving; it was not rotated or printed. Existing JSON,
retry, v3 and dashboard-resend preferences were retained. Obtain action-time
confirmation before future changes to this external form.

Build 75 includes these payment fixes:
- Quote creates a random receipt before checkout and stores only its hash.
- Browser saves the receipt before accepting payment and can recover a
  webhook-confirmed payment after a lost callback.
- Verification requires that receipt and its statement fingerprint.
- Concurrent confirmations use a database transaction and do not rotate tokens.
- Retry confirmation verifies the same payment; cancelled checkout reuses its order.
- Temporary webhook verification failures return 503 so Flutterwave can retry.
- Customer enters their own receipt email; no fixed merchant email is supplied.

Hosting now explicitly excludes hidden folder descendants, backend source,
rules, package manifests and deployment logs. The old `**/.*` pattern included
hidden-directory contents in deployment manifests. The corrected release has
24 public files; `.git/HEAD`, `.claude/settings.local.json` and
`functions/payments.js` were verified to return 404. Avoid rolling Hosting back
to old releases containing those folders. Firebase cache files are local only.

Verification: `node tests/run_tests.js` passes **389 tests**, including mocked
backend/browser recovery and webhook forwarding. Live non-financial probes
confirmed: Flutterwave key authenticates; quote is NGN 3,000 with a live public
key and no-store headers; unpaid receipt stays locked; wrong tokens, foreign
origins, unsigned webhooks and anonymous Firestore access are rejected.
One synthetic unpaid order was created; no customer statement was used.
FoodCard and the router both reject bad hashes (401) and accept an authenticated
PENDING transfer probe for a random nonexistent reference (200, no balance or
payment change). An earlier custom healthcheck event returned 401 because the
deployed FoodCard mapper rejects unknown event names, not because of a bad hash.
**No sandbox or live charge has been made; real payment/unlock is unverified.**

Next: have the user perform or explicitly authorize a real payment test and
confirm report unlock plus receipt restoration. Existing build75 browser tabs
must refresh to load build76 and enable the button. Do not describe a real
charge or paid-report unlock as verified until that test has happened.

**For:** Chineye / Hermes
**Date:** 13 June 2026
**Build:** 19 (shown in the app header as `build 19`; bump `APP_BUILD` in `js/app.js` **and** the `?v=N` query strings in `index.html` together on every change — stale browser cache has bitten us before)

---

## 1. Project root
```
C:\Users\Deen\Downloads\ClaudeProjects\Bank Charge Auditor
```
(POSIX form, for git-bash: `/c/Users/Deen/Downloads/ClaudeProjects/Bank Charge Auditor`)

## 2. GitHub
- **Repo:** https://github.com/dsanwoola/BSA
- **Remote:** `origin` → `https://github.com/dsanwoola/BSA.git`
- **Current branch:** `main`
- **Auth:** pushes work via Windows Credential Manager on the current machine (the `gh` CLI is **not** logged in). A new maintainer must set up their own GitHub auth (`gh auth login` or a credential helper) before they can push.
- **Auto-sync:** a Claude Code **Stop hook** in `.claude/settings.local.json` runs `node sync-to-github.js` (async) after each session, committing and pushing any changes. That file is git-ignored (machine-specific), so it is **not** in the repo — a new maintainer won't inherit the hook and should re-create it if wanted. Manual sync any time: `node sync-to-github.js`.

## 2.5. Firebase (configured but not integrated)
- **Firebase Project ID:** `bank-statement-auditor`
- **Hosting:** configured in `firebase.json` (public root: `.`) but **NOT DEPLOYED**. Hosting config includes no-cache headers for HTML and long-lived cache for JS/CSS, matching the app's versioning strategy.
- **Cloud Functions:** `functions/index.js` exports an `analytics` Cloud Function that tracks user events (app_load, audit_completed, file_read_error, export_csv, etc.) to Firestore collections (`analytics/summary`, `analytics_daily/`, `analytics_hourly/`). CORS-whitelisted for bank-statement-auditor.web.app, firebaseapp.com, and localhost:8765.
- **Integration status:** The analytics function is **configured but NOT integrated into the app code** — there are no Firebase SDK imports in `js/`, and the function endpoint is not called anywhere. If you want to enable analytics, you must:
  1. Deploy with `npx firebase deploy --only hosting,functions`
  2. Wire the function endpoint into `js/app.js` (would require HTTPS-only and is currently **opt-out** for privacy)
  3. Update `.firebaserc` to use the correct project ID if deploying to a different project
- **Data:** no private data in Firestore; this is read-only usage telemetry (only event names and bucketed metrics like refund amount ranges).

## 3. Tech stack
- **Pure client-side web app** — no backend, no build step, no framework. Plain HTML + CSS + ES5-style vanilla JavaScript (UMD modules that run in both the browser and Node for tests).
- **Vendored libraries** (committed in `vendor/`, so the app runs fully offline):
  - `xlsx.full.min.js` (SheetJS) — Excel parsing
  - `pdf.min.js` + `pdf.worker.min.js` (Mozilla pdf.js) — PDF text extraction
- **Tests:** run on **Node.js** (no test framework — a self-contained assertion script).
- **Local dev server:** Python 3 (`serve.py`, standard library only).

## 4. Run command
The app is static — it can be opened directly, but a server is recommended (the demo + fixture loading and no-cache behaviour rely on it):
```
python serve.py            # serves http://localhost:8765 with caching disabled
```
Then open http://localhost:8765 . Alternatively, double-click `index.html` (works offline; no page-count cache control).

## 5. Test command
```
node tests/run_tests.js
```
- **Location:** `tests/run_tests.js` (single file).
- **Current result:** **194 tests, all passing.**
- Covers: amount/date parsing, CSV quoting, column detection, the narration classifier, every CBN charge family, VAT pairing, the EMTL→stamp-duty 2026 switch, ATM/CAMF/levy cross-checks, PDF table reconstruction (header-anchored columns, wrapped dates, page-break dedupe, balance-chain repair), and the customer-payment-vs-bank-fee disambiguation.
- **Real-bank fixtures:** if `reference/fixtures/*.json` are present locally, the suite additionally runs full real-statement regressions (100% balance chain + all checksums required). These fixtures are **git-ignored** (they contain real transaction data) — they will NOT exist on a fresh clone, and the suite skips them gracefully (still 100% of the committed tests pass). See §7.

## 6. Deployment status
- **Not yet deployed to production.** No production hosting is set up.
- `serve.py` (no-cache) and the manual `?v=N` cache-busting are **dev-only**.
- **Hosting options:**
  1. **Firebase Hosting** (ready to deploy): `firebase.json` is configured, just run `npx firebase deploy --only hosting`. Serves at `https://bank-statement-auditor.web.app`. (Cloud Functions are also configured but optional; see §2.5.)
  2. **GitHub Pages, Netlify, or Cloudflare Pages** (free static hosts): `vendor/` is committed so no install/build is needed. For GitHub Pages, verify the relative worker path `vendor/pdf.worker.min.js` resolves at `/BSA/` (subpath).
- **Pre-deploy checks:** (a) confirm the relative worker path `vendor/pdf.worker.min.js` resolves when served from a subpath; (b) serve over HTTPS; (c) test a large PDF on mobile; (d) if using Firebase Hosting, decide whether to enable the analytics Cloud Function (currently wired only to config, not app code).

## 7. Current known blockers / risks
1. **Production deployment not done** (see §6) — the only hard blocker to a public URL.
2. **Parser validated against 3 banks only** — Fidelity (corporate), GTBank/“GTW”, and OPay. Other banks/fintechs (Access, Zenith, UBA, First Bank, Kuda, Moniepoint, PalmPay…) are untested layouts. The app degrades **safely** (guided mapping step + checksum warnings rather than silent misreads), but “works with any bank” is aspirational. The fixture system (`reference/fixtures/`) is built to absorb new layouts during a beta.
3. **CBN rules are hardcoded with dates** in `js/rules.js`. Accuracy depends on keeping them current; some entries are review-sensitive assumptions (SMS ₦4→₦6, cashless-fee suspension windows, the 1 Jan 2026 stamp-duty switch). Needs a periodic review process and an in-app “rules last reviewed” date.
4. **No telemetry by design** (privacy) → you are blind to in-the-wild parser failures. Consider an *opt-in*, amounts-free “share the layout that failed” feature.
5. **Accessibility / browser support** are partial: CSS `:has()` (cosmetic) needs Chrome 105+/Safari 15.4+; keyboard activation of the dropzone, modal focus-trapping, and contrast need a pass before claiming full a11y (relevant for government/corporate buyers).
6. **Performance ceiling:** parse + audit run on the main thread (a scanning overlay covers the ~5s on a 4,000-txn statement). Very large statements (10k+ txns) would benefit from moving work to a Web Worker.

(Full detail in the launch-readiness review delivered separately.)

## 8. Key files

### Parser — `js/parser.js`
File reading (CSV/Excel/PDF), header-anchored PDF column reconstruction, date/amount parsing, hero-section metadata mining, balance-chain repair & page-break dedupe, and the statement-totals/transaction-count checksums. Largest and most intricate file; most bank-specific quirks live here.

### Rules (CBN knowledge base) — `js/rules.js`
**Single source of truth for every CBN charge cap, threshold, date, and legal citation.** Update this one file when CBN issues a new circular. Paired with `js/patterns.js` (narration → charge-type classifier).

### Audit engine — `js/engine.js`
Deterministic, date-aware evaluation of each charge against the rules; the four-verdict system (violation / compliant / review / advisory); the aggregate cross-checks (CAMF recompute, levy count, ATM monthly allowance, quarterly card fee); and customer-payment-vs-bank-fee disambiguation. **Never guesses** — anything uncertain → “review”.

### Report generation — `js/report.js`
Renders the dashboard, findings, and cross-checks; CSV export; the printable report; and the pre-filled CBN-citing **refund demand letter**. All user/statement text is HTML-escaped here via `esc()` (XSS-safe).

### UI controller — `js/app.js`
4-step flow (account context → upload → verify-the-read mapping → report), the scanning overlay, the header-row picker, manual reclassification, and the `APP_BUILD` constant.

### Tests — `tests/run_tests.js`
See §5.

### Reference (not code) — `reference/`
`stanbic_2025_pricing_guide.pdf` + `.txt`: a public bank tariff published “in line with the CBN Guide”, used to cross-verify the caps in `rules.js`. (Real user statements and fixtures here are git-ignored.)

## 9. Secrets / private data in the repo
**None.** Verified against the tracked file list and the remote:
- No real bank statements — `reference/user_statement*.pdf` are git-ignored.
- No test fixtures with real data — `reference/fixtures/` is git-ignored.
- No `.env`, API keys, tokens, credentials, or private keys.
- No `settings.local.json` (git-ignored; contains only the local auto-sync hook).
- **No statement content ever leaves the browser.** The app does make network calls, and this is what each one carries:
  - `js/analytics.js` → `/api/analytics`: aggregate counters and bucketed metrics only (no narrations, balances, names or account numbers).
  - `js/paywall.js` → `/api/pay/*`: the account holder type, the statement's **date range**, and a SHA-256 **fingerprint** of `period-from|period-to|txn-count`. The fingerprint is non-reversible and carries no statement content; it exists so one payment unlocks one statement.
  - `checkout.flutterwave.com/v3.js` is loaded **only when the user clicks to pay**, never while a statement is being parsed.
  Statements themselves are parsed and audited entirely in the browser.
- The only bundled statement is the **synthetic demo** (`samples/sample_statement.csv` — “CHIOMA OBI / FIRST DEMO BANK”, fabricated).
- **Firestore:** `firestore.rules` now denies **all** client reads and writes. Every legitimate access goes through Cloud Functions on the Admin SDK, which bypasses rules. This matters most for the `orders` collection, which holds payment unlock tokens. Deploy the rules with `firebase deploy --only firestore:rules`.

To re-verify at any time:
```
git ls-files | grep -iE "user_statement|fixtures|\.env|secret|settings.local"   # expect: no output
git ls-tree -r --name-only origin/main | grep -iE "user_statement|fixtures"      # expect: no output
```

## 10. Payments — Flutterwave paywall

The audit is free; the **report that proves it** is paid. After an audit runs,
the reader sees the integrity verdict, the summary cards (including the refund
figure) and a breakdown of *what kinds* of charge were flagged. Everything
else — per-charge dates, narrations, arithmetic, CBN citations, the transaction
ledger, the demand letter, CSV export and print — is behind the paywall.

### Price

| Statement holder | Per 6-month block |
|---|---|
| Individual | ₦3,000 |
| Business / Government | ₦5,000 |

A "6-month block" is **183 days**, not six calendar months. This matters: a
statement running 5 Jan – 1 Jul touches seven calendar months but is under six
months long, and bills as one block. Statements longer than a block bill one
unit per block started (a 12-month individual statement is 2 × ₦3,000).

Prices and the block rule live in one place — `js/pricing.js`, copied verbatim
to `functions/pricing.js`. **Edit both, or the test suite fails.** That guard
exists because a client that quotes one price while the server charges another
is a bug that only shows up on a real customer's card.

### How it is enforced

1. `POST /api/pay/quote` — the browser sends the holder type, the statement's
   date range, and a statement fingerprint. **The server computes the price**;
   the client never states an amount. It opens a pending order and returns a
   `tx_ref`, the amount, and the Flutterwave public key.
2. The browser runs `FlutterwaveCheckout()` with that `tx_ref` and amount.
3. `POST /api/pay/verify` — the server calls Flutterwave's verify endpoint with
   the **secret** key and unlocks only if `status`, `tx_ref`, `currency` and
   `amount` all match the order it opened. It then issues a random unlock token
   (stored hashed, so a leaked backup cannot be replayed).
4. `POST /api/pay/webhook` — the same fulfilment path, driven by Flutterwave and
   authenticated by the `verif-hash` header, so a customer who closes the tab
   mid-payment still gets what they paid for. Fulfilment is idempotent.
5. `POST /api/pay/status` — exchanges a stored receipt for the unlock on a later
   visit. An unlock is **bound to the statement it was bought for**: presenting a
   valid receipt against a different statement does not unlock it.

Locked report sections are **not rendered into the page at all** while locked —
they are not rendered-then-hidden, because CSS hiding would put the whole
report one DevTools click away.

Flutterwave's `checkout.flutterwave.com/v3.js` is **lazy-loaded on click**, never
with the page, so third-party JS is not present in the document while a bank
statement is being parsed.

### Known limit — read this before promising anything

The audit runs on the reader's own machine, because their statement never
leaves it. A developer can therefore still reach the findings by calling the
engine from the browser console. Closing that hole completely would mean
uploading statements to a server, which is the one thing this product promises
never to do. **The gate is built to make paying the easy path and to stop casual
sharing — not to defeat someone willing to reverse-engineer it.** The same
tradeoff is recorded in `LAUNCH_MONETIZATION.md`.

Relatedly, the statement's date range is supplied by the client, so a modified
client could under-declare the period to buy fewer blocks. The floor is still
one block, so the worst case is an underpayment, never a free report.

### Configuration — required before payments work

Nothing ships with keys. Set all three in Secret Manager, then deploy:

```bash
firebase functions:secrets:set FLW_PUBLIC_KEY
firebase functions:secrets:set FLW_SECRET_KEY
firebase functions:secrets:set FLW_WEBHOOK_HASH
```

`FLW_WEBHOOK_HASH` must match the secret hash set on the Flutterwave dashboard
under **Settings → Webhooks**, where the webhook URL is:

```
https://checkam.ng/api/pay/webhook
```

Until `FLW_PUBLIC_KEY` is set, `/api/pay/quote` returns `503
payments_unconfigured` and the unlock button shows "Payments are not switched
on yet." **Do not deploy the paywall to production before the keys are set** —
every report would be locked with no way to pay.

Test with Flutterwave's sandbox keys first; the same code path serves both.

### Firestore

`firestore.rules` denies all client access. Every read and write goes through
Cloud Functions on the Admin SDK, which bypasses rules. The `orders` collection
holds unlock tokens — a client able to read it could unlock every report ever
bought, so it must never be exposed, not even for reads.

Deploy rules with:

```bash
firebase deploy --only firestore:rules
```

