/* =========================================================================
 * REPORT BUILDER — renders audit results, exports CSV, and generates a
 * ready-to-send refund demand letter citing the exact CBN provisions.
 * ========================================================================= */

(function (global) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtN(n) {
    return "₦" + Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(d) {
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  var VERDICT_META = {
    violation: { label: "VIOLATION", cls: "v-violation", icon: "⛔" },
    compliant: { label: "COMPLIANT", cls: "v-compliant", icon: "✓" },
    review: { label: "NEEDS REVIEW", cls: "v-review", icon: "❓" },
    advisory: { label: "ADVISORY", cls: "v-advisory", icon: "ℹ" }
  };

  /* ---------------- summary cards ---------------- */
  function renderSummary(audit) {
    var s = audit.summary;
    var aggViolations = audit.aggregates.filter(function (a) { return a.verdict === "violation"; }).length;
    return '' +
      card("refund", "Refund you can claim", fmtN(s.refundDue), (s.counts.violation + aggViolations) + " proven violation(s) — every kobo backed by CBN arithmetic") +
      card("charges", "Total bank charges found", fmtN(s.totalCharges), s.chargeCount + " charge lines out of " + s.txnCount + " transactions") +
      card("review", "Needs your review", String((s.counts.review || 0)), "charges the auditor refuses to guess about" + (s.underReview ? " (" + fmtN(s.underReview) + ")" : "")) +
      card("ok", "Verified compliant", String((s.counts.compliant || 0)), "charges proven within CBN caps");

    function card(kind, title, big, sub) {
      return '<div class="sum-card sum-' + kind + '"><div class="sum-title">' + esc(title) + '</div>' +
        '<div class="sum-big">' + esc(big) + '</div><div class="sum-sub">' + esc(sub) + '</div></div>';
    }
  }

  /* ---------------- SME finance dashboard ---------------- */
  function smeDashboard(txns, audit) {
    txns = txns || [];
    audit = audit || { findings: [], aggregates: [], summary: {} };
    var totalIn = 0, totalOut = 0, bankCharges = 0, suspicious = 0, largestDebit = null;
    var findingsByIndex = {}, chargeCount = 0, debitCount = 0;
    (audit.findings || []).forEach(function (f) { findingsByIndex[f.txnIndex] = f; });
    txns.forEach(function (t) {
      totalIn += t.credit || 0;
      totalOut += t.debit || 0;
      if (t.debit > 0) debitCount++;
      var f = findingsByIndex[t.index];
      if (f) { bankCharges += f.charged || 0; chargeCount++; }
      if (!f && t.debit > 0 && (!largestDebit || t.debit > largestDebit.debit)) largestDebit = t;
    });
    (audit.aggregates || []).forEach(function (a) { if (a.verdict === "violation") suspicious += a.excess || 0; });
    (audit.findings || []).forEach(function (f) {
      if (f.verdict === "violation" || f.verdict === "review") suspicious += f.charged || 0;
    });
    return {
      totalIn: r2(totalIn),
      totalOut: r2(totalOut),
      netCashflow: r2(totalIn - totalOut),
      bankCharges: r2(bankCharges),
      chargeCount: chargeCount,
      refundDue: (audit.summary && audit.summary.refundDue) || 0,
      reviewAmount: (audit.summary && audit.summary.underReview) || 0,
      suspiciousAmount: r2(suspicious),
      largestDebit: largestDebit ? { date: largestDebit.date, narration: largestDebit.narration, debit: largestDebit.debit } : null,
      averageDebit: debitCount ? r2(totalOut / debitCount) : 0,
      periodFrom: audit.summary && audit.summary.period ? audit.summary.period.from : null,
      periodTo: audit.summary && audit.summary.period ? audit.summary.period.to : null
    };
  }

  function renderSmeDashboard(txns, audit, opts) {
    opts = opts || {};
    var premium = !!opts.premiumUnlocked;
    var d = smeDashboard(txns, audit);
    var cashTone = d.netCashflow >= 0 ? "positive" : "negative";
    var ownerLine = ownerSummaryLine(d);
    var largest = d.largestDebit ? fmtDate(d.largestDebit.date) + " — " + fmtN(d.largestDebit.debit) : "None";
    return '<section class="sme-dashboard" id="sme-dashboard">' +
      '<div class="sme-head"><div><h3>SME finance dashboard</h3><p>Owner/accountant view of cash movement, bank-charge leakage and review items from this statement.</p></div><span class="badge premium-badge">PREMIUM</span></div>' +
      '<div class="sme-grid">' +
        smeCard("Money in", fmtN(d.totalIn), "Total credits/read inflows") +
        smeCard("Money out", fmtN(d.totalOut), "Total debits/outflows") +
        smeCard("Net cashflow", fmtN(d.netCashflow), d.netCashflow >= 0 ? "More came in than went out" : "Outflows exceeded inflows", "sme-" + cashTone) +
        smeCard("Bank charges", fmtN(d.bankCharges), d.chargeCount + " charge line(s) detected") +
        smeCard("Refund/recovery", fmtN(d.refundDue), "Proven refundable amount", d.refundDue > 0 ? "sme-negative" : "sme-positive") +
        smeCard("Needs review", fmtN(d.reviewAmount), "Unclear charge amount") +
      '</div>' +
      '<div class="sme-notes"><div><strong>Owner summary:</strong> ' + esc(ownerLine) + '</div>' +
      '<div><strong>Accountant checks:</strong> suspicious/review exposure ' + fmtN(d.suspiciousAmount) + '; largest ordinary debit ' + esc(largest) + '; average debit ' + fmtN(d.averageDebit) + '.</div></div>' +
      '<div class="premium-panel ' + (premium ? 'premium-open' : 'premium-locked') + '">' +
        '<div><strong>SME Premium monthly report</strong><p>' + (premium ? 'Unlocked: export a board/accountant-ready monthly finance report or copy a WhatsApp owner summary.' : 'Locked premium feature: monthly finance report export and owner WhatsApp summary for SMEs, accountants and bookkeepers.') + '</p></div>' +
        '<div class="premium-actions">' +
          (premium ? '' : '<button class="btn btn-primary btn-small" id="btn-premium-unlock" type="button">Unlock SME Premium</button>') +
          '<button class="btn btn-ghost btn-small" id="btn-sme-monthly-report" type="button"' + (premium ? '' : ' disabled aria-disabled="true"') + '>Download monthly SME report</button>' +
          '<button class="btn btn-ghost btn-small" id="btn-sme-whatsapp-summary" type="button"' + (premium ? '' : ' disabled aria-disabled="true"') + '>Copy owner WhatsApp summary</button>' +
        '</div>' +
      '</div>' +
      '</section>';
    function smeCard(title, big, sub, cls) {
      return '<div class="sme-card ' + (cls || "") + '"><span>' + esc(title) + '</span><strong>' + esc(big) + '</strong><small>' + esc(sub) + '</small></div>';
    }
  }

  function ownerSummaryLine(d) {
    if (d.refundDue > 0) return "Action: send the refund demand letter and track recovery of " + fmtN(d.refundDue) + ".";
    if (d.reviewAmount > 0) return "Action: review unclear charges worth " + fmtN(d.reviewAmount) + " before accepting the statement.";
    return "Action: no proven refundable bank charge found in this run.";
  }

  function monthlySmeReport(txns, audit, ctx, src) {
    var d = smeDashboard(txns, audit);
    var lines = [];
    src = src || {};
    lines.push("SME MONTHLY FINANCE REPORT — PREMIUM");
    lines.push("Generated: " + new Date().toLocaleString("en-NG"));
    lines.push("Statement period: " + fmtDate(d.periodFrom) + " – " + fmtDate(d.periodTo));
    if (src.fileName) lines.push("Source statement: " + src.fileName);
    lines.push("Account profile: " + ((ctx && ctx.accountType) || "current") + " / " + ((ctx && ctx.holderType) || "business"));
    lines.push("");
    lines.push("OWNER DASHBOARD");
    lines.push("- Money in: " + fmtN(d.totalIn));
    lines.push("- Money out: " + fmtN(d.totalOut));
    lines.push("- Net cashflow: " + fmtN(d.netCashflow));
    lines.push("- Bank charges detected: " + fmtN(d.bankCharges) + " across " + d.chargeCount + " charge line(s)");
    lines.push("- Refund/recovery due: " + fmtN(d.refundDue));
    lines.push("- Needs review: " + fmtN(d.reviewAmount));
    lines.push("");
    lines.push("OWNER NEXT ACTION");
    lines.push("- " + ownerSummaryLine(d));
    lines.push("");
    lines.push("ACCOUNTANT CHECKS");
    lines.push("- Suspicious/review exposure: " + fmtN(d.suspiciousAmount));
    lines.push("- Largest ordinary debit: " + (d.largestDebit ? fmtDate(d.largestDebit.date) + " — " + fmtN(d.largestDebit.debit) + " — " + d.largestDebit.narration : "None"));
    lines.push("- Average debit: " + fmtN(d.averageDebit));
    lines.push("");
    var recon = smeReconciliation(txns, audit);
    lines.push("PHASE 2 RECONCILIATION");
    lines.push("- Status: " + (recon.status === "reconciled" ? "Reconciled" : (recon.status === "variance" ? "Variance found" : "Needs balance column")));
    lines.push("- Opening balance: " + (recon.openingBalance == null ? "N/A" : fmtN(recon.openingBalance)));
    lines.push("- Total credits: " + fmtN(recon.totalCredits));
    lines.push("- Total debits: " + fmtN(recon.totalDebits));
    lines.push("- Expected closing: " + (recon.expectedClosing == null ? "N/A" : fmtN(recon.expectedClosing)));
    lines.push("- Actual closing: " + (recon.closingBalance == null ? "N/A" : fmtN(recon.closingBalance)));
    lines.push("- Variance: " + (recon.variance == null ? "N/A" : fmtN(recon.variance)));
    lines.push("- Unreconciled exposure: " + fmtN(recon.unreconciledExposure));
    Object.keys(recon.buckets).forEach(function (k) {
      var b = recon.buckets[k];
      lines.push("- " + b.label + ": " + fmtN(b.amount) + " across " + b.count + " item(s)");
    });
    if (recon.reviewItems.length) {
      lines.push("- Large debit reviews: " + recon.reviewItems.map(function (x) { return fmtDate(x.date) + " " + fmtN(x.amount) + " " + x.narration; }).join("; "));
    }
    lines.push("");
    var intelligence = smeCashflowIntelligence(txns, audit);
    lines.push("PHASE 3 CASHFLOW INTELLIGENCE");
    lines.push("- Health score: " + intelligence.healthScore + "/100 (" + intelligence.healthBand + ")");
    lines.push("- Average daily inflow: " + fmtN(intelligence.avgDailyIn));
    lines.push("- Average daily outflow: " + fmtN(intelligence.avgDailyOut));
    lines.push("- Net daily cashflow: " + fmtN(intelligence.netDaily));
    lines.push("- Runway: " + (intelligence.runwayDays == null ? "N/A" : intelligence.runwayDays + " day(s)"));
    lines.push("- Income concentration: " + intelligence.incomeConcentration + "% from top customer/source");
    lines.push("- Expense concentration: " + intelligence.expenseConcentration + "% to top supplier/outflow");
    if (intelligence.topIncome.length) lines.push("- Top income source: " + intelligence.topIncome[0].name + " — " + fmtN(intelligence.topIncome[0].amount));
    if (intelligence.topExpenses.length) lines.push("- Top expense/outflow: " + intelligence.topExpenses[0].name + " — " + fmtN(intelligence.topExpenses[0].amount));
    lines.push("- Action plan: " + intelligence.actions.join("; "));
    lines.push("");
    lines.push("CHARGE FINDINGS SUMMARY");
    if (!(audit.findings || []).length && !(audit.aggregates || []).length) {
      lines.push("- No bank-charge findings in this statement.");
    } else {
      (audit.findings || []).slice(0, 25).forEach(function (f) {
        lines.push("- " + fmtDate(f.txn.date) + " | " + f.verdict.toUpperCase() + " | " + f.typeName + " | charged " + fmtN(f.charged) + (f.excess ? " | excess " + fmtN(f.excess) : "") + " | " + f.txn.narration);
      });
      (audit.aggregates || []).forEach(function (a) {
        lines.push("- CROSS-CHECK | " + a.verdict.toUpperCase() + " | " + a.title + (a.excess ? " | excess " + fmtN(a.excess) : ""));
      });
    }
    lines.push("");
    lines.push("Note: This premium report is generated locally in the browser from the imported statement. It is for SME bookkeeping/recovery follow-up, not legal advice.");
    return lines.join("\n");
  }

  function whatsappSmeSummary(txns, audit) {
    var d = smeDashboard(txns, audit);
    return [
      "SME Finance Summary",
      "Period: " + fmtDate(d.periodFrom) + " – " + fmtDate(d.periodTo),
      "Money in: " + fmtN(d.totalIn),
      "Money out: " + fmtN(d.totalOut),
      "Net cashflow: " + fmtN(d.netCashflow),
      "Bank charges: " + fmtN(d.bankCharges),
      "Refund/recovery due: " + fmtN(d.refundDue),
      "Needs review: " + fmtN(d.reviewAmount),
      ownerSummaryLine(d)
    ].join("\n");
  }

  function smeReconciliation(txns, audit) {
    txns = (txns || []).slice().sort(function (a, b) { return (a.date || 0) - (b.date || 0) || (a.index || 0) - (b.index || 0); });
    var d = smeDashboard(txns, audit);
    var findingsByIndex = {};
    (audit.findings || []).forEach(function (f) { findingsByIndex[f.txnIndex] = f; });
    var buckets = {
      income: { label: "Customer/income credits", count: 0, amount: 0 },
      supplier: { label: "Supplier/vendor payments", count: 0, amount: 0 },
      cash: { label: "Cash/ATM/POS/card spend", count: 0, amount: 0 },
      transfers: { label: "Other transfers/debits", count: 0, amount: 0 },
      charges: { label: "Bank charges", count: 0, amount: 0 }
    };
    var review = [];
    var firstBalTxn = null, lastBalTxn = null;
    txns.forEach(function (t) {
      if (typeof t.balance === "number" && !isNaN(t.balance)) {
        if (!firstBalTxn) firstBalTxn = t;
        lastBalTxn = t;
      }
      if (t.credit > 0) addBucket(buckets.income, t.credit);
      if (t.debit > 0) {
        var f = findingsByIndex[t.index];
        var n = String(t.narration || "").toUpperCase();
        if (f) addBucket(buckets.charges, t.debit);
        else if (/SUPPLIER|VENDOR|INVOICE|INV\b|MARKET|STORE|STORES|FOOD|RENT|SALARY|PAYROLL|WAGES|CONTRACTOR/.test(n)) addBucket(buckets.supplier, t.debit);
        else if (/ATM|POS|CARD|WEB PURCHASE|ONLINE|USSD|CASH|WITHDRAW/.test(n)) addBucket(buckets.cash, t.debit);
        else addBucket(buckets.transfers, t.debit);
        if (!f && d.averageDebit && t.debit >= Math.max(50000, d.averageDebit * 2.5)) {
          review.push({ date: t.date, narration: t.narration, amount: t.debit, reason: "Large ordinary debit compared with the statement average" });
        }
      }
    });
    var opening = null, closing = null, expectedClosing = null, variance = null, status = "no_balance";
    if (firstBalTxn && lastBalTxn) {
      opening = r2(firstBalTxn.balance + (firstBalTxn.debit || 0) - (firstBalTxn.credit || 0));
      closing = r2(lastBalTxn.balance);
      expectedClosing = r2(opening + d.totalIn - d.totalOut);
      variance = r2(closing - expectedClosing);
      status = Math.abs(variance) <= 0.05 ? "reconciled" : "variance";
    }
    var unreconciledExposure = r2(d.reviewAmount + (status === "variance" ? Math.abs(variance || 0) : 0));
    return {
      status: status,
      openingBalance: opening,
      totalCredits: d.totalIn,
      totalDebits: d.totalOut,
      expectedClosing: expectedClosing,
      closingBalance: closing,
      variance: variance,
      buckets: buckets,
      reviewItems: review.slice(0, 10),
      unreconciledExposure: unreconciledExposure
    };
    function addBucket(b, amount) { b.count++; b.amount = r2(b.amount + amount); }
  }

  function renderSmeReconciliation(txns, audit, opts) {
    opts = opts || {};
    var premium = !!opts.premiumUnlocked;
    var r = smeReconciliation(txns, audit);
    var statusText = r.status === "reconciled" ? "Reconciled" : (r.status === "variance" ? "Variance found" : "Needs balances");
    var statusClass = r.status === "reconciled" ? "sme-positive" : (r.status === "variance" ? "sme-negative" : "");
    return '<section class="recon-panel ' + (premium ? 'premium-open' : 'premium-locked') + '" id="sme-reconciliation">' +
      '<div class="sme-head"><div><h3>Phase 2: SME reconciliation</h3><p>Premium cashbook-style reconciliation of statement movement, categories and unexplained exposure.</p></div><span class="badge premium-badge">PREMIUM PHASE 2</span></div>' +
      '<div class="sme-grid">' +
        reconCard("Status", statusText, r.status === "reconciled" ? "Opening + inflows - outflows matches closing balance" : (r.status === "variance" ? "Check the variance before relying on the report" : "No running balance column available"), statusClass) +
        reconCard("Opening", r.openingBalance == null ? "—" : fmtN(r.openingBalance), "Inferred from first balance row") +
        reconCard("Expected closing", r.expectedClosing == null ? "—" : fmtN(r.expectedClosing), "Opening + credits - debits") +
        reconCard("Actual closing", r.closingBalance == null ? "—" : fmtN(r.closingBalance), "Last statement balance") +
        reconCard("Variance", r.variance == null ? "—" : fmtN(r.variance), "Actual closing minus expected", r.variance && Math.abs(r.variance) > 0.05 ? "sme-negative" : "sme-positive") +
        reconCard("Unreconciled exposure", fmtN(r.unreconciledExposure), "Review charges plus any balance variance") +
      '</div>' +
      '<div class="recon-buckets">' + Object.keys(r.buckets).map(function (k) {
        var b = r.buckets[k];
        return '<div><strong>' + esc(b.label) + '</strong><span>' + fmtN(b.amount) + ' · ' + b.count + ' item(s)</span></div>';
      }).join("") + '</div>' +
      (r.reviewItems.length ? '<div class="sme-notes"><strong>Large debits to review:</strong>' + r.reviewItems.map(function (x) { return '<div>' + esc(fmtDate(x.date) + ' — ' + fmtN(x.amount) + ' — ' + x.narration + ' (' + x.reason + ')') + '</div>'; }).join("") + '</div>' : '') +
      (premium ? '' : '<div class="premium-panel premium-locked"><div><strong>Unlock SME Premium</strong><p>Phase 2 reconciliation is visible as a premium preview. Unlock to export it inside the monthly SME report.</p></div></div>') +
      '</section>';
    function reconCard(title, big, sub, cls) {
      return '<div class="sme-card ' + (cls || "") + '"><span>' + esc(title) + '</span><strong>' + esc(big) + '</strong><small>' + esc(sub) + '</small></div>';
    }
  }

  function smeCashflowIntelligence(txns, audit) {
    txns = (txns || []).slice().sort(function (a, b) { return (a.date || 0) - (b.date || 0) || (a.index || 0) - (b.index || 0); });
    var d = smeDashboard(txns, audit);
    var recon = smeReconciliation(txns, audit);
    var first = d.periodFrom || (txns[0] && txns[0].date) || null;
    var last = d.periodTo || (txns[txns.length - 1] && txns[txns.length - 1].date) || null;
    var days = first && last ? Math.max(1, Math.round((last - first) / 86400000) + 1) : 1;
    var avgDailyIn = r2(d.totalIn / days);
    var avgDailyOut = r2(d.totalOut / days);
    var netDaily = r2(avgDailyIn - avgDailyOut);
    var closing = recon.closingBalance;
    var runwayDays = null;
    if (closing != null && avgDailyOut > avgDailyIn) runwayDays = Math.max(0, Math.floor(closing / (avgDailyOut - avgDailyIn)));
    else if (closing != null && avgDailyOut > 0) runwayDays = 999;

    var findingsByIndex = {};
    (audit.findings || []).forEach(function (f) { findingsByIndex[f.txnIndex] = f; });
    var income = {}, expenses = {};
    txns.forEach(function (t) {
      if (t.credit > 0) addParty(income, partyName(t.narration, true), t.credit);
      if (t.debit > 0 && !findingsByIndex[t.index]) addParty(expenses, partyName(t.narration, false), t.debit);
    });
    var topIncome = partyList(income).slice(0, 3);
    var topExpenses = partyList(expenses).slice(0, 3);
    var incomeConcentration = d.totalIn ? Math.round(((topIncome[0] && topIncome[0].amount) || 0) / d.totalIn * 100) : 0;
    var nonChargeOut = Math.max(0, d.totalOut - d.bankCharges);
    var expenseConcentration = nonChargeOut ? Math.round(((topExpenses[0] && topExpenses[0].amount) || 0) / nonChargeOut * 100) : 0;

    var score = 70;
    if (d.netCashflow > 0) score += 10; else if (d.netCashflow < 0) score -= 18;
    if (runwayDays != null && runwayDays < 14) score -= 18; else if (runwayDays != null && runwayDays >= 60) score += 8;
    if (d.refundDue > 0) score -= 8;
    if (d.reviewAmount > 0) score -= 7;
    if (recon.status === "variance") score -= 15;
    if (incomeConcentration >= 70) score -= 8;
    if (expenseConcentration >= 60) score -= 5;
    score = Math.max(0, Math.min(100, Math.round(score)));
    var band = score >= 80 ? "Strong" : (score >= 60 ? "Watch" : (score >= 40 ? "Tight" : "Critical"));
    var actions = [];
    if (d.netCashflow < 0) actions.push("Reduce discretionary outflows or chase receivables before the next cycle");
    if (runwayDays != null && runwayDays < 30) actions.push("Protect cash runway; avoid non-essential debits until inflow improves");
    if (d.refundDue > 0) actions.push("Recover " + fmtN(d.refundDue) + " proven refundable bank charges");
    if (d.reviewAmount > 0) actions.push("Review unclear bank charges worth " + fmtN(d.reviewAmount));
    if (recon.status === "variance") actions.push("Resolve reconciliation variance of " + fmtN(Math.abs(recon.variance || 0)));
    if (incomeConcentration >= 70) actions.push("Diversify income: one customer/source dominates inflows");
    if (!actions.length) actions.push("Keep monthly reconciliation discipline and monitor bank charges");
    return {
      healthScore: score,
      healthBand: band,
      daysCovered: days,
      avgDailyIn: avgDailyIn,
      avgDailyOut: avgDailyOut,
      netDaily: netDaily,
      runwayDays: runwayDays,
      incomeConcentration: incomeConcentration,
      expenseConcentration: expenseConcentration,
      topIncome: topIncome,
      topExpenses: topExpenses,
      actions: actions.slice(0, 5)
    };
    function addParty(map, name, amount) {
      map[name] = map[name] || { name: name, count: 0, amount: 0 };
      map[name].count++;
      map[name].amount = r2(map[name].amount + amount);
    }
    function partyList(map) {
      return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.amount - a.amount; });
    }
    function partyName(narration, isCredit) {
      var n = String(narration || "").toUpperCase();
      n = n.replace(/\b(NIP|TRF|TRANSFER|FROM|TO|POS|WEB|PURCHASE|PAYMENT|PAID|BY|VIA|USSD|ATM|WD|WITHDRAWAL|CREDIT|DEBIT)\b/g, " ");
      n = n.replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      if (!n) return isCredit ? "Unlabelled income" : "Unlabelled outflow";
      return n.split(" ").slice(0, 4).join(" ");
    }
  }

  function renderSmeCashflowIntelligence(txns, audit, opts) {
    opts = opts || {};
    var premium = !!opts.premiumUnlocked;
    var x = smeCashflowIntelligence(txns, audit);
    var bandClass = x.healthScore >= 80 ? "sme-positive" : (x.healthScore < 60 ? "sme-negative" : "");
    return '<section class="phase3-panel ' + (premium ? 'premium-open' : 'premium-locked') + '" id="sme-cashflow-intelligence">' +
      '<div class="sme-head"><div><h3>Phase 3: SME cashflow intelligence</h3><p>Premium owner playbook: health score, runway, concentration risk and next actions from this statement.</p></div><span class="badge premium-badge">PREMIUM PHASE 3</span></div>' +
      '<div class="sme-grid">' +
        intelCard("Health score", x.healthScore + "/100", x.healthBand, bandClass) +
        intelCard("Avg daily inflow", fmtN(x.avgDailyIn), x.daysCovered + " day statement window") +
        intelCard("Avg daily outflow", fmtN(x.avgDailyOut), "Daily cash pressure") +
        intelCard("Net daily cashflow", fmtN(x.netDaily), x.netDaily >= 0 ? "Positive daily movement" : "Negative daily movement", x.netDaily >= 0 ? "sme-positive" : "sme-negative") +
        intelCard("Runway", x.runwayDays == null ? "—" : (x.runwayDays >= 999 ? "60+ days" : x.runwayDays + " days"), "Based on current burn") +
        intelCard("Income concentration", x.incomeConcentration + "%", "Top source share of inflows") +
      '</div>' +
      '<div class="phase3-lists"><div><strong>Top income sources</strong>' + partyRows(x.topIncome) + '</div><div><strong>Top expenses/outflows</strong>' + partyRows(x.topExpenses) + '</div></div>' +
      '<div class="sme-notes"><strong>Owner action plan:</strong>' + x.actions.map(function (a) { return '<div>• ' + esc(a) + '</div>'; }).join("") + '</div>' +
      (premium ? '' : '<div class="premium-panel premium-locked"><div><strong>Unlock SME Premium</strong><p>Phase 3 intelligence is a premium preview and is included in the SME monthly report export after unlock.</p></div></div>') +
      '</section>';
    function intelCard(title, big, sub, cls) {
      return '<div class="sme-card ' + (cls || "") + '"><span>' + esc(title) + '</span><strong>' + esc(big) + '</strong><small>' + esc(sub) + '</small></div>';
    }
    function partyRows(items) {
      if (!items.length) return '<p class="muted">No matching transactions.</p>';
      return items.map(function (p) { return '<p><span>' + esc(p.name) + '</span><b>' + fmtN(p.amount) + '</b><small>' + p.count + ' item(s)</small></p>'; }).join("");
    }
  }

  function r2(n) { return Math.round(n * 100) / 100; }

  /* ---------------- aggregate cross-checks ---------------- */
  function renderAggregates(audit) {
    if (!audit.aggregates.length) {
      return '<p class="muted">No cross-checks applied — none of the recomputable charge families (CAMF, levy, ATM monthly count, quarterly card fee) appear in this statement.</p>';
    }
    return audit.aggregates.map(function (a) {
      var m = VERDICT_META[a.verdict];
      return '<div class="agg-card ' + m.cls + '">' +
        '<div class="agg-head"><span class="badge ' + m.cls + '">' + m.icon + " " + m.label + '</span>' +
        '<strong>' + esc(a.title) + '</strong>' +
        (a.excess ? '<span class="agg-amt">' + fmtN(a.excess) + ' refundable</span>' : "") + "</div>" +
        '<p>' + esc(a.detail) + '</p>' +
        '<p class="cite">' + esc(a.citation) + '</p></div>';
    }).join("");
  }

  /* ---------------- findings table ---------------- */
  function renderFindings(audit, filter) {
    var rows = audit.findings.filter(function (f) { return filter === "all" || f.verdict === filter; });
    if (!rows.length) return '<p class="muted empty-row">No findings in this category.</p>';
    return rows.map(function (f, i) {
      var m = VERDICT_META[f.verdict];
      return '<details class="finding ' + m.cls + '">' +
        '<summary>' +
        '<span class="badge ' + m.cls + '">' + m.icon + " " + m.label + '</span>' +
        '<span class="f-date">' + fmtDate(f.txn.date) + '</span>' +
        '<span class="f-narr" title="' + esc(f.txn.narration) + '">' + esc(f.txn.narration) + '</span>' +
        '<span class="f-type">' + esc(f.typeName) + '</span>' +
        '<span class="f-amt">' + fmtN(f.charged) + '</span>' +
        (f.excess ? '<span class="f-excess">+' + fmtN(f.excess) + ' over</span>' : '<span class="f-excess"></span>') +
        '</summary>' +
        '<div class="f-body">' +
        '<p class="f-reason">' + esc(f.reason) + '</p>' +
        (f.math ? '<p class="f-math"><strong>The arithmetic:</strong> ' + esc(f.math) + '</p>' : "") +
        '<p class="cite"><strong>Legal basis:</strong> ' + esc(f.citation) + '</p>' +
        '</div></details>';
    }).join("");
  }

  /* ---------------- all-transactions tab (with reclassify) ---------------- */
  /** Options for the reclassify dropdowns — injected lazily on focus,
   *  because rendering them inline for thousands of rows is megabytes of
   *  HTML and the main thing slowing big audits down. */
  function typeOptionsHTML(typeNames) {
    return Object.keys(typeNames).map(function (k) {
      return '<option value="' + k + '">' + esc(typeNames[k]) + "</option>";
    }).join("");
  }

  function renderAllTxns(txns, audit, typeNames) {
    var byIndex = {};
    audit.findings.forEach(function (f) { byIndex[f.txnIndex] = f; });
    return '<div class="txn-table-wrap"><table class="txn-table"><colgroup>' +
      '<col class="txn-col-date"><col class="txn-col-desc"><col class="txn-col-money"><col class="txn-col-money"><col class="txn-col-status"><col class="txn-col-action">' +
      '</colgroup><thead><tr>' +
      "<th>Date</th><th>Description</th><th class='num'>Money out</th><th class='num'>Money in</th><th>Audit status</th><th>Reclassify</th>" +
      "</tr></thead><tbody>" +
      txns.map(function (t) {
        var f = byIndex[t.index];
        var status = f
          ? '<span class="badge ' + VERDICT_META[f.verdict].cls + '">' + VERDICT_META[f.verdict].label + "</span> " + esc(f.typeName)
          : '<span class="muted">not a charge</span>';
        var sel = '<select class="reclass" data-idx="' + t.index + '" data-hastype="' + (t.chargeType ? 1 : 0) + '">' +
          '<option value="">' + (t.chargeType ? "— change —" : "— mark as… —") + "</option></select>";
        return "<tr" + (f ? ' class="row-' + f.verdict + '"' : "") + ">" +
          "<td>" + fmtDate(t.date) + "</td>" +
          '<td class="narr">' + esc(t.narration) + "</td>" +
          '<td class="num">' + (t.debit ? fmtN(t.debit) : "") + "</td>" +
          '<td class="num">' + (t.credit ? fmtN(t.credit) : "") + "</td>" +
          "<td>" + status + "</td><td>" + sel + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* ---------------- CSV export ---------------- */
  function findingsCSV(audit) {
    function q(s) { return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"'; }
    var lines = ["Date,Narration,Charge type,Verdict,Charged (NGN),Allowed (NGN),Refundable excess (NGN),Reason,Legal basis"];
    audit.findings.forEach(function (f) {
      lines.push([
        f.txn.date.toISOString().slice(0, 10), q(f.txn.narration), q(f.typeName), f.verdict.toUpperCase(),
        f.charged.toFixed(2), f.allowed === null ? "" : Number(f.allowed).toFixed(2),
        f.excess ? f.excess.toFixed(2) : "0.00", q(f.reason), q(f.citation)
      ].join(","));
    });
    audit.aggregates.forEach(function (a) {
      lines.push([
        "", q("CROSS-CHECK: " + a.title), q("aggregate"), a.verdict.toUpperCase(), "", "",
        a.excess ? a.excess.toFixed(2) : "0.00", q(a.detail), q(a.citation)
      ].join(","));
    });
    return lines.join("\r\n");
  }

  /* ---------------- refund demand letter ---------------- */
  function demandLetter(audit, ctx) {
    var s = audit.summary;
    var today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    var violations = audit.findings.filter(function (f) { return f.verdict === "violation"; });
    var aggViolations = audit.aggregates.filter(function (a) { return a.verdict === "violation"; });
    if (!violations.length && !aggViolations.length) return null;

    var L = [];
    L.push(today);
    L.push("");
    L.push("The Branch Manager");
    L.push("[Bank name]");
    L.push("[Branch address]");
    L.push("");
    L.push("Dear Sir/Madam,");
    L.push("");
    L.push("FORMAL COMPLAINT: UNAUTHORISED/EXCESS CHARGES ON ACCOUNT [ACCOUNT NUMBER] — DEMAND FOR REFUND OF " + fmtN(s.refundDue).toUpperCase());
    L.push("");
    L.push("An audit of my " + (ctx.accountType || "bank") + " account statement covering " +
      fmtDate(s.period.from) + " to " + fmtDate(s.period.to) +
      " against the Central Bank of Nigeria's Guide to Charges by Banks, Other Financial and Non-Bank Financial Institutions (effective 1 January 2020) and subsequent CBN circulars has identified the following charges that exceed, or are not authorised by, the said Guide:");
    L.push("");
    var n = 1;
    violations.forEach(function (f) {
      L.push(n + ". " + fmtDate(f.txn.date) + " — \"" + f.txn.narration + "\" — charged " + fmtN(f.charged) +
        (f.allowed ? "; maximum permitted " + fmtN(f.allowed) : "; permitted charge NIL") +
        "; refundable excess " + fmtN(f.excess) + ".");
      L.push("   Basis: " + f.citation + ".");
      n++;
    });
    aggViolations.forEach(function (a) {
      L.push(n + ". " + a.title + " — refundable amount " + fmtN(a.excess) + ".");
      L.push("   " + a.detail);
      L.push("   Basis: " + a.citation + ".");
      n++;
    });
    L.push("");
    L.push("TOTAL REFUND DEMANDED: " + fmtN(s.refundDue));
    L.push("");
    L.push("I remind the bank that by the CBN Guide to Charges, any breach of the Guide attracts a penalty of N2,000,000 per infraction, and that the CBN Consumer Protection Regulations oblige you to acknowledge this complaint within 24 hours and resolve it within 14 days.");
    L.push("");
    L.push("Kindly refund the total sum above to my account and confirm in writing. If this complaint is not resolved within 14 days, I will escalate it to the Consumer Protection Department of the Central Bank of Nigeria (email: cpd@cbn.gov.ng), attaching this letter and the statement evidence.");
    L.push("");
    L.push("Yours faithfully,");
    L.push("");
    L.push("[Your full name]");
    L.push("[Account number]   [Phone]   [Email]");
    L.push("");
    L.push("Attachments: statement of account; audit schedule of charges.");
    return L.join("\n");
  }

  /* ---------------- printable report header ---------------- */
  function reportMeta(audit, ctx, src) {
    var s = audit.summary;
    var rulesMeta = (typeof global !== "undefined" && global.CBN_RULES && global.CBN_RULES.metadata) ? global.CBN_RULES.metadata : null;
    src = src || {};
    var srcLine = "";
    if (src.fileName) {
      var detail = src.pageCount ? src.pageCount + " page" + (src.pageCount === 1 ? "" : "s") + " scanned"
        : (src.sheetCount ? src.sheetCount + " worksheet" + (src.sheetCount === 1 ? "" : "s") + " detected" : "");
      srcLine = '<div><strong>Statement file:</strong> ' + esc(src.fileName) + (detail ? " — " + detail : "") + "</div>";
    }
    return '<div class="report-meta">' + srcLine +
      '<div><strong>Statement period:</strong> ' + fmtDate(s.period.from) + " – " + fmtDate(s.period.to) + "</div>" +
      '<div><strong>Account type:</strong> ' + esc(ctx.accountType) + " (" + esc(ctx.holderType) + (ctx.salaryAccount ? ", salary account" : "") + ")</div>" +
      '<div><strong>Transactions:</strong> ' + s.txnCount + " &nbsp; <strong>Charge lines:</strong> " + s.chargeCount + "</div>" +
      '<div><strong>Audited against:</strong> CBN Guide to Charges (eff. 1 Jan 2020), ATM Fee Circular (eff. 1 Mar 2025), Finance Act 2020 (EMTL), Nigeria Tax Act 2025 (stamp duty, eff. 1 Jan 2026), CBN Cashless Policy circulars</div>' +
      (rulesMeta ? '<div><strong>Rules version:</strong> ' + esc(rulesMeta.version) + ' &nbsp; <strong>Last reviewed:</strong> ' + esc(rulesMeta.lastReviewed) + '</div>' : '') +
      "</div>";
  }

  var API = {
    renderSummary: renderSummary, renderAggregates: renderAggregates,
    smeDashboard: smeDashboard, renderSmeDashboard: renderSmeDashboard,
    monthlySmeReport: monthlySmeReport, whatsappSmeSummary: whatsappSmeSummary,
    smeReconciliation: smeReconciliation, renderSmeReconciliation: renderSmeReconciliation,
    smeCashflowIntelligence: smeCashflowIntelligence, renderSmeCashflowIntelligence: renderSmeCashflowIntelligence,
    renderFindings: renderFindings, renderAllTxns: renderAllTxns,
    typeOptionsHTML: typeOptionsHTML,
    findingsCSV: findingsCSV, demandLetter: demandLetter, reportMeta: reportMeta,
    fmtN: fmtN, fmtDate: fmtDate, esc: esc, VERDICT_META: VERDICT_META
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_REPORT = API;

})(typeof window !== "undefined" ? window : globalThis);
