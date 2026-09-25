"use strict";
var fs = require("fs"), path = require("path");

module.exports = function (check) {
  var previousStorage = global.localStorage;
  var data = {};
  global.localStorage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, value) { data[key] = String(value); }
  };
  delete require.cache[require.resolve("../js/paid-reports.js")];
  var reports = require("../js/paid-reports.js");
  var fp = "a".repeat(64);
  var charge = { index: 1, date: new Date("2026-01-15T00:00:00Z"), narration: "TRANSFER CHARGE", debit: 25, credit: 0, balance: 1000 };
  charge.vatParent = { narration: "duplicate link that must not be stored" };
  var audit = {
    findings: [{ txnIndex: 1, txn: charge, verdict: "violation", typeName: "Transfer fee", charged: 25, allowed: 10, excess: 15, reason: "Over cap", citation: "CBN guide" }],
    aggregates: [],
    summary: { counts: { violation: 1 }, refundDue: 15, underReview: 0, period: { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-06-30T00:00:00Z") }, txnCount: 300, chargeCount: 1 },
    bankProfile: { id: "gtbank", name: "Guaranty Trust Bank Ltd (GTBank)" }
  };

  check("paid reports: malformed fingerprints are never saved", reports.save("bad", audit, {}, {}) === false && reports.list().length === 0);
  check("paid reports: paid findings save locally", reports.save(fp, audit, { accountType: "current", holderType: "business", salaryAccount: false, secret: "drop me" }, { fileName: "statement.pdf", pageCount: 10 }));
  var listed = reports.list();
  check("paid reports: return list contains useful non-ledger summary", listed.length === 1 && listed[0].fingerprint === fp && listed[0].bankName.includes("GTBank") && listed[0].refundDue === 15);
  var raw = data[reports.storeKey];
  check("paid reports: redundant transaction links and arbitrary context are not persisted", !raw.includes("duplicate link") && !raw.includes("drop me"));
  var loaded = reports.load(fp);
  check("paid reports: dates revive for report rendering and exports", loaded.audit.findings[0].txn.date instanceof Date && loaded.audit.summary.period.from instanceof Date && loaded.audit.summary.period.to instanceof Date);
  check("paid reports: saved context and source restore", loaded.ctx.holderType === "business" && loaded.source.fileName === "statement.pdf" && loaded.source.pageCount === 10);

  reports.save(fp, Object.assign({}, audit, { summary: Object.assign({}, audit.summary, { refundDue: 20 }) }), {}, {});
  check("paid reports: resaving replaces rather than duplicates a report", reports.list().length === 1 && reports.list()[0].refundDue === 20);
  for (var i = 0; i < reports.maxReports + 2; i++) reports.save(i.toString(16).padStart(64, "0"), audit, {}, {});
  check("paid reports: local history is bounded", reports.list().length === reports.maxReports);
  var newest = reports.list()[0].fingerprint;
  check("paid reports: a local copy can be removed", reports.remove(newest) && reports.load(newest) === null && reports.list().length === reports.maxReports - 1);

  var html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  var app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
  check("paid reports: landing page exposes the return path", html.includes('id="btn-saved-reports"') && html.includes('id="saved-reports-list"') && app.includes("openSavedReport"));
  check("paid reports: reopening verifies payment before loading local data", app.indexOf("PAYWALL.restore(fingerprint)") < app.indexOf("PAID_REPORTS.load(fingerprint)"));
  check("paid reports: privacy copy distinguishes local findings from the original file", html.includes("statement file is never uploaded or shared") && fs.readFileSync(path.join(__dirname, "../js/paywall.js"), "utf8").includes("original file and full transaction ledger are not saved"));

  global.localStorage = previousStorage;
};
