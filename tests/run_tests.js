/* =========================================================================
 * TEST SUITE — run with:  node tests/run_tests.js
 * Verifies the parser and the audit engine against known CBN scenarios.
 * ========================================================================= */
"use strict";
var fs = require("fs");

var PARSER = require("../js/parser.js");
var ENGINE = require("../js/engine.js");
var RULES = require("../js/rules.js");
var PATTERNS = require("../js/patterns.js");

var passed = 0, failed = 0, failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(name + (detail ? "  [" + detail + "]" : "")); }
}
function D(y, m, d) { return new Date(y, m - 1, d); }
function T(idx, date, narration, debit, credit, balance) {
  return { index: idx, date: date, narration: narration, debit: debit || 0, credit: credit || 0, balance: balance === undefined ? null : balance };
}
function findFor(res, idx) { return res.findings.find(function (f) { return f.txnIndex === idx; }); }

var CTX_SAVINGS = { accountType: "savings", holderType: "individual", salaryAccount: false };
var CTX_CURRENT = { accountType: "current", holderType: "individual", salaryAccount: false };

/* ---------------- parser: amounts ---------------- */
check("amount: comma", PARSER.parseAmount("1,234.56") === 1234.56);
check("amount: naira sign", PARSER.parseAmount("₦1,000") === 1000);
check("amount: NGN prefix", PARSER.parseAmount("NGN 2,500.00") === 2500);
check("amount: parentheses negative", PARSER.parseAmount("(500.00)") === -500);
check("amount: empty is zero", PARSER.parseAmount("") === 0);
check("amount: dash is zero", PARSER.parseAmount("-") === 0);
check("amount: garbage is null (never guessed)", PARSER.parseAmount("abc") === null);
var drAmt = PARSER.parseAmount("1500.00 DR");
check("amount: DR suffix", drAmt && drAmt.amount === 1500 && drAmt.drcr === "DR");

/* ---------------- parser: dates (day-first) ---------------- */
var dt = PARSER.parseDate("01/02/2025");
check("date: dd/mm/yyyy is day-first", dt && dt.getDate() === 1 && dt.getMonth() === 1 && dt.getFullYear() === 2025);
dt = PARSER.parseDate("2025-02-01");
check("date: ISO", dt && dt.getDate() === 1 && dt.getMonth() === 1);
dt = PARSER.parseDate("15-Mar-24");
check("date: dd-MMM-yy", dt && dt.getDate() === 15 && dt.getMonth() === 2 && dt.getFullYear() === 2024);
dt = PARSER.parseDate("01-Apr-26 89");
check("date: PremiumTrust date with trailing reference fragment", dt && dt.getDate() === 1 && dt.getMonth() === 3 && dt.getFullYear() === 2026);
dt = PARSER.parseDate("April 30, 2026");
check("date: full month name", dt && dt.getDate() === 30 && dt.getMonth() === 3 && dt.getFullYear() === 2026);
dt = PARSER.parseDate("01/May/2026");
check("date: dd/MMM/yyyy slash month", dt && dt.getDate() === 1 && dt.getMonth() === 4 && dt.getFullYear() === 2026);
dt = PARSER.parseDate("4/14/2026");
check("date: non-zero-padded M/d/yyyy Polaris style", dt && dt.getDate() === 14 && dt.getMonth() === 3 && dt.getFullYear() === 2026);
check("date: invalid is null", PARSER.parseDate("99/99/2024") === null);
check("date: 31/02 rejected", PARSER.parseDate("31/02/2024") === null);

/* ---------------- parser: CSV ---------------- */
var rows = PARSER.parseCSVText('Date,Narration,Debit,Credit,Balance\n"01/05/2025","NIP/TRF TO JOHN, DOE","10,000.00","","90,000.00"');
check("csv: quoted comma survives", rows[1][1] === "NIP/TRF TO JOHN, DOE");
var det = PARSER.detectColumns(rows);
check("csv: columns detected", det && det.map.date === 0 && det.map.narration === 1 && det.map.debit === 2 && det.map.balance === 4);
var built = PARSER.buildTransactions(rows, det.headerRow, det.map);
check("csv: txn built", built.txns.length === 1 && built.txns[0].debit === 10000);

var monieRows = [
  ["Date", "Narration", "Reference", "Debit", "Credit", "Balance"],
  ["2025-02-18T15:", "TRANSFER TO SAMPLE PERSON", "", "", "", ""],
  ["24:02", "Sample bank transfer", "REF_DEBIT_0", "15,020.00", "0.00", "16,922.50"],
  ["2025-02-18T17: 09:51", "Sample credit", "REF_CREDIT_0", "0.00", "16,000.00", "32,922.50"]
];
var monieDet = PARSER.detectColumns(monieRows);
var monieBuilt = PARSER.buildTransactions(monieRows, monieDet.headerRow, monieDet.map);
check("parser: Moniepoint split ISO datetime rejoins time-only amount row", monieBuilt.problems.length === 0 && monieBuilt.txns.length === 2 && monieBuilt.txns[0].date.getFullYear() === 2025 && monieBuilt.txns[0].date.getMonth() === 1 && monieBuilt.txns[0].date.getDate() === 18 && monieBuilt.txns[0].debit === 15020, JSON.stringify(monieBuilt.problems));

var providusRows = [
  ["TXN DATE", "VAL DATE", "REMARKS", "DEBIT", "CREDIT", "BALANCE"],
  ["01/01/2026", "01/01/2026", "Balance B/F", "", "", "1,000.00"],
  ["02/01/2026", "02/01/2026", "PDF-anchored debit value under credit column", "", "100.00", "900.00"],
  ["03/01/2026", "03/01/2026", "Normal debit column", "50.00", "", "850.00"],
  ["04/01/2026", "04/01/2026", "PDF-anchored credit value under debit column", "25.00", "", "875.00"]
];
var providusDet = PARSER.detectColumns(providusRows);
var providusBuilt = PARSER.buildTransactions(providusRows, providusDet.headerRow, providusDet.map);
check("parser: balance-proven money side repair handles misanchored PDF amounts", providusBuilt.moneySideRepairs === 2 && providusBuilt.txns[0].debit === 100 && providusBuilt.txns[0].credit === 0 && providusBuilt.txns[2].debit === 0 && providusBuilt.txns[2].credit === 25 && PARSER.integrityCheck(providusBuilt.txns).ratio === 1, JSON.stringify({repairs: providusBuilt.moneySideRepairs, txns: providusBuilt.txns, ic: PARSER.integrityCheck(providusBuilt.txns)}));

/* ---------------- classifier ---------------- */
function cls(s) { var c = PATTERNS.classify(s); return c ? c.type : null; }
check("classify: COT", cls("COT CHARGE FOR APRIL") === "cot");
check("classify: card maintenance", cls("CARD MAINT FEE Q2") === "card_maintenance");
check("classify: CAMF", cls("ACCOUNT MAINTENANCE FEE APRIL") === "camf");
check("classify: SMS", cls("SMS ALERT CHARGES 01APR-30APR") === "sms_alert");
check("classify: VAT beats fee words", cls("VAT ON NIP TRANSFER CHARGE") === "vat");
check("classify: EMTL", cls("ELECTRONIC MONEY TRANSFER LEVY") === "levy");
check("classify: stamp duty", cls("STAMP DUTY") === "levy");
check("classify: NIP fee", cls("NIP TRANSFER CHARGE") === "eft");
check("classify: USSD fee", cls("USSD SESSION CHARGE") === "eft");
check("classify: plain transfer is NOT a charge", cls("NIP/TRF TO JOHN DOE/GTB/REF123") === null);
check("classify: POS purchase is NOT a charge", cls("POS PURCHASE COFFEE PALACE LAGOS") === null);
check("classify: merchant named CHARGERS is NOT a charge", cls("WEB PURCHASE CHARGERS LTD") === null);
check("classify: generic fee -> unknown (review)", cls("XYZ SERVICE CHARGE") === "unknown_charge");
check("classify: ATM fee", cls("ATM WD FEE NOT-ON-US") === "atm_fee");
check("classify: ATM withdrawal is NOT a charge", cls("ATM WD IKEJA LAGOS") === null);
check("classify: dormancy", cls("DORMANCY FEE") === "account_reactivation");
check("classify: SMSALERT one-word", cls("SMSALERT TXN CHARGES") === "sms_alert");
check("classify: leading /charge| fee line", cls("/charge|FT/CIB/Goods/NEIGHBOURS NG TECH NIG LTD") === "eft");
check("classify: leading charge with GTL channel", cls("/charge|FT/GTL/LAMIDI RAS/LAMIDI RASHEED OYE") === "eft");
check("classify: fused /chargeFT variant", cls("/chargeFT/CIB/Comm Sept 14th to 27th/TITILOLA") === "eft");
check("classify: card issuance", cls("DEBIT CARD ISSUANCE FEE") === "card_issuance");
check("classify: non-clearing withdrawal slip", cls("NON CLEARING WITHDRAWAL SLIP 100 LEAVES") === "nonclearing_slip");
check("classify: credit card interest", cls("CREDIT CARD INTEREST CHARGE") === "credit_card_interest");
check("classify: premium minimum-balance forfeiture", cls("GOLD PREMIUM MINIMUM BALANCE FORFEITURE") === "premium_account_forfeiture");
check("classify: treasury bill processing", cls("TREASURY BILL PROCESSING FEE") === "treasury_bill_processing");

/* ---------------- engine: prohibited charges ---------------- */
var res = ENGINE.audit([T(0, D(2025, 5, 10), "COT CHARGE", 1200, 0)], CTX_CURRENT);
var f = findFor(res, 0);
check("COT is a violation", f.verdict === "violation" && f.excess === 1200);

res = ENGINE.audit([T(0, D(2025, 5, 10), "ACCOUNT CLOSURE FEE", 1000, 0)], CTX_CURRENT);
check("closure fee is a violation", findFor(res, 0).verdict === "violation");

/* ---------------- engine: card maintenance ---------------- */
res = ENGINE.audit([T(0, D(2025, 5, 10), "CARD MAINT FEE", 50, 0)], CTX_CURRENT);
check("card maint on CURRENT acct = violation", findFor(res, 0).verdict === "violation" && findFor(res, 0).excess === 50);

res = ENGINE.audit([T(0, D(2025, 5, 10), "CARD MAINT FEE", 53.75, 0)], CTX_SAVINGS);
check("card maint ₦53.75 on savings = compliant (VAT-inclusive)", findFor(res, 0).verdict === "compliant");

res = ENGINE.audit([T(0, D(2025, 5, 10), "CARD MAINT FEE", 100, 0)], CTX_SAVINGS);
f = findFor(res, 0);
check("card maint ₦100 on savings = violation", f.verdict === "violation" && Math.abs(f.excess - 46.25) < 0.02, "excess=" + f.excess);

res = ENGINE.audit([
  T(0, D(2025, 4, 5), "CARD MAINT FEE", 50, 0),
  T(1, D(2025, 6, 20), "CARD MAINT FEE", 50, 0)
], CTX_SAVINGS);
var dupAgg = res.aggregates.find(function (a) { return a.id.indexOf("cardq") === 0; });
check("card maint twice in same quarter = aggregate violation", dupAgg && dupAgg.verdict === "violation" && dupAgg.excess === 50);

res = ENGINE.audit([
  T(0, D(2025, 3, 5), "CARD MAINT FEE", 50, 0),
  T(1, D(2025, 4, 20), "CARD MAINT FEE", 50, 0)
], CTX_SAVINGS);
check("card maint in different quarters = no duplicate flag",
  !res.aggregates.some(function (a) { return a.id.indexOf("cardq") === 0 && a.verdict === "violation"; }));

/* ---------------- engine: CAMF ---------------- */
res = ENGINE.audit([T(0, D(2025, 5, 31), "ACCOUNT MAINTENANCE FEE", 200, 0)], CTX_SAVINGS);
check("CAMF on savings = violation, full refund", findFor(res, 0).verdict === "violation" && findFor(res, 0).excess === 200);

// full May 2025 coverage; turnover 100,000 -> cap ₦100 ex-VAT; charged ₦150 (no separate VAT -> ex-VAT 139.53)
res = ENGINE.audit([
  T(0, D(2025, 5, 1), "POS PURCHASE SHOPRITE", 60000, 0),
  T(1, D(2025, 5, 15), "NIP/TRF TO VENDOR LTD", 40000, 0),
  T(2, D(2025, 5, 31), "ACCOUNT MAINTENANCE FEE MAY", 150, 0),
  T(3, D(2025, 5, 31), "POS PURCHASE FILLING STATION", 1, 0)
], CTX_CURRENT);
var camfAgg = res.aggregates.find(function (a) { return a.id.indexOf("camf") === 0; });
check("CAMF recompute flags overcharge", camfAgg && camfAgg.verdict === "violation", camfAgg && camfAgg.detail);
check("CAMF overcharge amount ≈ ₦39.53", camfAgg && Math.abs(camfAgg.excess - 39.53) < 0.05, camfAgg && "excess=" + camfAgg.excess);

// compliant CAMF: turnover 100,001 -> cap 100; charged 100 ex-VAT equivalent 107.50 bundled
res = ENGINE.audit([
  T(0, D(2025, 5, 1), "POS PURCHASE SHOPRITE", 100001, 0),
  T(1, D(2025, 5, 31), "ACCOUNT MAINTENANCE FEE MAY", 107.5, 0)
], CTX_CURRENT);
camfAgg = res.aggregates.find(function (a) { return a.id.indexOf("camf") === 0; });
check("CAMF within cap = compliant", camfAgg && camfAgg.verdict === "compliant", camfAgg && camfAgg.detail);

// incomplete month -> advisory, never a verdict
res = ENGINE.audit([
  T(0, D(2025, 5, 10), "POS PURCHASE", 50000, 0),
  T(1, D(2025, 5, 31), "ACCOUNT MAINTENANCE FEE MAY", 500, 0)
], CTX_CURRENT);
camfAgg = res.aggregates.find(function (a) { return a.id.indexOf("camf") === 0; });
check("CAMF with partial month = advisory (no guessing)", camfAgg && camfAgg.verdict === "advisory");

/* ---------------- engine: EFT fees ---------------- */
res = ENGINE.audit([
  T(0, D(2025, 5, 10), "NIP/TRF TO MAMA PUT KITCHEN", 3000, 0),
  T(1, D(2025, 5, 10), "NIP TRANSFER CHARGE", 26.88, 0)
], CTX_SAVINGS);
f = findFor(res, 1);
check("₦26.88 fee on ₦3,000 transfer = violation", f.verdict === "violation", f.verdict + " " + f.math);
check("EFT excess ≈ ₦16.13", Math.abs(f.excess - 16.13) < 0.02, "excess=" + f.excess);

res = ENGINE.audit([
  T(0, D(2025, 5, 10), "NIP/TRF TO VENDOR LTD", 30000, 0),
  T(1, D(2025, 5, 10), "NIP TRANSFER CHARGE", 26.88, 0)
], CTX_SAVINGS);
check("₦26.88 fee on ₦30,000 transfer = compliant", findFor(res, 1).verdict === "compliant");

res = ENGINE.audit([T(0, D(2025, 5, 10), "NIP TRANSFER CHARGE", 53.75, 0)], CTX_SAVINGS);
check("unlinked fee at absolute ceiling = compliant", findFor(res, 0).verdict === "compliant");

res = ENGINE.audit([T(0, D(2025, 5, 10), "NIP TRANSFER CHARGE", 80, 0)], CTX_SAVINGS);
check("unlinked ₦80 transfer fee = violation (beyond any tier)", findFor(res, 0).verdict === "violation");

/* ---------------- engine: VAT pairing ---------------- */
res = ENGINE.audit([
  T(0, D(2025, 5, 10), "NIP/TRF TO VENDOR LTD", 30000, 0),
  T(1, D(2025, 5, 10), "NIP TRANSFER CHARGE", 25, 0),
  T(2, D(2025, 5, 10), "VAT ON NIP TRANSFER CHARGE", 1.88, 0)
], CTX_SAVINGS);
check("VAT at 7.5% of fee = compliant", findFor(res, 2).verdict === "compliant");
check("fee with separate VAT judged ex-VAT", findFor(res, 1).verdict === "compliant");

res = ENGINE.audit([T(0, D(2025, 5, 10), "VAT CHARGE", 500, 0)], CTX_SAVINGS);
check("orphan VAT = review (no guessing)", findFor(res, 0).verdict === "review");

/* ---------------- engine: levy (EMTL / stamp duty) ---------------- */
res = ENGINE.audit([
  T(0, D(2025, 5, 10), "NIP/TRF FROM EMPLOYER LTD", 0, 250000),
  T(1, D(2025, 5, 10), "STAMP DUTY", 50, 0)
], CTX_SAVINGS);
check("₦50 EMTL with qualifying inflow = compliant", findFor(res, 1).verdict === "compliant");

res = ENGINE.audit([
  T(0, D(2025, 5, 10), "NIP/TRF FROM CLIENT A", 0, 20000),
  T(1, D(2025, 5, 10), "STAMP DUTY", 50, 0),
  T(2, D(2025, 5, 12), "STAMP DUTY", 50, 0),
  T(3, D(2025, 5, 20), "STAMP DUTY", 50, 0)
], CTX_SAVINGS);
var levyAgg = res.aggregates.find(function (a) { return a.id.indexOf("levy") === 0; });
check("3 levies but 1 qualifying inflow = over-collection of ₦100",
  levyAgg && levyAgg.verdict === "violation" && levyAgg.excess === 100, levyAgg && levyAgg.detail);

res = ENGINE.audit([T(0, D(2025, 5, 10), "STAMP DUTY", 53.75, 0)], CTX_SAVINGS);
check("levy with VAT added = violation (no VAT on EMTL)", findFor(res, 0).verdict === "violation");

res = ENGINE.audit([
  T(0, D(2025, 5, 10), "NIP/TRF FROM EMPLOYER", 0, 500000),
  T(1, D(2025, 5, 10), "STAMP DUTY", 50, 0)
], { accountType: "savings", holderType: "individual", salaryAccount: true });
check("levy on salary account = violation", findFor(res, 1).verdict === "violation");

// 2026 regime: trigger is outgoing transfers
res = ENGINE.audit([
  T(0, D(2026, 2, 10), "NIP/TRF TO LANDLORD", 300000, 0),
  T(1, D(2026, 2, 10), "STAMP DUTY", 50, 0)
], CTX_SAVINGS);
check("2026 stamp duty on outgoing transfer = compliant", findFor(res, 1).verdict === "compliant");

/* ---------------- engine: SMS ---------------- */
res = ENGINE.audit([T(0, D(2024, 6, 10), "SMS ALERT CHARGE", 4, 0)], CTX_SAVINGS);
check("₦4 SMS in 2024 = compliant", findFor(res, 0).verdict === "compliant");
res = ENGINE.audit([T(0, D(2025, 5, 10), "SMS ALERT CHARGE", 6, 0)], CTX_SAVINGS);
check("₦6 SMS in 2025 = compliant", findFor(res, 0).verdict === "compliant");
res = ENGINE.audit([T(0, D(2025, 5, 31), "SMS ALERT CHARGES APRIL", 168, 0)], CTX_SAVINGS);
check("₦168 bulk SMS (28×₦6) = advisory with count", findFor(res, 0).verdict === "advisory" && /28/.test(findFor(res, 0).reason));
res = ENGINE.audit([T(0, D(2025, 5, 31), "SMS ALERT CHARGE", 7.34, 0)], CTX_SAVINGS);
check("odd SMS amount = review", findFor(res, 0).verdict === "review");

/* ---------------- engine: ATM ---------------- */
// pre-2025: 5 withdrawals, 3 fees, full month -> only 2 chargeable -> 1 extra
res = ENGINE.audit([
  T(0, D(2024, 6, 1), "POS PURCHASE OPENER", 100, 0),
  T(1, D(2024, 6, 3), "ATM WD ZENITH IKEJA", 10000, 0),
  T(2, D(2024, 6, 3), "ATM WD FEE", 35, 0),
  T(3, D(2024, 6, 10), "ATM WD UBA SURULERE", 10000, 0),
  T(4, D(2024, 6, 10), "ATM WD FEE", 35, 0),
  T(5, D(2024, 6, 20), "ATM WD ACCESS YABA", 10000, 0),
  T(6, D(2024, 6, 20), "ATM WD FEE", 35, 0),
  T(7, D(2024, 6, 25), "ATM WD GTB VI", 5000, 0),
  T(8, D(2024, 6, 26), "ATM WD FCMB IKOYI", 5000, 0),
  T(9, D(2024, 6, 30), "POS PURCHASE CLOSER", 100, 0)
], CTX_SAVINGS);
var atmAgg = res.aggregates.find(function (a) { return a.id.indexOf("atm3") === 0; });
check("pre-2025 ATM: 5 wd, 3 fees -> 1 fee refundable",
  atmAgg && atmAgg.verdict === "violation" && atmAgg.excess === 35, atmAgg && atmAgg.detail);

res = ENGINE.audit([T(0, D(2024, 6, 3), "ATM WD FEE", 100, 0)], CTX_SAVINGS);
check("pre-2025 ATM fee above ₦35 = violation", findFor(res, 0).verdict === "violation");

// post-2025
res = ENGINE.audit([T(0, D(2025, 5, 3), "ATM WD FEE", 107.5, 0)], CTX_SAVINGS);
check("post-2025 ₦107.50 ATM fee = compliant", findFor(res, 0).verdict === "compliant");
res = ENGINE.audit([T(0, D(2025, 5, 3), "ATM WD FEE", 700, 0)], CTX_SAVINGS);
check("post-2025 ₦700 unlinked = review (could be multi-block)", findFor(res, 0).verdict === "review");
res = ENGINE.audit([
  T(0, D(2025, 5, 3), "ATM WD ZENITH IKEJA", 40000, 0),
  T(1, D(2025, 5, 3), "ATM WD FEE", 215, 0)
], CTX_SAVINGS);
check("post-2025 ₦215 on ₦40k withdrawal = compliant (2 blocks)", findFor(res, 1).verdict === "compliant");
res = ENGINE.audit([
  T(0, D(2025, 5, 3), "ATM WD ZENITH IKEJA", 20000, 0),
  T(1, D(2025, 5, 3), "ATM WD FEE", 1500, 0)
], CTX_SAVINGS);
f = findFor(res, 1);
check("post-2025 ₦1,500 on ₦20k withdrawal = violation", f.verdict === "violation" && Math.abs(f.excess - 855) < 0.02, f && "excess=" + f.excess);

/* ------- customer payments with "commission/charge" wording ------- */
// real case: account holder pays commissions to agents; narrations contain
// fee words. The bank's actual fee (26.88) mirrors the parent's narration.
res = ENGINE.audit([
  T(0, D(2025, 3, 12), "/charge|FT/CIB/COMMISSION For kiosk space /YEMI FATIMAH OSH", 26.88, 0),
  T(1, D(2025, 3, 12), "FT/CIB/COMMISSION For kiosk space /YEMI FATIMAH OSHIMODI", 13000, 0)
], CTX_CURRENT);
check("twin: customer payment auto-cleared, no violation",
  res.summary.refundDue === 0 && !res.findings.some(function (x) { return x.txnIndex === 1; }),
  "refund=" + res.summary.refundDue + " findings=" + JSON.stringify(res.findings.map(function (x) { return [x.txnIndex, x.verdict]; })));
f = findFor(res, 0);
check("twin: the 26.88 fee line itself is compliant (tier of ₦13,000 parent)", f && f.verdict === "compliant", f && f.verdict + " " + f.math);

// fee line AFTER the parent works the same
res = ENGINE.audit([
  T(0, D(2025, 3, 12), "FT/CIB/COMMISSION For kiosk space /YEMI FATIMAH OSHIMODI", 13000, 0),
  T(1, D(2025, 3, 12), "/charge|FT/CIB/COMMISSION For kiosk space /YEMI FATIMAH OSH", 26.88, 0)
], CTX_CURRENT);
check("twin: order-independent (fee after parent)",
  res.summary.refundDue === 0 && findFor(res, 1) && findFor(res, 1).verdict === "compliant");

// a lone large "commission" debit -> review, never a violation
res = ENGINE.audit([T(0, D(2025, 3, 12), "FT/UTO/COMMISSION PAYMENT TO AGENTS MARCH", 50000, 0)], CTX_CURRENT);
f = findFor(res, 0);
check("suspect: lone large commission debit = review, not violation",
  f && f.verdict === "review" && res.summary.refundDue === 0, f && f.verdict);

// a real fee overcharge with a mirrored parent is still caught exactly
res = ENGINE.audit([
  T(0, D(2025, 3, 12), "FT/CIB/For kiosk space /YEMI FATIMAH OSHIMODI", 3000, 0),
  T(1, D(2025, 3, 12), "/charge|FT/CIB/For kiosk space /YEMI FATIMAH OSH", 80, 0)
], CTX_CURRENT);
f = findFor(res, 1);
check("twin: ₦80 fee on mirrored ₦3,000 parent = violation at the ₦10 tier",
  f && f.verdict === "violation" && Math.abs(f.excess - 69.25) < 0.02, f && f.verdict + " excess=" + f.excess);

// genuine standard fees are untouched by the refinement
res = ENGINE.audit([
  T(0, D(2025, 5, 10), "NIP/TRF TO MAMA ADE FOODS", 3000, 0),
  T(1, D(2025, 5, 10), "NIP TRANSFER CHARGE", 26.88, 0)
], CTX_SAVINGS);
check("twin: standard fee-tier violations still caught", findFor(res, 1).verdict === "violation");

/* ---------------- engine: honest defaults ---------------- */
res = ENGINE.audit([T(0, D(2025, 5, 10), "XYZ SERVICE CHARGE", 5000, 0)], CTX_SAVINGS);
check("unknown charge = review, never guessed", findFor(res, 0).verdict === "review");

res = ENGINE.audit([T(0, D(2019, 5, 10), "NIP TRANSFER CHARGE", 52.5, 0)], CTX_SAVINGS);
check("pre-2020 txn = review (outside rule coverage)", findFor(res, 0).verdict === "review");

/* ---------------- engine: overrides ---------------- */
res = ENGINE.audit([T(0, D(2025, 5, 10), "MYSTERY DEBIT 001", 75, 0)],
  { accountType: "savings", holderType: "individual", overrides: { 0: "cot" } });
check("manual reclassification works", findFor(res, 0) && findFor(res, 0).verdict === "violation");

res = ENGINE.audit([T(0, D(2025, 5, 10), "XYZ SERVICE CHARGE", 75, 0)],
  { accountType: "savings", holderType: "individual", overrides: { 0: "ignore" } });
check("manual 'not a charge' works", res.findings.length === 0);

/* ---------------- uploaded CBN guide: additional charge caps ---------------- */
res = ENGINE.audit([T(0, D(2025, 5, 10), "CHEQUE BOOK 50 LEAVES", 1612.50, 0)], CTX_CURRENT);
check("CBN guide: 50-leaf cheque book ₦1,500+VAT compliant", findFor(res, 0).verdict === "compliant");
res = ENGINE.audit([T(0, D(2025, 5, 10), "CHEQUE BOOK 50 LEAVES", 2000, 0)], CTX_CURRENT);
check("CBN guide: 50-leaf cheque book over cap violation", findFor(res, 0).verdict === "violation");
res = ENGINE.audit([T(0, D(2025, 5, 10), "NON CLEARING WITHDRAWAL SLIP 100 LEAVES", 3150, 0)], CTX_CURRENT);
check("CBN guide: non-clearing slip 100 leaves VAT-inclusive compliant", findFor(res, 0).verdict === "compliant");
res = ENGINE.audit([T(0, D(2025, 5, 10), "BANK DRAFT FEE", 376.25, 0)], CTX_CURRENT);
check("CBN guide: current-account customer draft cap ₦350+VAT compliant", findFor(res, 0).verdict === "compliant");
res = ENGINE.audit([T(0, D(2025, 5, 10), "BANK DRAFT FEE", 600, 0)], CTX_CURRENT);
check("CBN guide: current-account customer draft over cap violation", findFor(res, 0).verdict === "violation");
res = ENGINE.audit([T(0, D(2025, 5, 10), "CREDIT CARD INTEREST CHARGE", 2500, 0)], CTX_CURRENT);
check("CBN guide: credit-card interest recognized as advisory", findFor(res, 0).verdict === "advisory");
res = ENGINE.audit([T(0, D(2025, 5, 10), "TREASURY BILL PROCESSING FEE", 150, 0)], CTX_CURRENT);
check("CBN guide: treasury bill processing recognized as advisory", findFor(res, 0).verdict === "advisory");

/* ---------------- integrity check ---------------- */
var good = [
  T(0, D(2025, 5, 1), "OPENING", 0, 1000, 1000),
  T(1, D(2025, 5, 2), "POS PURCHASE", 200, 0, 800),
  T(2, D(2025, 5, 3), "NIP/TRF FROM A", 0, 500, 1300)
];
var ic = PARSER.integrityCheck(good);
check("integrity: clean statement scores 100%", ic.ratio === 1);
var bad = [
  T(0, D(2025, 5, 1), "OPENING", 0, 1000, 1000),
  T(1, D(2025, 5, 2), "POS PURCHASE", 200, 0, 999),
  T(2, D(2025, 5, 3), "NIP/TRF FROM A", 0, 500, 123)
];
check("integrity: bad mapping detected", PARSER.integrityCheck(bad).ratio === 0);

/* ---------------- summary totals ---------------- */
res = ENGINE.audit([
  T(0, D(2025, 5, 10), "COT CHARGE", 1000, 0),
  T(1, D(2025, 5, 11), "SMS ALERT CHARGE", 6, 0)
], CTX_CURRENT);
check("summary refund equals violation excess", res.summary.refundDue === 1000);
check("summary counts", res.summary.counts.violation === 1 && res.summary.counts.compliant === 1);

/* ---------------- hero section, metadata mining & checksum ---------------- */
var heroRows = [
  ["ZENITH BANK PLC", "", "", "", "", "", ""],
  ["STATEMENT OF ACCOUNT", "", "", "", "", "", ""],
  ["Account Name:", "ADEWALE MUSA", "", "", "", "", ""],
  ["Account No:", "1234567890", "Account Type:", "SAVINGS ACCOUNT", "", "", ""],
  ["Statement Period:", "01/05/2025 - 31/05/2025", "", "", "", "", ""],
  ["Opening Balance:", "100,000.00", "Closing Balance:", "99,894.00", "", "", ""],
  ["Total Debit:", "106.00", "Total Credit:", "0.00", "", "", ""],
  ["Date", "Reference", "Value Date", "Debit", "Credit", "Balance", "Remarks"],
  ["05/05/2025", "REF001", "05/05/2025", "100.00", "", "99,900.00", "ATM WD FEE"],
  ["31/05/2025", "REF002", "31/05/2025", "6.00", "", "99,894.00", "SMS ALERT CHARGE"]
];
var hdet = PARSER.detectColumns(heroRows);
check("hero: header row found below the hero section", hdet && hdet.headerRow === 7, hdet && "row=" + hdet.headerRow);
check("hero: all 7 roles mapped in the bank's arrangement",
  hdet && hdet.map.date === 0 && hdet.map.reference === 1 && hdet.map.valueDate === 2 &&
  hdet.map.debit === 3 && hdet.map.credit === 4 && hdet.map.balance === 5 && hdet.map.narration === 6);

var hmeta = PARSER.extractStatementMeta(heroRows, hdet.headerRow);
check("hero: opening balance mined", hmeta && hmeta.openingBalance === 100000);
check("hero: closing balance mined", hmeta && hmeta.closingBalance === 99894);
check("hero: totals mined", hmeta && hmeta.totalDebit === 106 && hmeta.totalCredit === 0);
check("hero: account number mined", hmeta && hmeta.accountNumber === "1234567890");
check("hero: account name mined", hmeta && hmeta.accountName === "ADEWALE MUSA");
check("hero: account type detected as savings", hmeta && hmeta.accountType === "savings");
check("hero: statement period mined", hmeta && hmeta.periodFrom && hmeta.periodFrom.getDate() === 1 &&
  hmeta.periodFrom.getMonth() === 4 && hmeta.periodTo.getDate() === 31);

var globusLikeRows = [
  ["Summary Statement for,", "2025-01-01 to 2025-12-31", "Account Number", "1000000000"],
  ["SAMPLE BUSINESS LIMITED", "Opening Balance"],
  ["Account Name"],
  ["LIMITED"],
  ["Total Withdrawals", "46,440,475.54"],
  ["Total Lodgement", "46,465,685.38"],
  ["Closing Balance", "25,209.84"],
  ["Post Date", "Value Date", "Description", "Debit", "Credit", "Balance"],
  ["1 01/1/2025", "01/1/2025", "Opening Balance", "--", "0.00", "0.00"],
  ["2 16-01-2025", "16-01-2025", "Opening credit", "--", "50,000.00", "50,000.00"]
];
var globusLikeDet = PARSER.detectColumns(globusLikeRows);
var globusLikeMeta = PARSER.extractStatementMeta(globusLikeRows, globusLikeDet.headerRow);
check("meta/globus: opening label beside statement date range does not steal date fragments as balance", globusLikeMeta && globusLikeMeta.openingBalance === null && globusLikeMeta.closingBalance === 25209.84 && globusLikeMeta.totalDebit === 46440475.54 && globusLikeMeta.totalCredit === 46465685.38, JSON.stringify(globusLikeMeta));

var hbuilt = PARSER.buildTransactions(heroRows, hdet.headerRow, hdet.map);
check("hero: txns built with reference merged into narration", hbuilt.txns.length === 2 && /REF001/.test(hbuilt.txns[0].narration));

var hrec = PARSER.reconcileWithMeta(hbuilt.txns, hmeta);
check("hero: checksum passes on a complete parse", hrec && hrec.allOk,
  hrec && hrec.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label + ": " + c.detail; }).join("; "));
var hrec2 = PARSER.reconcileWithMeta(hbuilt.txns.slice(0, 1), hmeta);
check("hero: checksum catches a missing row", hrec2 && hrec2.anyFail);

var stackedSummaryRows = [
  ["Account Statement"],
  ["Total Credit", "Total Debit"],
  ["Account Number", "691,100.98", "533,530.15"],
  ["Credit Count", "Debit Count"],
  ["Account Type", "2", "2"],
  ["Opening Balance", "Closing Balance"],
  ["₦ 124.05", "₦ 157,694.98"],
  ["Date", "Reference Number", "Transaction Details", "Credit( ₦ )", "Debit( ₦ )", "Balance( ₦ )"],
  ["01-Apr- 2026", "S84515082", "WTax.Pd", "", "0.10", "124.05"],
  ["01-Apr- 2026", "S84515082", "Int.Pd", "0.98", "", "125.03"],
  ["30-Apr- 2026", "S30127267", "Wallet credit", "691,100.00", "", "691,225.03"],
  ["30-Apr- 2026", "S30127268", "Wallet debit", "", "533,530.05", "157,694.98"]
];
var stackedDet = PARSER.detectColumns(stackedSummaryRows);
var stackedMeta = PARSER.extractStatementMeta(stackedSummaryRows, stackedDet.headerRow);
check("meta: stacked PalmPay-style totals ignore leading value-row labels", stackedMeta && stackedMeta.totalCredit === 691100.98 && stackedMeta.totalDebit === 533530.15 && stackedMeta.creditCount === 2 && stackedMeta.debitCount === 2, JSON.stringify(stackedMeta));
var stackedBuilt = PARSER.buildTransactions(stackedSummaryRows, stackedDet.headerRow, stackedDet.map);
var stackedRec = PARSER.reconcileWithMeta(stackedBuilt.txns, stackedMeta);
check("meta: stacked PalmPay-style boundary mismatch is classified separately", stackedRec && stackedRec.summaryBoundaryOnly === true, JSON.stringify(stackedRec));

var premiumRows = [
  ["Transaction Details", "Account Details"],
  ["Total Credit : 10,000.00", "Customer Name : SAMPLE CUSTOMER"],
  ["Total Debit :", "87,000.00", "Acccount Number : 0111603118"],
  ["Closing Balance : 4.70", "Acccount Type : I"],
  ["Account Statement Generated from Wednesday, April 1, 2026 to Thursday, April 30, 2026"],
  ["TRANSACTION REFERENCE"],
  ["DATE", "TRANSACTION DETAILS", "VALUE DATE", "DEBIT ()", "CREDIT ()", "BALANCE ()"],
  ["01-Apr-26 89", "Transfer out", "01-Apr-26", "10,000.00", "", "67,004.70"],
  ["10-Apr-26 20", "Transfer in", "11-Apr-26", "", "10,000.00", "77,004.70"]
];
var premiumDet = PARSER.detectColumns(premiumRows);
var premiumBuilt = PARSER.buildTransactions(premiumRows, premiumDet.headerRow, premiumDet.map);
var premiumMeta = PARSER.extractStatementMeta(premiumRows, premiumDet.headerRow);
check("premium: trailing reference date fragment stays in 2026", premiumBuilt.txns.length === 2 && premiumBuilt.txns[0].date.getFullYear() === 2026 && premiumBuilt.txns[0].date.getMonth() === 3, JSON.stringify(premiumBuilt.txns));
check("premium: misspelled Acccount Number and long-form period mined", premiumMeta && premiumMeta.accountNumber === "0111603118" && premiumMeta.periodFrom && premiumMeta.periodFrom.getDate() === 1 && premiumMeta.periodTo && premiumMeta.periodTo.getDate() === 30, JSON.stringify(premiumMeta));

var kudaRows = [
  ["Opening Balance", "Closing Balance"],
  ["LAGOS"],
  ["₦1,000.00"],
  ["₦900.00"],
  ["Summary"],
  ["Money In", "Money Out"],
  ["₦0.00", "₦100.00"],
  ["Date/Time", "Money In", "Money Out", "Description", "Balance"],
  ["01/01/26", "", "outward", "stamp duty on electronic", ""],
  ["10:00:00", "", "₦50.00 transfer", "funds transfer - 2003845475", "₦950.00"],
  ["01/01/26 10:01:00", "", "outward ₦50.00 transfer", "stamp duty on electronic funds transfer - 2003845475", "₦900.00"]
];
var kudaDet = PARSER.detectColumns(kudaRows);
var kudaBuilt = PARSER.buildTransactions(kudaRows, kudaDet.headerRow, kudaDet.map);
var kudaMeta = PARSER.extractStatementMeta(kudaRows, kudaDet.headerRow);
var kudaRec = PARSER.reconcileWithMeta(kudaBuilt.txns, kudaMeta);
check("kuda: mixed naira amount cells and split date/time rows parse", kudaBuilt.txns.length === 2 && kudaBuilt.problems.length === 0 && kudaBuilt.txns[0].debit === 50 && kudaBuilt.txns[0].date.getFullYear() === 2026, JSON.stringify(kudaBuilt));
check("kuda: summary Money In/Out and split balances reconcile", kudaMeta && kudaMeta.openingBalance === 1000 && kudaMeta.closingBalance === 900 && kudaMeta.totalDebit === 100 && kudaRec && kudaRec.allOk, JSON.stringify({ meta: kudaMeta, rec: kudaRec }));

var hres = ENGINE.audit(hbuilt.txns.map(function (t, i) {
  return { index: i, date: t.date, narration: t.narration, debit: t.debit, credit: t.credit };
}), CTX_SAVINGS);
check("hero: ATM fee still classified with merged reference", hres.findings.some(function (x) { return x.type === "atm_fee"; }));

// completely different labels, different order
var alt = PARSER.detectColumns([
  ["Money In", "Money Out", "Txn Date", "Running Balance", "Remarks"],
  ["", "500.00", "10/05/2025", "1,000.00", "POS PURCHASE"]
]);
check("hero: alternative labels in any order", alt && alt.map.credit === 0 && alt.map.debit === 1 &&
  alt.map.date === 2 && alt.map.balance === 3 && alt.map.narration === 4);

// the statement's declared period widens month coverage for cross-checks
res = ENGINE.audit([
  T(0, D(2025, 5, 10), "POS PURCHASE", 50000, 0),
  T(1, D(2025, 5, 20), "ACCOUNT MAINTENANCE FEE MAY", 500, 0)
], { accountType: "current", holderType: "individual", statementFrom: D(2025, 5, 1), statementTo: D(2025, 5, 31) });
camfAgg = res.aggregates.find(function (a) { return a.id.indexOf("camf") === 0; });
check("hero period: CAMF cross-check runs on a hero-covered month", camfAgg && camfAgg.verdict === "violation", camfAgg && camfAgg.verdict);

/* quorum rule: ≥5 recognised labels in one row = the transaction header */
var quorumRows = [
  ["ACME BANK PLC", "", "", "", "", ""],
  ["Account Statement for CHIOMA OBI", "", "", "", "", ""],
  // header uses an unknown word for the narration column — quorum still catches it
  ["Posted Date", "Reference", "Story", "Credit", "Debit", "Balance"],
  ["05/05/2025", "REF77", "ATM WD FEE", "", "100.00", "9,900.00"]
];
var qdet = PARSER.detectColumns(quorumRows);
check("quorum: header found via 5-label rule despite unknown narration label",
  qdet && qdet.headerRow === 2, qdet && "row=" + qdet.headerRow);
check("quorum: found header marked incomplete (narration unassigned)",
  qdet && qdet.complete === false && qdet.map.narration === undefined);
check("quorum: 'Posted Date' recognised as the date column", qdet && qdet.map.date === 0);
check("quorum: labels counted", qdet && qdet.labels >= 5);

// the user's exact field list, all in one row
var userList = PARSER.detectColumns([
  ["Value Date", "Reference", "Remarks", "Credit", "Debit", "Balance", "Posted Date", "Description", "Trans Date"],
  ["05/05/2025", "R1", "SMS ALERT CHARGE", "", "6.00", "994.00", "05/05/2025", "alert", "05/05/2025"]
]);
check("quorum: full field list maps completely", userList && userList.complete === true &&
  userList.map.valueDate === 0 && userList.map.reference === 1 && userList.map.narration === 2 &&
  userList.map.credit === 3 && userList.map.debit === 4 && userList.map.balance === 5);

// a transaction row can never reach the quorum
var dataRowOnly = PARSER.detectColumns([
  ["Bank of Test", "", "", "", ""],
  ["05/05/2025", "REF001", "POS PURCHASE MALL", "DR", "500.00"]
]);
check("quorum: transaction rows never qualify as headers", dataRowOnly === null);

// user manually picks the header row -> roles re-derived for that exact row
var atDet = PARSER.detectColumnsAt(heroRows, 7);
check("hero: detectColumnsAt re-derives roles for a user-picked row",
  atDet && atDet.headerRow === 7 && atDet.map.date === 0 && atDet.map.debit === 3 && atDet.map.narration === 6);
check("hero: detectColumnsAt on a hero row yields no usable mapping",
  PARSER.detectColumnsAt(heroRows, 2).map.date === undefined);
check("hero: detectColumnsAt out of range is null", PARSER.detectColumnsAt(heroRows, 99) === null);

// B/F opening row in the table itself
var bfRows = [
  ["Date", "Narration", "Debit", "Credit", "Balance"],
  ["01/05/2025", "BALANCE B/F", "", "", "5,000.00"],
  ["02/05/2025", "POS PURCHASE", "1,000.00", "", "4,000.00"]
];
var bfDet = PARSER.detectColumns(bfRows);
var bfBuilt = PARSER.buildTransactions(bfRows, bfDet.headerRow, bfDet.map);
check("hero: 'Balance B/F' table row captured as opening balance", bfBuilt.openingBalance === 5000 && bfBuilt.txns.length === 1);

/* ---------------- PDF header-anchored column extraction ---------------- */
function pit(x, w, str, y) { return { x: x, w: w, y: y, str: str }; }
var PDF = PARSER.pdfInternals;

var sterlingPage = [
  { y: 760, items: [pit(45, 90, "101,912.69", 760)] },
  { y: 746, items: [pit(45, 100, "Opening balance:", 746), pit(310, 105, "Total Credit (0):", 746), pit(420, 45, "0.00", 746), pit(470, 25, "NGN", 746)] },
  { y: 732, items: [pit(45, 90, "101,712.69", 732)] },
  { y: 718, items: [pit(45, 100, "Closing balance:", 718)] },
  { y: 704, items: [pit(310, 95, "Total Debit (1):", 704), pit(410, 55, "200.00", 704), pit(470, 25, "NGN", 704)] },
  { y: 664, items: [pit(155, 105, "Reference/Session", 664), pit(401, 20, "Money", 664), pit(441, 20, "Money", 664)] },
  { y: 658, items: [pit(45, 50, "Trans Date", 658), pit(100, 52, "Value Date", 658), pit(234, 40, "Channel", 658), pit(274, 52, "Narration", 658), pit(480, 46, "Balance", 658)] },
  { y: 652, items: [pit(155, 14, "ID", 652), pit(401, 12, "In", 652), pit(441, 18, "Out", 652)] },
  { y: 632, items: [pit(45, 60, "01/May/2026", 632), pit(100, 60, "04/May/2026", 632), pit(156, 70, "2886931494/0000012", 632), pit(235, 8, "-", 632), pit(274, 130, "Airtime purchase", 632), pit(432, 8, "-", 632), pit(444, 36, "200.00", 632), pit(500, 54, "101,712.69", 632)] }
];
var sterlingRows = PDF.assemble([sterlingPage]);
var sterlingDet = PARSER.detectColumns(sterlingRows);
var sterlingBuilt = sterlingDet && PARSER.buildTransactions(sterlingRows, sterlingDet.headerRow, sterlingDet.map);
var sterlingMeta = sterlingDet && PARSER.extractStatementMeta(sterlingRows, sterlingDet.headerRow);
var sterlingRec = sterlingBuilt && PARSER.reconcileWithMeta(sterlingBuilt.txns, sterlingMeta);
check("pdf/sterling: three-line Reference/Session Money In/Out header maps combined narration and leaves Reference blank", sterlingDet && sterlingDet.map.date === 0 && sterlingDet.map.valueDate === 1 && sterlingDet.map.narration === 2 && sterlingDet.map.reference === undefined && sterlingDet.map.credit === 3 && sterlingDet.map.debit === 4 && sterlingDet.map.balance === 5 && sterlingRows[sterlingDet.headerRow][2] === "Reference / Session Channel Narration", JSON.stringify(sterlingRows[sterlingDet && sterlingDet.headerRow]));
check("pdf/sterling: slash month dates and merged narration/reference parse", sterlingBuilt && sterlingBuilt.txns.length === 1 && sterlingBuilt.txns[0].date.getMonth() === 4 && sterlingBuilt.txns[0].debit === 200 && /Airtime purchase/.test(sterlingBuilt.txns[0].narration), JSON.stringify(sterlingBuilt && sterlingBuilt.problems));
check("pdf/sterling: above-label opening and counted totals reconcile", sterlingRec && sterlingRec.allOk, sterlingRec && JSON.stringify(sterlingRec.checks));

var zenithPage = [
  { y: 596, items: [pit(52, 24, "DATE", 596), pit(111, 70, "DESCRIPTION", 596), pit(265, 30, "DEBIT", 596), pit(339, 34, "CREDIT", 596), pit(413, 54, "VALUE DATE", 596), pit(473, 45, "BALANCE", 596)] },
  { y: 586, items: [pit(111, 80, "Opening Balance", 586), pit(321, 25, "0.00", 586), pit(396, 25, "0.00", 586), pit(508, 55, "1,000.00", 586)] },
  { y: 576, items: [pit(52, 55, "11/01/2026", 576), pit(111, 80, "FGN STAMP DUTY", 576), pit(318, 35, "50.00", 576), pit(396, 72, "0.00 11/01/2026", 576), pit(508, 55, "950.00", 576)] },
  { y: 566, items: [pit(52, 55, "12/01/2026", 566), pit(111, 85, "TRANSFER INFLOW", 566), pit(321, 25, "0.00", 566), pit(374, 88, "200.00 12/01/2026", 566), pit(508, 55, "1,150.00", 566)] },
  { y: 556, items: [pit(234, 40, "TOTALS", 556), pit(292, 45, "-50.00", 556), pit(365, 55, "1,200.00", 556)] },
  { y: 546, items: [pit(147, 130, "TOTAL (CLEARED + UNCLEARED)", 546), pit(292, 45, "-50.00", 546), pit(365, 55, "1,200.00", 546), pit(516, 55, "1,150.00", 546)] }
];
var zenithRows = PDF.assemble([zenithPage]);
var zenithDet = PARSER.detectColumns(zenithRows);
var zenithBuilt = zenithDet && PARSER.buildTransactions(zenithRows, zenithDet.headerRow, zenithDet.map);
var zenithMeta = zenithDet && PARSER.extractStatementMeta(zenithRows, zenithDet.headerRow);
var zenithRec = zenithBuilt && PARSER.reconcileWithMeta(zenithBuilt.txns, zenithMeta);
check("pdf/zenith: compact Debit/Credit header with fused value-date cells is normalized", zenithRows[zenithDet.headerRow + 2][2] === "50.00" && zenithRows[zenithDet.headerRow + 2][3] === "0.00" && zenithRows[zenithDet.headerRow + 3][2] === "0.00" && zenithRows[zenithDet.headerRow + 3][3] === "200.00", JSON.stringify(zenithRows));
check("pdf/zenith: transactions parse without balance-proven side repairs", zenithBuilt && zenithBuilt.txns.length === 2 && zenithBuilt.moneySideRepairs === 0 && zenithBuilt.txns[0].debit === 50 && zenithBuilt.txns[1].credit === 200, JSON.stringify(zenithBuilt));
check("pdf/zenith: opening and totals metadata reconcile with credit total including opening balance", zenithMeta && zenithMeta.openingBalance === 1000 && zenithMeta.totalDebit === 50 && zenithMeta.totalCredit === 200 && zenithRec && zenithRec.allOk, JSON.stringify({ meta: zenithMeta, rec: zenithRec }));

var polarisPage = [
  { y: 510, items: [pit(45, 75, "O p e n i n g B a l a n c e :", 510), pit(45, 75, "O p e n i n g B a l a n c e :", 510), pit(150, 34, "100.00", 510), pit(150, 34, "100.00", 510)] },
  { y: 496, items: [pit(45, 70, "C l o s i n g B a l a n c e :", 496), pit(45, 70, "C l o s i n g B a l a n c e :", 496), pit(150, 34, "140.00", 496), pit(150, 34, "140.00", 496)] },
  { y: 482, items: [pit(45, 55, "T o t a l C r e d i t :", 482), pit(45, 55, "T o t a l C r e d i t :", 482), pit(150, 28, "50.00", 482), pit(150, 28, "50.00", 482)] },
  { y: 468, items: [pit(45, 50, "T o t a l D e b i t :", 468), pit(45, 50, "T o t a l D e b i t :", 468), pit(150, 28, "10.00", 468), pit(150, 28, "10.00", 468)] },
  { y: 428, items: [pit(54, 32, "T r a n s .", 428), pit(54, 32, "T r a n s .", 428), pit(381, 57, "W i t h d r a w a l", 428), pit(381, 57, "W i t h d r a w a l", 428), pit(446, 40, "D e p o s i t", 428), pit(446, 40, "D e p o s i t", 428)] },
  { y: 422, items: [pit(112, 65, "R e f . N u m b e r", 422), pit(112, 65, "R e f . N u m b e r", 422), pit(214, 101, "T r a n s a c t i o n D e t a i l s", 422), pit(215, 101, "T r a n s a c t i o n D e t a i l s", 422), pit(506, 38, "B a l a n c e", 422), pit(506, 38, "B a l a n c e", 422)] },
  { y: 416, items: [pit(54, 22, "D a t e", 416), pit(54, 22, "D a t e", 416), pit(381, 21, "(D R )", 416), pit(381, 21, "(D R )", 416), pit(446, 20, "(C R )", 416), pit(446, 20, "(C R )", 416)] },
  { y: 398, items: [pit(214, 90, "M OBBN KG : TEST", 398)] },
  { y: 386, items: [pit(54, 45, "4/14/2026", 386), pit(112, 40, "REF001", 386), pit(214, 80, "TRANSFER OUT", 386), pit(381, 25, "-10.00", 386), pit(506, 28, "90.00", 386)] },
  { y: 368, items: [pit(54, 45, "4/15/2026", 368), pit(112, 40, "REF002", 368), pit(214, 70, "TRANSFER IN", 368), pit(446, 25, "50.00", 368), pit(506, 30, "140.00", 368)] }
];
var polarisRows = PDF.assemble([polarisPage]);
var polarisDet = PARSER.detectColumns(polarisRows);
var polarisBuilt = polarisDet && PARSER.buildTransactions(polarisRows, polarisDet.headerRow, polarisDet.map);
var polarisMeta = polarisDet && PARSER.extractStatementMeta(polarisRows, polarisDet.headerRow);
var polarisRec = polarisBuilt && PARSER.reconcileWithMeta(polarisBuilt.txns, polarisMeta);
check("pdf/polaris: spaced duplicate header labels are detected", polarisDet && polarisDet.map.date === 0 && polarisDet.map.reference === 1 && polarisDet.map.narration === 2 && polarisDet.map.debit === 3 && polarisDet.map.credit === 4 && polarisDet.map.balance === 5, JSON.stringify(polarisRows[polarisDet && polarisDet.headerRow]));
check("pdf/polaris: M/d/yyyy rows parse and compact spaced summary reconciles", polarisBuilt && polarisBuilt.txns.length === 2 && polarisBuilt.problems.length === 0 && polarisMeta && polarisMeta.openingBalance === 100 && polarisMeta.totalCredit === 50 && polarisRec && polarisRec.allOk, JSON.stringify({ built: polarisBuilt, meta: polarisMeta, rec: polarisRec }));

var gtCorpHeaderPage = [
  { y: 600, items: [pit(383, 34, "Remarks", 600), pit(401, 80, "OPENING CREDIT", 600)] },
  { y: 504, items: [pit(383, 72, "Originating Branch", 504), pit(401, 70, "001 BRANCH", 504)] },
  { y: 422, items: [pit(383, 31, "Balance", 422), pit(401, 35, "1,100.00", 422)] },
  { y: 342, items: [pit(383, 28, "Credits", 342), pit(401, 35, "100.00", 342)] },
  { y: 262, items: [pit(383, 24, "Debits", 262)] },
  { y: 182, items: [pit(383, 39, "Reference", 182), pit(401, 45, "REF001", 182)] },
  { y: 118, items: [pit(383, 43, "Value. Date", 118), pit(401, 52, "01-Jan-2025", 118)] },
  { y: 54, items: [pit(383, 44, "Trans. Date", 54), pit(401, 52, "01-Jan-2025", 54)] }
];
var gtCorpContinuationPage = [
  { y: 600, items: [pit(52, 90, "TRANSFER OUT", 600), pit(94, 85, "TRANSFER IN", 600)] },
  { y: 504, items: [pit(52, 70, "001 BRANCH", 504), pit(94, 70, "001 BRANCH", 504)] },
  { y: 422, items: [pit(52, 35, "900.00", 422), pit(94, 35, "950.00", 422)] },
  { y: 342, items: [pit(94, 30, "50.00", 342)] },
  { y: 262, items: [pit(52, 30, "200.00", 262)] },
  { y: 182, items: [pit(52, 45, "REF002", 182), pit(94, 45, "REF003", 182)] },
  { y: 118, items: [pit(52, 52, "02-Jan-2025", 118), pit(94, 52, "03-Jan-2025", 118)] },
  { y: 54, items: [pit(52, 52, "02-Jan-2025", 54), pit(94, 52, "03-Jan-2025", 54)] }
];
var gtCorpRows = PDF.assemble([gtCorpHeaderPage, gtCorpContinuationPage]);
var gtCorpDet = PARSER.detectColumns(gtCorpRows);
var gtCorpBuilt = gtCorpDet && PARSER.buildTransactions(gtCorpRows, gtCorpDet.headerRow, gtCorpDet.map);
var gtCorpIntegrity = gtCorpBuilt && PARSER.integrityCheck(gtCorpBuilt.txns);
check("pdf/gtbank-corporate: transposed statement headers are reconstructed", gtCorpDet && gtCorpDet.map.date === 0 && gtCorpDet.map.valueDate === 1 && gtCorpDet.map.reference === 2 && gtCorpDet.map.debit === 3 && gtCorpDet.map.credit === 4 && gtCorpDet.map.balance === 5 && gtCorpDet.map.narration === 7, JSON.stringify(gtCorpRows));
check("pdf/gtbank-corporate: continuation pages without header labels parse", gtCorpBuilt && gtCorpBuilt.txns.length === 3 && gtCorpBuilt.problems.length === 0 && gtCorpIntegrity && gtCorpIntegrity.ratio === 1, JSON.stringify({ built: gtCorpBuilt, integrity: gtCorpIntegrity }));

// page modeled on a real statement: two-line header ("Trans"/"Date",
// "Value"/"Date"), an EMPTY Debit cell, and Remarks wrapping to a 2nd line
var pdfPage = [
  { y: 760, items: [pit(40, 120, "FIDELITY BANK PLC", 760)] },
  { y: 740, items: [pit(40, 110, "Opening Balance:", 740), pit(170, 60, "42,019.90", 740)] },
  { y: 700, items: [pit(40, 28, "Trans", 700), pit(150, 55, "Reference", 700), pit(300, 30, "Value", 700), pit(380, 28, "Debit", 700), pit(470, 32, "Credit", 700), pit(560, 42, "Balance", 700), pit(650, 45, "Remarks", 700)] },
  { y: 686, items: [pit(40, 25, "Date", 686), pit(300, 25, "Date", 686)] },
  { y: 660, items: [pit(40, 55, "02-Jan-2026", 660), pit(150, 120, "'00000726010211384170NIP", 660), pit(300, 55, "02-Jan-2026", 660), pit(455, 55, "725,000.00", 660), pit(545, 57, "767,019.90", 660), pit(650, 130, "TRANSFER BETWEEN CUSTOMERS", 660)] },
  { y: 646, items: [pit(650, 110, "COB TRF FROM GHANAMANT", 646)] },
  { y: 620, items: [pit(40, 55, "03-Jan-2026", 620), pit(150, 45, "REF9921", 620), pit(300, 55, "03-Jan-2026", 620), pit(370, 50, "50.00", 620), pit(548, 55, "766,969.90", 620), pit(650, 70, "STAMP DUTY", 620)] }
];
var prows = PDF.assemble([pdfPage]);
check("pdf: hero line kept above the table", prows[0][0] === "FIDELITY BANK PLC");
check("pdf: two-line header merged ('Trans'+'Date')",
  prows[2] && prows[2][0] === "Trans Date" && prows[2][2] === "Value Date" && prows[2][6] === "Remarks",
  JSON.stringify(prows[2]));
var dataRow = prows[3];
check("pdf: empty Debit stays empty — credit lands under Credit",
  dataRow && dataRow[3] === "" && dataRow[4] === "725,000.00", JSON.stringify(dataRow));
check("pdf: balance and remarks in their own columns",
  dataRow && dataRow[5] === "767,019.90" && /TRANSFER BETWEEN/.test(dataRow[6]));
check("pdf: wrapped remarks merged into the same logical row",
  dataRow && /TRANSFER BETWEEN CUSTOMERS COB TRF FROM GHANAMANT/.test(dataRow[6]), dataRow && dataRow[6]);
check("pdf: debit row keeps 50.00 under Debit", prows[4] && prows[4][3] === "50.00" && prows[4][4] === "");

// the assembled rows flow through the normal pipeline end-to-end
var pdet = PARSER.detectColumns(prows);
check("pdf: detectColumns finds the merged header", pdet && prows[pdet.headerRow][0] === "Trans Date");
var pbuilt = PARSER.buildTransactions(prows, pdet.headerRow, pdet.map);
check("pdf: 2 txns built; credit txn correct", pbuilt.txns.length === 2 &&
  pbuilt.txns[0].credit === 725000 && pbuilt.txns[0].debit === 0);
check("pdf: continuation merged into narration", /COB TRF FROM GHANAMANT/.test(pbuilt.txns[0].narration));
check("pdf: stamp duty row parsed as debit", pbuilt.txns[1].debit === 50 && /STAMP DUTY/.test(pbuilt.txns[1].narration));
var pmeta = PARSER.extractStatementMeta(prows, pdet.headerRow);
check("pdf: hero opening balance mined", pmeta && pmeta.openingBalance === 42019.9);

// repeated header on page 2 refreshes anchors but is not duplicated
var page2 = [
  { y: 700, items: pdfPage[2].items }, { y: 686, items: pdfPage[3].items },
  { y: 660, items: [pit(40, 55, "04-Jan-2026", 660), pit(150, 45, "REF9930", 660), pit(300, 55, "04-Jan-2026", 660), pit(370, 50, "53.75", 660), pit(548, 55, "766,916.15", 660), pit(650, 95, "NIP TRANSFER CHARGE", 660)] }
];
var prows2 = PDF.assemble([pdfPage, page2]);
check("pdf: page-2 header not duplicated as data",
  prows2.filter(function (r) { return r[0] === "Trans Date"; }).length === 1);
check("pdf: page-2 data row still column-aligned",
  prows2[prows2.length - 1][3] === "53.75" && /NIP TRANSFER/.test(prows2[prows2.length - 1][6]));

/* -------- wrapped dates, date-once-per-day rows, footer totals -------- */
var wrapPage = [
  { y: 760, items: [pit(40, 120, "FIDELITY BANK PLC", 760)] },
  { y: 700, items: [pit(40, 28, "Trans", 700), pit(150, 55, "Reference", 700), pit(300, 30, "Value", 700), pit(380, 28, "Debit", 700), pit(470, 32, "Credit", 700), pit(560, 42, "Balance", 700), pit(650, 45, "Remarks", 700)] },
  { y: 686, items: [pit(40, 25, "Date", 686), pit(300, 25, "Date", 686)] },
  // the date itself wraps to a second line ("02-Jan-" / "2026"), remarks wrap over 3 lines
  { y: 660, items: [pit(40, 40, "02-Jan-", 660), pit(150, 120, "'00000726010211384170NIP", 660), pit(300, 40, "02-Jan-", 660), pit(455, 55, "725,000.00", 660), pit(545, 57, "767,019.90", 660), pit(650, 100, "TRANSFER BETWEEN", 660)] },
  { y: 648, items: [pit(40, 28, "2026", 648), pit(300, 28, "2026", 648), pit(650, 80, "CUSTOMERS", 648)] },
  { y: 636, items: [pit(650, 120, "COB TRF FROM GHANAMANT", 636)] },
  // a row whose date is omitted (printed once per day): must inherit 02-Jan
  { y: 610, items: [pit(380, 40, "50.00", 610), pit(548, 57, "766,969.90", 610), pit(650, 70, "STAMP DUTY", 610)] },
  // footer totals must NOT become transactions
  { y: 580, items: [pit(40, 80, "Total Debit:", 580), pit(380, 50, "50.00", 580), pit(470, 80, "Total Credit:", 580), pit(560, 70, "725,000.00", 580)] }
];
var wrows = PDF.assemble([wrapPage]);
var wdet = PARSER.detectColumns(wrows);
check("wrap: header still detected", wdet && wrows[wdet.headerRow][0] === "Trans Date");
var wbuilt = PARSER.buildTransactions(wrows, wdet.headerRow, wdet.map);
check("wrap: both transactions read", wbuilt.txns.length === 2,
  "got " + wbuilt.txns.length + " txns: " + JSON.stringify(wbuilt.txns.map(function (t) { return t.narration.slice(0, 30); })));
check("wrap: two-line date parsed as 02 Jan 2026",
  wbuilt.txns[0] && wbuilt.txns[0].date.getFullYear() === 2026 && wbuilt.txns[0].date.getMonth() === 0 && wbuilt.txns[0].date.getDate() === 2);
check("wrap: credit in the right column despite empty debit",
  wbuilt.txns[0] && wbuilt.txns[0].credit === 725000 && wbuilt.txns[0].debit === 0);
check("wrap: three remark lines merged",
  wbuilt.txns[0] && /TRANSFER BETWEEN CUSTOMERS COB TRF FROM GHANAMANT/.test(wbuilt.txns[0].narration));
check("wrap: dateless amount row inherits the day's date",
  wbuilt.txns[1] && wbuilt.txns[1].date.getDate() === 2 && wbuilt.txns[1].debit === 50 && /STAMP DUTY/.test(wbuilt.txns[1].narration));
check("wrap: footer totals row not audited as a transaction",
  !wbuilt.txns.some(function (t) { return /TOTAL/i.test(t.narration); }));
check("wrap: no rows reported as problems", wbuilt.problems.length === 0, JSON.stringify(wbuilt.problems));
var wmeta = PARSER.extractStatementMeta(wrows, wdet.headerRow);
check("wrap: footer totals still mined for the checksum", wmeta && wmeta.totalDebit === 50 && wmeta.totalCredit === 725000);
var wrec = PARSER.reconcileWithMeta(wbuilt.txns, wmeta);
check("wrap: checksum reconciles", wrec && wrec.allOk,
  wrec && wrec.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label; }).join(", "));

/* ---- wide description column: trailing words must not spill into Debit ---- */
// modeled on a real corporate statement (S/n | Post Date | Value Date |
// Description | Debit | Credit | Balance) where long wrapped descriptions
// run far right toward the Debit label, and empty amounts are "--"
var widePage = [
  { y: 700, items: [pit(41, 12, "S/n", 700), pit(110, 45, "Post Date", 700), pit(224, 50, "Value Date", 700), pit(338, 55, "Description", 700), pit(757, 25, "Debit", 700), pit(871, 28, "Credit", 700), pit(985, 38, "Balance", 700)] },
  // single-line row, "--" debit
  { y: 660, items: [pit(46, 6, "2", 660), pit(111, 48, "16-01-2025", 660), pit(225, 48, "16-01-2025", 660), pit(339, 160, "MOB/UTO/NEIGHBOURS_NG_/loan/28", 660), pit(758, 10, "--", 660), pit(872, 42, "50,000.00", 660), pit(986, 42, "50,000.00", 660)] },
  // wrapped row: desc line 1 ends with a word deep into the page ("MARIAM"
  // at x≈560, past the label midpoint) + centred main line + desc line 2
  { y: 620, items: [pit(339, 195, "FT/OPAY/MARIAM ADEOLA W/Transfer from", 620), pit(540, 38, "MARIAM", 620)] },
  { y: 610, items: [pit(46, 6, "7", 610), pit(111, 48, "20-01-2025", 610), pit(225, 48, "18-01-2025", 610), pit(758, 10, "--", 610), pit(872, 38, "7,800.00", 610), pit(986, 42, "79,500.00", 610)] },
  { y: 600, items: [pit(339, 22, "ADE", 600)] },
  // straggler word even further right (x=580, center beyond old midpoint)
  { y: 560, items: [pit(339, 180, "FT/OPAY/RIHATOP BUSINES/Transfer from", 560), pit(580, 55, "RIHATOP BU", 560)] },
  { y: 550, items: [pit(46, 6, "9", 550), pit(111, 48, "20-01-2025", 550), pit(225, 48, "18-01-2025", 550), pit(758, 10, "--", 550), pit(872, 38, "9,550.00", 550), pit(986, 42, "95,550.00", 550)] }
];
var wirows = PDF.assemble([widePage]);
var widet = PARSER.detectColumns(wirows);
var wibuilt = PARSER.buildTransactions(wirows, widet.headerRow, widet.map);
check("wide: all 3 rows read, none excluded", wibuilt.txns.length === 3 && wibuilt.problems.length === 0,
  "txns=" + wibuilt.txns.length + " problems=" + JSON.stringify(wibuilt.problems));
check("wide: '--' debit reads as zero", wibuilt.txns[0].debit === 0 && wibuilt.txns[0].credit === 50000);
check("wide: trailing word stays in narration, amount intact",
  wibuilt.txns[1] && /MARIAM\b.*ADE/.test(wibuilt.txns[1].narration) && wibuilt.txns[1].credit === 7800 && wibuilt.txns[1].debit === 0,
  wibuilt.txns[1] && wibuilt.txns[1].narration + " | dr=" + wibuilt.txns[1].debit);
check("wide: far-right straggler still narration",
  wibuilt.txns[2] && /RIHATOP BU/.test(wibuilt.txns[2].narration) && wibuilt.txns[2].credit === 9550,
  wibuilt.txns[2] && wibuilt.txns[2].narration);

/* ---- vertically-centred rows (Fidelity-style) with hyphen-less dates ---- */
// each transaction is a tall block: remarks start at the top, the date and
// amounts sit on MIDDLE lines, and the PDF font drops the hyphen glyphs so
// dates read "02Jan" / "2026". Rows are separated by larger vertical gaps.
var centeredPage = [
  { y: 760, items: [pit(40, 120, "FIDELITY BANK PLC", 760)] },
  { y: 700, items: [pit(40, 28, "Trans", 700), pit(150, 55, "Reference", 700), pit(300, 30, "Value", 700), pit(380, 28, "Debit", 700), pit(470, 32, "Credit", 700), pit(560, 42, "Balance", 700), pit(650, 45, "Remarks", 700)] },
  { y: 686, items: [pit(40, 25, "Date", 686), pit(300, 25, "Date", 686)] },
  // txn 1 — a 4-line centred block
  { y: 660, items: [pit(650, 100, "TRANSFER BETWEEN", 660)] },
  { y: 648, items: [pit(40, 28, "02Jan", 648), pit(150, 120, "'00000726010211384170NIP", 648), pit(300, 28, "02Jan", 648), pit(650, 80, "CUSTOMERS", 648)] },
  { y: 636, items: [pit(455, 55, "725,000.00", 636), pit(545, 57, "767,019.90", 636), pit(650, 60, "COB TRF", 636)] },
  { y: 624, items: [pit(40, 28, "2026", 624), pit(300, 28, "2026", 624), pit(650, 110, "FROM GHANAMANT", 624)] },
  // txn 2 — a 3-line centred block after a BIGGER gap
  { y: 598, items: [pit(40, 28, "03Jan", 598), pit(650, 50, "STAMP", 598)] },
  { y: 586, items: [pit(380, 40, "50.00", 586), pit(548, 57, "766,969.90", 586), pit(650, 40, "DUTY", 586)] },
  { y: 574, items: [pit(40, 28, "2026", 574)] }
];
var crows = PDF.assemble([centeredPage]);
var cdet = PARSER.detectColumns(crows);
var cbuilt = PARSER.buildTransactions(crows, cdet.headerRow, cdet.map);
check("centred: exactly 2 transactions read", cbuilt.txns.length === 2,
  "got " + cbuilt.txns.length + ": " + JSON.stringify(crows.slice(cdet.headerRow + 1)));
check("centred: hyphen-less wrapped date parsed (02Jan/2026)",
  cbuilt.txns[0] && cbuilt.txns[0].date.getDate() === 2 && cbuilt.txns[0].date.getMonth() === 0 && cbuilt.txns[0].date.getFullYear() === 2026);
check("centred: credit on the middle line lands in its row",
  cbuilt.txns[0] && cbuilt.txns[0].credit === 725000 && cbuilt.txns[0].debit === 0);
check("centred: top remarks line stays with ITS OWN transaction (no off-by-one)",
  cbuilt.txns[0] && /^TRANSFER BETWEEN CUSTOMERS COB TRF FROM GHANAMANT/.test(cbuilt.txns[0].narration), cbuilt.txns[0] && cbuilt.txns[0].narration);
check("centred: second block parsed (03 Jan, ₦50 debit)",
  cbuilt.txns[1] && cbuilt.txns[1].date.getDate() === 3 && cbuilt.txns[1].debit === 50 && /STAMP DUTY/.test(cbuilt.txns[1].narration));
check("centred: no rows lost as problems", cbuilt.problems.length === 0, JSON.stringify(cbuilt.problems));

// date formats seen on Nigerian statements
check("date: wrapped dd-MMM- yyyy", PARSER.parseDate("02-Jan- 2026") && PARSER.parseDate("02-Jan- 2026").getDate() === 2);
check("date: time with AM/PM stripped", PARSER.parseDate("02-Jan-2026 06:45:51 PM") !== null);
check("date: dotted time stripped", PARSER.parseDate("02/01/2026 06.45.51") !== null);
check("date: spaced slashes rejoined", PARSER.parseDate("02/ 01/2026") !== null);
var hyphenless = PARSER.parseDate("02Jan 2026");
check("date: hyphen-less '02Jan 2026'", hyphenless && hyphenless.getDate() === 2 && hyphenless.getMonth() === 0 && hyphenless.getFullYear() === 2026);
check("date: compact '02Jan2026'", PARSER.parseDate("02Jan2026") !== null);
check("date: '15Sep 25' two-digit year", PARSER.parseDate("15Sep 25") !== null && PARSER.parseDate("15Sep 25").getFullYear() === 2025);
check("date: plain text still rejected", PARSER.parseDate("Total Debit") === null);

/* -------- dual-date statements: Value Date as fallback -------- */
var dualRows = [
  ["Trans Date", "Value Date", "Narration", "Debit", "Credit", "Balance"],
  ["16/01/2025", "16/01/2025", "POS PURCHASE A", "1,000.00", "", "9,000.00"],
  ["**INVALID**", "17/01/2025", "POS PURCHASE B", "500.00", "", "8,500.00"],   // junk trans date -> value date used
  ["18-Jan-2025 REF9912", "", "POS PURCHASE C", "300.00", "", "8,200.00"],     // noisy cell -> date token salvaged
  ["junk", "junk", "POS PURCHASE D", "200.00", "", "8,000.00"]                 // both unreadable -> excluded, reported
];
var ddet = PARSER.detectColumns(dualRows);
check("dual-date: both date columns detected", ddet && ddet.map.date === 0 && ddet.map.valueDate === 1);
var dbuilt = PARSER.buildTransactions(dualRows, ddet.headerRow, ddet.map);
check("dual-date: 3 of 4 rows readable", dbuilt.txns.length === 3, "got " + dbuilt.txns.length);
check("dual-date: junk trans date falls back to value date",
  dbuilt.txns[1] && dbuilt.txns[1].date.getDate() === 17 && dbuilt.txns[1].debit === 500);
check("dual-date: date token salvaged from noisy cell",
  dbuilt.txns[2] && dbuilt.txns[2].date.getDate() === 18 && dbuilt.txns[2].date.getMonth() === 0);
check("dual-date: row with no readable date is excluded AND reported",
  dbuilt.problems.length === 1 && /POS PURCHASE D/.test(dbuilt.problems[0].data));
check("dual-date: balance chain intact for readable rows",
  PARSER.integrityCheck(dbuilt.txns).matched === 2);
check("dual-date: token salvage never invents dates", PARSER.parseDate("REF 4TH FLOOR 123") === null);

/* ------- page-break duplicates, date fragments, count checksums ------- */
// banks' PDF generators re-render a row that straddles a page boundary,
// sometimes fusing the page footer into the narration and splitting the date
var dupRows = [
  ["Date", "Reference", "Value Date", "Debit", "Credit", "Balance", "Remarks"],
  ["02Jan 2026", "'REF1", "02Jan 2026", "", "725,000.00", "767,019.90", "TRANSFER IN"],
  // partial render at page bottom (footer fused in) + full re-render on next page
  ["06Jan 2026", "'REF2", "06Jan 2026", "1,500,000.00", "", "2,050,607.73", "GTWORLD FROM Page: 5 of 26 SANWOOLA TO"],
  ["06Jan 2026", "'REF2", "06Jan 2026", "1,500,000.00", "", "2,050,607.73", "GTWORLD FROM SANWOOLA DEEN O. TO BABARINDE SAMSON OLADELE"],
  // date split at a page break: year-only tail with amounts
  ["2026", "'GTW", "2026", "1.88", "", "2,050,605.85", "VAT CHARGES"],
  // day-month head missing its year
  ["07-Jan-", "'GTW", "07-Jan-", "25.00", "", "2,050,580.85", "Commission on NIP Transfer CHARGES"]
];
var ddet = PARSER.detectColumns(dupRows);
var dbuilt = PARSER.buildTransactions(dupRows, ddet.headerRow, ddet.map);
check("dedupe: page-break duplicate removed", dbuilt.txns.length === 4 && dbuilt.duplicates === 1,
  "txns=" + dbuilt.txns.length + " dups=" + dbuilt.duplicates);
check("dedupe: cleaner (longer) narration kept and footer stripped",
  /BABARINDE/.test(dbuilt.txns[1].narration) && !/Page: 5 of 26/.test(dbuilt.txns[1].narration),
  dbuilt.txns[1].narration);
check("dedupe: year-tail fragment recovered with previous row's date",
  dbuilt.txns[2].date.getDate() === 6 && dbuilt.txns[2].debit === 1.88);
check("dedupe: day-month head completed with previous row's year",
  dbuilt.txns[3].date.getDate() === 7 && dbuilt.txns[3].date.getFullYear() === 2026 && dbuilt.txns[3].debit === 25);
check("dedupe: no rows excluded", dbuilt.problems.length === 0, JSON.stringify(dbuilt.problems));

// GROUP re-render: a Commission+VAT pair duplicated together (copies are
// NOT adjacent) and re-rendered in SWAPPED order — both provable by chain
var groupRows = [
  ["Date", "Narration", "Debit", "Credit", "Balance"],
  ["02/01/2026", "POS PURCHASE OPENER", "100.00", "", "405,895.52"],
  // true order: Comm(25) then VAT(1.88) — page prints VAT first…
  ["02/01/2026", "VAT CHARGES", "1.88", "", "405,868.64"],
  ["02/01/2026", "Commission on NIP Transfer CHARGES", "25.00", "", "405,870.52"],
  // …then re-renders the SAME pair on the next page
  ["02/01/2026", "Commission on NIP Transfer CHARGES", "25.00", "", "405,870.52"],
  ["02/01/2026", "VAT CHARGES", "1.88", "", "405,868.64"],
  ["02/01/2026", "POS PURCHASE CLOSER", "868.64", "", "405,000.00"]
];
var gDet = PARSER.detectColumns(groupRows);
var gBuilt = PARSER.buildTransactions(groupRows, gDet.headerRow, gDet.map);
check("chain-repair: group duplicates removed and order fixed",
  gBuilt.txns.length === 4, "txns=" + gBuilt.txns.length + " " + JSON.stringify(gBuilt.txns.map(function(t){ return [t.debit, t.balance]; })));
var gIc = PARSER.integrityCheck(gBuilt.txns);
check("chain-repair: balance chain fully reconciles after repair", gIc.ratio === 1,
  "ratio=" + gIc.ratio + " " + JSON.stringify(gBuilt.txns.map(function(t){ return [t.debit, t.balance]; })));
check("chain-repair: repaired rows in true order (25 before 1.88)",
  gBuilt.txns[1].debit === 25 && gBuilt.txns[2].debit === 1.88);

// a legitimate buy-refund-buy pattern (same amounts, same balance twice)
// keeps the chain intact and must NOT be touched
var legitRows = [
  ["Date", "Narration", "Debit", "Credit", "Balance"],
  ["02/01/2026", "POS PURCHASE STORE A", "100.00", "", "900.00"],
  ["02/01/2026", "REFUND STORE A", "", "100.00", "1,000.00"],
  ["02/01/2026", "POS PURCHASE STORE A", "100.00", "", "900.00"]
];
var lDet = PARSER.detectColumns(legitRows);
var lBuilt = PARSER.buildTransactions(legitRows, lDet.headerRow, lDet.map);
check("chain-repair: legitimate repeat purchases untouched", lBuilt.txns.length === 3 && lBuilt.duplicates === 0);

// OPay/OWealth pattern: the payment is PRINTED before the funding row that
// arithmetically precedes it — forward swap must fix it without deleting
var opayRows = [
  ["Trans. Time", "Value Date", "Description", "Debit", "Credit", "Balance After"],
  ["02 Jun 2026 10:58:25", "02 Jun 2026", "Transfer from AINA | Providus", "--", "10,000.00", "10,000.00"],
  ["02 Jun 2026 10:59:26", "02 Jun 2026", "Auto-save to OWealth Balance", "10,000.00", "--", "0.00"],
  // printed: payment first (bal 0), then the OWealth withdrawal that funded it
  ["02 Jun 2026 10:59:30", "02 Jun 2026", "Transfer to GEORGE NZE | OPay | 8068319140", "3,700.00", "--", "0.00"],
  ["02 Jun 2026 10:59:30", "02 Jun 2026", "OWealth Withdrawal(Transaction Payment)", "--", "3,700.00", "3,700.00"],
  // a second swapped pair right behind the first
  ["02 Jun 2026 14:23:52", "02 Jun 2026", "Transfer to LUKMON GANIYU | OPay | 8096379115", "5,000.00", "--", "0.00"],
  ["02 Jun 2026 14:23:52", "02 Jun 2026", "OWealth Withdrawal(Transaction Payment)", "--", "5,000.00", "5,000.00"]
];
var oDet = PARSER.detectColumns(opayRows);
check("opay: 'Trans. Time' maps as the date column, Value Date separate",
  oDet && oDet.map.date === 0 && oDet.map.valueDate === 1 && oDet.map.balance === 5,
  oDet && JSON.stringify(oDet.map));
var oBuilt = PARSER.buildTransactions(opayRows, oDet.headerRow, oDet.map);
check("opay: all rows kept, nothing falsely merged", oBuilt.txns.length === 6 && oBuilt.duplicates === 0,
  "txns=" + oBuilt.txns.length + " dups=" + oBuilt.duplicates);
check("opay: swapped funding pairs re-sequenced", oBuilt.resequenced === 2, "swaps=" + oBuilt.resequenced);
check("opay: balance chain fully reconciles", PARSER.integrityCheck(oBuilt.txns).ratio === 1,
  JSON.stringify(oBuilt.txns.map(function (t) { return [t.debit, t.credit, t.balance]; })));

var opayPdfPage = [
  { y: 464, items: [pit(379, 45, "Balance After", 464), pit(409, 5, "(", 464)] },
  { y: 458, items: [pit(71, 55, "Trans. Time", 458), pit(132, 48, "Value Date", 458), pit(179, 70, "Description", 458), pit(302, 36, "Debit", 458), pit(340, 38, "Credit", 458), pit(421, 42, "Channel", 458), pit(478, 88, "Transaction Reference", 458)] },
  { y: 452, items: [pit(379, 14, "₦)", 452)] },
  { y: 432, items: [pit(71, 92, "01 May 2026 11:13:06", 432), pit(132, 58, "01 May 2026", 432), pit(179, 124, "OWealth Withdrawal(Transaction Payment)", 432), pit(302, 10, "--", 432), pit(340, 42, "2,000.00", 432), pit(379, 60, "2,000.00", 432), pit(421, 35, "Mobile", 432), pit(478, 70, "REF001", 432)] },
  { y: 410, items: [pit(71, 92, "01 May 2026 11:13:01", 410), pit(132, 58, "01 May 2026", 410), pit(179, 70, "Transfer out", 410), pit(302, 42, "2,000.00", 410), pit(340, 10, "--", 410), pit(379, 30, "0.00", 410), pit(421, 35, "Mobile", 410), pit(478, 70, "REF002", 410)] },
  { y: 390, items: [pit(71, 88, "Savings Account", 390), pit(224, 75, "Period: 01 May 2026", 390)] },
  { y: 370, items: [pit(71, 92, "02 May 2026 09:00:00", 370), pit(132, 58, "02 May 2026", 370), pit(179, 70, "Savings leg", 370), pit(302, 42, "1,000.00", 370), pit(379, 30, "0.00", 370)] }
];
var opayPdfRows = PDF.assemble([opayPdfPage]);
var opayPdfDet = PARSER.detectColumns(opayPdfRows);
var opayPdfBuilt = opayPdfDet && PARSER.buildTransactions(opayPdfRows, opayPdfDet.headerRow, opayPdfDet.map);
check("opay/pdf: split Balance After header is reconstructed", opayPdfDet && opayPdfDet.map.balance === 5 && opayPdfRows[opayPdfDet.headerRow][5] === "Balance After", JSON.stringify(opayPdfRows));
check("opay/pdf: balance cells with trailing channel text parse", opayPdfBuilt && PARSER.integrityCheck(opayPdfBuilt.txns).ratio === 1, JSON.stringify(opayPdfBuilt && opayPdfBuilt.txns));
check("opay/pdf: a following Savings Account section is not mixed into the Wallet checksum", opayPdfBuilt && opayPdfBuilt.txns.length === 2, JSON.stringify(opayPdfBuilt && opayPdfBuilt.txns));

// recurring identical payments with colliding balances are NEVER deduped
// (different references keep their narrations distinct)
var recurRows = [
  ["Date", "Narration", "Debit", "Credit", "Balance"],
  ["02/06/2026", "Transfer to GEORGE NZE | ref 26060201010095873365", "3,700.00", "", "0.00"],
  ["02/06/2026", "OWealth Withdrawal AAA", "", "3,700.00", "3,700.00"],
  ["02/06/2026", "Transfer to GEORGE NZE | ref 26060299999999999999", "3,700.00", "", "0.00"],
  ["02/06/2026", "OWealth Withdrawal BBB", "", "3,700.00", "3,700.00"]
];
var rDet = PARSER.detectColumns(recurRows);
var rBuilt = PARSER.buildTransactions(recurRows, rDet.headerRow, rDet.map);
check("opay: repeat same-payee payments survive", rBuilt.txns.length === 4 && rBuilt.duplicates === 0,
  "txns=" + rBuilt.txns.length + " dups=" + rBuilt.duplicates);

// identical consecutive txns WITHOUT a balance column are never deduped
var noBalRows = [
  ["Date", "Narration", "Debit", "Credit"],
  ["02/01/2026", "SMS ALERT CHARGE", "6.00", ""],
  ["02/01/2026", "SMS ALERT CHARGE", "6.00", ""]
];
var nbDet = PARSER.detectColumns(noBalRows);
var nbBuilt = PARSER.buildTransactions(noBalRows, nbDet.headerRow, nbDet.map);
check("dedupe: without balance evidence nothing is removed", nbBuilt.txns.length === 2 && nbBuilt.duplicates === 0);

// debit/credit count checksums
var cntMeta = PARSER.extractStatementMeta([
  ["Debit Count:", "3", "Credit Count:", "1"],
  ["Total Debit:", "1,500,026.88", "Total Credit:", "725,000.00"]
], null);
check("counts: debit/credit counts mined", cntMeta && cntMeta.debitCount === 3 && cntMeta.creditCount === 1);
var cntRec = PARSER.reconcileWithMeta(dbuilt.txns, cntMeta);
check("counts: count checksum passes on deduped txns",
  cntRec && cntRec.checks.some(function (c) { return /Number of debit/.test(c.label) && c.ok; }) &&
  cntRec.checks.some(function (c) { return /Number of credit/.test(c.label) && c.ok; }),
  cntRec && JSON.stringify(cntRec.checks));

/* ---------------- ragged CSV repair ---------------- */
var raggedRows = [
  ["Date", "Narration", "Debit", "Credit", "Balance"],
  ["01/05/2025", "NIP/TRF TO ADE", " SONS LTD", "100.00", "", "900.00"], // unquoted comma split the narration
  ["02/05/2025", "SMS ALERT CHARGE", "6.00", "", "894.00"]
];
var rdet = PARSER.detectColumns(raggedRows);
var rbuilt = PARSER.buildTransactions(raggedRows, rdet.headerRow, rdet.map);
check("ragged: overflow cells re-joined into narration",
  rbuilt.txns.length === 2 && /NIP\/TRF TO ADE,\s*SONS LTD/.test(rbuilt.txns[0].narration), rbuilt.txns[0] && rbuilt.txns[0].narration);
check("ragged: shifted amounts land back in the right columns",
  rbuilt.txns[0].debit === 100 && rbuilt.txns[0].balance === 900);
check("ragged: normal rows untouched", rbuilt.txns[1].debit === 6);




/* ---------------- Wema/ALAT PDF-style wrapped date/reference cells ---------------- */
var wemaPdfPage = [
  { y: 398, items: [pit(65, 41, "R e f e r e n c e", 398)] },
  { y: 392, items: [pit(21, 18, "Date", 392), pit(136, 75, "Transaction Details", 392), pit(431, 27, "Credit(", 392), pit(458, 5, "₦", 392), pit(463, 3, ")", 392), pit(482, 24, "Debit(", 392), pit(506, 5, "₦", 392), pit(511, 3, ")", 392), pit(531, 35, "Balance(", 392), pit(566, 5, "₦", 392), pit(571, 3, ")", 392)] },
  { y: 386, items: [pit(65, 31, "Number", 386)] },
  { y: 364, items: [pit(19, 29, "05-Jan-", 364)] },
  { y: 358, items: [pit(64, 26, "M122871", 358), pit(134, 157, "SMS Alert Charges for NOV 25 to DEC 24, 2025", 358), pit(481, 19, "66.00", 358), pit(529, 16, "85.31", 358)] },
  { y: 352, items: [pit(19, 17, "2026", 352)] },
  { y: 328, items: [pit(19, 29, "09-Jan-", 328)] },
  { y: 322, items: [pit(64, 42, "S42709800", 322), pit(134, 155, "NIP TRANSFER FROM CUSTOMER", 322), pit(431, 52, "140,000.00", 322), pit(529, 46, "140,085.31", 322)] },
  { y: 316, items: [pit(19, 17, "2026", 316)] }
];
var wemaPdfRows = PDF.assemble([wemaPdfPage]);
var wemaPdfDet = PARSER.detectColumns(wemaPdfRows);
check("pdf/wema: stacked Reference Number is added as its own column", wemaPdfDet && wemaPdfDet.map.reference === 1 && wemaPdfRows[wemaPdfDet.headerRow][1] === "Reference Number", JSON.stringify(wemaPdfRows));
check("pdf/wema: date and reference separated in assembled rows", wemaPdfRows[wemaPdfDet.headerRow + 1][0] === "05-Jan- 2026" && wemaPdfRows[wemaPdfDet.headerRow + 1][1] === "M122871", JSON.stringify(wemaPdfRows[wemaPdfDet.headerRow + 1]));
var wemaBuilt = PARSER.buildTransactions(wemaPdfRows, wemaPdfDet.headerRow, wemaPdfDet.map);
check("wema: separated date/reference rows become transactions", wemaBuilt.txns.length === 2 && wemaBuilt.problems.length === 0, JSON.stringify(wemaBuilt.problems));
check("wema: reference kept out of date and included in narration", wemaBuilt.txns[0].date.getFullYear() === 2026 && /M122871/.test(wemaBuilt.txns[0].narration));
check("wema: first debit and second credit parsed", wemaBuilt.txns[0].debit === 66 && wemaBuilt.txns[1].credit === 140000);
check("wema: balance integrity passes", PARSER.integrityCheck(wemaBuilt.txns).ratio === 1);

/* ---------------- PDF header detection: FCMB-style mixed header line ---------------- */
function pdfItem(x, text) { return { x: x, w: Math.max(10, text.length * 5), y: 550, str: text }; }
var fcmbHeader = PARSER.pdfInternals.tryHeader({ y: 550, items: [
  pdfItem(10, "PRIVATE"), pdfItem(50, "AND"), pdfItem(78, "CONFIDENTIAL"),
  pdfItem(130, "Date"), pdfItem(185, "Reference"), pdfItem(245, "Descrip"),
  pdfItem(420, "ValueDate"), pdfItem(475, "Deposit"), pdfItem(535, "Withdrawal"), pdfItem(610, "Balance")
] }, null);
check("pdf header: FCMB line with non-table text still qualifies", PARSER.pdfInternals.qualifies(fcmbHeader));
check("pdf header: FCMB labels produce required role map", fcmbHeader.map.date === 0 && fcmbHeader.map.narration === 2 && fcmbHeader.map.credit === 4 && fcmbHeader.map.debit === 5 && fcmbHeader.map.balance === 6);
var fcmbRows = [
  ["6/12/26, 4:48 PM"],
  ["ACCOUNT STATEMENT", "SUMMARY DETAILS"],
  ["Date", "Reference", "Descrip", "ValueDate", "Deposit", "Withdrawal", "Balance"],
  ["02-Mar-2025", "1731204979/S9", "TRANSFER FROM CUSTOMER", "01-Mar-2025", "4,600.00", "", "4,633.01 Cr"],
  ["02-Mar-2025", "QR/Q22991972320", "AIRTIME PURCHASE", "01-Mar-2025", "", "750.00", "3,883.01 Cr"]
];
var fcmbDet = PARSER.detectColumns(fcmbRows);
check("detectColumns: FCMB Descrip/ValueDate header row detected", fcmbDet && fcmbDet.headerRow === 2 && fcmbDet.complete);

/* ---------------- anonymized parser diagnostics ---------------- */
var sensitiveRows = [
  ["Date", "Narration", "Debit", "Credit", "Balance"],
  ["01/05/2025", "TRANSFER TO DEEN SANWOOLA 0123456789", "10,000.00", "", "90,000.00"],
  ["02/05/2025", "SMS ALERT CHARGE", "6.00", "", "89,994.00"]
];
var sd = PARSER.detectColumns(sensitiveRows);
var sb = PARSER.buildTransactions(sensitiveRows, sd.headerRow, sd.map);
var sic = PARSER.integrityCheck(sb.txns);
var sdiag = PARSER.anonymizedLayoutDiagnostic(sensitiveRows, sd.headerRow, sd.map, sb, sic, null, { source: "csv", fileName: "customer_statement.csv" });
var sjson = JSON.stringify(sdiag);
check("diagnostic: exported", !!sdiag && sdiag.parse.transactionCount === 2);
check("diagnostic: keeps header labels", sdiag.table.headerLabels.indexOf("Narration") !== -1);
check("diagnostic: excludes raw narration/name", sjson.indexOf("DEEN SANWOOLA") === -1 && sjson.indexOf("TRANSFER TO") === -1);
check("diagnostic: sanitizes unrecognized header labels", PARSER.anonymizedLayoutDiagnostic([["DEEN SANWOOLA", "Narration"], ["abc", "x"]], 0, {}, {}, null, null, {}).table.headerLabels[0].indexOf("DEEN") === -1);
check("diagnostic: excludes account number", sjson.indexOf("0123456789") === -1);
check("diagnostic: excludes transaction amounts and balances", sjson.indexOf("10,000") === -1 && sjson.indexOf("90000") === -1 && sjson.indexOf("89,994") === -1);



/* ---------------- static beta-launch checks ---------------- */
var indexHtml = fs.readFileSync(__dirname + "/../index.html", "utf8");
var appJs = fs.readFileSync(__dirname + "/../js/app.js", "utf8");
var appCss = fs.readFileSync(__dirname + "/../css/app.css", "utf8");
var betaGuide = fs.readFileSync(__dirname + "/../BETA_TESTING.md", "utf8");
check("static: beta guide appears in app", indexHtml.indexOf("Beta tester checklist") !== -1 && indexHtml.indexOf("anonymized parser diagnostic") !== -1);
check("static: BETA_TESTING documents privacy-safe diagnostics", betaGuide.indexOf("anonymized parser diagnostic") !== -1 && betaGuide.indexOf("must not contain names") !== -1);
check("static: APP_BUILD and cache bust agree on 50", appJs.indexOf("APP_BUILD = 50") !== -1 && (indexHtml.match(/v=50/g) || []).length >= 6);
check("static: global back button is wired across later steps", indexHtml.indexOf('id="btn-global-back"') !== -1 && indexHtml.indexOf('id="btn-results-back"') !== -1 && appJs.indexOf("function goBack()") !== -1 && appJs.indexOf("PREV_STEP") !== -1);
check("static: light/dark theme toggle is wired and persisted", indexHtml.indexOf('id="theme-toggle"') !== -1 && indexHtml.indexOf('bsa-theme') !== -1 && appCss.indexOf(':root[data-theme="light"]') !== -1 && appJs.indexOf("function wireTheme()") !== -1 && appJs.indexOf('localStorage.setItem("bsa-theme"') !== -1);
check("static: Access-style preview columns have explicit role widths", appCss.indexOf("table-layout: fixed") !== -1 && appJs.indexOf("previewColWidth") !== -1 && appJs.indexOf("previewTableWidth") !== -1 && appJs.indexOf("<colgroup>") !== -1);
check("static: Access preview date/narration spacing is compact", appCss.indexOf("col.w-date { width: 96px") !== -1 && appCss.indexOf("col.w-value-date { width: 96px") !== -1 && appCss.indexOf("col.w-narration { width: 320px") !== -1);
check("static: mapping preview money columns wrap instead of overlapping", appCss.indexOf("col.w-money { width: 160px") !== -1 && appCss.indexOf(".map-table .c-num") !== -1 && appCss.indexOf("white-space: normal; overflow-wrap: anywhere") !== -1 && appJs.indexOf("return 160") !== -1);
check("static: final audit table reserves wider money columns", appCss.indexOf("min-width: 1080px") !== -1 && appCss.indexOf("col.txn-col-money { width: 170px") !== -1 && appCss.indexOf("txn-table-wrap") !== -1);
check("static: encrypted PDF password modal is present", indexHtml.indexOf('id="pdf-password-modal"') !== -1 && indexHtml.indexOf('id="pdf-password-input"') !== -1 && indexHtml.indexOf('id="btn-pdf-password-unlock"') !== -1);
check("static: encrypted PDF retry path is wired", appJs.indexOf("err.pdfPasswordRequired") !== -1 && appJs.indexOf("askPdfPassword") !== -1 && appJs.indexOf("pdfPassword: password") !== -1);
check("static: PDF passwords stay local", indexHtml.indexOf("not uploaded, stored, logged, or sent anywhere") !== -1);
var accessMetaRows = [
  ["Account Name:", "SAMPLE BUSINESS"],
  ["Product Name:", "MPOWER BIZ"],
  ["Currency:", "NGN"],
  ["Opening Balance: 131,073.05"],
  ["Closing Balance:", "130,990.80"],
  ["Post Date", "Value Date", "Narration", "Ref/Cheque No.", "Debits", "Credits", "Balance"]
];
var accessMeta = PARSER.extractStatementMeta(accessMetaRows, 5);
check("meta: Access currency stays NGN, not neighboring balance label", accessMeta && accessMeta.currency === "NGN" && accessMeta.openingBalance === 131073.05 && accessMeta.closingBalance === 130990.8, JSON.stringify(accessMeta));
var fcmbMetaRows = [
  ["Date", "Reference", "Description", "ValueDate", "Deposit", "Withdrawal", "Balance"],
  ["Opening Balance:", "", "", "", "", "", "33.01 Cr"],
  ["02-Mar-2025", "1731204979/S9 7721782", "Sample narration", "01-Mar-2025", "4,600.00", "", "4,633.01 Cr"]
];
var fcmbMeta = PARSER.extractStatementMeta(fcmbMetaRows, 0);
check("meta: FCMB opening balance can be in far-right balance column", fcmbMeta && fcmbMeta.openingBalance === 33.01, JSON.stringify(fcmbMeta));

/* ============== REAL-STATEMENT FIXTURES (the training set) ==============
 * Every real bank statement we have debugged is captured as a fixture
 * (text items + coordinates, extracted once via pdf.js in the browser).
 * Each must parse to a 100% balance chain with every statement checksum
 * passing — so a fix for one bank can never silently break another. */
var fs = require("fs"), path = require("path");
var fixDir = path.join(__dirname, "..", "reference", "fixtures");
if (fs.existsSync(fixDir)) {
  fs.readdirSync(fixDir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (fname) {
    var fix = JSON.parse(fs.readFileSync(path.join(fixDir, fname), "utf8"));
    var rows = PDF.assemble(fix.pages);
    var det = PARSER.detectColumns(rows);
    check("fixture " + fname + ": table header found", !!det);
    if (!det) return;
    var built = PARSER.buildTransactions(rows, det.headerRow, det.map);
    var ic = PARSER.integrityCheck(built.txns);
    var meta = PARSER.extractStatementMeta(rows, det.headerRow);
    if (meta && meta.openingBalance === null && built.openingBalance !== null) meta.openingBalance = built.openingBalance;
    var rec = PARSER.reconcileWithMeta(built.txns, meta);
    check("fixture " + fname + ": no unreadable rows", built.problems.length === 0,
      built.problems.length + " problems, e.g. " + JSON.stringify(built.problems[0] || ""));
    check("fixture " + fname + ": balance chain 100%", ic.checked > 0 && ic.ratio === 1,
      "ratio=" + (ic.ratio === null ? "n/a" : Math.round(ic.ratio * 1000) / 10 + "%") + " (" + ic.matched + "/" + ic.checked + ")");
    check("fixture " + fname + ": every statement checksum passes", rec && rec.allOk,
      rec ? rec.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label + " — " + c.detail; }).join("; ") : "no checksums");
    if (fix.expect && fix.expect.txns) {
      check("fixture " + fname + ": expected transaction count (" + fix.expect.txns + ")",
        built.txns.length === fix.expect.txns, "got " + built.txns.length);
    }
  });
}

/* ---------------- report ---------------- */
console.log("==========================================");
console.log("  PASSED: " + passed + "   FAILED: " + failed);
console.log("==========================================");
if (failed) {
  failures.forEach(function (f) { console.log("  ✗ " + f); });
  process.exit(1);
}
