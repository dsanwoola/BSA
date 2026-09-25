/* =========================================================================
 * PAID REPORTS — local, privacy-preserving copies of unlocked audit findings.
 * The original statement and full transaction ledger are never stored here.
 * A saved copy is keyed to the same fingerprint and receipt as its payment.
 * ========================================================================= */
(function (global) {
  "use strict";

  var STORE_KEY = "checkam-paid-reports-v1";
  var MAX_REPORTS = 8;

  function storage() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  function readAll() {
    var s = storage();
    if (!s) return [];
    try {
      var value = JSON.parse(s.getItem(STORE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (e) { return []; }
  }

  function writeAll(items) {
    var s = storage();
    if (!s) return false;
    try {
      s.setItem(STORE_KEY, JSON.stringify(items));
      return Array.isArray(JSON.parse(s.getItem(STORE_KEY) || ""));
    } catch (e) { return false; }
  }

  function serialiseAudit(audit) {
    try {
      return JSON.parse(JSON.stringify(audit, function (key, value) {
        // Some VAT findings retain a link to another transaction. The report
        // does not render that link and omitting it prevents duplicate data.
        return key === "vatParent" ? undefined : value;
      }));
    } catch (e) { return null; }
  }

  function safeContext(ctx) {
    ctx = ctx || {};
    return {
      accountType: ctx.accountType || "current",
      holderType: ctx.holderType || "individual",
      salaryAccount: !!ctx.salaryAccount,
      bankId: ctx.bankId || "other"
    };
  }

  function save(fingerprint, audit, ctx, source) {
    if (!/^[a-f0-9]{64}$/i.test(String(fingerprint || "")) || !audit || !audit.summary) return false;
    var copy = serialiseAudit(audit);
    if (!copy) return false;
    source = source || {};
    var entry = {
      schema: 1,
      fingerprint: fingerprint,
      savedAt: Date.now(),
      audit: copy,
      ctx: safeContext(ctx),
      source: {
        fileName: source.fileName || "",
        pageCount: Number(source.pageCount) || 0,
        sheetCount: Number(source.sheetCount) || 0
      }
    };
    var items = readAll().filter(function (item) { return item && item.fingerprint !== fingerprint; });
    items.unshift(entry);
    return writeAll(items.slice(0, MAX_REPORTS));
  }

  function reviveDates(value, key) {
    if (Array.isArray(value)) return value.map(function (item) { return reviveDates(item, ""); });
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (childKey) { value[childKey] = reviveDates(value[childKey], childKey); });
      return value;
    }
    if (typeof value === "string" && ["date", "from", "to", "statementFrom", "statementTo"].indexOf(key) !== -1) {
      var date = new Date(value);
      return isNaN(date) ? value : date;
    }
    return value;
  }

  function load(fingerprint) {
    var entry = readAll().find(function (item) { return item && item.fingerprint === fingerprint; });
    if (!entry || entry.schema !== 1 || !entry.audit || !entry.audit.summary) return null;
    // Clone before reviving so callers cannot mutate the stored object.
    return reviveDates(JSON.parse(JSON.stringify(entry)), "");
  }

  function list() {
    return readAll().filter(function (entry) {
      return entry && entry.schema === 1 && entry.audit && entry.audit.summary && entry.fingerprint;
    }).map(function (entry) {
      var s = entry.audit.summary || {}, p = s.period || {}, bank = entry.audit.bankProfile || {};
      return {
        fingerprint: entry.fingerprint,
        savedAt: entry.savedAt || 0,
        bankName: bank.name || "Bank statement",
        periodFrom: p.from || null,
        periodTo: p.to || null,
        refundDue: Number(s.refundDue) || 0,
        underReview: Number(s.underReview) || 0
      };
    }).sort(function (a, b) { return b.savedAt - a.savedAt; });
  }

  function remove(fingerprint) {
    return writeAll(readAll().filter(function (item) { return item && item.fingerprint !== fingerprint; }));
  }

  var API = { save: save, load: load, list: list, remove: remove, storeKey: STORE_KEY, maxReports: MAX_REPORTS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_PAID_REPORTS = API;
})(typeof window !== "undefined" ? window : globalThis);
