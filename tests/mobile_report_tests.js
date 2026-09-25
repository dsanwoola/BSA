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
};
