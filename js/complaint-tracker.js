/* Checkam complaint journey. Stores only the user's follow-up record in this browser. */
(function (root) {
  "use strict";

  var STORE_KEY = "checkam-complaint-journeys-v1";
  var MAX_JOURNEYS = 8;
  var DAY_MS = 86400000;

  function storage() {
    try { return root.localStorage; } catch (e) { return null; }
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
      return true;
    } catch (e) { return false; }
  }

  function validFingerprint(value) {
    return /^[a-f0-9]{64}$/i.test(String(value || ""));
  }

  function cleanText(value, max) {
    return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
  }

  function validDate(value) {
    value = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    var parts = value.split("-").map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return d.getUTCFullYear() === parts[0] && d.getUTCMonth() === parts[1] - 1 && d.getUTCDate() === parts[2] ? value : "";
  }

  function dateMs(value) {
    var safe = validDate(value);
    if (!safe) return NaN;
    var p = safe.split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }

  function isoDate(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function todayIso(now) {
    var d = now ? new Date(now) : new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  }

  function deadlineFor(complaintDate) {
    var ms = dateMs(complaintDate);
    return isNaN(ms) ? "" : isoDate(ms + 14 * DAY_MS);
  }

  function normaliseResponse(value) {
    value = value || {};
    var allowed = ["resolved", "partly_resolved", "not_resolved"];
    return {
      date: validDate(value.date),
      status: allowed.indexOf(value.status) >= 0 ? value.status : "",
      reference: cleanText(value.reference, 120),
      notes: cleanText(value.notes, 3000)
    };
  }

  function normalise(fingerprint, value) {
    value = value || {};
    return {
      schema: 1,
      fingerprint: fingerprint,
      bankName: cleanText(value.bankName, 160) || "Bank",
      refundDue: Math.max(0, Number(value.refundDue) || 0),
      letterGeneratedAt: cleanText(value.letterGeneratedAt, 40),
      complaintDate: validDate(value.complaintDate),
      submittedAt: cleanText(value.submittedAt, 40),
      reminderDownloadedAt: cleanText(value.reminderDownloadedAt, 40),
      escalationGeneratedAt: cleanText(value.escalationGeneratedAt, 40),
      response: normaliseResponse(value.response),
      updatedAt: Number(value.updatedAt) || Date.now()
    };
  }

  function load(fingerprint) {
    if (!validFingerprint(fingerprint)) return null;
    var found = readAll().find(function (item) { return item && item.fingerprint === fingerprint; });
    return found && found.schema === 1 ? normalise(fingerprint, found) : null;
  }

  function save(fingerprint, patch) {
    if (!validFingerprint(fingerprint)) return false;
    var current = load(fingerprint) || normalise(fingerprint, {});
    patch = patch || {};
    var merged = Object.assign({}, current, patch, { fingerprint: fingerprint, updatedAt: Date.now() });
    if (patch.response) merged.response = Object.assign({}, current.response, patch.response);
    var entry = normalise(fingerprint, merged);
    var items = readAll().filter(function (item) { return item && item.fingerprint !== fingerprint; });
    items.unshift(entry);
    return writeAll(items.slice(0, MAX_JOURNEYS));
  }

  function list() {
    return readAll().filter(function (item) { return item && item.schema === 1 && validFingerprint(item.fingerprint); })
      .map(function (item) { return normalise(item.fingerprint, item); })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function journeyStatus(journey, today) {
    journey = journey || {};
    var deadline = deadlineFor(journey.complaintDate);
    var todayMs = dateMs(today || todayIso());
    var deadlineMs = dateMs(deadline);
    var response = journey.response || {};
    var resolved = response.status === "resolved";
    var due = !!deadline && !resolved && todayMs >= deadlineMs;
    var daysRemaining = deadline ? Math.max(0, Math.ceil((deadlineMs - todayMs) / DAY_MS)) : null;
    var completed = 0;
    if (journey.letterGeneratedAt) completed++;
    if (journey.complaintDate) completed += 3;
    if (journey.escalationGeneratedAt || resolved) completed++;
    if (response.status || response.date || response.reference || response.notes) completed++;
    return { deadline: deadline, due: due, resolved: resolved, daysRemaining: daysRemaining, completed: Math.min(6, completed) };
  }

  function dueItems(today) {
    return list().filter(function (item) { return journeyStatus(item, today).due; });
  }

  function formatDate(value) {
    var ms = dateMs(value);
    return isNaN(ms) ? "[date]" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }

  function formatAuditDate(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return "[date]";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function escalationLetter(audit, ctx, journey) {
    if (!audit || !audit.summary || !journey || !journey.complaintDate) return null;
    var s = audit.summary;
    var bank = journey.bankName || (audit.bankProfile && audit.bankProfile.name) || "[Bank name]";
    if (/other|not sure/i.test(bank)) bank = "[Bank name]";
    var money = "NGN " + (Number(s.refundDue) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var lines = [
      "[Your full name]", "[Your address]", "[Phone number]", "[Email address]", "", formatDate(todayIso()), "",
      "The Director", "Consumer Protection Department", "Central Bank of Nigeria", "Central Business District, Abuja", "Email: cpd@cbn.gov.ng", "",
      "Dear Sir/Madam,", "",
      "COMPLAINT AGAINST " + bank.toUpperCase() + ": UNRESOLVED EXCESS BANK CHARGES", "",
      "I ask the Consumer Protection Department to review an unresolved complaint against " + bank + ". I first lodged the complaint with the bank on " + formatDate(journey.complaintDate) + ". The bank has not resolved it within two weeks.", "",
      "The complaint concerns charges found in my " + ((ctx && ctx.accountType) || "bank") + " account statement. The audit period was " + formatAuditDate(s.period && s.period.from) + " to " + formatAuditDate(s.period && s.period.to) + ". The amount claimed is " + money + ".", "",
      "I have attached the complaint sent to the bank, evidence that it was submitted, the bank's response if any, the statement of account, and the audit schedule of charges.", "",
      "Please investigate the complaint and direct the bank to resolve any excess or unauthorised charges supported by the attached evidence.", "",
      "Yours faithfully,", "", "[Your full name]", "[Account number]", "",
      "Attachments:",
      "1. Complaint submitted to the bank and proof of submission", "2. Bank response, if any", "3. Statement of account", "4. Audit schedule of charges"
    ];
    return lines.join("\n");
  }

  function calendarEvent(journey) {
    var deadline = deadlineFor(journey && journey.complaintDate);
    if (!deadline) return null;
    var compact = deadline.replace(/-/g, "");
    var end = isoDate(dateMs(deadline) + DAY_MS).replace(/-/g, "");
    var bank = cleanText(journey.bankName, 120).replace(/[;,\\]/g, " ");
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Checkam//Complaint Journey//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", "UID:checkam-" + journey.fingerprint + "@checkam.ng", "DTSTART;VALUE=DATE:" + compact,
      "DTEND;VALUE=DATE:" + end, "SUMMARY:Check bank complaint status", "DESCRIPTION:Two weeks have passed since your complaint to " + bank + ". If it remains unresolved, you may escalate it to the CBN Consumer Protection Department.",
      "END:VEVENT", "END:VCALENDAR", ""
    ].join("\r\n");
  }

  var API = {
    save: save, load: load, list: list, dueItems: dueItems, status: journeyStatus,
    deadlineFor: deadlineFor, todayIso: todayIso, formatDate: formatDate,
    escalationLetter: escalationLetter, calendarEvent: calendarEvent,
    storeKey: STORE_KEY, maxJourneys: MAX_JOURNEYS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.CHECKAM_COMPLAINTS = API;
})(typeof window !== "undefined" ? window : globalThis);
