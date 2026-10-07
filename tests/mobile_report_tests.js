"use strict";
var fs = require("fs"), path = require("path");

module.exports = function (check) {
  var REPORT = require("../js/report.js");
  var css = fs.readFileSync(path.join(__dirname, "../css/app.css"), "utf8");
  var audit = {
    findings: [
      { verdict: "violation", typeName: "Transfer fee", charged: 50, allowed: 10, excess: 40,
        txn: { date: new Date("2026-02-03T00:00:00Z"), narration: "NIP TRANSFER <TEST>" },
        reason: "The fee exceeds the cap.", math: "₦50 - ₦10 = ₦40", citation: "CBN transfer fee rule" },
      { verdict: "compliant", typeName: "SMS alert", charged: 4, allowed: 4, excess: 0,
        txn: { date: new Date("2026-02-04T00:00:00Z"), narration: "SMS ALERT" },
        reason: "Within the cap.", math: "", citation: "CBN SMS rule" }
    ]
  };
  var html = REPORT.renderFindings(audit, "all");
  check("mobile report: findings render inside a table-style wrapper", html.includes('class="findings-table"') && html.includes('class="findings-table-head"'));
  check("mobile report: compact header exposes result, charge and amount columns", html.includes("<span>Result</span><span>Charge</span><span>Amount</span>"));
  check("mobile report: each row remains a native keyboard-accessible disclosure", (html.match(/<details class="finding/g) || []).length === 2 && !/<details[^>]* open/.test(html));
  check("mobile report: collapsed row contains verdict, narration, date, type and amount", html.includes("VIOLATION") && html.includes("NIP TRANSFER &lt;TEST&gt;") && html.includes("03 Feb 2026") && html.includes("Transfer fee") && html.includes("₦50.00"));
  check("mobile report: expanded area labels the reason, calculation and CBN basis", html.includes("Why flagged") && html.includes("Calculation") && html.includes("CBN basis") && html.includes("₦50 - ₦10 = ₦40") && html.includes("CBN transfer fee rule"));
  check("mobile report: row toggle is decorative while disclosure supplies semantics", html.includes('class="f-toggle" aria-hidden="true"') && html.includes('class="badge-label">VIOLATION'));
  var violations = REPORT.renderFindings(audit, "violation");
  check("mobile report: filters keep the same table presentation", violations.includes("findings-table-head") && violations.includes("NIP TRANSFER") && !violations.includes("SMS ALERT"));
  check("mobile report: empty filters stay concise", !REPORT.renderFindings(audit, "review").includes("findings-table-head") && REPORT.renderFindings(audit, "review").includes("No findings"));
  check("mobile report: phone layout uses aligned table columns and tap-sized rows", css.includes("grid-template-columns: 54px minmax(0, 1fr) 78px 18px") && css.includes("min-height: 64px") && css.includes(".findings-table-head"));
  check("mobile report: expanded information uses labeled two-column detail rows", css.includes(".f-detail-row { display: grid; grid-template-columns: 82px minmax(0, 1fr)") && css.includes('.finding[open] .f-toggle::before'));

  var healthAudit = {
    findings: audit.findings,
    aggregates: [],
    summary: { txnCount: 16, totalCharges: 54, refundDue: 40 }
  };
  var health = REPORT.statementHealth(healthAudit, {
    duplicateRowsMerged: 1, excludedRowCount: 0, hasBalance: true,
    balanceRatio: 1, reconciliationFailed: false
  });
  var healthHtml = REPORT.renderHealthScore(health);
  check("health score: sample audit produces 72 out of 100", health.score === 72, JSON.stringify(health));
  check("health score: breakdown contains the five requested categories", ["Charge clarity", "Duplicate risk", "CBN compliance risk", "Unexplained deductions", "Refund potential"].every(function (label) { return health.categories.some(function (item) { return item.label === label; }); }));
  check("health score: mobile card uses native disclosures and visible numeric scores", healthHtml.includes("Your Bank Statement Health Score") && healthHtml.includes(">72</strong><span>/100</span>") && (healthHtml.match(/<details class="health-factor/g) || []).length === 5);
  check("health score: progress values have accessible labels and do not rely on colour", (healthHtml.match(/role="progressbar"/g) || []).length === 5 && healthHtml.includes("Strong.") && healthHtml.includes("High concern."));
  check("health score: explains that the result is not a credit score", healthHtml.includes("not a credit score or bank rating"));
  var cleanHealth = REPORT.statementHealth({ findings: [], aggregates: [], summary: { txnCount: 20, totalCharges: 0, refundDue: 0 } }, { duplicateRowsMerged: 0, excludedRowCount: 0, hasBalance: true, balanceRatio: 1 });
  check("health score: a clean statement scores higher than a risky statement", cleanHealth.score === 100 && cleanHealth.score > health.score);
  var uncertainHealth = REPORT.statementHealth({ findings: [], aggregates: [], summary: { txnCount: 20, totalCharges: 0, refundDue: 0 } }, { excludedRowCount: 1, hasBalance: false, reconciliationFailed: true });
  check("health score: read-quality failures reduce the score and explain why", uncertainHealth.score < cleanHealth.score && uncertainHealth.categories[0].detail.includes("running balance could not be checked") && uncertainHealth.categories[3].detail.includes("needs reconciliation"));
  check("health score: phone styles keep the card compact with tap-sized rows", css.includes(".health-score-ring") && css.includes(".health-factor > summary") && css.includes("min-height: 52px"));
};
