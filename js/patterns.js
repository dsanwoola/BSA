/* =========================================================================
 * NARRATION CLASSIFIER
 * -------------------------------------------------------------------------
 * Maps a statement narration to a charge type — or to nothing at all.
 * Order matters: the FIRST matching pattern wins, so the most specific
 * patterns come first (e.g. "CARD MAINTENANCE" before "MAINTENANCE",
 * "VAT" before the fee it sits on).
 *
 * Design principle (no guessing):
 *   - A transaction is only typed when a strong pattern matches.
 *   - Debits that merely *smell* like a charge (generic FEE/CHARGE/
 *     COMMISSION words) become "unknown_charge" -> human review.
 *   - Everything else is treated as ordinary spending and left alone,
 *     but remains visible in the "All transactions" tab where the user
 *     can manually reclassify anything we missed.
 * ========================================================================= */

(function (global) {
  "use strict";

  function norm(s) {
    return String(s || "")
      .toUpperCase()
      .replace(/[_*]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Ordered: first match wins. */
  var CHARGE_PATTERNS = [
    // --- taxes & levies (match before the fees they ride on) -------------
    { type: "vat",  re: /\bVAT\b|VALUE ADDED TAX/ },
    { type: "levy", re: /STAMP\s*DUTY|\bEMTL\b|\bE\.?M\.?T\.?L\b|ELECTRONIC MONEY TRANSFER LEVY|\bEMT\s*LEVY\b/ },

    // --- prohibited / must-be-free ---------------------------------------
    { type: "cot", re: /\bCOT\b|COMMISSION ON TURNOVER/ },
    { type: "account_reactivation", re: /REACTIVAT|DORMANC?Y/ },
    { type: "account_closure", re: /(ACCOUNT|ACCT|A\/C).{0,12}(CLOSURE|CLOSING)|CLOSURE (FEE|CHARGE)/ },
    { type: "pin_reset", re: /\bPIN\b.{0,15}(RE-?ISSUE|RESET|CHANGE|RE-?SET)/ },
    { type: "email_alert", re: /E-?MAIL.{0,12}(ALERT|NOTIF)/ },
    { type: "bvn_charge", re: /\bBVN\b.{0,15}(FEE|CHARGE|ENROL)/ },
    { type: "letter_of_discharge", re: /LETTER OF DISCHARGE/ },
    { type: "draft_repurchase", re: /DRAFT REPURCHASE/ },

    { type: "credit_card_interest", re: /CREDIT CARD.{0,18}(INTEREST|FINANCE CHARGE)|CARD INTEREST/ },

    // --- cards ------------------------------------------------------------
    { type: "card_maintenance", re: /(CARD|CRD)\s*MAINT|NAIRA CARD.{0,12}MAINT|QUARTERLY CARD|MAINT.{0,6}(FEE)?.{0,10}(MASTER|VISA|VERVE)|(MASTER|VISA|VERVE).{0,15}MAINT/ },
    { type: "card_issuance", re: /(CARD|CRD).{0,12}(ISSUANCE|ISSUE|ISSUING|REQUEST|REPLACEMENT|RENEWAL|PRODUCTION|COLLECTION)|(DEBIT|ATM|MASTER|VISA|VERVE)\s*CARD\s*(FEE|CHARGE)/ },

    // --- account maintenance (after card patterns) -------------------------
    { type: "camf", re: /ACCOUNT MAINTENANCE|ACCT?\.?\s*MAINT|A\/C\s*MAINT|\bCAMF?\b|CURRENT ACC.{0,12}MAINT|MAINTENANCE (FEE|CHARGE|CHG)/ },

    // --- alerts -------------------------------------------------------------
    { type: "sms_alert", re: /\bSMS\b|SMSALERT|GSM ALERT|E-?ALERT|ALERT\s*(FEE|CHARGE|CHG|COMM)|TRANSACTION ALERT|MOBILE ALERT|NOTIFICATION (FEE|CHARGE)/ },

    // --- ATM ---------------------------------------------------------------
    { type: "atm_fee", re: /ATM.{0,25}(FEE|CHARGE|CHG|SURCHARGE|COMM)|REMOTE.?ON.?US|NOT.?ON.?US|ATM DECLINE|INTERSWITCH.{0,12}(FEE|CHARGE)|ATM WD (FEE|CHG)/ },

    // --- cash handling (cashless policy) -------------------------------------
    { type: "cash_deposit_fee", re: /CASH DEPOSIT.{0,15}(FEE|CHARGE|CHG|PROCESSING)|PROCESSING FEE.{0,12}(CASH|DEPOSIT)|CASH HANDLING/ },
    { type: "cash_withdrawal_fee", re: /CASH WITHDRAWAL.{0,15}(FEE|CHARGE|CHG|PROCESSING)|PROCESSING FEE.{0,12}WITHDRAWAL/ },

    // --- USSD session fees (must precede "eft": plain "USSD ... FEE" with
    //     SESSION wording is a telco session pass-through, not a transfer fee;
    //     under End-User Billing (mid-2025) banks must not debit these at all)
    { type: "ussd_session_fee", re: /USSD\s*.{0,20}SESSION.{0,12}(FEE|CHARGE|CHG)|SESSION\s*(FEE|CHARGE|CHG).{0,20}USSD|USSD\s*(MAINTENANCE|ACCESS)\s*(FEE|CHARGE|CHG)/ },

    // --- transfers -----------------------------------------------------------
    { type: "rtgs", re: /RTGS.{0,15}(FEE|CHARGE|CHG|COMM)/ },
    { type: "bulk_payment", re: /(BULK|SALARY|DIVIDEND).{0,12}(PAYMENT|TRANSFER|UPLOAD).{0,12}(FEE|CHARGE|CHG|COMM)/ },
    { type: "eft", re: /(NIP|NEFT|\bTRF\b|TRANSFER|\bFT\b|E-?CHANNELS?|USSD|MOBILE|\bAPP\b|QUICKTELLER|ELECTRONIC FUNDS? TRANSFER|\bEFT\b)\s*.{0,25}(FEE|FEES|CHARGE|CHARGES|\bCHG\b|COMMISSION|\bCOMM\b)|TRANSFER LEVY|\bNIP\s*CHG\b|^\W*(CHARGE|CHG)S?\W{0,3}(FT|NIP|TRF|TRANSFER|EFT|CIB|GTL|MOB|UTO)\b/ },

    // --- cheques ---------------------------------------------------------------
    { type: "stopped_cheque", re: /STOP\s*(CHEQUE|CHECK|ORDER|PAYMENT)/ },
    { type: "counter_cheque", re: /COUNTER\s*CHEQUE/ },
    { type: "nonclearing_slip", re: /NON[-\s]?CLEARING.{0,20}(WITHDRAWAL\s*)?SLIP|WITHDRAWAL\s*SLIP/ },
    { type: "cheque_book", re: /(CHEQUE|CHQ|CHECK)\s*BOOK/ },
    { type: "returned_unfunded", re: /RETURNED?\s*(CHEQUE|CHECK|ITEM)|DISHONOU?RED|UNPAID\s*(CHEQUE|ITEM)|FAILED DIRECT DEBIT/ },
    { type: "bank_draft", re: /(BANK\s*)?DRAFT.{0,15}(FEE|CHARGE|COMM)|MANAGER'?S CHEQUE.{0,15}(FEE|CHARGE|COMM)/ },

    // --- digital banking ----------------------------------------------------------
    { type: "hardware_token", re: /HARD(WARE)?\s*TOKEN|TOKEN.{0,15}(FEE|CHARGE|COST|ISSU|REPLACE)/ },
    { type: "bills_payment", re: /BILL(S)?\s*PAYMENT.{0,15}(FEE|CHARGE|CHG|COMM)|BILLER (FEE|CHARGE)/ },
    { type: "cashback_purchase", re: /CASH\s*-?\s*BACK.{0,15}(FEE|CHARGE|CHG)/ },
    { type: "standing_order", re: /STANDING ORDER.{0,15}(FEE|CHARGE|CHG|COMM)|\bSO\b CHARGE/ },
    { type: "statement_request", re: /STATEMENT.{0,15}(REQUEST|FEE|CHARGE|CHG)|INTERIM STATEMENT/ },

    // --- credit & other -------------------------------------------------------------
    { type: "loan_fee", re: /(LOAN|FACILITY|CREDIT).{0,18}(MANAGEMENT|COMMITMENT|RESTRUCTUR|PROCESSING|RENEWAL)?\s*(FEE|CHARGE)|(MANAGEMENT|COMMITMENT|RESTRUCTURING) FEE/ },
    { type: "credit_card_interest", re: /CREDIT CARD.{0,18}(INTEREST|FINANCE CHARGE)|CARD INTEREST/ },
    { type: "fx_card_maintenance", re: /(FOREIGN|FX|DOLLAR|USD).{0,18}CARD.{0,18}MAINT/ },
    { type: "premium_account_forfeiture", re: /(GOLD|PLATINUM|PREMIUM).{0,18}(FORFEIT|MINIMUM BALANCE|MAINTENANCE)/ },
    { type: "savings_withdrawal_interest_forfeiture", re: /SAVINGS?.{0,25}(INTEREST FORFEIT|FORFEITURE)|EXCESS WITHDRAWAL.{0,18}INTEREST/ },
    { type: "fixed_deposit_early_liquidation", re: /(FIXED|TERM) DEPOSIT.{0,25}(EARLY|LIQUIDAT|BREAK|PENALTY)|EARLY LIQUIDATION/ },
    { type: "bond_guarantee", re: /(PERFORMANCE BOND|ADVANCE PAYMENT GUARANTEE|BANK GUARANTEE).{0,20}(FEE|CHARGE|COMM|COMMISSION)?/ },
    { type: "treasury_bill_processing", re: /(TREASURY BILL|T\s*-?\s*BILL).{0,25}(PROCESSING|FORM|FEE|CHARGE)|\bS4\b.{0,15}(SETTLEMENT|FEE|CHARGE)/ },
    { type: "syndicated_lending_fee", re: /(SYNDICATED|CONSORTIUM).{0,25}(LOAN|LENDING|AGENCY|MANAGEMENT|COMMITMENT|UNDERWRITING).{0,20}(FEE|CHARGE|COMM)?/ },
    { type: "credit_report", re: /CREDIT (BUREAU|REPORT|REFERENCE|CHECK).{0,12}(FEE|CHARGE)?/ },
    { type: "legal_search", re: /SEARCH (FEE|REPORT|CHARGE)|\bCAC\b.{0,12}(SEARCH|FEE)|\bCTC\b|PERFECTION (FEE|CHARGE)/ },
    { type: "pos_merchant", re: /\bMSC\b|MERCHANT.{0,12}(SERVICE)?.{0,6}COMM|POS.{0,10}COMM/ },
    { type: "insurance_premium", re: /INSURANCE PREMIUM/ },
    { type: "fx_commission", re: /(\bDOM\b|DOMICILIARY).{0,18}(COMM|CHARGE|FEE)|\bFX\b.{0,10}(COMM|CHARGE|FEE)|FOREIGN EXCHANGE.{0,12}(COMM|CHARGE)/ },
    { type: "swift_charge", re: /SWIFT|OFFSHORE.{0,10}(CHARGE|FEE)|CORRESPONDENT BANK|TELEX/ }
  ];

  /* Generic fee words — used only as a LAST-RESORT signal that an
   * unclassified debit is probably a bank charge that needs review.
   * Word boundaries keep merchant names (COFFEE, CHARGERS LTD) out. */
  var GENERIC_FEE = /\b(FEE|FEES|CHARGE|CHARGES|CHG|COMMISSION|COMM|LEVY|DUTY|SURCHARGE|PENALTY|TARIFF)\b/;

  /* Markers used for context linking, NOT charge detection. */
  var CONTEXT = {
    /** A debit that *is* an outgoing transfer (not the fee on one). */
    transferDebit: /\b(NIP|TRF|TRANSFER|NEFT|RTGS|FT|MOB TRF|USSD TRF|TO)\b/,
    /** A debit that is an ATM cash withdrawal. */
    atmWithdrawal: /\bATM\b|CASH\s*W(ITHDRAWA)?L|ATM WD|\bCWDL\b/,
    /** A credit that looks like an electronic receipt (EMTL trigger). */
    electronicCredit: /\b(NIP|TRF|TRANSFER|NEFT|RTGS|FT|MOB|USSD|FRM|FROM)\b/
  };

  function classify(narration) {
    var n = norm(narration);
    if (!n) return null;
    for (var i = 0; i < CHARGE_PATTERNS.length; i++) {
      var p = CHARGE_PATTERNS[i];
      if (p.re.test(n)) return { type: p.type, matched: p.re.source };
    }
    if (GENERIC_FEE.test(n)) return { type: "unknown_charge", matched: "generic fee keyword" };
    return null;
  }

  var API = { classify: classify, norm: norm, CONTEXT: CONTEXT, CHARGE_PATTERNS: CHARGE_PATTERNS, GENERIC_FEE: GENERIC_FEE };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_PATTERNS = API;

})(typeof window !== "undefined" ? window : globalThis);
