# Bank Charge Auditor — Launch & Monetization Playbook

*Written 2026-07-06. Grounded in what the app already is: a 100% client-side
auditor (no backend, no uploads) with 304 passing tests, CBN rules current
through the Guide to Charges 2026 (eff. 1 May 2026), a working demo, Firebase
Hosting + Cloudflare Pages deploy workflows, and a fully built (currently
disabled) SME premium dashboard.*

---

## 1. SaaS or native app? → **Web app (PWA) with SaaS-style billing. Not native — yet.**

| Factor | Web/PWA | Native (Play Store/App Store) |
|---|---|---|
| CBN rules change quarterly | Update is live the moment you deploy | Review queue + users on stale versions **auditing with dead rules** |
| Privacy promise ("never uploaded") | Same client-side code, provable in DevTools | Same possible, but store-app permissions invite more suspicion |
| Distribution cost | Share a link on WhatsApp — zero install | Play Store finance-app review is slow and strict for anything touching bank data |
| Nigerian device reality | Low-storage Androids: PWA installs in <1 MB | 20–60 MB APK competes with photos for space |
| Payments | Paystack/Flutterwave web checkout, no 15–30% store tax | Google/Apple take 15–30% of in-app payments |
| Offline | Already works offline (all parsing is local); add a service worker to formalize it | Native's main advantage — matched by PWA here |

**Verdict:** the product's moat is *trust* ("your statement never leaves your
device") and *freshness* (rules that track CBN circulars). Both favor the web.
Ship the PWA, take payments through Paystack (no store tax), and only wrap it
as a **TWA (Trusted Web Activity)** for Play Store presence once organic
traffic proves demand — a TWA is the same web app in a thin wrapper, so you
keep one codebase.

Note on the word "SaaS": this is not classic SaaS (there is no server doing
the work — by design). It is a **hosted client-side product with SaaS-style
billing**. That's a selling point, not a compromise: "we *can't* see your
statement" beats "we promise not to look."

---

## 2. Monetization — three tiers, pay-per-use first

Nigerian consumers resist small subscriptions but happily pay one-off fees
for concrete value. The audit produces a number ("₦X refund you can claim")
— price against that number.

### Tier 0 — Free (the hook)
- Full audit, violation count, and total refund figure visible.
- Demo statement, balance integrity check, all parsing.
- **Why free:** the refund figure is the marketing. Screenshots of
  "₦23,450 refund found" are the growth loop.

### Tier 1 — Pay-per-report: **₦1,000–₦2,500 one-off** (start at ₦1,500)
Unlocks per audited statement:
- The **demand letter** (already built) addressed to the bank, with CBN
  citations and the CPD escalation path (cpd@cbn.gov.ng).
- CSV/print export of the full report.
- Pricing logic: a typical active account loses ₦5k–₦50k/year to wrongful
  charges; ₦1,500 against a documented refund claim is an easy yes. Gate by
  license key or Paystack payment reference — no accounts needed at first.

### Tier 2 — SME Premium: **₦10,000–₦15,000/month** (the real business)
The four SME phases already exist in the codebase (dashboard, reconciliation,
cashflow intelligence, funding readiness, monthly report exports) — currently
disabled. Re-enable behind payment:
- Multi-statement/monthly reconciliation, recurring audit, exportable
  monthly reports (accountant-ready), WhatsApp summary.
- Target: SMEs, accountants, and bookkeepers who audit *many* accounts —
  one accountant with 20 clients is worth 20 consumers.

### Later (only after traction)
- **B2B/API licensing** to accounting software, PFM apps, or law firms
  running charge-recovery practices (they take 10–30% of refunds recovered;
  your tool is their factory).
- **Affiliate**: refer disputed-refund cases to partner law firms for a fee.
- Do **not** run ads — they poison the trust positioning.

---

## 3. Launch checklist (2 weeks, in order)

### Week 1 — Ship
1. **Domain + deploy**: pick a name (e.g. `bankchargeauditor.ng` or a
   brandable `.com`); wire it to the existing Cloudflare Pages workflow
   (already in `.github/workflows/cloudflare-pages.yml`). Cloudflare's free
   tier handles this traffic indefinitely at ₦0.
2. **PWA polish**: add `manifest.json` + service worker so "Add to Home
   Screen" works and the app opens offline. (~1 day of work; the app is
   already offline-capable in logic.)
3. **Paystack integration** for Tier 1: static checkout link → payment
   reference → unlock export. No backend needed for v1 (Paystack inline JS +
   client-side verification is acceptable to start; move verification to a
   Cloudflare Worker when volume justifies it).
4. **Analytics that respect the privacy promise**: Cloudflare Web Analytics
   (no cookies, no PII) — never anything that could see statement data.
5. **Legal one-pager**: not-legal-advice disclaimer (exists), NDPR statement
   (trivial: no data collected), terms for paid exports.

### Week 2 — Tell people
6. **Seed content**: one viral-format piece — "I ran my GTBank statement
   through a CBN rule checker and found ₦18,000 in illegal charges" — with
   screenshots, posted to X/Twitter (NaijaTech/personal-finance), Nairaland
   (Investment board), and LinkedIn.
7. **WhatsApp-first sharing**: add a "Share your refund figure" button that
   generates a share card (number only, no statement data). WhatsApp is
   Nigeria's real distribution network.
8. **SEO base**: publish the CBN rule tables (from `js/rules.js` citations)
   as static pages — "CBN approved bank charges 2026" searches are heavy and
   fresh since the May 2026 guide changed everything. You have the most
   current machine-readable rule set in the country; publish it.
9. **10 beta users → 10 testimonials**: use `BETA_TESTING.md` flow; convert
   the private beta into public launch quotes.
10. **Accountant outreach**: 20 DMs to accountants/bookkeepers offering free
    SME-tier trials — they become Tier 2's first cohort.

### KPIs (first 90 days)
- Audits run/week (free tier) — target 100/wk by day 30.
- Free → paid conversion on statements with violations found — target 5–10%.
- Average refund figure surfaced (marketing ammo).
- SME trials → paid — target 3 paying SMEs by day 90 (₦30–45k MRR floor).

---

## 4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| CBN issues a new circular; rules go stale | Rules are data in `js/rules.js` with a quarterly review cadence baked into metadata; web deploy = instant fix. This is the #1 operational duty. |
| A bank disputes the app's findings publicly | Every finding carries its arithmetic + citation; the "never guesses" policy and balance-integrity gate are the defense. Lean into it. |
| Parser fails on an unsupported bank layout | Guided import + anonymized diagnostics flow already exists; each new fixture becomes a moat (15+ bank layouts already covered — that took real work to build and is hard to copy). |
| Payment unlock bypassed (client-side gating) | Accept it at v1 scale; the paying customer is buying the letter + legitimacy, not the bits. Move to Worker-verified unlocks with volume. |
| Play Store rejection later (finance category) | TWA wraps the proven web app; by then you'll have traction data for the review. |

---

## 5. The one-sentence strategy

**Give away the audit, sell the ammunition (demand letter + exports), and
grow through the refund-figure screenshot loop — all on the web, where rule
updates ship the day CBN publishes them.**
