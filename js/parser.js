/* =========================================================================
 * STATEMENT PARSER
 * -------------------------------------------------------------------------
 * Turns a bank statement file (CSV / Excel / PDF) into clean transactions:
 *   { index, date: Date, narration, debit, credit, balance|null }
 *
 * Accuracy safeguards (in line with the no-guessing policy):
 *   1. Column auto-detection is only a SUGGESTION — the user confirms the
 *      mapping on a preview before any audit runs.
 *   2. Dates are parsed DAY-FIRST (Nigerian convention) and rows whose
 *      dates cannot be parsed are reported, never silently dropped.
 *   3. If the statement has a Balance column, a running-balance integrity
 *      check (prev ± debit/credit = next) verifies the parse arithmetic.
 *      A poor score blocks the audit with a clear warning.
 * ========================================================================= */

(function (global) {
  "use strict";

  /* ------------------------- CSV (RFC 4180-ish) ------------------------- */
  function parseCSVText(text) {
    var rows = [], row = [], field = "", inQ = false;
    text = String(text).replace(/^﻿/, "");
    // auto-detect delimiter: comma, semicolon or tab
    var head = text.slice(0, 2000);
    var delim = ",";
    var counts = { ",": (head.match(/,/g) || []).length, ";": (head.match(/;/g) || []).length, "\t": (head.match(/\t/g) || []).length };
    if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) delim = ";";
    else if (counts["\t"] > counts[","]) delim = "\t";

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
  }

  /* ------------------------- value parsing ------------------------- */

  var MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, SEPT: 8, OCT: 9, NOV: 10, DEC: 11 };

  function parseDate(v) {
    if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    if (typeof v === "number" && v > 25569 && v < 80000) { // Excel serial
      var ms = Math.round((v - 25569) * 86400000);
      var dt = new Date(ms);
      return new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    }
    var s = String(v || "").trim();
    if (!s) return null;
    s = s.replace(/[T ]\d{1,2}[:.]\d{2}([:.]\d{2})?(\s*[AP]\.?M\.?)?$/i, "").trim(); // strip time
    s = s.replace(/\s*([\/\-.])\s*/g, "$1"); // re-join dates wrapped across PDF lines ("02-Jan- 2026")

    var m;
    // yyyy-mm-dd / yyyy/mm/dd
    m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (m) return mk(+m[1], +m[2] - 1, +m[3]);
    // dd-mm-yyyy / dd/mm/yyyy / dd.mm.yyyy  (DAY FIRST — Nigerian convention)
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (m) {
      var y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
      return mk(y, +m[2] - 1, +m[1]);
    }
    // dd-MMM-yyyy / dd MMM yyyy / dd-MMM-yy
    m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,4})[-,\s]+(\d{2,4})$/);
    if (m && MONTHS[m[2].toUpperCase()] !== undefined) {
      var y2 = +m[3]; if (y2 < 100) y2 += y2 < 70 ? 2000 : 1900;
      return mk(y2, MONTHS[m[2].toUpperCase()], +m[1]);
    }
    // Wema/ALAT PDFs sometimes wrap date + reference + year into one cell:
    // "05-Jan- M122871 2026" becomes "05-Jan-M122871 2026" after cleanup.
    // Treat only the date/year shell as the date; the reference remains visible
    // in the preview but must not block the audit.
    m = s.match(/^(\d{1,2})-([A-Za-z]{3,4})-[A-Za-z0-9\/._-]+\s+(\d{2,4})$/);
    if (m && MONTHS[m[2].toUpperCase()] !== undefined) {
      var yRef = +m[3]; if (yRef < 100) yRef += yRef < 70 ? 2000 : 1900;
      return mk(yRef, MONTHS[m[2].toUpperCase()], +m[1]);
    }
    // ddMMM yyyy / ddMMMyyyy — PDFs whose fonts drop the hyphen glyphs
    // turn "02-Jan-2026" into "02Jan 2026" or "02Jan2026"
    m = s.match(/^(\d{1,2})\s*([A-Za-z]{3,4})[\s,]*(\d{2,4})$/);
    if (m && MONTHS[m[2].toUpperCase()] !== undefined) {
      var y3 = +m[3]; if (y3 < 100) y3 += y3 < 70 ? 2000 : 1900;
      return mk(y3, MONTHS[m[2].toUpperCase()], +m[1]);
    }
    // MMM dd, yyyy
    m = s.match(/^([A-Za-z]{3,4})[\s.]+(\d{1,2}),?\s+(\d{4})$/);
    if (m && MONTHS[m[1].toUpperCase()] !== undefined) return mk(+m[3], MONTHS[m[1].toUpperCase()], +m[2]);
    return null;

    function mk(y, mo, d) {
      if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
      var dt = new Date(y, mo, d);
      return (dt.getMonth() === mo && dt.getDate() === d) ? dt : null;
    }
  }

  function parseAmount(v) {
    if (typeof v === "number") return isFinite(v) ? Math.round(v * 100) / 100 : null;
    var s = String(v == null ? "" : v).trim();
    if (!s || s === "-" || s === "--") return 0;
    var neg = /^\(.*\)$/.test(s) || /-/.test(s.replace(/^-/, "")) === false && /^-/.test(s);
    if (/^\(.*\)$/.test(s)) neg = true;
    var drcr = null;
    var mm = s.match(/\b(DR|CR)\.?$/i);
    if (mm) drcr = mm[1].toUpperCase();
    s = s.replace(/[()₦]/g, "").replace(/NGN|N(?=\d)/gi, "").replace(/\b(DR|CR)\.?$/i, "")
      .replace(/[,\s']/g, "").trim();
    if (s === "" ) return 0;
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    if (neg) n = -Math.abs(n);
    n = Math.round(n * 100) / 100;
    return drcr ? { amount: n, drcr: drcr } : n;
  }

  /* ------------------------- column detection ------------------------- */

  /* Nigerian banks label their transaction-table columns in many ways and
   * in any order. Every spelling we have seen lives here; matching is done
   * LONGEST-LABEL-FIRST so "VALUE DATE" can never be mistaken for "DATE",
   * nor "OPENING BALANCE" for "BALANCE". */
  var ROLE_SYNONYMS = {
    date: ["TRANSACTION DATE", "TRANSACTION TIME", "TRANS DATE", "TRANS TIME", "TXN DATE", "TXN TIME", "TRAN DATE", "POSTING DATE", "POSTED DATE", "POST DATE", "DATE POSTED", "ENTRY DATE", "DATE TIME", "DATETIME", "DATE"],
    valueDate: ["VALUE DATE", "VALUEDATE", "VAL DATE", "VAL. DATE", "VALUE. DATE"],
    narration: ["TRANSACTION DESCRIPTION", "TRANSACTION NARRATION", "TRANSACTION REMARKS", "TRANSACTION DETAILS", "NARRATION", "NARRATIVE", "DESCRIPTION", "PARTICULARS", "REMARKS", "REMARK", "DETAILS", "DESC"],
    debit: ["WITHDRAWAL (DR)", "DEBIT AMOUNT", "DEBIT (DR)", "DEBIT(DR)", "DEBIT AMT", "WITHDRAWALS", "WITHDRAWAL", "MONEY OUT", "OUTFLOW", "DR AMOUNT", "DEBITS", "DEBIT", "DR"],
    credit: ["DEPOSIT (CR)", "CREDIT AMOUNT", "CREDIT (CR)", "CREDIT(CR)", "CREDIT AMT", "LODGEMENTS", "LODGEMENT", "DEPOSITS", "DEPOSIT", "MONEY IN", "INFLOW", "CR AMOUNT", "CREDITS", "CREDIT", "CR"],
    balance: ["RUNNING BALANCE", "ACCOUNT BALANCE", "AVAILABLE BALANCE", "CURRENT BALANCE", "CLOSING BALANCE", "BALANCE", "BAL"],
    amount: ["TRANSACTION AMOUNT", "AMOUNT", "AMT"],
    drcr: ["TRANSACTION TYPE", "DR / CR", "DR/CR", "CR/DR", "INDICATOR", "TYPE", "D/C"],
    reference: ["TRANSACTION REF", "REFERENCE NUMBER", "REFERENCE NO", "INSTRUMENT NO", "CHEQUE NO", "TRANS REF", "REFERENCE", "REF NO", "CHQ NO", "REF"]
  };

  /* Labels that often sit in a statement's table header but carry nothing
   * we audit — their presence is still strong evidence the row IS the
   * header, so they add to the score. */
  var AUX_HEADER_TOKENS = ["CHANNEL", "BRANCH NAME", "TELLER ID", "BRANCH", "TELLER", "ORIGINATOR", "BENEFICIARY", "INSTRUMENT", "SESSION ID"];

  var MATCHERS = (function () {
    var list = [];
    Object.keys(ROLE_SYNONYMS).forEach(function (role) {
      ROLE_SYNONYMS[role].forEach(function (syn) { list.push({ role: role, syn: syn }); });
    });
    AUX_HEADER_TOKENS.forEach(function (syn) { list.push({ role: "_aux", syn: syn }); });
    list.sort(function (a, b) { return b.syn.length - a.syn.length; });
    return list;
  })();

  function normHeader(s) {
    return String(s == null ? "" : s).toUpperCase().replace(/[._:#*]/g, " ").replace(/\s+/g, " ").trim();
  }

  /** Which column role does a single header cell describe, if any? */
  function roleForHeaderCell(h) {
    if (!h || h.length > 40) return null;
    for (var i = 0; i < MATCHERS.length; i++) {
      if (h === MATCHERS[i].syn) return MATCHERS[i];
    }
    for (i = 0; i < MATCHERS.length; i++) {
      var syn = MATCHERS[i].syn;
      if (h.indexOf(syn) === 0) return MATCHERS[i];
      if (h.length <= syn.length + 12 && h.indexOf(syn) > -1) return MATCHERS[i];
    }
    return null;
  }

  /** Map the cells of ONE row to column roles (used both by the automatic
   *  header hunt and when the user manually picks the header row). */
  function mapRowRoles(row) {
    var map = {}, score = 0, nonEmpty = 0, matched = 0, auxCount = 0;
    for (var c = 0; c < (row ? row.length : 0); c++) {
      var h = normHeader(row[c]);
      if (!h) continue;
      nonEmpty++;
      var m = roleForHeaderCell(h);
      if (!m) continue;
      matched++;
      if (m.role === "_aux") { auxCount++; score += 1; continue; }
      if (map[m.role] !== undefined) continue;
      map[m.role] = c;
      score += (m.role === "date" || m.role === "narration" || m.role === "debit" || m.role === "credit") ? 3 : 2;
    }
    if (map.date === undefined && map.valueDate !== undefined) {
      map.date = map.valueDate;
      delete map.valueDate; // one column cannot play two roles
    }
    // distinct recognised header labels on this row (the "quorum")
    var labels = Object.keys(map).length + auxCount;
    // a true header row is made almost entirely of labels
    if (nonEmpty >= 3 && matched / nonEmpty >= 0.6) score += 2;
    return { map: map, score: score, nonEmpty: nonEmpty, matched: matched, labels: labels };
  }

  /** Find the transaction-table header row anywhere in the first 80 rows —
   *  the hero/summary section above it is handled by extractStatementMeta.
   *
   *  A row qualifies as the table header when EITHER:
   *   (a) QUORUM RULE — it carries at least 5 distinct recognised column
   *       labels (Value Date, Reference, Remarks, Credit, Debit, Balance,
   *       Posted Date, Description, Trans Date, Money In/Out, …). Nigerian
   *       statements differ, but their table header always shows ≥5 of
   *       these — while hero rows and transaction rows never do; OR
   *   (b) CORE-TRIO RULE — it names a Date, a Narration/Remarks and a
   *       Debit (or Amount) column, for minimal statements.
   *  Labels may appear in ANY order and under ANY known spelling; the row
   *  with the most recognised labels wins. A quorum row that is missing a
   *  required role still wins the header slot — the user just assigns the
   *  missing dropdown instead of the app mis-reading the hero section. */
  var HEADER_QUORUM = 5;

  function detectColumns(rows) {
    var best = null;
    for (var r = 0; r < Math.min(rows.length, 80); r++) {
      var res = mapRowRoles(rows[r]);
      var coreTrio = res.map.date !== undefined && res.map.narration !== undefined &&
        (res.map.debit !== undefined || res.map.amount !== undefined);
      var quorum = res.labels >= HEADER_QUORUM;
      if (!coreTrio && !quorum) continue;
      var score = res.score + (quorum ? 4 : 0);
      if (!best || score > best.score) {
        best = { headerRow: r, map: res.map, score: score, labels: res.labels, complete: coreTrio };
      }
    }
    return best; // may be null -> manual mapping required
  }

  /** Re-derive the column roles for a header row the USER chose. */
  function detectColumnsAt(rows, headerRow) {
    if (headerRow < 0 || headerRow >= rows.length) return null;
    return { headerRow: headerRow, map: mapRowRoles(rows[headerRow]).map };
  }

  /* ------------------- hero / summary section mining ------------------- */

  var META_LABELS = [
    { key: "openingBalance", kind: "amount", re: /OPENING\s*BALANCE|BALANCE\s*B\/?F\b|BROUGHT\s*FORWARD|START(ING)?\s*BALANCE/ },
    { key: "closingBalance", kind: "amount", re: /CLOSING\s*BALANCE|BALANCE\s*C\/?F\b|CARRIED\s*FORWARD|END(ING)?\s*BALANCE/ },
    { key: "debitCount", kind: "amount", re: /DEBIT\s*COUNT|COUNT\s*OF\s*DEBITS?|NO\.?\s*OF\s*DEBITS?/ },
    { key: "creditCount", kind: "amount", re: /CREDIT\s*COUNT|COUNT\s*OF\s*CREDITS?|NO\.?\s*OF\s*CREDITS?/ },
    { key: "totalDebit", kind: "amount", re: /TOTAL\s*(DEBITS?|WITHDRAWALS?|MONEY\s*OUT|OUTFLOW|DR)\b|(DEBITS?|WITHDRAWALS?)\s*TOTAL/ },
    { key: "totalCredit", kind: "amount", re: /TOTAL\s*(CREDITS?|LODGEMENTS?|DEPOSITS?|MONEY\s*IN|INFLOW|CR)\b|(CREDITS?|LODGEMENTS?)\s*TOTAL/ },
    { key: "accountNumber", kind: "acctno", re: /ACCOUNT\s*(NO|NUMBER)|\bNUBAN\b|\bACCT?\s*(NO|NUM)\b/ },
    { key: "accountName", kind: "text", re: /ACCOUNT\s*NAME|CUSTOMER\s*NAME|ACCOUNT\s*HOLDER/ },
    { key: "accountTypeRaw", kind: "text", re: /ACCOUNT\s*TYPE|PRODUCT\s*NAME|\bPRODUCT\b|ACCOUNT\s*CLASS|SCHEME\s*(TYPE|NAME)|ACCOUNT\s*CATEGORY/ },
    { key: "period", kind: "period", re: /STATEMENT\s*PERIOD|FOR\s*THE\s*PERIOD|DATE\s*RANGE|\bPERIOD\b|\bFROM\b.*\bTO\b/ },
    { key: "currency", kind: "text", re: /\bCURRENCY\b|\bCCY\b/ }
  ];

  var DATE_TOKEN = /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})|(\d{4}-\d{2}-\d{2})|(\d{1,2}[-\s]?[A-Za-z]{3,4}[-\s,]*\d{2,4})/g;

  /** Pull a clean, unambiguous date token out of a noisy cell (e.g. a date
   *  with merged reference fragments around it). Deterministic — only a
   *  recognisable date pattern is accepted, never a guess. */
  function extractDateToken(v) {
    var s = String(v == null ? "" : v);
    if (!s.trim()) return null;
    DATE_TOKEN.lastIndex = 0;
    var m;
    while ((m = DATE_TOKEN.exec(s)) !== null) {
      var d = parseDate(m[0]);
      if (d) return d;
    }
    return null;
  }

  /** Mine the hero (rows above the table header) AND footer rows for the
   *  statement's own summary figures: opening/closing balance, total
   *  debits/credits, period, account number/name/type. These become an
   *  independent checksum for the parse (see reconcileWithMeta). */
  function extractStatementMeta(rows, headerRow) {
    var meta = {
      openingBalance: null, closingBalance: null, totalDebit: null, totalCredit: null,
      debitCount: null, creditCount: null,
      accountNumber: null, accountName: null, accountTypeRaw: null, accountType: null,
      periodFrom: null, periodTo: null, currency: null
    };
    var heroText = [];

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var inHero = headerRow === null || headerRow === undefined || r < headerRow;
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        if (cell == null || cell === "") continue;
        var s = cell instanceof Date ? cell.toLocaleDateString("en-GB") : String(cell);
        var u = s.toUpperCase();
        if (inHero) heroText.push(u);

        for (var i = 0; i < META_LABELS.length; i++) {
          var def = META_LABELS[i];
          // amounts/period may also live in the table FOOTER (totals row);
          // identity fields are only trusted from the hero section
          var allowed = inHero || def.kind === "amount" || def.kind === "period";
          if (!allowed) continue;
          if (def.key === "period" && (meta.periodFrom || meta.periodTo)) continue;
          if (def.key !== "period" && meta[def.key] !== null) continue;
          var m = u.match(def.re);
          if (!m) continue;
          // candidate value: remainder of this cell after the label, the next
          // cells in this row, then the same column of the NEXT row — some
          // banks (e.g. wallet statements) stack the value under the label.
          // A cell that itself carries ANOTHER label is never a value
          // candidate (it would steal its neighbour's figure).
          var candidates = [s.slice((m.index || 0) + m[0].length)];
          function pushCandidate(cell) {
            if (cell == null || cell === "") return;
            var str = cell instanceof Date ? cell.toLocaleDateString("en-GB") : String(cell);
            var up = str.toUpperCase();
            for (var li = 0; li < META_LABELS.length; li++) {
              if (META_LABELS[li].re.test(up)) return; // it's a label, not a value
            }
            candidates.push(str);
          }
          for (var k = c + 1; k < row.length; k++) pushCandidate(row[k]);
          var below = rows[r + 1];
          if (below) for (var k2 = c; k2 <= c + 1 && k2 < below.length; k2++) pushCandidate(below[k2]);
          assignMeta(meta, def, candidates);
        }
      }
    }

    // classify the account type from any hero wording
    var typeSource = ((meta.accountTypeRaw || "") + " " + heroText.join(" ")).toUpperCase();
    if (/DOMICILIARY|\bDOM\b.{0,10}ACCOUNT/.test(typeSource)) meta.accountType = "domiciliary";
    else if (/SAVINGS?/.test(typeSource)) meta.accountType = "savings";
    else if (/CURRENT/.test(typeSource)) meta.accountType = "current";

    var any = Object.keys(meta).some(function (k) { return meta[k] !== null; });
    return any ? meta : null;
  }

  function assignMeta(meta, def, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var raw = String(candidates[i]).replace(/^[\s:=\-–]+/, "").trim();
      if (!raw) continue;
      if (def.kind === "amount") {
        if (parseDate(raw)) continue; // a date below/near the label is not a money value
        var numMatch = raw.match(/-?[\d,]+(\.\d{1,2})?/);
        if (!numMatch) continue;
        var v = parseAmount(numMatch[0]);
        if (typeof v === "number") { meta[def.key] = Math.abs(v); return; }
      } else if (def.kind === "acctno") {
        var am = raw.match(/\d{10}/);
        if (am) { meta[def.key] = am[0]; return; }
      } else if (def.kind === "period") {
        var found = [];
        var dm, str = candidates.join(" ");
        DATE_TOKEN.lastIndex = 0;
        while ((dm = DATE_TOKEN.exec(str)) !== null) {
          var d = parseDate(dm[0]);
          if (d) found.push(d);
        }
        if (found.length >= 1) {
          found.sort(function (a, b) { return a - b; });
          meta.periodFrom = found[0];
          meta.periodTo = found[found.length - 1];
          return;
        }
        continue;
      } else { // text
        if (/^[\d,.\s]+$/.test(raw) && def.key !== "accountNumber") continue;
        if (def.key === "currency") {
          var cm = raw.toUpperCase().match(/\b(NGN|USD|GBP|EUR|JPY|CAD|AUD|CHF|CNY|ZAR|GHS|XOF|XAF|[A-Z]{3})\b/);
          if (!cm || /BALANCE|OPENING|CLOSING|DEBIT|CREDIT|TOTAL/.test(raw.toUpperCase())) continue;
          meta[def.key] = cm[1]; return;
        }
        meta[def.key] = raw.slice(0, 60);
        return;
      }
    }
  }

  /** Wallet statements (e.g. OPay/OWealth) print BOTH ledger legs of each
   *  internal savings sweep, but their declared summary counts only the
   *  wallet side. The savings-side legs are identifiable by direction:
   *  auto-saves/interest accrue INTO savings (credit leg), withdrawals
   *  come OUT of savings (debit leg). */
  function isInternalSweepLeg(t) {
    var n = String(t.narration || "").toUpperCase();
    if (/AUTO-?SAVE/.test(n)) return t.credit > 0;
    if (/OWEALTH\s*WITHDRAWAL|\(TRANSACTION\s*PAYMENT\)/.test(n)) return t.debit > 0;
    if (/OWEALTH\s*INTEREST|INTEREST\s*EARNED/.test(n)) return t.credit > 0;
    return false;
  }

  /** Prove the parse against the statement's own summary figures.
   *  Every check is independent; a failed check means rows were missed or
   *  misread — and the audit should not be trusted until fixed.
   *  Two reading bases are tried: all rows, and (for wallet statements)
   *  all rows minus internal savings-sweep legs. The alternative basis is
   *  only adopted when it makes EVERY declared total/count match — the
   *  numbers themselves prove which convention the statement uses. */
  function reconcileWithMeta(txns, meta) {
    if (!meta || !txns.length) return null;
    function rr(n) { return Math.round(n * 100) / 100; }
    function sums(list) {
      var pd = 0, pc = 0, dn = 0, cn = 0;
      list.forEach(function (t) {
        pd = rr(pd + t.debit); pc = rr(pc + t.credit);
        if (t.debit > 0) dn++;
        if (t.credit > 0) cn++;
      });
      return { pd: pd, pc: pc, dn: dn, cn: cn };
    }
    var all = sums(txns);
    var sweepCount = 0;
    var nonSweep = txns.filter(function (t) {
      var s = isInternalSweepLeg(t);
      if (s) sweepCount++;
      return !s;
    });
    function basisOk(s) {
      var pairs = [[meta.totalDebit, s.pd], [meta.totalCredit, s.pc], [meta.debitCount, s.dn], [meta.creditCount, s.cn]];
      var any = false, ok = true;
      pairs.forEach(function (pr) {
        if (pr[0] === null || pr[0] === undefined) return;
        any = true;
        if (Math.abs(pr[0] - pr[1]) > 0.02) ok = false;
      });
      return any && ok;
    }
    var basis = all, basisNote = "";
    if (sweepCount && !basisOk(all) && basisOk(sums(nonSweep))) {
      basis = sums(nonSweep);
      basisNote = " (the statement's summary excludes its " + sweepCount + " internal savings-sweep legs; verified on that basis)";
    }

    var checks = [];
    function add(label, expected, actual, isCount, note) {
      if (expected === null || expected === undefined) return;
      var ok = Math.abs(expected - actual) <= 0.02;
      var f = isCount ? function (n) { return String(Math.round(n)); } : fmt;
      checks.push({
        label: label, ok: ok,
        detail: ok ? f(actual) + " — matches the statement's own figure" + (note || "")
          : "statement says " + f(expected) + " but the parsed rows " + (isCount ? "count " : "add up to ") + f(actual) + " (difference " + f(Math.abs(expected - actual)) + ")"
      });
    }
    function fmt(n) { return "₦" + Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    add("Total debits", meta.totalDebit, basis.pd, false, basisNote);
    add("Total credits", meta.totalCredit, basis.pc, false, basisNote);
    add("Number of debit transactions", meta.debitCount, basis.dn, true, basisNote);
    add("Number of credit transactions", meta.creditCount, basis.cn, true, basisNote);
    if (meta.openingBalance !== null && meta.closingBalance !== null) {
      add("Opening + credits − debits = closing", meta.closingBalance,
        rr(meta.openingBalance + basis.pc - basis.pd), false, basisNote);
    }

    var withBal = txns.filter(function (t) { return t.balance !== null; });
    if (withBal.length) {
      // the main table's chain may be followed by a separate savings/interest
      // section with its own balance track — the closing balance belongs to
      // the END OF THE CONNECTED CHAIN, not to whatever row is printed last
      var lastMainBal = withBal[0].balance, prevRow = withBal[0], tail = 0;
      for (var i = 1; i < withBal.length; i++) {
        var t2 = withBal[i];
        if (Math.abs(rr(prevRow.balance - t2.debit + t2.credit) - t2.balance) <= 0.011) {
          lastMainBal = t2.balance; prevRow = t2;
        } else { tail = withBal.length - i; break; }
      }
      var tailNote = tail ? " (a separate savings/interest section of " + tail + " row(s) follows the main table on its own balance track)" : "";
      if (meta.closingBalance !== null) add("Last running balance vs closing balance", meta.closingBalance, lastMainBal, false, tailNote);
      if (meta.openingBalance !== null) {
        var first = withBal[0];
        add("First running balance vs opening balance", meta.openingBalance,
          rr(first.balance + first.debit - first.credit));
      }
    }
    if (!checks.length) return null;
    return {
      checks: checks,
      allOk: checks.every(function (ch) { return ch.ok; }),
      anyFail: checks.some(function (ch) { return !ch.ok; })
    };
  }

  /* ------------------------- transaction building ------------------------- */

  var FOOTER_RE = /\bTOTALS?\b|BROUGHT\s*FORWARD|CARRIED\s*FORWARD|\bB\/F\b|\bC\/F\b|OPENING\s*BAL|CLOSING\s*BAL|PAGE\s+\d+\s*(OF|\/)/i;

  function buildTransactions(rows, headerRow, map) {
    var txns = [], problems = [], lastTxn = null, openingBalance = null, pendingDatePrefix = null;
    var headerLen = rows[headerRow] ? rows[headerRow].length : 0;
    for (var r = headerRow + 1; r < rows.length; r++) {
      var row = rows[r];
      var joinedRow = row.join(" ").replace(/\s+/g, " ").trim();
      // Wema/ALAT can extract the table header as two visual rows:
      // "Date | Transaction Details | Credit | Debit | Balance" followed by
      // a standalone "Number" row (the tail of "Reference Number"). It is
      // header continuation text, not a transaction row.
      if (/^(reference\s+)?number$/i.test(joinedRow) || /^r\s*e\s*f\s*e\s*r\s*e\s*n\s*c\s*e\s+number$/i.test(joinedRow)) continue;
      // ragged-CSV repair: some banks export unquoted commas inside the
      // narration, splitting it across extra cells and shifting every
      // column after it — re-join the overflow into the narration cell
      if (headerLen && map.narration !== undefined && row.length > headerLen) {
        var extra = row.length - headerLen;
        row = row.slice(0, map.narration)
          .concat([row.slice(map.narration, map.narration + extra + 1).join(", ")])
          .concat(row.slice(map.narration + extra + 1));
      }
      var rawDate = row[map.date];
      var rawDateText = String(rawDate == null ? "" : rawDate).trim();
      var date = parseDate(rawDate);
      // Moniepoint PDFs sometimes split ISO datetimes across visual rows:
      // row A date cell: "2025-02-18T15:"; row B date cell: "24:02".
      // Rejoin only when the previous visual row supplied an incomplete ISO
      // date/time prefix and the current row is exactly the missing time tail.
      if (!date && pendingDatePrefix && /^\d{1,2}:\d{2}$/.test(rawDateText)) {
        date = parseDate(pendingDatePrefix + rawDateText);
      }
      // fallback chain: Trans Date -> Value Date -> a clean date token
      // inside either cell. Only rows failing ALL of these are excluded.
      if (!date && map.valueDate !== undefined && map.valueDate !== map.date) {
        date = parseDate(row[map.valueDate]);
      }
      if (!date) date = extractDateToken(rawDate);
      if (!date && map.valueDate !== undefined && map.valueDate !== map.date) {
        date = extractDateToken(row[map.valueDate]);
      }
      var narration = map.narration !== undefined ? String(row[map.narration] == null ? "" : row[map.narration]).trim() : "";
      if (map.reference !== undefined) {
        var ref = String(row[map.reference] == null ? "" : row[map.reference]).trim();
        if (ref && ref !== narration) narration = narration ? narration + " | " + ref : ref;
      }
      // page footers fuse into rows that straddle a page break
      narration = narration.replace(/\bPage:?\s*\d+\s*of\s*\d+\s*/gi, " ").replace(/\s{2,}/g, " ").trim();

      // page-break date fragments: a bare year tail ("2026") or a bare
      // day-month head ("02-Jan-") is completed from the previous row's
      // year — deterministic, since statements are chronological
      if (!date && lastTxn) {
        var frag = String(rawDate == null ? "" : rawDate).trim();
        if (/^\d{4}$/.test(frag) && +frag === lastTxn.date.getFullYear()) date = lastTxn.date;
        else if (/^\d{1,2}[-\s\/.]?[A-Za-z]{3,4}[-\s\/.]?$/.test(frag)) date = parseDate(frag + " " + lastTxn.date.getFullYear());
      }

      if (!date) {
        var rawStr = rawDateText;
        // summary/footer lines (totals, B/F-C/F, page numbers) are not transactions
        if (FOOTER_RE.test(row.join(" "))) continue;
        if (!rawStr && lastTxn && rowHasMoney(row, map)) {
          // some statements print the date only once for several rows in a day
          date = lastTxn.date;
        } else if (lastTxn && narration && rowIsOnlyText(row, map)) {
          // wrapped narration on a dateless continuation row
          lastTxn.narration += " " + narration;
          continue;
        } else {
          if (rowHasMoney(row, map)) {
            problems.push({ row: r + 1, issue: "Unreadable date '" + rawDate + "' on a row with amounts — row was NOT audited", data: row.join(" | ").slice(0, 140) });
          }
          continue;
        }
      }

      var debit = 0, credit = 0, balance = null;
      if (map.debit !== undefined || map.credit !== undefined) {
        var dv = map.debit !== undefined ? parseAmount(row[map.debit]) : 0;
        var cv = map.credit !== undefined ? parseAmount(row[map.credit]) : 0;
        if (dv === null || cv === null) {
          problems.push({ row: r + 1, issue: "Unreadable amount — row was NOT audited", data: row.join(" | ").slice(0, 140) });
          continue;
        }
        debit = Math.abs(typeof dv === "object" ? dv.amount : dv);
        credit = Math.abs(typeof cv === "object" ? cv.amount : cv);
      } else if (map.amount !== undefined) {
        var av = parseAmount(row[map.amount]);
        if (av === null) {
          problems.push({ row: r + 1, issue: "Unreadable amount — row was NOT audited", data: row.join(" | ").slice(0, 140) });
          continue;
        }
        var amt = typeof av === "object" ? av.amount : av;
        var ind = typeof av === "object" ? av.drcr : null;
        if (!ind && map.drcr !== undefined) {
          var indRaw = normHeader(row[map.drcr]);
          if (/^D|DEBIT/.test(indRaw)) ind = "DR";
          else if (/^C|CREDIT/.test(indRaw)) ind = "CR";
        }
        if (ind === "DR") debit = Math.abs(amt);
        else if (ind === "CR") credit = Math.abs(amt);
        else if (amt < 0) debit = Math.abs(amt);
        else credit = amt;
      }
      if (map.balance !== undefined) {
        var bv = parseAmount(row[map.balance]);
        if (bv !== null && typeof bv !== "object") balance = bv;
        if (bv !== null && typeof bv === "object") balance = bv.amount;
      }
      if (debit === 0 && credit === 0) {
        var partialIso = rawDateText.match(/^(\d{4}-\d{2}-\d{2}T\d{1,2}:)\s*$/);
        if (partialIso) pendingDatePrefix = partialIso[1];
        // a "Balance B/F / opening balance" table row carries the opening figure
        if (balance !== null && txns.length === 0 && /B\/?F|BROUGHT\s*F|OPENING/i.test(narration)) openingBalance = balance;
        continue; // non-monetary row
      }

      lastTxn = { index: txns.length, date: date, narration: narration, debit: debit, credit: credit, balance: balance };
      pendingDatePrefix = null;
      txns.push(lastTxn);
    }
    var repaired = repairChain(txns);
    return {
      txns: txns, problems: problems, openingBalance: openingBalance,
      duplicates: repaired.dups, resequenced: repaired.swaps
    };

    function rowHasMoney(row, map) {
      var cells = [map.debit, map.credit, map.amount].filter(function (x) { return x !== undefined; });
      return cells.some(function (c) {
        var v = parseAmount(row[c]);
        var n = (v && typeof v === "object") ? v.amount : v;
        return typeof n === "number" && n !== 0;
      });
    }
    function rowIsOnlyText(row, map) { return !rowHasMoney(row, map); }
  }

  /* ------------------- balance-chain repair (page breaks) ------------------- */

  /** Bank PDF generators re-render rows that straddle a page boundary —
   *  sometimes a whole GROUP of rows, sometimes in a different order.
   *  Every repair here is PROVEN by the running-balance arithmetic, never
   *  guessed: a row is only removed when it is an exact re-render of a
   *  recent row (same date, amounts AND running balance) sitting where the
   *  chain breaks; two adjacent rows are only swapped when the swap makes
   *  both of them reconcile. Statements without a balance column are left
   *  untouched. */
  /** Cheap narration-token similarity used to confirm duplicates (the two
   *  renders of a page-straddling row share names and references). */
  function narrTokensLite(s) {
    var seen = {}, out = [];
    String(s || "").toUpperCase().split(/[^A-Z0-9]+/).forEach(function (w) {
      if (w.length < 3 || seen[w]) return;
      seen[w] = 1; out.push(w);
    });
    return out;
  }
  function similarNarrLite(a, b) {
    var A = narrTokensLite(a), B = narrTokensLite(b);
    if (!A.length || !B.length) return false;
    var setB = {}; B.forEach(function (w) { setB[w] = 1; });
    var hits = 0;
    A.forEach(function (w) { if (setB[w]) hits++; });
    return hits / Math.min(A.length, B.length) >= 0.5;
  }

  /** Are two rows the SAME transaction? Transaction references (long digit
   *  runs) are decisive when both rows carry them: page-break re-renders
   *  share theirs, while two genuine same-payee/same-amount payments never
   *  do. Without references, fall back to narration similarity. */
  function longDigitTokens(s) {
    return (String(s || "").match(/\d{8,}/g) || []);
  }
  /** balanceIsRare: how often this balance value occurs in the statement —
   *  a value seen only twice makes a signature match near-proof, while a
   *  wallet's ever-repeating ₦0.00 proves nothing. */
  function sameTxnFingerprint(a, b, balanceIsRare) {
    var ra = longDigitTokens(a), rb = longDigitTokens(b);
    if (ra.length && rb.length) {
      return ra.some(function (x) { return rb.indexOf(x) >= 0; }); // references decide
    }
    return !!balanceIsRare && similarNarrLite(a, b);
  }

  /** Repair the transaction sequence using the running balance as proof.
   *  Banks' PDFs print rows out of order at page boundaries, and wallet
   *  statements (e.g. OPay/OWealth sweeps) list a payment BEFORE the
   *  funding row that precedes it arithmetically. Order of operations
   *  matters: swaps are tried FIRST (non-destructive); a row is removed
   *  as a duplicate only when its date+amounts+balance match a recent row
   *  AND the narrations agree — never on amounts alone, so recurring
   *  identical payments are safe. */
  function repairChain(txns) {
    if (!txns.some(function (t) { return t.balance !== null; })) return { dups: 0, swaps: 0 };
    function rr(n) { return Math.round(n * 100) / 100; }
    function fits(balFrom, t) { return Math.abs(rr(balFrom - t.debit + t.credit) - t.balance) <= 0.011; }

    /* Greedy chain reconstruction. Keep a running balance; at each step
     * take the FIRST nearby printed row whose debit/credit/balance fits
     * the arithmetic (banks scramble row order at page boundaries, and
     * wallet statements print payments before the funding rows that
     * precede them). A row that never fits is either a duplicate
     * re-render of a recent row (same date+amounts+balance AND the same
     * transaction reference — dropped) or the start of a new
     * self-consistent section (kept as a new anchor). */
    var remaining = txns.slice();
    var out = [], dups = 0, moved = 0;
    var cur = null;
    var WINDOW = 8;

    var balFreq = {};
    txns.forEach(function (t) {
      if (t.balance !== null) balFreq[t.balance] = (balFreq[t.balance] || 0) + 1;
    });

    function findDup(head, lookback) {
      var rare = balFreq[head.balance] <= 3;
      for (var k = out.length - 1; k >= Math.max(0, out.length - lookback); k--) {
        var c = out[k];
        if (c.balance === head.balance && c.debit === head.debit && c.credit === head.credit &&
            c.date && head.date && c.date.getTime() === head.date.getTime() &&
            sameTxnFingerprint(c.narration, head.narration, rare)) return c;
      }
      return null;
    }
    function dropAsDup(head, dup) {
      if (head.narration.length > dup.narration.length) dup.narration = head.narration;
      dups++;
    }

    while (remaining.length) {
      var head = remaining[0];
      // rows without a balance cell pass through in printed order
      if (head.balance === null) {
        out.push(remaining.shift());
        continue;
      }
      // anchor, or fast path: the head fits the chain — and a row that
      // fits is NEVER a duplicate (a re-render's balance is stale)
      if (cur === null || fits(cur, head)) {
        out.push(remaining.shift());
        cur = head.balance;
        continue;
      }
      // head does not fit: a page-boundary re-render of a recent row?
      var earlyDup = findDup(head, 8);
      if (earlyDup) { dropAsDup(remaining.shift(), earlyDup); continue; }
      // displaced row: the true next row was printed a little later
      var pickedIdx = -1;
      for (var j = 1; j < Math.min(WINDOW, remaining.length); j++) {
        var cand = remaining[j];
        if (cand.balance === null) continue;
        if (fits(cur, cand)) { pickedIdx = j; break; }
      }
      if (pickedIdx === -1) {
        remaining.shift();
        var dup = findDup(head, out.length); // full-history backstop
        if (dup) dropAsDup(head, dup);
        else {
          out.push(head);
          cur = head.balance; // unexplained break or a new section's own track
        }
        continue;
      }
      var pick = remaining.splice(pickedIdx, 1)[0];
      moved++;
      out.push(pick);
      cur = pick.balance;
    }

    for (var i2 = 0; i2 < out.length; i2++) txns[i2] = out[i2];
    txns.length = out.length;
    txns.forEach(function (x, idx) { x.index = idx; });
    return { dups: dups, swaps: moved };
  }

  /* ------------------------- integrity check ------------------------- */

  /** Verify prev balance ± debit/credit = balance, transaction by transaction.
   *  A high match rate proves the columns were mapped correctly.
   *  A break that opens a NEW self-consistent balance track is a section
   *  transition (e.g. a wallet statement's savings/interest annex), not a
   *  misread — counted separately, not against the score. */
  function integrityCheck(txns) {
    var checked = 0, matched = 0, sections = 0;
    function rr(n) { return Math.round(n * 100) / 100; }
    var withBal = txns.filter(function (t) { return t.balance !== null; });
    for (var i = 1; i < withBal.length; i++) {
      var p = withBal[i - 1], t = withBal[i];
      checked++;
      if (Math.abs(rr(p.balance - t.debit + t.credit) - t.balance) <= 0.011) { matched++; continue; }
      var nx = withBal[i + 1];
      if (nx && Math.abs(rr(t.balance - nx.debit + nx.credit) - nx.balance) <= 0.011) {
        checked--; sections++; // new internally-consistent track begins at t
      }
    }
    return {
      checked: checked, matched: matched, sections: sections,
      ratio: checked ? matched / checked : null,
      hasBalance: withBal.length > 0
    };
  }

  /* ------------------------- browser file readers ------------------------- */

  function readFile(file, onProgress, opts) {
    var name = (file.name || "").toLowerCase();
    if (/\.(xlsx|xls)$/.test(name)) return readExcel(file);
    if (/\.pdf$/.test(name)) return readPdf(file, onProgress, opts || {});
    return readCsv(file); // .csv, .txt and anything else text-like
  }

  function readCsv(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve({ rows: parseCSVText(fr.result), source: "csv" }); };
      fr.onerror = function () { reject(new Error("Could not read the file.")); };
      fr.readAsText(file);
    });
  }

  function readExcel(file) {
    return new Promise(function (resolve, reject) {
      if (typeof XLSX === "undefined") return reject(new Error("Excel library not loaded."));
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(fr.result), { type: "array", cellDates: true });
          // choose the sheet with the most rows
          var bestSheet = null, bestLen = -1;
          wb.SheetNames.forEach(function (sn) {
            var data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" });
            if (data.length > bestLen) { bestLen = data.length; bestSheet = data; }
          });
          resolve({ rows: bestSheet || [], source: "excel", sheetCount: wb.SheetNames.length });
        } catch (e) { reject(new Error("Could not parse the Excel file: " + e.message)); }
      };
      fr.onerror = function () { reject(new Error("Could not read the file.")); };
      fr.readAsArrayBuffer(file);
    });
  }

  function readPdf(file, onProgress, opts) {
    return new Promise(function (resolve, reject) {
      if (typeof pdfjsLib === "undefined") return reject(new Error("PDF library not loaded."));
      opts = opts || {};
      var fr = new FileReader();
      fr.onload = function () {
        var docOptions = { data: new Uint8Array(fr.result) };
        if (opts.pdfPassword) docOptions.password = opts.pdfPassword;
        pdfjsLib.getDocument(docOptions).promise.then(function (doc) {
          if (doc.numPages === 0) return reject(new Error("Empty PDF."));
          var pages = [];
          var chain = Promise.resolve();
          for (var p = 1; p <= doc.numPages; p++) {
            (function (pageNo) {
              chain = chain.then(function () {
                if (onProgress) { try { onProgress(pageNo, doc.numPages); } catch (e) { /* UI only */ } }
                // yield a macrotask so the progress UI can actually paint
                return new Promise(function (res) { setTimeout(res, 0); });
              }).then(function () {
                return doc.getPage(pageNo).then(function (page) {
                  return page.getTextContent();
                }).then(function (tc) {
                  pages.push(pdfLines(tc));
                });
              });
            })(p);
          }
          chain.then(function () {
            var rows = assemblePdfRows(pages);
            if (!rows.length) {
              return reject(new Error("This PDF contains no extractable text — it is probably a scanned image. Please download your statement as CSV or Excel from your bank's internet banking instead."));
            }
            resolve({ rows: rows, source: "pdf", pageCount: doc.numPages });
          }).catch(reject);
        }).catch(function (e) {
          reject(pdfOpenError(e, !!opts.pdfPassword));
        });
      };
      fr.onerror = function () { reject(new Error("Could not read the file.")); };
      fr.readAsArrayBuffer(file);
    });
  }

  function pdfOpenError(e, hadPassword) {
    var msg = (e && e.message) || "";
    var code = e && e.code;
    var name = (e && e.name) || "";
    var isPassword = /password/i.test(msg) || /PasswordException/i.test(name) || code === 1 || code === 2;
    if (!isPassword) return new Error("Could not open the PDF: " + msg);
    var err = new Error(hadPassword ? "That PDF password did not work. Please check it and try again." : "This PDF is password-protected. Enter the statement password to unlock it on this device.");
    err.code = code === 2 || hadPassword ? "PDF_PASSWORD_INCORRECT" : "PDF_PASSWORD_REQUIRED";
    err.pdfPasswordRequired = true;
    err.pdfPasswordIncorrect = err.code === "PDF_PASSWORD_INCORRECT";
    return err;
  }

  /* --------------- PDF: header-anchored column extraction ---------------
   * A PDF has no real columns — only text fragments at x/y positions.
   * Naively splitting on gaps shifts values left whenever a cell (often
   * Debit) is empty. So instead:
   *   1. group text into visual lines;
   *   2. find the header line with the label-quorum rule (also merging two
   *      stacked lines, because banks wrap headers like "Trans"/"Date");
   *   3. the header labels' x-extents become COLUMN BOUNDARIES;
   *   4. every later value is snapped into the column it physically sits
   *      under — empty cells stay empty, exactly as the eye reads it.
   * Repeated headers on later pages refresh the anchors silently. */

  /** One page -> visual lines (top to bottom) with x extents per item. */
  function pdfLines(tc) {
    var byY = {};
    tc.items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = Math.round(it.transform[5] / 2) * 2; // bucket nearby baselines
      (byY[y] = byY[y] || []).push({
        x: it.transform[4],
        w: (typeof it.width === "number" && it.width > 0) ? it.width : it.str.length * 5,
        y: it.transform[5],
        str: it.str.trim()
      });
    });
    return Object.keys(byY).map(Number).sort(function (a, b) { return b - a; })
      .map(function (y) { return { y: y, items: byY[y].sort(function (a, b) { return a.x - b.x; }) }; });
  }

  /** Cluster items (possibly from two merged lines) into cells by x-extent. */
  function pdfClusterCells(items, gap) {
    var sorted = items.slice().sort(function (a, b) { return a.x - b.x; });
    var cells = [];
    sorted.forEach(function (it) {
      var cur = cells[cells.length - 1];
      if (cur && it.x <= cur.hi + gap) {
        cur.items.push(it);
        cur.hi = Math.max(cur.hi, it.x + it.w);
      } else {
        cells.push({ lo: it.x, hi: it.x + it.w, items: [it] });
      }
    });
    cells.forEach(function (c) {
      c.items.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); }); // upper line first
      c.text = c.items.map(function (i) { return i.str; }).join(" ").replace(/\s+/g, " ").trim();
    });
    return cells;
  }

  /** Score a line (optionally merged with the next, for stacked headers
   *  like "Trans"/"Date") as a candidate transaction-table header. */
  function pdfTryHeader(lineA, lineB) {
    var items = lineB ? lineA.items.concat(lineB.items) : lineA.items;
    if (!items.length) return null;
    var cells = pdfClusterCells(items, 9);
    var candidate = pdfHeaderFromCells(cells);

    // FCMB-style statements can place non-table text ("PRIVATE AND
    // CONFIDENTIAL") on the same visual line as the table header. Clustering
    // then swallows Date/Reference/Description into one wide cell and the
    // header is missed. Fallback: inspect the individual PDF text items and
    // keep only the words that are known header labels; their x-extents make
    // the column anchors. This still requires a label quorum, so it cannot
    // mistake ordinary transaction text for a header.
    var itemCells = items.map(function (it) {
      return { lo: it.x, hi: it.x + it.w, items: [it], text: it.str };
    }).sort(function (a, b) { return a.lo - b.lo; });
    var itemCandidate = pdfHeaderFromCells(itemCells);
    if (pdfHeaderQualifies(itemCandidate) && (!pdfHeaderQualifies(candidate) || itemCandidate.labels > candidate.labels)) {
      return itemCandidate;
    }
    return candidate;
  }

  function pdfHeaderFromCells(cells) {
    var map = {}, labels = 0, headerCells = [];
    cells.forEach(function (c) {
      var m = roleForHeaderCell(normHeader(c.text));
      if (!m) return;
      if (m.role === "_aux") { labels++; return; }
      if (map[m.role] !== undefined) return;
      map[m.role] = headerCells.length;
      headerCells.push(c);
      labels++;
    });
    if (map.date === undefined && map.valueDate !== undefined) {
      map.date = map.valueDate;
      delete map.valueDate;
    }
    return { cells: headerCells.length ? headerCells : cells, labels: labels, map: map, hasDate: map.date !== undefined };
  }

  function lineText(line) {
    return line ? line.items.map(function (it) { return it.str; }).join(" ").replace(/\s+/g, " ").trim() : "";
  }

  function pdfMaybeAddStackedReferenceNumber(header, prevLine, nextLine) {
    if (!header || header.map.reference !== undefined || !prevLine || !nextLine) return header;
    var prevText = lineText(prevLine), nextText = lineText(nextLine);
    if (!/^r\s*e\s*f\s*e\s*r\s*e\s*n\s*c\s*e$/i.test(prevText) || !/^number$/i.test(nextText)) return header;
    var refItems = prevLine.items.concat(nextLine.items);
    var lo = Math.min.apply(null, refItems.map(function (it) { return it.x; }));
    var hi = Math.max.apply(null, refItems.map(function (it) { return it.x + it.w; }));
    var cells = header.cells.concat([{ lo: lo, hi: hi, items: refItems, text: "Reference Number", consumeBelow: true }])
      .sort(function (a, b) { return a.lo - b.lo; });
    var rebuilt = pdfHeaderFromCells(cells);
    rebuilt.consumeBelow = true;
    return pdfHeaderQualifies(rebuilt) ? rebuilt : header;
  }

  function pdfHeaderQualifies(h) { return !!h && h.labels >= 4 && (h.hasDate || h.labels >= 5); }

  /** Column boundaries = midpoints between the header labels' x-extents.
   *  The narration/description column gets special treatment: its text can
   *  legitimately run almost up to the next column's label (banks make it
   *  very wide), so its right boundary is pushed to just before the next
   *  label instead of the midpoint — long descriptions stay narration,
   *  while amounts (which sit at/after their own label) are unaffected. */
  function pdfBoundaries(cells, narrCol) {
    var b = [];
    for (var i = 0; i < cells.length - 1; i++) {
      var edge = (cells[i].hi + cells[i + 1].lo) / 2;
      if (narrCol !== undefined && i === narrCol) {
        edge = Math.max(edge, cells[i + 1].lo - 15);
      }
      b.push(edge);
    }
    return { boundaries: b, n: cells.length };
  }

  /** Snap a line's items into the header-anchored columns. Items are first
   *  clustered into contiguous phrases so a trailing word of a long
   *  description cannot break off into the next column on its own. */
  function pdfAssign(items, anchors) {
    var cols = new Array(anchors.n);
    pdfClusterCells(items, 6).forEach(function (cl) {
      var center = (cl.lo + cl.hi) / 2;
      var col = 0;
      while (col < anchors.boundaries.length && center > anchors.boundaries[col]) col++;
      cols[col] = cols[col] ? cols[col] + " " + cl.text : cl.text;
    });
    var out = [];
    for (var i = 0; i < anchors.n; i++) out.push(cols[i] || "");
    return out;
  }

  /** Merge a wrapped continuation line into its row, cell by cell —
   *  date tails rejoin the date, remark lines rejoin the remarks. */
  function pdfMergeInto(row, cells) {
    for (var c = 0; c < cells.length; c++) {
      if (!cells[c]) continue;
      row[c] = row[c] ? row[c] + " " + cells[c] : cells[c];
    }
  }

  /** Split a page's data lines into logical transaction rows by their
   *  VERTICAL SPACING — the way the eye does it. Lines inside one
   *  transaction sit a single line-height apart; a new transaction starts
   *  after a visibly larger gap (row padding / rule line). This is layout-
   *  driven, so it survives vertically-centred rows where the date and
   *  amounts appear on middle lines of the block. With perfectly uniform
   *  spacing (tight single-line tables) every line is its own row and the
   *  content-level fallbacks in buildTransactions handle wrapped text. */
  function pdfSegmentByGaps(lines) {
    if (lines.length <= 1) return lines.length ? [lines] : [];
    var gaps = [];
    for (var i = 1; i < lines.length; i++) gaps.push(Math.max(1, lines[i - 1].y - lines[i].y));
    var minGap = Math.min.apply(null, gaps);
    var threshold = Math.max(minGap * 1.4, minGap + 3);
    if (gaps.every(function (g) { return g <= threshold; })) {
      return lines.map(function (l) { return [l]; }); // uniform spacing: one line = one row
    }
    var segs = [], cur = [lines[0]];
    for (i = 1; i < lines.length; i++) {
      if (gaps[i - 1] > threshold) { segs.push(cur); cur = []; }
      cur.push(lines[i]);
    }
    segs.push(cur);
    return segs;
  }

  function assemblePdfRows(pages) {
    var rows = [], anchors = null, headerPushed = false, headerShape = 0;
    pages.forEach(function (lines) {
      var dataBuf = [];
      function flushData() {
        pdfSegmentByGaps(dataBuf).forEach(function (seg) {
          var merged = null;
          seg.forEach(function (ln) {
            var cells = pdfAssign(ln.items, anchors);
            if (!merged) merged = cells;
            else pdfMergeInto(merged, cells);
          });
          if (merged) rows.push(merged);
        });
        dataBuf = [];
      }
      for (var i = 0; i < lines.length; i++) {
        var one = pdfTryHeader(lines[i], null);
        // Only try a stacked two-line header when the upper line already
        // contains several header labels. Otherwise an "Opening Balance" hero
        // row plus the next header line can be falsely merged as a header.
        var two = (i + 1 < lines.length && one && one.labels >= 2) ? pdfTryHeader(lines[i], lines[i + 1]) : null;
        var pick = null, usedTwo = false;
        if (pdfHeaderQualifies(one)) pick = one;
        if (pdfHeaderQualifies(two) && (!pick || two.labels > one.labels)) { pick = two; usedTwo = true; }
        if (pick) pick = pdfMaybeAddStackedReferenceNumber(pick, lines[i - 1], lines[i + 1]);
        // a repeated page header refreshes the anchors, but an annex table
        // of a DIFFERENT shape (e.g. a wallet's interest section) must not —
        // its rows stay on the main table's columns
        if (pick && (!headerPushed || pick.cells.length === headerShape)) {
          flushData();
          anchors = pdfBoundaries(pick.cells, pick.map.narration);
          if (!headerPushed) {
            rows.push(pick.cells.map(function (c) { return c.text; }));
            headerPushed = true;
            headerShape = pick.cells.length;
          }
          if (usedTwo || pick.consumeBelow) i++; // consume the second header line
          continue;
        }
        if (!anchors) { // hero section: gap-based cells for metadata mining
          rows.push(pdfClusterCells(lines[i].items, 18).map(function (c) { return c.text; }));
          continue;
        }
        dataBuf.push(lines[i]);
      }
      flushData();
    });
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
  }

  /* ---------------- anonymized parser diagnostics ---------------- */

  function cellShape(v) {
    if (v instanceof Date) return "date";
    var raw = String(v == null ? "" : v).trim();
    if (!raw) return "empty";
    if (parseDate(raw)) return "date-like";
    if (parseAmount(raw) !== null && /\d/.test(raw)) return "amount-like";
    if (/^[A-Za-z0-9 _./:()\-#]{1,40}$/.test(raw) && /DATE|NARR|DESC|DEBIT|CREDIT|BAL|AMOUNT|REF|REMARK|WITHDRAW|DEPOSIT/i.test(raw)) return "header-like";
    if (/\d/.test(raw) && /[A-Za-z]/.test(raw)) return "mixed-text";
    if (/\d/.test(raw)) return "numeric-text";
    return raw.length > 40 ? "long-text" : "text";
  }


  function safeHeaderLabel(v) {
    var raw = String(v == null ? "" : v).trim();
    if (!raw) return "";
    var normalized = normHeader(raw);
    var role = roleForHeaderCell(normalized);
    if (role) return raw.slice(0, 80);
    return "unrecognized-" + cellShape(raw) + "-len" + raw.length;
  }

  /** Create a privacy-preserving layout diagnostic for parser debugging.
   *  It intentionally excludes names, narrations, account numbers, balances,
   *  transaction amounts, and raw row values. It keeps only structural facts:
   *  row/column counts, chosen header labels, role mapping, cell-shape samples,
   *  parse problem categories, and checksum ratios. */
  function anonymizedLayoutDiagnostic(rows, headerRow, map, built, integrity, reconcile, src) {
    rows = rows || [];
    map = map || {};
    built = built || { txns: [], problems: [] };
    src = src || {};
    var nCols = 0;
    rows.forEach(function (r) { nCols = Math.max(nCols, (r || []).length); });
    var header = rows[headerRow] || [];
    var problemCounts = {};
    (built.problems || []).forEach(function (p) { problemCounts[p.issue] = (problemCounts[p.issue] || 0) + 1; });
    var samples = [];
    for (var r = Math.max(0, headerRow + 1); r < rows.length && samples.length < 8; r++) {
      var row = rows[r] || [];
      if (!row.some(function (c) { return String(c == null ? "" : c).trim(); })) continue;
      samples.push({
        rowOffsetFromHeader: r - headerRow,
        cellShapes: row.slice(0, nCols).map(cellShape),
        nonEmptyCells: row.filter(function (c) { return String(c == null ? "" : c).trim(); }).length
      });
    }
    return {
      diagnosticVersion: 1,
      privacy: "No names, account numbers, narrations, balances, transaction amounts, or raw transaction values are included.",
      source: {
        kind: src.source || null,
        fileExtension: src.fileName && /\.([^.]+)$/.test(src.fileName) ? src.fileName.replace(/^.*\.([^.]+)$/, "$1").toLowerCase() : null,
        pageCount: src.pageCount || null,
        sheetCount: src.sheetCount || null
      },
      table: {
        totalRows: rows.length,
        columnCount: nCols,
        headerRow: headerRow,
        headerLabels: header.slice(0, nCols).map(safeHeaderLabel),
        roleMap: Object.keys(map).sort().reduce(function (o, k) { o[k] = map[k]; return o; }, {}),
        detectedColumns: detectColumns(rows)
      },
      parse: {
        transactionCount: built.txns ? built.txns.length : 0,
        excludedRowCount: built.problems ? built.problems.length : 0,
        excludedRowIssueCounts: problemCounts,
        duplicateRowsMerged: built.duplicates || 0,
        resequencedRows: built.resequenced || 0,
        balanceIntegrity: integrity ? { hasBalance: !!integrity.hasBalance, checked: integrity.checked, matched: integrity.matched, ratio: integrity.ratio } : null,
        statementChecksum: reconcile ? { allOk: !!reconcile.allOk, anyFail: !!reconcile.anyFail, checks: reconcile.checks.map(function (c) { return { label: c.label, ok: !!c.ok }; }) } : null
      },
      rowShapeSamples: samples
    };
  }

  var API = {
    parseCSVText: parseCSVText, parseDate: parseDate, parseAmount: parseAmount,
    detectColumns: detectColumns, detectColumnsAt: detectColumnsAt, buildTransactions: buildTransactions,
    extractStatementMeta: extractStatementMeta, reconcileWithMeta: reconcileWithMeta,
    integrityCheck: integrityCheck, anonymizedLayoutDiagnostic: anonymizedLayoutDiagnostic,
    readFile: readFile, ROLE_SYNONYMS: ROLE_SYNONYMS,
    pdfInternals: {
      cluster: pdfClusterCells, tryHeader: pdfTryHeader, qualifies: pdfHeaderQualifies,
      boundaries: pdfBoundaries, assign: pdfAssign, assemble: assemblePdfRows, lines: pdfLines
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_PARSER = API;

})(typeof window !== "undefined" ? window : globalThis);
