/* =========================================================================
 * AUDIT ENGINE
 * -------------------------------------------------------------------------
 * Deterministic, date-aware evaluation of every detected bank charge
 * against the CBN rules knowledge base (rules.js).
 *
 * Verdicts:
 *   violation  – provably above the CBN cap, or a charge that must be free.
 *                Carries a refund amount and the supporting arithmetic.
 *   compliant  – provably within the cap in force on that date.
 *   review     – the auditor cannot decide from the statement alone.
 *                IT NEVER GUESSES: unrecognized or ambiguous charges land
 *                here with an explanation of what to check.
 *   advisory   – recognized charge whose cap is "cost recovery" or
 *                depends on a count (pages, SMS, beneficiaries) the
 *                statement does not reveal.
 *
 * False-positive policy: a VIOLATION is only declared when the charge
 * exceeds the cap under the MOST GENEROUS lawful interpretation
 * (VAT-inclusive reading, largest candidate transfer, all credits counted
 * as levy-eligible, same-name exclusions ignored). Anything softer is
 * review/advisory. This is what makes the report safe to send to a bank.
 * ========================================================================= */

(function (global) {
  "use strict";

  var RULES = (typeof module !== "undefined" && module.exports)
    ? require("./rules.js") : global.CBN_RULES;
  var PATTERNS = (typeof module !== "undefined" && module.exports)
    ? require("./patterns.js") : global.CBN_PATTERNS;

  var r2 = RULES.r2;
  var TOL = 0.015; // one-and-a-half kobo arithmetic tolerance

  /* ---------------- small helpers ---------------- */

  function monthKey(dt) { return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0"); }
  function quarterKey(dt) { return dt.getFullYear() + "-Q" + (Math.floor(dt.getMonth() / 3) + 1); }
  function fmtN(n) {
    return "₦" + Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function daysBetween(a, b) { return Math.abs(a - b) / 86400000; }

  /** Is the calendar month (y, m0) fully inside [minD, maxD]? */
  function monthFullyCovered(minD, maxD, y, m0) {
    var first = new Date(y, m0, 1);
    var last = new Date(y, m0 + 1, 0);
    return minD <= first && maxD >= last;
  }

  /** Allowed ceiling for a fee with an ex-VAT cap:
   *  if the bank charged VAT on a separate line, the fee line itself must
   *  respect the ex-VAT cap; if not, give it the benefit of a bundled-VAT
   *  reading. */
  function capWithVat(cap, txn, rate) {
    return txn.hasSeparateVat ? cap : r2(cap * (1 + rate));
  }

  function mkFinding(txn, verdict, allowed, reason, citation, math) {
    var excess = 0;
    if (verdict === "violation") {
      excess = allowed === 0 ? txn.debit : r2(Math.max(0, txn.debit - allowed));
    }
    return {
      txnIndex: txn.index, txn: txn, type: txn.chargeType,
      typeName: RULES.typeNames[txn.chargeType] || txn.chargeType,
      verdict: verdict,
      allowed: allowed, charged: txn.debit, excess: excess,
      reason: reason, citation: citation, math: math || ""
    };
  }

  /* =====================================================================
   * MAIN ENTRY
   * txns: [{ index, date: Date, narration, debit, credit }]
   * ctx:  { accountType: 'savings'|'current'|'domiciliary',
   *         holderType: 'individual'|'business'|'government',
   *         salaryAccount: bool,
   *         overrides: { txnIndex: chargeType|'ignore' } }
   * ===================================================================== */
  function audit(txns, ctx) {
    ctx = ctx || {};
    var overrides = ctx.overrides || {};
    var holderClass = ctx.holderType === "individual" ? "individual" : "business";

    /* ---- 1. classify ---- */
    txns.forEach(function (t) {
      t.chargeType = null; t.hasSeparateVat = false; t.vatLinkIndex = null;
      var ov = overrides[t.index];
      if (ov !== undefined) {
        t.chargeType = (ov === "ignore") ? null : ov;
        t.overridden = true;
        return;
      }
      t.overridden = false;
      if (t.debit > 0) {
        var c = PATTERNS.classify(t.narration);
        if (c) t.chargeType = c.type;
      }
    });

    /* ---- 1.5 disambiguate customer payments from bank fees ----
     * Customer-initiated transfers often contain words like "commission"
     * or "charge" (e.g. commissions the account holder pays its agents).
     * Vocabulary alone must never create a violation. */
    refineChargeClassification(txns);

    var minDate = null, maxDate = null;
    txns.forEach(function (t) {
      if (!minDate || t.date < minDate) minDate = t.date;
      if (!maxDate || t.date > maxDate) maxDate = t.date;
      // precompute context markers once — the linkage helpers below would
      // otherwise re-run these regexes millions of times on big statements
      if (t.debit > 0 && !t.chargeType) {
        var n = PATTERNS.norm(t.narration);
        t._isTransferDebit = PATTERNS.CONTEXT.transferDebit.test(n);
        t._isAtmWd = PATTERNS.CONTEXT.atmWithdrawal.test(n);
      } else {
        t._isTransferDebit = false; t._isAtmWd = false;
      }
    });

    /* ---- 2. pair VAT lines with their parent fee ---- */
    var charges = txns.filter(function (t) { return t.chargeType && t.debit > 0; });
    charges.filter(function (t) { return t.chargeType === "vat"; }).forEach(function (v) {
      var rate = RULES.vatRate(v.date);
      var best = null, bestDist = Infinity;
      charges.forEach(function (f) {
        if (f === v || f.chargeType === "vat") return;
        if (daysBetween(f.date, v.date) > 1.01) return;
        if (Math.abs(r2(f.debit * rate) - v.debit) > 0.06) return;
        var dist = Math.abs(f.index - v.index) + (f.hasSeparateVat ? 1000 : 0);
        if (dist < bestDist) { bestDist = dist; best = f; }
      });
      if (best) { best.hasSeparateVat = true; v.vatLinkIndex = best.index; v.vatParent = best; }
    });

    /* ---- 3. evaluate each charge ---- */
    var findings = [];
    charges.forEach(function (t) {
      if (t.date < RULES.coverageStart) {
        findings.push(mkFinding(t, "review", null,
          "This transaction predates 1 January 2020, the start of the current CBN Guide to Charges. It must be checked against the 2017 Guide manually.",
          "CBN Guide to Charges 2020 — effective date"));
        return;
      }
      findings.push(evaluate(t, txns, ctx, holderClass));
    });

    /* ---- 4. aggregate cross-checks ---- */
    /* Month coverage: trust the statement's own declared period (mined from
     * its hero/summary section) when it is wider than the transaction dates —
     * a quiet first week must not disqualify a fully-covered month. */
    var covFrom = (ctx.statementFrom instanceof Date && !isNaN(ctx.statementFrom) && ctx.statementFrom < minDate) ? ctx.statementFrom : minDate;
    var covTo = (ctx.statementTo instanceof Date && !isNaN(ctx.statementTo) && ctx.statementTo > maxDate) ? ctx.statementTo : maxDate;
    var aggregates = [];
    aggCamf(txns, findings, ctx, covFrom, covTo, aggregates);
    aggLevy(txns, findings, ctx, aggregates);
    aggAtmFreeRule(txns, findings, covFrom, covTo, aggregates);
    aggCardMaintQuarter(txns, findings, ctx, aggregates);

    /* ---- 5. summary ---- */
    var sum = { violation: 0, compliant: 0, review: 0, advisory: 0 };
    var refund = 0, chargesTotal = 0, reviewTotal = 0;
    findings.forEach(function (f) {
      sum[f.verdict] = (sum[f.verdict] || 0) + 1;
      chargesTotal = r2(chargesTotal + f.charged);
      if (f.verdict === "violation") refund = r2(refund + f.excess);
      if (f.verdict === "review") reviewTotal = r2(reviewTotal + f.charged);
    });
    aggregates.forEach(function (a) {
      if (a.verdict === "violation") refund = r2(refund + a.excess);
    });

    return {
      findings: findings,
      aggregates: aggregates,
      summary: {
        counts: sum,
        totalCharges: chargesTotal,
        refundDue: refund,
        underReview: reviewTotal,
        period: { from: minDate, to: maxDate },
        txnCount: txns.length,
        chargeCount: charges.length
      }
    };
  }

  /* =====================================================================
   * PER-CHARGE EVALUATORS
   * ===================================================================== */
  function evaluate(t, txns, ctx, holderClass) {
    var rate = RULES.vatRate(t.date);

    switch (t.chargeType) {

      /* ---------- must-be-free charges ---------- */
      case "cot": case "account_closure": case "account_reactivation":
      case "pin_reset": case "email_alert": case "bvn_charge":
      case "otc_cheque_deposit_own": case "letter_of_discharge":
      case "draft_repurchase": {
        var rule = RULES.mustBeFree[t.chargeType];
        return mkFinding(t, "violation", 0,
          rule.name + " is prohibited — the CBN says this service must be FREE. The full amount is refundable.",
          rule.citation,
          "Permitted charge: ₦0.00 • Charged: " + fmtN(t.debit) + " • Refund due: " + fmtN(t.debit));
      }

      /* ---------- VAT lines ---------- */
      case "vat": {
        if (t.vatParent) {
          var expected = r2(t.vatParent.debit * rate);
          if (t.debit <= expected + TOL) {
            return mkFinding(t, "compliant", expected,
              "VAT correctly computed at " + (rate * 100) + "% of the " + fmtN(t.vatParent.debit) + " fee on the same day.",
              "Finance Act 2019 — VAT " + (rate * 100) + "%",
              fmtN(t.vatParent.debit) + " × " + (rate * 100) + "% = " + fmtN(expected));
          }
          return mkFinding(t, "violation", expected,
            "VAT charged is more than " + (rate * 100) + "% of the linked fee.",
            "Finance Act 2019 — VAT " + (rate * 100) + "%",
            "Expected " + fmtN(t.vatParent.debit) + " × " + (rate * 100) + "% = " + fmtN(expected) + " • Charged: " + fmtN(t.debit));
        }
        return mkFinding(t, "review", null,
          "This VAT debit could not be matched to any bank fee within 1 day at " + (rate * 100) + "%. VAT may only be charged ON a fee — standalone VAT debits should be queried with the bank.",
          "Finance Act 2019 — VAT is chargeable on fees, not on its own");
      }

      /* ---------- levy (EMTL / stamp duty) ---------- */
      case "levy": {
        var regime = RULES.levy.regime(t.date);
        if (ctx.salaryAccount) {
          return mkFinding(t, "violation", 0,
            "You marked this as a salary account. Salary accounts/salary payments are exempt from the ₦50 " + regime.name + ", so this charge is refundable.",
            regime.citation,
            "Exempt account • Charged: " + fmtN(t.debit));
        }
        var units = Math.round(t.debit / RULES.levy.amount);
        if (units >= 1 && Math.abs(t.debit - units * RULES.levy.amount) <= TOL) {
          var note = units === 1
            ? "Flat ₦50 levy — correct rate. (The cross-check below verifies the bank did not charge the levy more times than you had qualifying transfers of ₦10,000+.)"
            : "This looks like a batched levy for " + units + " transfers (" + units + " × ₦50). The cross-check below verifies the count against your qualifying transfers.";
          return mkFinding(t, "compliant", t.debit, note, regime.citation,
            units + " × ₦50 = " + fmtN(units * 50) + ". No VAT applies to this levy.");
        }
        var allowedLevy = Math.max(1, Math.floor(t.debit / RULES.levy.amount)) * RULES.levy.amount;
        return mkFinding(t, "violation", allowedLevy,
          "The " + regime.name + " is a FLAT ₦50 per qualifying transfer — never a percentage, and VAT does not apply to it. " + fmtN(t.debit) + " is not a valid multiple of ₦50.",
          regime.citation,
          "Charged " + fmtN(t.debit) + " • nearest lawful amount " + fmtN(allowedLevy) + " • excess " + fmtN(r2(t.debit - allowedLevy)));
      }

      /* ---------- CAMF ---------- */
      case "camf": {
        if (ctx.accountType === "savings") {
          return mkFinding(t, "violation", 0,
            "Account maintenance fees are NOT permitted on savings accounts. CAMF applies to current accounts only. The full amount is refundable.",
            RULES.mustBeFree.savings_maintenance.citation,
            "Permitted on savings: ₦0.00 • Charged: " + fmtN(t.debit));
        }
        if (ctx.accountType === "domiciliary") {
          return mkFinding(t, "review", null,
            "A naira 'maintenance fee' appeared on a domiciliary account. The CBN Guide permits CAMF on naira current accounts (₦1/mille) and a 0.05%/$10 commission on domiciliary withdrawals — ask the bank which rule this debit was charged under.",
            RULES.camf.citation);
        }
        return mkFinding(t, "compliant", null,
          "CAMF is permitted on current accounts at max ₦1 per ₦1,000 of your own debit transactions. Whether THIS amount is correct is verified arithmetically in the cross-check below, which recomputes the cap from your statement's actual turnover.",
          RULES.camf.citation,
          "See 'CAMF recomputation' cross-check for the month-by-month arithmetic.");
      }

      /* ---------- cards ---------- */
      case "card_maintenance": {
        if (t.date && t.date >= RULES.cards.maintenanceAbolishedFrom) {
          return mkFinding(t, "violation", 0,
            "Naira card maintenance fees were ABOLISHED by the CBN Guide to Charges 2026, effective 1 May 2026. Any card maintenance charge from that date is not permitted on any account type and is fully refundable.",
            RULES.cards.citationMaintAbolished,
            "Permitted from 1 May 2026: ₦0.00 • Charged: " + fmtN(t.debit) + " • Refund due: " + fmtN(t.debit));
        }
        if (ctx.accountType !== "savings") {
          return mkFinding(t, "violation", 0,
            "Naira card maintenance fees are only permitted on cards linked to SAVINGS accounts. On a " + ctx.accountType + " account this charge is not allowed at all and is fully refundable.",
            RULES.cards.citationMaint,
            "Permitted on " + ctx.accountType + " accounts: ₦0.00 • Charged: " + fmtN(t.debit));
        }
        var cmCap = capWithVat(RULES.cards.maintenancePerQuarterMax, t, rate);
        if (t.debit <= cmCap + TOL) {
          return mkFinding(t, "compliant", cmCap,
            "Within the ₦50-per-quarter cap" + (t.hasSeparateVat ? "" : " (VAT-inclusive reading: ₦53.75)") + ". The cross-check below confirms it was charged at most once this quarter.",
            RULES.cards.citationMaint,
            "Cap " + fmtN(cmCap) + " • charged " + fmtN(t.debit));
        }
        return mkFinding(t, "violation", cmCap,
          "Above the ₦50 per quarter cap for naira card maintenance.",
          RULES.cards.citationMaint,
          "Cap " + fmtN(cmCap) + (t.hasSeparateVat ? " (VAT charged separately)" : " (incl. VAT allowance)") + " • charged " + fmtN(t.debit) + " • excess " + fmtN(r2(t.debit - cmCap)));
      }

      case "card_issuance": {
        var ciMax = RULES.cards.issuanceMaxFor(t.date);
        var ciCite = RULES.cards.citationIssuanceFor(t.date);
        var ciCap = capWithVat(ciMax, t, rate);
        if (t.debit <= ciCap + TOL) {
          return mkFinding(t, "compliant", ciCap, "Within the one-off ₦" + ciMax.toLocaleString() + " (+VAT) cap for card issuance/replacement for this date.",
            ciCite, "Cap " + fmtN(ciCap) + " • charged " + fmtN(t.debit));
        }
        return mkFinding(t, "violation", ciCap, "Above the ₦" + ciMax.toLocaleString() + " (+VAT) one-off cap for card issuance/replacement for this date.",
          ciCite,
          "Cap " + fmtN(ciCap) + " • charged " + fmtN(t.debit) + " • excess " + fmtN(r2(t.debit - ciCap)));
      }

      /* ---------- possible customer payment, not a bank fee ---------- */
      case "suspect_transfer": {
        return mkFinding(t, "review", null,
          "This debit contains charge/commission wording, but " + fmtN(t.debit) + " does not match any CBN transfer-fee tier (₦10/₦25/₦50 + VAT) and no separate bank-fee line accompanies it. It is most likely a payment YOU made (for example a commission you paid to someone), not a bank charge. If so, mark it 'Not a charge' in the All-transactions tab. Only if the bank confirms in writing that this is THEIR fee does it become disputable as an overcharge.",
          "CBN Guide to Charges 2020 — electronic funds transfer fees: ≤₦5,000 → ₦10; ₦5,001–₦50,000 → ₦25; above ₦50,000 → ₦50, plus VAT");
      }

      /* ---------- electronic transfers ---------- */
      case "eft": {
        var linked = t._feeParent ? { transfers: [t._feeParent] } : linkTransfer(t, txns);
        var ownSameBankOnly = linked.transfers.length && linked.transfers.every(isOwnAccountSameBankTransfer);
        if (ownSameBankOnly || isOwnAccountSameBankTransfer(t)) {
          return mkFinding(t, "violation", 0,
            "Own-account transfers within the same bank are not eligible for an electronic transfer fee. The full fee is refundable.",
            RULES.eftOwnAccountSameBankCitation,
            "Permitted charge: ₦0.00 • Charged: " + fmtN(t.debit) + " • Refund due: " + fmtN(t.debit));
        }
        var feeCapEx;
        var how;
        if (linked.transfers.length) {
          feeCapEx = Math.max.apply(null, linked.transfers.map(function (x) { return RULES.eftFeeFor(x.debit, t.date); }));
          how = linked.transfers.length === 1
            ? "matched to your transfer of " + fmtN(linked.transfers[0].debit) + " on the same day"
            : "checked against the largest of " + linked.transfers.length + " same-day transfers (most generous reading)";
        } else {
          feeCapEx = RULES.eftMaxFee;
          how = "no same-day transfer found on the statement, so the absolute ceiling for any transfer (₦50) was used";
        }
        var eftCap = capWithVat(feeCapEx, t, rate);
        if (t.debit <= eftCap + TOL) {
          return mkFinding(t, "compliant", eftCap,
            "Within the CBN transfer-fee tier for this date (" + how + ").",
            RULES.eftCitationFor(t.date),
            "Tier cap " + fmtN(feeCapEx) + (t.hasSeparateVat ? " (VAT on separate line)" : " +" + (rate * 100) + "% VAT = " + fmtN(eftCap)) + " • charged " + fmtN(t.debit));
        }
        return mkFinding(t, "violation", eftCap,
          "Above the CBN cap for electronic transfer fees for this date (" + how + ").",
          RULES.eftCitationFor(t.date),
          "Cap " + fmtN(eftCap) + " • charged " + fmtN(t.debit) + " • excess " + fmtN(r2(t.debit - eftCap)));
      }

      /* ---------- USSD session fees ---------- */
      case "ussd_session_fee": {
        if (t.date && t.date >= RULES.ussd.eubFrom) {
          return mkFinding(t, "review", null,
            "Your bank debited a USSD session fee of " + fmtN(t.debit) + ". Under the End-User Billing policy (rolled out from mid-2025) USSD sessions are billed to your AIRTIME by your phone network — a bank that has migrated to EUB must not debit your bank account for USSD sessions. Ask the bank when it migrated to EUB; if this debit is after that date, it is refundable.",
            RULES.ussd.eubCitation,
            "Charged: " + fmtN(t.debit) + " • If the bank was on EUB at this date, permitted charge is ₦0.00");
        }
        var ussdCap = r2(RULES.ussd.sessionFeeMax);
        if (t.debit <= ussdCap + TOL) {
          return mkFinding(t, "compliant", ussdCap,
            "Single USSD session fee within the NCC cost-recovery benchmark (₦6.98/session).",
            RULES.ussd.citation, "Benchmark " + fmtN(ussdCap) + " • charged " + fmtN(t.debit));
        }
        return mkFinding(t, "review", null,
          "This USSD session-fee debit of " + fmtN(t.debit) + " exceeds a single ₦6.98 session. It may bundle several sessions — ask the bank for the session count; anything above ₦6.98 × sessions is refundable.",
          RULES.ussd.citation,
          "Single-session benchmark " + fmtN(ussdCap) + " • charged " + fmtN(t.debit));
      }

      /* ---------- ATM ---------- */
      case "atm_fee": return evalAtm(t, txns, rate);

      /* ---------- SMS ---------- */
      case "sms_alert": {
        var unit = RULES.sms.unitMax(t.date);
        var unitIncl = r2(unit * (1 + rate));
        if (t.debit <= unitIncl + TOL) {
          return mkFinding(t, "compliant", unitIncl,
            "Single SMS alert within the cost-recovery benchmark (₦" + unit + "/SMS" + (t.hasSeparateVat ? "" : " incl. VAT allowance") + " for this date).",
            RULES.sms.citation, "Benchmark " + fmtN(unitIncl) + " • charged " + fmtN(t.debit));
        }
        var nPlain = t.debit / unit, nIncl = t.debit / unitIncl;
        var count = null, basis = null;
        if (Math.abs(nPlain - Math.round(nPlain)) < 0.002 && Math.round(nPlain) <= 2000) { count = Math.round(nPlain); basis = unit; }
        else if (Math.abs(nIncl - Math.round(nIncl)) < 0.002 && Math.round(nIncl) <= 2000) { count = Math.round(nIncl); basis = unitIncl; }
        if (count) {
          return mkFinding(t, "advisory", null,
            "Bulk SMS alert charge equal to " + count + " messages at " + fmtN(basis) + " each. SMS fees are cost-recovery only and apply solely to alerts on YOUR OWN transactions — count your alerts for the period and dispute any shortfall. Bank-induced alerts (e.g. promos) must be free.",
            RULES.sms.citation,
            fmtN(t.debit) + " ÷ " + fmtN(basis) + " = " + count + " SMS");
        }
        return mkFinding(t, "review", null,
          "SMS alert charge of " + fmtN(t.debit) + " is not a clean multiple of the cost-recovery benchmark (₦" + unit + "/SMS on this date). Ask the bank for the per-message breakdown.",
          RULES.sms.citation);
      }

      /* ---------- cash handling (cashless policy) ---------- */
      case "cash_deposit_fee": {
        var susp = RULES.cashless.depositSuspensions.some(function (w) { return t.date >= w[0] && t.date <= w[1]; });
        if (susp) {
          return mkFinding(t, "violation", 0,
            "Cash deposit processing fees were SUSPENDED by the CBN on this date. The full amount is refundable.",
            RULES.cashless.citation,
            "Charged during CBN suspension window • Refund: " + fmtN(t.debit));
        }
        var dep = RULES.cashless.deposit[holderClass];
        var depCredit = nearestCashCredit(t, txns);
        if (depCredit) {
          var depAllowed = depCredit.credit > dep.threshold ? r2((depCredit.credit - dep.threshold) * dep.rate) : 0;
          if (t.debit <= depAllowed + TOL) {
            return mkFinding(t, "compliant", depAllowed, "Within the cashless-policy processing fee for the " + fmtN(depCredit.credit) + " cash deposit on the same day.",
              RULES.cashless.citation,
              "(" + fmtN(depCredit.credit) + " − " + fmtN(dep.threshold) + ") × " + (dep.rate * 100) + "% = " + fmtN(depAllowed));
          }
          return mkFinding(t, "violation", depAllowed,
            "Above the cashless-policy processing fee for the matched same-day cash deposit.",
            RULES.cashless.citation,
            "Allowed (" + fmtN(depCredit.credit) + " − " + fmtN(dep.threshold) + ") × " + (dep.rate * 100) + "% = " + fmtN(depAllowed) + " • charged " + fmtN(t.debit));
        }
        return mkFinding(t, "review", null,
          "Cash deposit processing fee found, but no same-day cash deposit above " + fmtN(dep.threshold) + " could be matched on the statement. If you made no such deposit, this fee has no basis — query it.",
          RULES.cashless.citation);
      }

      case "cash_withdrawal_fee": {
        var wd = RULES.cashless.withdrawal[holderClass];
        return mkFinding(t, "review", null,
          "Cash withdrawal processing fee detected. Lawful only on over-the-counter cash withdrawals above " + fmtN(wd.threshold) + " (" + (wd.rate * 100) + "% of the excess for " + holderClass + " accounts). Verify the withdrawal it relates to.",
          RULES.cashless.citation);
      }

      /* ---------- fixed-cap single charges ---------- */
      case "hardware_token": case "bills_payment": case "rtgs":
      case "standing_order": case "stopped_cheque": case "counter_cheque":
      case "statement_request": case "bulk_payment": case "cashback_purchase": {
        var fc = RULES.fixedCaps[t.chargeType];
        var fcCap = capWithVat(fc.max, t, rate);
        if (t.debit <= fcCap + TOL) {
          return mkFinding(t, "compliant", fcCap, "Within the CBN cap.", fc.citation,
            "Cap " + fmtN(fcCap) + " • charged " + fmtN(t.debit));
        }
        if (fc.perUnit) {
          var unitsIncl = t.debit / r2(fc.max * (1 + rate)), unitsEx = t.debit / fc.max;
          var n = null, b = null;
          if (Math.abs(unitsEx - Math.round(unitsEx)) < 0.002 && Math.round(unitsEx) <= 5000) { n = Math.round(unitsEx); b = fc.max; }
          else if (Math.abs(unitsIncl - Math.round(unitsIncl)) < 0.002 && Math.round(unitsIncl) <= 5000) { n = Math.round(unitsIncl); b = r2(fc.max * (1 + rate)); }
          if (n) {
            return mkFinding(t, "advisory", null,
              "Charge equals " + n + " × " + fmtN(b) + " (the cap is per " + fc.perUnit + "). Verify the count of " + fc.perUnit + "s is genuine — if fewer, the difference is refundable.",
              fc.citation, fmtN(t.debit) + " ÷ " + fmtN(b) + " = " + n + " " + fc.perUnit + "(s)");
          }
        }
        return mkFinding(t, "violation", fcCap, "Above the CBN cap for this charge.",
          fc.citation, "Cap " + fmtN(fcCap) + " • charged " + fmtN(t.debit) + " • excess " + fmtN(r2(t.debit - fcCap)));
      }

      case "cheque_book": return evalLeafBook(t, rate, "cheque_book");
      case "nonclearing_slip": return evalLeafBook(t, rate, "nonclearing_slip");
      case "bank_draft": return evalBankDraft(t, ctx, rate);

      /* ---------- advisory (cost-recovery / negotiable) types ---------- */
      case "returned_unfunded":
      case "fx_commission": case "swift_charge": case "legal_search":
      case "credit_report": case "loan_fee": case "pos_merchant":
      case "insurance_premium": case "premium_account_forfeiture":
      case "credit_card_interest": case "fx_card_maintenance":
      case "savings_withdrawal_interest_forfeiture": case "fixed_deposit_early_liquidation":
      case "bond_guarantee": case "treasury_bill_processing": case "syndicated_lending_fee": {
        var at = RULES.advisoryTypes[t.chargeType];
        return mkFinding(t, "advisory", null,
          at.name + " — the CBN sets this at cost-recovery / a formula the statement alone cannot verify. Governing rule: " + at.citation,
          at.citation);
      }

      /* ---------- the honest default ---------- */
      case "unknown_charge":
      default:
        return mkFinding(t, "review", null,
          "This debit looks like a bank charge, but it does not match any charge type in the CBN Guide with certainty. The auditor does not guess: ask the bank to state, in writing, which provision of the CBN Guide to Charges authorises this debit.",
          "CBN Guide to Charges 2020 — banks may only impose charges listed in the Guide; penalty for breach is ₦2,000,000 per infraction");
    }
  }

  /* ---------------- cheque books / non-clearing slips ---------------- */
  function evalLeafBook(t, rate, kind) {
    var n = PATTERNS.norm(t.narration);
    var capKey;
    if (/\b50\b/.test(n)) capKey = kind === "cheque_book" ? "cheque_book_50" : "nonclearing_slip_50";
    else if (/\b100\b/.test(n)) capKey = kind === "cheque_book" ? "cheque_book_100" : "nonclearing_slip_100";
    else capKey = kind === "cheque_book" ? "cheque_book_100" : "nonclearing_slip_100"; // most generous cap when leaves are not visible
    var fc = RULES.fixedCaps[capKey];
    var cap = fc.vat ? capWithVat(fc.max, t, rate) : fc.max;
    var label = kind === "cheque_book" ? "cheque book" : "non-clearing withdrawal slip booklet";
    if (t.debit <= cap + TOL) {
      return mkFinding(t, "compliant", cap,
        "Within the uploaded CBN guide cap for this " + label + " (" + fc.perUnit + ")." + (capKey.slice(-3) === "100" && !/\b100\b/.test(n) ? " Leaf count was not visible, so the most generous 100-leaf cap was used." : ""),
        fc.citation, "Cap " + fmtN(cap) + " • charged " + fmtN(t.debit));
    }
    return mkFinding(t, "violation", cap,
      "Above the uploaded CBN guide cap for this " + label + ".",
      fc.citation, "Cap " + fmtN(cap) + " • charged " + fmtN(t.debit) + " • excess " + fmtN(r2(t.debit - cap)));
  }

  function evalBankDraft(t, ctx, rate) {
    var n = PATTERNS.norm(t.narration);
    if (/NON[-\s]?CUSTOMER/.test(n)) {
      return mkFinding(t, "advisory", null,
        "Non-customer bank draft fee is ₦550 + 0.1% of draft value. The statement does not reveal the draft value, so confirm the value before disputing.",
        RULES.advisoryTypes.bank_draft.citation);
    }
    var base = ctx.accountType === "savings" ? 550 : 350;
    var cap = capWithVat(base, t, rate);
    if (t.debit <= cap + TOL) {
      return mkFinding(t, "compliant", cap,
        "Within the customer bank-draft cap for a " + (ctx.accountType || "current") + " account.",
        RULES.advisoryTypes.bank_draft.citation, "Cap " + fmtN(cap) + " • charged " + fmtN(t.debit));
    }
    return mkFinding(t, "violation", cap,
      "Above the customer bank-draft cap for a " + (ctx.accountType || "current") + " account.",
      RULES.advisoryTypes.bank_draft.citation, "Cap " + fmtN(cap) + " • charged " + fmtN(t.debit) + " • excess " + fmtN(r2(t.debit - cap)));
  }

  /* ---------------- ATM evaluator ---------------- */
  function evalAtm(t, txns, rate) {
    var regime = RULES.atm.regime(t.date);

    if (regime.era === "pre2025") {
      var atmCap = capWithVat(regime.notOnUsFee, t, rate);
      if (t.debit <= atmCap + TOL) {
        return mkFinding(t, "compliant", atmCap,
          "Within the ₦35 not-on-us ATM fee in force before 1 March 2025. The cross-check below verifies your first 3 monthly withdrawals at other banks' ATMs were free.",
          regime.citation, "Cap " + fmtN(atmCap) + " • charged " + fmtN(t.debit));
      }
      return mkFinding(t, "violation", atmCap, "Above the ₦35 not-on-us ATM fee in force before 1 March 2025.",
        regime.citation, "Cap " + fmtN(atmCap) + " • charged " + fmtN(t.debit) + " • excess " + fmtN(r2(t.debit - atmCap)));
    }

    // post-2025 regime: ₦100/₦20,000 on-site; ₦100+max ₦500 surcharge off-site
    var wdl = nearestAtmWithdrawal(t, txns);
    var onsitePer = capWithVat(regime.onSitePer20k, t, rate);     // 107.50
    var offsitePer = capWithVat(regime.offSiteMaxPer20k, t, rate); // 645.00
    if (wdl) {
      var chunks = Math.max(1, Math.ceil(wdl.debit / regime.chunk));
      var offCap = r2(offsitePer * chunks);
      var onCap = r2(onsitePer * chunks);
      if (t.debit <= onCap + TOL) {
        return mkFinding(t, "compliant", onCap,
          "Within the branch-ATM fee for the matched " + fmtN(wdl.debit) + " withdrawal (" + chunks + " × ₦20,000 block" + (chunks > 1 ? "s" : "") + ").",
          regime.citation, chunks + " × " + fmtN(onsitePer) + " = " + fmtN(onCap) + " • charged " + fmtN(t.debit));
      }
      if (t.debit <= offCap + TOL) {
        return mkFinding(t, "compliant", offCap,
          "Above the branch-ATM rate but within the OFF-SITE ATM ceiling (₦100 + max ₦500 surcharge per ₦20,000). Lawful only if the machine was an off-site ATM (mall, fuel station, kiosk).",
          regime.citation, chunks + " × " + fmtN(offsitePer) + " = " + fmtN(offCap) + " • charged " + fmtN(t.debit));
      }
      return mkFinding(t, "violation", offCap,
        "Above even the off-site ATM ceiling for the matched " + fmtN(wdl.debit) + " withdrawal.",
        regime.citation, "Max " + chunks + " × " + fmtN(offsitePer) + " = " + fmtN(offCap) + " • charged " + fmtN(t.debit) + " • excess " + fmtN(r2(t.debit - offCap)));
    }
    if (t.debit <= onsitePer + TOL) {
      return mkFinding(t, "compliant", onsitePer,
        "Within the ₦100 (+VAT) per-₦20,000 fee for using another bank's branch ATM (own-bank ATMs must be free).",
        regime.citation, "Cap " + fmtN(onsitePer) + " • charged " + fmtN(t.debit));
    }
    if (t.debit <= offsitePer + TOL) {
      return mkFinding(t, "compliant", offsitePer,
        "Within the off-site ATM ceiling (₦100 + max ₦500 surcharge, +VAT). Lawful only at off-site machines, and your own bank's ATMs must always be free.",
        regime.citation, "Off-site ceiling " + fmtN(offsitePer) + " • charged " + fmtN(t.debit));
    }
    return mkFinding(t, "review", null,
      "ATM fee of " + fmtN(t.debit) + " exceeds the ceiling for a single ₦20,000 block (" + fmtN(offsitePer) + ") and no matching ATM withdrawal was found on the statement to justify multiple blocks. Verify the withdrawal amount with the bank.",
      regime.citation);
  }

  /* ------------- customer-payment vs bank-fee disambiguation ------------- */

  /** Could this amount be a lawful electronic-transfer fee?
   *  Tiers ₦10/₦25/₦50 — bare, or with the VAT of that date bundled in. */
  function isFeeLikeAmount(amount, date) {
    var rate = RULES.vatRate(date);
    var bases = [10, 25, 50];
    for (var i = 0; i < bases.length; i++) {
      if (Math.abs(amount - bases[i]) <= 0.02) return true;
      if (Math.abs(amount - r2(bases[i] * (1 + rate))) <= 0.02) return true;
    }
    return false;
  }

  var GENERIC_NARR_WORDS = /^(THE|FOR|AND|FROM|CHARGE|CHARGES|FEE|FEES|CHG|COMMISSION|COMM|VAT|TRF|TRANSFER|NIP|NEFT|MOB|UTO|CIB|REF|WITH)$/;

  function narrTokens(s) {
    var seen = {}, out = [];
    PATTERNS.norm(s).split(/[^A-Z0-9]+/).forEach(function (w) {
      if (w.length < 3 || GENERIC_NARR_WORDS.test(w) || seen[w]) return;
      seen[w] = 1; out.push(w);
    });
    return out;
  }

  /** Do two narrations describe the same transaction? Token overlap with
   *  prefix tolerance, because fee lines truncate names ("OSH" vs
   *  "OSHIMODI"). Generic charge/transfer words are ignored. */
  function similarNarr(a, b) {
    var A = narrTokens(a), B = narrTokens(b);
    if (!A.length || !B.length) return false;
    var hits = 0;
    A.forEach(function (w) {
      var hit = B.some(function (v) {
        return v === w || (w.length >= 4 && v.indexOf(w) === 0) || (v.length >= 4 && w.indexOf(v) === 0);
      });
      if (hit) hits++;
    });
    return hits / Math.min(A.length, B.length) >= 0.5;
  }

  /** Same-day txns within a few positions of t. */
  function nearbyTxns(t, txns, span) {
    var out = [];
    for (var j = Math.max(0, t.index - span); j <= Math.min(txns.length - 1, t.index + span); j++) {
      var x = txns[j];
      if (x !== t && sameDay(x.date, t.date)) out.push(x);
    }
    return out;
  }

  function refineChargeClassification(txns) {
    txns.forEach(function (t) {
      if (t.overridden || (t.chargeType !== "eft" && t.chargeType !== "unknown_charge")) return;
      if (t.debit <= 0 || isFeeLikeAmount(t.debit, t.date)) return; // fee-sized: plausible bank fee

      var near = nearbyTxns(t, txns, 4);

      // (a) it has its OWN small fee line with a mirrored narration
      //     (e.g. "/charge|FT/..." right before "FT/...") -> it is the
      //     customer's payment, because banks do not levy transfer fees
      //     on their own charges
      var feeTwin = near.find ? near.find(twinTest) : near.filter(twinTest)[0];
      function twinTest(x) {
        return x.debit > 0 && isFeeLikeAmount(x.debit, x.date) && similarNarr(t.narration, x.narration);
      }
      if (feeTwin) { t.chargeType = null; t.autoCleared = true; return; }

      // (b) small non-standard amount mirroring a LARGER nearby debit ->
      //     it is the fee FOR that transfer (e.g. "/charge|FT/..." beside
      //     "FT/..."); remember the parent so the exact tier is enforced
      if (t.debit <= 200) {
        var parent = null;
        near.forEach(function (x) {
          if (!parent && !x.chargeType && x.debit >= t.debit * 5 && similarNarr(t.narration, x.narration)) parent = x;
        });
        if (parent) { t._feeParent = parent; t.chargeType = "eft"; }
        return; // small amounts stay fee candidates either way
      }

      // (c) a large "commission/charge"-worded debit with no fee structure
      //     and no twin: most likely the customer's own payment — the
      //     auditor asks instead of accusing
      if (t.chargeType === "eft") t.chargeType = "suspect_transfer";
    });
  }

  /* ---------------- linkage helpers ---------------- */

  /** Same-day outgoing transfers that are NOT themselves charges. */
  function linkTransfer(fee, txns) {
    var out = [];
    txns.forEach(function (x) {
      if (!x._isTransferDebit || x === fee) return;
      if (!sameDay(x.date, fee.date)) return;
      out.push(x);
    });
    return { transfers: out };
  }

  /** Deterministic own-account/same-bank transfer marker. We only apply the
   *  exemption where the narration explicitly says it is an own/self transfer
   *  AND does not carry interbank rails such as NIP/NEFT/RTGS. Same-account-name
   *  transfers to another bank remain chargeable under the normal transfer-fee
   *  tiers, as confirmed by the user. */
  function isOwnAccountSameBankTransfer(t) {
    var n = PATTERNS.norm(t && t.narration);
    if (!n) return false;
    var own = /\bOWN\s+(ACCOUNT|ACCT|A\/?C)\b|\bSELF\s+TRANSFER\b|\bTRANSFER\s+TO\s+SELF\b|\bTO\s+SELF\b|\bBETWEEN\s+(OWN|MY)\s+ACCOUNTS?\b|\bINTERNAL\s+TRANSFER\b/.test(n);
    if (!own) return false;
    var interbankRails = /\b(NIP|NEFT|RTGS|INTERBANK|INTER\s+BANK|OTHER\s+BANK|TO\s+OTHER\s+BANK)\b/.test(n);
    return !interbankRails;
  }

  /** Nearest ATM cash withdrawal within 1 day. */
  function nearestAtmWithdrawal(fee, txns) {
    var best = null, bestDist = Infinity;
    txns.forEach(function (x) {
      if (!x._isAtmWd || x === fee) return;
      if (daysBetween(x.date, fee.date) > 1.01) return;
      var dist = Math.abs(x.index - fee.index);
      if (dist < bestDist) { bestDist = dist; best = x; }
    });
    return best;
  }

  /** Largest same-day credit (candidate cash deposit). */
  function nearestCashCredit(fee, txns) {
    var best = null;
    txns.forEach(function (x) {
      if (x.credit > 0 && sameDay(x.date, fee.date) && (!best || x.credit > best.credit)) best = x;
    });
    return best;
  }

  /* =====================================================================
   * AGGREGATE CROSS-CHECKS
   * ===================================================================== */

  /** Recompute the lawful CAMF cap month by month from the statement's own
   *  debit turnover and compare with what was charged. */
  function aggCamf(txns, findings, ctx, minDate, maxDate, out) {
    if (ctx.accountType !== "current") return;
    var camfTxns = txns.filter(function (t) { return t.chargeType === "camf"; });
    if (!camfTxns.length) return;

    var byMonth = {};
    camfTxns.forEach(function (t) {
      (byMonth[monthKey(t.date)] = byMonth[monthKey(t.date)] || []).push(t);
    });

    Object.keys(byMonth).sort().forEach(function (mk) {
      var parts = mk.split("-"), y = +parts[0], m0 = +parts[1] - 1;
      var covered = monthFullyCovered(minDate, maxDate, y, m0);
      var monthCamf = byMonth[mk];
      var rate = RULES.vatRate(monthCamf[0].date);

      // ex-VAT reading of what was charged (generous to the bank)
      var chargedEx = 0;
      monthCamf.forEach(function (t) {
        chargedEx = r2(chargedEx + (t.hasSeparateVat ? t.debit : r2(t.debit / (1 + rate))));
      });

      // customer-induced debit turnover: all debits that are not charges,
      // excluding deterministically identified own-account same-bank transfers.
      var turnover = 0, ownSameBankTurnover = 0;
      txns.forEach(function (x) {
        if (x.debit > 0 && !x.chargeType && monthKey(x.date) === mk) {
          if (isOwnAccountSameBankTransfer(x)) ownSameBankTurnover = r2(ownSameBankTurnover + x.debit);
          else turnover = r2(turnover + x.debit);
        }
      });
      var perMille = RULES.camf.perMilleFor(monthCamf[0].date);
      var camfCite = RULES.camf.citationFor(monthCamf[0].date);
      var cap = r2(turnover * perMille / 1000);
      var capFormula = "₦" + perMille + "/mille";

      if (perMille === 0) {
        out.push({
          id: "camf-" + mk, title: "CAMF charged after abolition — " + mk,
          verdict: "violation", excess: chargedEx,
          detail: "CAMF is abolished from 1 Jan 2027 under the CBN Guide to Charges 2026. The " + fmtN(chargedEx) + " (ex-VAT) charged in " + mk + " is not permitted at all and is fully refundable.",
          citation: camfCite, txns: monthCamf.map(function (t) { return t.index; })
        });
        return;
      }
      if (!covered) {
        out.push({
          id: "camf-" + mk, title: "CAMF check — " + mk + " (incomplete month)",
          verdict: "advisory", excess: 0,
          detail: "CAMF of " + fmtN(chargedEx) + " (ex-VAT) was charged in " + mk + ", but the statement does not cover that whole month, so the " + capFormula + " cap cannot be recomputed fairly. Upload a statement covering the full month to audit it.",
          citation: camfCite, txns: monthCamf.map(function (t) { return t.index; })
        });
        return;
      }
      if (chargedEx > cap + TOL) {
        var excess = r2(chargedEx - cap);
        var exclusionNote = ownSameBankTurnover > 0 ? " Deterministically identified own-account same-bank transfers totalling " + fmtN(ownSameBankTurnover) + " were excluded from turnover." : " Same-name transfers that cannot be identified from the narration remain included, so the true cap may be even lower.";
        out.push({
          id: "camf-" + mk, title: "CAMF overcharge — " + mk,
          verdict: "violation", excess: excess,
          detail: "Your customer-induced debits in " + mk + " totalled " + fmtN(turnover) + ", so the maximum lawful CAMF (" + capFormula + " for this date) is " + fmtN(cap) + " (ex-VAT). The bank charged " + fmtN(chargedEx) + " (ex-VAT) — an overcharge of " + fmtN(excess) + ". (Bank charges were excluded from turnover." + exclusionNote + ")",
          citation: camfCite, txns: monthCamf.map(function (t) { return t.index; })
        });
      } else {
        out.push({
          id: "camf-" + mk, title: "CAMF verified — " + mk,
          verdict: "compliant", excess: 0,
          detail: "Recomputed cap: " + fmtN(turnover) + " of customer-induced debits at " + capFormula + " = " + fmtN(cap) + " (ex-VAT). Charged: " + fmtN(chargedEx) + " (ex-VAT) — within the cap." + (ownSameBankTurnover > 0 ? " Own-account same-bank transfers totalling " + fmtN(ownSameBankTurnover) + " were excluded from turnover." : ""),
          citation: camfCite, txns: monthCamf.map(function (t) { return t.index; })
        });
      }
    });
  }

  /** Levy (EMTL/stamp duty) total vs count of qualifying transfers. */
  function aggLevy(txns, findings, ctx, out) {
    if (ctx.salaryAccount) return; // already flagged per-charge
    var levyTxns = txns.filter(function (t) {
      if (t.chargeType !== "levy") return false;
      var f = findings.find(function (x) { return x.txnIndex === t.index; });
      return f && f.verdict !== "violation"; // per-charge violations counted already
    });
    if (!levyTxns.length) return;

    var pre = levyTxns.filter(function (t) { return t.date < RULES.dateOf("2026-01-01"); });
    var post = levyTxns.filter(function (t) { return t.date >= RULES.dateOf("2026-01-01"); });

    function check(group, qualifying, label, citation) {
      if (!group.length) return;
      var total = 0;
      group.forEach(function (t) { total = r2(total + t.debit); });
      var maxLawful = qualifying * RULES.levy.amount;
      if (total > maxLawful + TOL) {
        out.push({
          id: "levy-" + label, title: "Levy over-collection (" + label + ")",
          verdict: "violation", excess: r2(total - maxLawful),
          detail: "The statement shows " + qualifying + " qualifying transaction(s) of ₦10,000+ in this period (counted generously — every one of them was assumed levy-eligible, though own-account transfers are exempt). Maximum lawful levy: " + qualifying + " × ₦50 = " + fmtN(maxLawful) + ". Total levy debited: " + fmtN(total) + ". Over-collection: " + fmtN(r2(total - maxLawful)) + ".",
          citation: citation, txns: group.map(function (t) { return t.index; })
        });
      } else {
        out.push({
          id: "levy-" + label, title: "Levy count verified (" + label + ")",
          verdict: "compliant", excess: 0,
          detail: "Total levy debited " + fmtN(total) + " ≤ " + qualifying + " qualifying transaction(s) × ₦50 = " + fmtN(maxLawful) + ".",
          citation: citation, txns: group.map(function (t) { return t.index; })
        });
      }
    }

    // EMTL era: trigger is RECEIPTS of ₦10,000+
    var inflows = txns.filter(function (t) {
      return t.credit >= RULES.levy.threshold && t.date < RULES.dateOf("2026-01-01");
    }).length;
    check(pre, inflows, "EMTL on receipts, to Dec 2025", RULES.levy.regime(RULES.dateOf("2025-06-01")).citation);

    // Stamp-duty era: trigger is OUTGOING transfers of ₦10,000+
    var outflows = txns.filter(function (t) {
      return t.debit >= RULES.levy.threshold && !t.chargeType && t.date >= RULES.dateOf("2026-01-01");
    }).length;
    check(post, outflows, "stamp duty on transfers, from Jan 2026", RULES.levy.regime(RULES.dateOf("2026-01-02")).citation);
  }

  /** Pre-March-2025: first 3 not-on-us ATM withdrawals each month are free. */
  function aggAtmFreeRule(txns, findings, minDate, maxDate, out) {
    var fees = txns.filter(function (t) {
      return t.chargeType === "atm_fee" && t.date < RULES.dateOf("2025-03-01") && t.date >= RULES.coverageStart;
    });
    if (!fees.length) return;
    var byMonth = {};
    fees.forEach(function (t) { (byMonth[monthKey(t.date)] = byMonth[monthKey(t.date)] || []).push(t); });

    Object.keys(byMonth).sort().forEach(function (mk) {
      var parts = mk.split("-"), y = +parts[0], m0 = +parts[1] - 1;
      if (!monthFullyCovered(minDate, maxDate, y, m0)) return;
      var monthFees = byMonth[mk];
      var withdrawals = txns.filter(function (x) {
        return x._isAtmWd && monthKey(x.date) === mk;
      }).length;
      if (withdrawals === 0) return; // cannot verify the rule without seeing withdrawals
      var chargeable = Math.max(0, withdrawals - 3);
      if (monthFees.length > chargeable) {
        var extra = monthFees.length - chargeable;
        var refund = monthFees
          .slice(0, extra)
          .reduce(function (s, t) { return r2(s + t.debit); }, 0);
        out.push({
          id: "atm3-" + mk, title: "ATM 3-free-withdrawals rule breached — " + mk,
          verdict: "violation", excess: refund,
          detail: "Before 1 March 2025, the first 3 withdrawals at other banks' ATMs each month were FREE. In " + mk + " the statement shows " + withdrawals + " ATM withdrawal(s), so at most " + chargeable + " fee(s) were lawful — but " + monthFees.length + " ATM fee(s) were charged. " + extra + " fee(s) totalling " + fmtN(refund) + " are refundable.",
          citation: RULES.atm.regime(RULES.dateOf("2024-06-01")).citation,
          txns: monthFees.map(function (t) { return t.index; })
        });
      } else {
        out.push({
          id: "atm3-" + mk, title: "ATM monthly fee count verified — " + mk,
          verdict: "compliant", excess: 0,
          detail: withdrawals + " ATM withdrawal(s) and " + monthFees.length + " fee(s) in " + mk + " — consistent with 3 free not-on-us withdrawals.",
          citation: RULES.atm.regime(RULES.dateOf("2024-06-01")).citation,
          txns: monthFees.map(function (t) { return t.index; })
        });
      }
    });
  }

  /** Card maintenance may be charged at most ONCE per quarter. */
  function aggCardMaintQuarter(txns, findings, ctx, out) {
    if (ctx.accountType !== "savings") return; // non-savings already violations per-charge
    var byQ = {};
    txns.filter(function (t) { return t.chargeType === "card_maintenance"; })
      .forEach(function (t) { (byQ[quarterKey(t.date)] = byQ[quarterKey(t.date)] || []).push(t); });
    Object.keys(byQ).sort().forEach(function (qk) {
      var list = byQ[qk];
      if (list.length > 1) {
        var extras = list.slice(1);
        var refund = extras.reduce(function (s, t) { return r2(s + t.debit); }, 0);
        out.push({
          id: "cardq-" + qk, title: "Card maintenance charged " + list.length + "× in " + qk,
          verdict: "violation", excess: refund,
          detail: "Naira card maintenance may be charged at most ONCE per quarter (max ₦50). It appears " + list.length + " times in " + qk + " — the extra " + extras.length + " charge(s) totalling " + fmtN(refund) + " are refundable.",
          citation: RULES.cards.citationMaint,
          txns: list.map(function (t) { return t.index; })
        });
      }
    });
  }

  var API = { audit: audit, fmtN: fmtN, monthKey: monthKey, quarterKey: quarterKey };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_ENGINE = API;

})(typeof window !== "undefined" ? window : globalThis);
