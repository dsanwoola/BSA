/* =========================================================================
 * CBN RULES KNOWLEDGE BASE
 * -------------------------------------------------------------------------
 * Every permitted bank charge in Nigeria, encoded as data with:
 *   - the maximum permitted amount (or formula)
 *   - the date range in which the rule is/was in force
 *   - the legal citation (CBN Guide to Charges 2020 + later circulars/laws)
 *
 * Primary sources:
 *   [G2020]  CBN "Guide to Charges by Banks, Other Financial and Non-Bank
 *            Financial Institutions", effective 1 January 2020.
 *   [ATM25]  CBN Circular on Review of ATM Transaction Fees,
 *            10 February 2025, effective 1 March 2025.
 *   [EMTL]   Finance Act 2020 + EMTL Regulations (electronic money transfer
 *            levy, ₦50 on electronic receipts of ₦10,000+).
 *   [NTA25]  Nigeria Tax Act 2025 — from 1 Jan 2026 the levy is charged as
 *            Stamp Duty, borne by the SENDER, on transfers of ₦10,000+
 *            (own-account and salary transfers exempt).
 *   [CASHLESS] CBN Cashless Policy circulars (processing fees on large
 *            over-the-counter cash deposits/withdrawals).
 *
 * The engine NEVER guesses: if a charge cannot be matched to a rule with
 * certainty, it is reported as "needs human review", not classified.
 * ========================================================================= */

(function (global) {
  "use strict";

  /** Round to kobo (2dp) to avoid float noise. */
  function r2(n) { return Math.round(n * 100) / 100; }

  /** date helper: 'YYYY-MM-DD' -> Date (local midnight) */
  function d(iso) {
    var p = iso.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  var RULES = {

    metadata: {
      version: "2026.06",
      lastReviewed: "June 2026",
      reviewCadence: "Quarterly, or immediately after any CBN/Nigerian tax circular affecting bank charges",
      sources: [
        "CBN Guide to Charges by Banks, Other Financial and Non-Bank Financial Institutions (effective 1 Jan 2020)",
        "CBN Circular on Review of ATM Transaction Fees (10 Feb 2025; effective 1 Mar 2025)",
        "Finance Act 2020 and EMTL Regulations",
        "Nigeria Tax Act 2025 stamp duty provisions effective 1 Jan 2026",
        "CBN Cashless Policy circulars"
      ]
    },

    /** Earliest date the knowledge base covers. Transactions before this
     *  are sent to human review rather than judged with the wrong rules. */
    coverageStart: d("2020-01-01"),

    /* ---------------- VAT ---------------- */
    /** VAT moved from 5% to 7.5% on 1 Feb 2020 (Finance Act 2019). */
    vatRate: function (date) {
      return date < d("2020-02-01") ? 0.05 : 0.075;
    },

    /* ---------------- Electronic funds transfer (NIP/USSD/mobile) ----- */
    /** [G2020] Transfers: ≤₦5,000 → ₦10; ₦5,001–₦50,000 → ₦25;
     *  >₦50,000 → ₦50. All plus VAT. USSD: "current NIP charges apply". */
    eftFeeFor: function (transferAmount) {
      if (transferAmount <= 5000) return 10;
      if (transferAmount <= 50000) return 25;
      return 50;
    },
    eftMaxFee: 50, // absolute ceiling regardless of transfer size
    eftOwnAccountSameBankFeeAllowed: false,
    eftOwnAccountSameBankCitation: "Operational rule confirmed June 2026 — own-account transfers within the same bank should not attract electronic transfer fees; own-account transfers to another bank remain subject to normal transfer-fee tiers",

    /* ---------------- Levy / stamp duty on transfers ------------------ */
    /** Per-event levy is ₦50 flat in both regimes; what changes is who
     *  pays and which leg triggers it. */
    levy: {
      amount: 50,
      threshold: 10000,
      vatApplies: false,
      regime: function (date) {
        if (date < d("2026-01-01")) {
          return {
            name: "Electronic Money Transfer Levy (EMTL)",
            citation: "Finance Act 2020 & EMTL Regulations — ₦50 on electronic RECEIPTS of ₦10,000 and above",
            trigger: "credit"
          };
        }
        return {
          name: "Stamp Duty on Electronic Transfers",
          citation: "Nigeria Tax Act 2025 (eff. 1 Jan 2026) — ₦50 borne by the SENDER on transfers of ₦10,000 and above; own-account and salary transfers exempt",
          trigger: "debit"
        };
      }
    },

    /* ---------------- Current account maintenance fee ----------------- */
    /** [G2020] Max ₦1 per mille (₦1 per ₦1,000) on customer-induced DEBIT
     *  turnover. CURRENT accounts only — never savings. Transfers to
     *  accounts in the same name are excluded from the turnover. */
    camf: {
      perMille: 1,
      allowedOn: ["current"],
      citation: "CBN Guide to Charges 2020 — 'Current Account Maintenance Fee': negotiable, max ₦1 per mille on customer-induced debit transactions"
    },

    /* ---------------- Cards ---------------- */
    cards: {
      issuanceMax: 1000,          // + VAT (₦1,075 VAT-inclusive) [G2020]
      maintenancePerQuarterMax: 50, // Naira cards, SAVINGS accounts only [G2020]
      maintenanceAllowedOn: ["savings"],
      fxMaintenancePerAnnumUSD: 10,
      citationIssuance: "CBN Guide to Charges 2020 — card issuance/replacement/renewal: one-off ₦1,000 (₦1,075 VAT-inclusive)",
      citationMaint: "CBN Guide to Charges 2020 — Naira card maintenance: max ₦50 per QUARTER, applicable to cards linked to SAVINGS accounts only"
    },

    /* ---------------- ATM ---------------- */
    atm: {
      regime: function (date) {
        if (date < d("2025-03-01")) {
          return {
            era: "pre2025",
            onUs: 0,
            notOnUsFee: 35,
            freeNotOnUsPerMonth: 3,
            citation: "CBN Guide to Charges 2020 — ATM: own-bank withdrawals free; other banks' ATMs ₦35 after the 3rd withdrawal in the same month"
          };
        }
        return {
          era: "post2025",
          onUs: 0,
          onSitePer20k: 100,          // + VAT → ₦107.50
          offSiteMaxPer20k: 600,      // ₦100 + surcharge ≤ ₦500, + VAT → ₦645
          chunk: 20000,
          citation: "CBN Circular on Review of ATM Transaction Fees (10 Feb 2025, eff. 1 Mar 2025) — own-bank ATM free; other banks: ₦100 per ₦20,000 at branch ATMs; off-site ATMs ₦100 + surcharge of max ₦500 per ₦20,000"
        };
      }
    },

    /* ---------------- SMS alerts ---------------- */
    /** [G2020] Mandatory SMS alerts: cost recovery only, and only for
     *  customer-induced transactions. Bank-induced = free. Email = free.
     *  Typical telco cost: ₦4/SMS; raised to ₦6/SMS after the Feb 2025
     *  telecom tariff review. These thresholds are configurable. */
    sms: {
      unitMax: function (date) { return date < d("2025-02-01") ? 4 : 6; },
      citation: "CBN Guide to Charges 2020 — SMS alert (mandatory): cost recovery, customer-induced transactions only; email notification free"
    },

    /* ---------------- Fixed caps (single-event charges) --------------- */
    /** type -> { max (ex-VAT), vat: true/false, perUnit?, citation } */
    fixedCaps: {
      hardware_token: {
        max: 2500, vat: true,
        citation: "CBN Guide to Charges 2020 — hardware token: cost recovery, max ₦2,500"
      },
      bills_payment: {
        max: 500, vat: true,
        citation: "CBN Guide to Charges 2020 — bills payment (incl. e-channels): max ₦500 per beneficiary"
      },
      rtgs: {
        max: 950, vat: true,
        citation: "CBN Guide to Charges 2020 — RTGS transfer: ₦950 plus VAT"
      },
      standing_order: {
        max: 50, vat: true,
        citation: "CBN Guide to Charges 2020 — standing order to other banks: max ₦50 per transaction"
      },
      stopped_cheque: {
        max: 500, vat: true,
        citation: "CBN Guide to Charges 2020 — stop cheque/stop order: ₦500 (₦537.50 VAT-inclusive)"
      },
      counter_cheque: {
        max: 50, vat: true, perUnit: "leaflet",
        citation: "CBN Guide to Charges 2020 — counter-cheque issuance: ₦50 per leaflet"
      },
      statement_request: {
        max: 20, vat: true, perUnit: "page",
        citation: "CBN Guide to Charges 2020 — statement of account: monthly statement free; special/interim request max ₦20 per page"
      },
      bulk_payment: {
        max: 15, vat: true, perUnit: "beneficiary",
        citation: "CBN Guide to Charges 2020 — bulk payments (salaries, dividends etc.): max ₦15 per beneficiary, paid by sender"
      },
      cashback_purchase: {
        max: 100, vat: true, perUnit: "₦20,000", maxDailyWithdrawal: 100000,
        citation: "Uploaded CBN Bank Charges guide — purchase with cash-back: ₦100 per ₦20,000, maximum ₦100,000 daily withdrawal"
      },
      cheque_book_50: {
        max: 1500, vat: true, perUnit: "50-leaf book",
        citation: "Uploaded CBN Bank Charges guide — cheque book 50 leaves: ₦1,500 + VAT"
      },
      cheque_book_100: {
        max: 3000, vat: true, perUnit: "100-leaf book",
        citation: "Uploaded CBN Bank Charges guide — cheque book 100 leaves: ₦3,000 + VAT"
      },
      nonclearing_slip_50: {
        max: 1500, vat: true, perUnit: "50-leaf booklet",
        citation: "Uploaded CBN Bank Charges guide — non-clearing withdrawal slips 50 leaves: ₦1,500 + VAT"
      },
      nonclearing_slip_100: {
        max: 3150, vat: false, perUnit: "100-leaf booklet",
        citation: "Uploaded CBN Bank Charges guide — non-clearing withdrawal slips 100 leaves: ₦3,150 VAT-inclusive"
      }
    },

    /* ---------------- Charges that must be FREE ----------------------- */
    /** Any debit matching these types is an automatic violation. */
    mustBeFree: {
      cot: {
        name: "Commission on Turnover (COT)",
        citation: "COT was phased out completely by the CBN (zero since 2016; replaced by the Current Account Maintenance Fee in the Guide to Charges). Any COT charge is illegal."
      },
      account_closure: {
        name: "Account closure fee",
        citation: "CBN Guide to Charges 2020 — closure of account (savings, current or domiciliary): NO CHARGE"
      },
      account_reactivation: {
        name: "Account reactivation / dormancy fee",
        citation: "CBN Guide to Charges 2020 & CBN Guidelines on Dormant Accounts — reactivation of accounts: NO CHARGE; banks may not levy fees on dormant accounts"
      },
      pin_reset: {
        name: "Card/PIN reissue or reset fee",
        citation: "CBN Guide to Charges 2020 — PIN reissue or reset: NO CHARGE"
      },
      email_alert: {
        name: "Email notification fee",
        citation: "CBN Guide to Charges 2020 — email notification: NO CHARGE"
      },
      otc_cheque_deposit_own: {
        name: "Over-the-counter cheque deposit (own account)",
        citation: "CBN Guide to Charges 2020 — OTC cheque deposit into own account: NO CHARGE"
      },
      letter_of_discharge: {
        name: "Letter of discharge fee",
        citation: "CBN Guide to Charges 2020 — letter of discharge for repaid facilities: NO CHARGE"
      },
      draft_repurchase: {
        name: "Draft repurchase fee",
        citation: "CBN Guide to Charges 2020 — draft repurchase: NO CHARGE"
      },
      bvn_charge: {
        name: "BVN enrolment/verification fee",
        citation: "BVN enrolment and verification is free of charge (CBN/NIBSS directive)"
      },
      savings_maintenance: {
        name: "Maintenance fee on a savings account",
        citation: "CBN Guide to Charges 2020 — account maintenance fees apply to CURRENT accounts only (₦1/mille CAMF). There is no permitted maintenance fee on savings accounts."
      }
    },

    /* ---------------- Cashless-policy cash handling -------------------- */
    cashless: {
      deposit: { individual: { threshold: 500000, rate: 0.02 }, business: { threshold: 3000000, rate: 0.03 } },
      withdrawal: { individual: { threshold: 500000, rate: 0.03 }, business: { threshold: 5000000, rate: 0.05 } },
      /** CBN suspended cash-deposit processing fees: 11 Dec 2023 → 30 Apr 2024,
       *  then re-suspended/extended to 31 Mar 2025 (CBN circulars). */
      depositSuspensions: [
        [d("2023-12-11"), d("2024-04-30")],
        [d("2024-09-27"), d("2025-03-31")]
      ],
      citation: "Uploaded CBN Bank Charges guide / CBN Cashless Policy — OTC cash withdrawals: 3% for individuals above ₦500,000 per week; 5% for corporates above ₦5,000,000 per week. Cash deposits use cashless-policy deposit thresholds where applicable; deposit processing fees were suspended by CBN circulars (Dec 2023–Apr 2024; Sep 2024–Mar 2025)."
    },

    /* ---------------- Cost-recovery / negotiable types ----------------- */
    /** Recognized charges where the Guide sets no fixed naira cap. The
     *  auditor reports them as ADVISORY with the governing rule, never as
     *  compliant, because compliance cannot be proven from the statement. */
    advisoryTypes: {
      cheque_book: { name: "Cheque book fee", citation: "Uploaded CBN Bank Charges guide — cheque books: ₦1,500+VAT for 50 leaves; ₦3,000+VAT for 100 leaves. If leaf count is not stated, the auditor applies the most generous 100-leaf cap." },
      nonclearing_slip: { name: "Non-clearing withdrawal slip booklet", citation: "Uploaded CBN Bank Charges guide — non-clearing withdrawal slips: ₦1,500+VAT for 50 leaves; ₦3,150 VAT-inclusive for 100 leaves." },
      bank_draft: { name: "Bank draft / manager's cheque", citation: "Uploaded CBN Bank Charges guide — drafts: ₦350 for customer current accounts; ₦550 for customer savings accounts; non-customer ₦550 + 0.1% of draft value; draft repurchase is free." },
      returned_unfunded: { name: "Returned cheque / failed direct debit (unfunded account)", citation: "Uploaded CBN Bank Charges guide — failed direct debit due to insufficient funds: 1% of amount or ₦5,000, whichever is higher, drawer only; failed direct debit not due to insufficient funds is free." },
      fx_commission: { name: "Domiciliary account withdrawal commission", citation: "CBN Guide to Charges 2020 — 0.05% of transaction value or $10, whichever is LOWER" },
      swift_charge: { name: "SWIFT / offshore transfer charge", citation: "CBN Guide to Charges 2020 — international transfers: cost recovery + commission as per FX provisions; verify against your bank's published tariff" },
      legal_search: { name: "CAC/legal search, CTC or security perfection fee", citation: "CBN Guide to Charges 2020 — cost recovery only" },
      credit_report: { name: "Credit reference report fee", citation: "CBN Guide to Charges 2020 — cost recovery, applicable to customer-induced reports only" },
      loan_fee: { name: "Loan/credit facility fee", citation: "CBN Guide to Charges 2020 — management fee max 1% of principal (one-off); total lending fees must not exceed 2%; penal rate max 1% flat per month on unpaid amount" },
      pos_merchant: { name: "POS merchant service commission (MSC)", citation: "Uploaded CBN Bank Charges guide — merchant service fees are category/card-scheme based: supermarkets/schools/pharmacies/utilities/airlines 0.5% capped ₦1,000 locally; hotels 1.25%–2% local; travel airline ₦200 flat or 0.5%; restaurants/NGOs/religious orgs 1.25% capped ₦100 on Interswitch; fuel 0.6875%; international cards 3%–5.5% depending category." },
      insurance_premium: { name: "Insurance premium", citation: "CBN Guide to Charges 2020 — exact premium only; customer must be offered a choice of at least 3 insurers" },
      premium_account_forfeiture: { name: "Premium account minimum-balance forfeiture fee", citation: "Uploaded CBN Bank Charges guide — Gold/Platinum premium current account fees may be waived when minimum balances are maintained; if balance falls below minimum, Gold forfeiture fee is ₦2,500/month and Platinum may use ₦1/mille." },
      credit_card_interest: { name: "Credit card interest", citation: "Uploaded CBN Bank Charges guide — credit-card interest: 2.5% per month for naira, 30% per annum." },
      fx_card_maintenance: { name: "Foreign-currency card maintenance", citation: "Uploaded CBN Bank Charges guide — foreign-currency card maintenance: $10 per annum." },
      savings_withdrawal_interest_forfeiture: { name: "Savings excess-withdrawal interest forfeiture", citation: "Uploaded CBN Bank Charges guide — savings interest is generally forfeited for the month from the 5th withdrawal onward; some products forfeit bonus/premium interest after more than one withdrawal in a quarter." },
      fixed_deposit_early_liquidation: { name: "Fixed deposit early-liquidation interest penalty", citation: "Uploaded CBN Bank Charges guide — early liquidation penalty on interest: 0–25% tenor elapsed = 100%; 26–50% = 75%; 51–75% = 50%; 76–90% = 25%; 91–100% = no penalty." },
      bond_guarantee: { name: "Bond / bank guarantee fee", citation: "Uploaded CBN Bank Charges guide — performance bond, advance payment guarantee, and bank guarantee: negotiable, maximum 1% of bond value." },
      treasury_bill_processing: { name: "Treasury bill processing fee", citation: "Uploaded CBN Bank Charges guide — purchase/sale of treasury bills processing fee: ₦100 per form; custodian fee per CBN custodianship guideline; S4 settlement cost recovery." },
      syndicated_lending_fee: { name: "Consortium / syndicated lending fee", citation: "Uploaded CBN Bank Charges guide — agency/underwriting fees negotiable; management fee max 1% of principal; commitment/non-drawing fee max 0.5% of undisbursed amount." }
    },

    /* ---------------- Display names for every charge type -------------- */
    typeNames: {
      eft: "Electronic transfer fee (NIP/USSD/app)",
      eft_vat: "VAT on transfer fee",
      levy: "EMTL / Stamp duty (₦50 levy)",
      camf: "Current account maintenance fee (CAMF)",
      card_issuance: "Card issuance / replacement fee",
      card_maintenance: "Card maintenance fee",
      atm_fee: "ATM withdrawal fee",
      sms_alert: "SMS alert fee",
      vat: "VAT on a bank charge",
      hardware_token: "Hardware token fee",
      bills_payment: "Bills payment fee",
      rtgs: "RTGS transfer fee",
      standing_order: "Standing order fee",
      stopped_cheque: "Stop-cheque order fee",
      counter_cheque: "Counter cheque fee",
      statement_request: "Statement request fee",
      bulk_payment: "Bulk payment fee",
      cashback_purchase: "Cash-back purchase fee",
      cot: "Commission on Turnover (COT)",
      account_closure: "Account closure fee",
      account_reactivation: "Reactivation / dormancy fee",
      pin_reset: "PIN reissue/reset fee",
      email_alert: "Email notification fee",
      bvn_charge: "BVN fee",
      savings_maintenance: "Maintenance fee on savings account",
      cash_deposit_fee: "Cash deposit processing fee",
      cash_withdrawal_fee: "Cash withdrawal processing fee",
      cheque_book: "Cheque book fee",
      nonclearing_slip: "Non-clearing withdrawal slip fee",
      bank_draft: "Bank draft fee",
      returned_unfunded: "Returned cheque / failed debit fee",
      fx_commission: "Domiciliary withdrawal commission",
      swift_charge: "SWIFT / international transfer charge",
      legal_search: "Search / CTC / perfection fee",
      credit_report: "Credit report fee",
      loan_fee: "Loan facility fee",
      pos_merchant: "POS merchant commission",
      premium_account_forfeiture: "Premium account forfeiture fee",
      credit_card_interest: "Credit card interest",
      fx_card_maintenance: "Foreign-currency card maintenance",
      savings_withdrawal_interest_forfeiture: "Savings excess-withdrawal interest forfeiture",
      fixed_deposit_early_liquidation: "Fixed deposit early liquidation penalty",
      bond_guarantee: "Bond / guarantee fee",
      treasury_bill_processing: "Treasury bill processing fee",
      syndicated_lending_fee: "Syndicated lending fee",
      insurance_premium: "Insurance premium",
      otc_cheque_deposit_own: "OTC cheque deposit fee (own account)",
      letter_of_discharge: "Letter of discharge fee",
      draft_repurchase: "Draft repurchase fee",
      suspect_transfer: "Possible customer payment (confirm)",
      unknown_charge: "Unrecognized bank charge"
    },

    r2: r2,
    dateOf: d
  };

  /* UMD-ish export: browser global + Node (for the test suite). */
  if (typeof module !== "undefined" && module.exports) module.exports = RULES;
  else global.CBN_RULES = RULES;

})(typeof window !== "undefined" ? window : globalThis);
