# Bank Statement Auditor — Handoff

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
- **Not yet deployed.** No production hosting is set up.
- `serve.py` (no-cache) and the manual `?v=N` cache-busting are **dev-only**.
- **Recommended:** any static host — GitHub Pages, Netlify, or Cloudflare Pages (all free). `vendor/` is committed so no install/build is needed.
- **Pre-deploy checks:** (a) confirm the relative worker path `vendor/pdf.worker.min.js` resolves when served from a subpath (GitHub Pages serves at `/BSA/`); (b) serve over HTTPS; (c) test a large PDF on mobile.

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
- The app makes **zero network requests with user data** (verified: no `fetch`/`XHR`/CDN calls in `js/`). Statements are processed entirely in the browser.
- The only bundled statement is the **synthetic demo** (`samples/sample_statement.csv` — “CHIOMA OBI / FIRST DEMO BANK”, fabricated).

To re-verify at any time:
```
git ls-files | grep -iE "user_statement|fixtures|\.env|secret|settings.local"   # expect: no output
git ls-tree -r --name-only origin/main | grep -iE "user_statement|fixtures"      # expect: no output
```
