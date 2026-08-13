/* =========================================================================
 * ENHANCED ANALYTICS — comprehensive tracking for Bank Charge Auditor
 * =========================================================================
 * Tracks: bank detection, charge types, performance metrics, user journey,
 * parse/audit outcomes, file properties, and balance integrity.
 */

(function () {
  "use strict";

  const ANALYTICS_ENDPOINT = "/api/analytics";
  const BATCH_SIZE = 20;
  const FLUSH_INTERVAL = 30000; // 30 seconds

  var eventQueue = [];
  var flushTimer = null;

  // Bank detection patterns
  var BANK_PATTERNS = {
    "fidelity": /fidelity|fbn/i,
    "gtbank": /gtbank|gt bank|gtw/i,
    "access": /access\s*bank|accessbank/i,
    "zenith": /zenith\s*bank/i,
    "uba": /uba\s*bank|united bank|ubagroup/i,
    "first_bank": /first\s*bank|fb\s*ng/i,
    "stanbic": /stanbic\s*ibtc|stanbic/i,
    "fcmb": /fcmb|first\s*city/i,
    "kuda": /kuda\s*bank|kuda/i,
    "opay": /opay|o-pay/i,
    "moniepoint": /moniepoint|monie\s*point/i,
    "palmpay": /palmpay|palm\s*pay/i
  };

  // Charge type patterns
  var CHARGE_PATTERNS = {
    "atm_fee": /atm|automated\s*teller/i,
    "nip_fee": /nip|transfer\s*charge/i,
    "ussd_fee": /ussd/i,
    "stamp_duty": /stamp\s*duty|emtl/i,
    "maintenance_fee": /maintenance|camf|account.*maintenance/i,
    "sms_alert": /sms|alert|notification/i,
    "card_fee": /card|maintenance.*card/i,
    "processing": /processing|processing\s*charge/i,
    "cot": /cot|commission|overnight/i,
    "levy": /levy|electronic.*levy/i,
    "vat": /vat|value\s*added\s*tax/i
  };

  function detectBank(text) {
    if (!text) return "unknown";
    for (var bank in BANK_PATTERNS) {
      if (BANK_PATTERNS[bank].test(text)) return bank;
    }
    return "other";
  }

  function detectChargeTypes(findings) {
    var types = new Set();
    if (!findings || !findings.length) return [];

    findings.forEach(function (f) {
      if (f.narration) {
        for (var type in CHARGE_PATTERNS) {
          if (CHARGE_PATTERNS[type].test(f.narration)) {
            types.add(type);
          }
        }
      }
    });

    return Array.from(types).slice(0, 10); // Top 10 types
  }

  function track(eventName, meta) {
    meta = meta || {};

    eventQueue.push({
      name: eventName,
      timestamp: new Date().toISOString(),
      meta: meta
    });

    if (eventQueue.length >= BATCH_SIZE) {
      flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(flush, FLUSH_INTERVAL);
    }
  }

  function flush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;

    if (!eventQueue.length) return;

    var batch = eventQueue.splice(0, eventQueue.length);
    var payload = { events: batch };

    // Send analytics (non-blocking, no error handling)
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ANALYTICS_ENDPOINT, JSON.stringify(payload));
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", ANALYTICS_ENDPOINT, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify(payload));
      }
    } catch (e) {
      // Silently fail — analytics should never break the app
    }
  }

  function trackFileMetrics(file, rows, meta) {
    track("file_read_success", {
      fileType: file.name.split(".").pop().toLowerCase(),
      fileSizeKB: Math.round(file.size / 1024),
      rowCount: rows ? rows.length : 0,
      bankName: detectBank(file.name + " " + (rows && rows.length > 0 ? rows[0].join(" ") : ""))
    });
  }

  function trackParseMetrics(txns, meta, startTime) {
    track("parse_completed", {
      txnCount: txns ? txns.length : 0,
      parseTimeMs: new Date().getTime() - startTime,
      bankName: meta && meta.bankName ? meta.bankName : "unknown"
    });
  }

  function trackAuditMetrics(audit, startTime) {
    var chargeTypes = audit && audit.summary ? detectChargeTypes(audit.summary.allCharges) : [];

    track("audit_completed", {
      txnCount: audit && audit.rows ? audit.rows.length : 0,
      auditTimeMs: new Date().getTime() - startTime,
      violationCount: audit && audit.summary ? audit.summary.violations.length : 0,
      refundDue: audit && audit.summary ? audit.summary.refundDue : 0,
      underReview: audit && audit.summary ? audit.summary.underReview : 0,
      chargeTypes: chargeTypes.join(","),
      balanceIntegrityPercent: audit && audit.integrity ? (audit.integrity.ratio * 100) : 0
    });
  }

  function trackUserJourneyDrop(step, reason) {
    track("user_journey_drop", {
      step: step,
      reason: reason
    });
  }

  // Export analytics API
  window.BSA_ANALYTICS = {
    track: track,
    trackFileMetrics: trackFileMetrics,
    trackParseMetrics: trackParseMetrics,
    trackAuditMetrics: trackAuditMetrics,
    trackUserJourneyDrop: trackUserJourneyDrop,
    detectBank: detectBank,
    detectChargeTypes: detectChargeTypes,
    flush: flush,
    fileType: function (fileName) {
      return fileName ? fileName.split(".").pop().toLowerCase() : "unknown";
    }
  };

  // Flush on page unload
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flush);
  }
})();
