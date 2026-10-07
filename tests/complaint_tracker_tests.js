"use strict";
var fs = require("fs"), path = require("path");

module.exports = function (check) {
  var previousStorage = global.localStorage;
  var data = {};
  global.localStorage = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, value) { data[key] = String(value); }
  };
  delete require.cache[require.resolve("../js/complaint-tracker.js")];
  var tracker = require("../js/complaint-tracker.js");
  var fp = "b".repeat(64);

  check("complaint tracker: rejects an invalid report fingerprint", tracker.save("bad", {}) === false);
  check("complaint tracker: two-week deadline crosses month boundaries", tracker.deadlineFor("2026-01-25") === "2026-02-08");
  check("complaint tracker: leap-day arithmetic is date-only and stable", tracker.deadlineFor("2028-02-20") === "2028-03-05");

  check("complaint tracker: saves a bank submission locally", tracker.save(fp, {
    bankName: "Example Bank", refundDue: 1250, complaintDate: "2026-09-01",
    letterGeneratedAt: "2026-09-01T08:00:00.000Z"
  }));
  var saved = tracker.load(fp);
  check("complaint tracker: preserves the report link and complaint date", saved.fingerprint === fp && saved.complaintDate === "2026-09-01" && saved.bankName === "Example Bank");
  check("complaint tracker: reports remaining time before the deadline", tracker.status(saved, "2026-09-10").daysRemaining === 5 && !tracker.status(saved, "2026-09-10").due);
  check("complaint tracker: marks the journey due on day fourteen", tracker.status(saved, "2026-09-15").due && tracker.status(saved, "2026-09-15").deadline === "2026-09-15");
  check("complaint tracker: overdue journeys appear in return reminders", tracker.dueItems("2026-09-20").length === 1);

  var calendar = tracker.calendarEvent(saved);
  check("complaint tracker: calendar reminder uses an all-day two-week date", calendar.includes("DTSTART;VALUE=DATE:20260915") && calendar.includes("SUMMARY:Check bank complaint status"));

  var audit = {
    summary: { refundDue: 1250, period: { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-06-30T00:00:00Z") } },
    bankProfile: { name: "Example Bank" }
  };
  var letter = tracker.escalationLetter(audit, { accountType: "current" }, saved);
  check("complaint tracker: CBN letter includes the bank, amount and first complaint date", letter.includes("EXAMPLE BANK") && letter.includes("NGN 1,250.00") && letter.includes("1 September 2026"));
  check("complaint tracker: CBN letter preserves the displayed audit period", letter.includes("1 January 2026 to 30 June 2026"));
  check("complaint tracker: CBN letter addresses the Consumer Protection Department", letter.includes("The Director\nConsumer Protection Department\nCentral Bank of Nigeria") && letter.includes("cpd@cbn.gov.ng") && letter.includes("proof of submission"));

  tracker.save(fp, { response: { status: "resolved", date: "2026-09-18", reference: " REF-123 ", notes: "Refund received" } });
  saved = tracker.load(fp);
  check("complaint tracker: stores a bounded response summary", saved.response.status === "resolved" && saved.response.reference === "REF-123" && saved.response.notes === "Refund received");
  check("complaint tracker: a resolved response clears the overdue reminder", tracker.dueItems("2026-09-20").length === 0 && tracker.status(saved, "2026-09-20").resolved);

  var html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  var app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../css/app.css"), "utf8");
  check("complaint tracker: paid report contains the six-step journey host", html.includes('id="complaint-tracker"') && app.includes("Generate CBN escalation letter") && app.includes("Save bank response"));
  check("complaint tracker: returning users get a due reminder path", html.includes('id="complaint-reminder"') && app.includes("refreshComplaintReminder") && app.includes("data-complaint-report"));
  check("complaint tracker: official CBN guidance is linked", app.includes("https://www.cbn.gov.ng/supervision/cpdcomgt.html"));
  check("complaint tracker: mobile actions meet the touch target rule", css.includes(".journey-body .btn { width: 100%; min-height: 48px"));
  check("complaint tracker: loads before the app controller", html.indexOf("js/complaint-tracker.js") < html.indexOf("js/app.js"));

  global.localStorage = previousStorage;
};
