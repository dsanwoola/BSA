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
    renderFindings: renderFindings, renderAllTxns: renderAllTxns,
    typeOptionsHTML: typeOptionsHTML,
    findingsCSV: findingsCSV, demandLetter: demandLetter, reportMeta: reportMeta,
    fmtN: fmtN, fmtDate: fmtDate, esc: esc, VERDICT_META: VERDICT_META
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_REPORT = API;

})(typeof window !== "undefined" ? window : globalThis);
