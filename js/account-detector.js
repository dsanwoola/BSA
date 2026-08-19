/* =========================================================================
 * ACCOUNT TYPE DETECTOR — infer account type from statement content
 * =========================================================================
 * Analyzes charges, fees, and headers to detect whether a statement is from
 * a Savings, Current, or Domiciliary account — even if user selected wrong type.
 */

(function () {
  "use strict";

  var ACCOUNT_DETECTOR = {
    // Current account markers (high confidence)
    currentMarkers: {
      "CAMF": 10,                    // Current Account Maintenance Fee
      "account.*maintenance.*fee": 8, // Explicit maintenance fee
      "monthly.*maintenance": 8,
      "minimum.*balance": 6,
      "standing.*order": 5,
      "cheque": 4
    },

    // Savings account markers (high confidence)
    savingsMarkers: {
      "savings.*account": 10,         // Explicit mention in header
      "interest": 8,                  // Interest earned
      "credit.*interest": 8,
      "savings.*interest": 9,
      "no.*maintenance": 5,           // Absence of maintenance fees
      "restricted.*withdrawal": 4,
      "term.*deposit": 6
    },

    // Domiciliary account markers
    domiciliaryMarkers: {
      "domiciliary": 10,              // Explicit mention
      "foreign.*currency": 8,
      "usd|gbp|eur": 7,              // Currency indicators
      "swift": 6,
      "international.*transfer": 6,
      "forex": 5
    },

    // Charge patterns by account type
    chargePatterns: {
      current: {
        "CAMF": true,
        "stamp duty": true,
        "EMTL": true,
        "minimum balance": true,
        "account maintenance": true
      },
      savings: {
        "interest": true,
        "savings account": true
      },
      domiciliary: {
        "SWIFT": true,
        "international transfer": true,
        "forex": true,
        "USD": true,
        "GBP": true
      }
    },

    /**
     * Detect account type from statement text and rows
     * @param {Array} rows - parsed rows from statement
     * @param {String} text - raw statement text
     * @param {String} userSelected - user's selected account type
     * @return {Object} {type, confidence, reasons, mismatch}
     */
    detect: function (rows, text, userSelected) {
      var scores = { current: 0, savings: 0, domiciliary: 0 };
      var reasons = { current: [], savings: [], domiciliary: [] };

      // Normalize text for searching
      var normalizedText = (text || "").toLowerCase();
      var allRowsText = "";
      if (rows && rows.length > 0) {
        allRowsText = rows.slice(0, 50).join(" ").toLowerCase(); // First 50 rows
      }

      // Score based on headers and explicit mentions
      this._scoreByHeaders(normalizedText, scores, reasons);

      // Score based on charges present in rows
      this._scoreByCharges(allRowsText, scores, reasons);

      // Score based on balance patterns
      this._scoreByBalancePatterns(rows, scores, reasons);

      // Determine detected type
      var detected = "current"; // default fallback
      var maxScore = 0;
      for (var type in scores) {
        if (scores[type] > maxScore) {
          maxScore = scores[type];
          detected = type;
        }
      }

      // Calculate confidence (0-100%)
      var confidence = Math.min(100, Math.round((maxScore / 20) * 100));

      // Check for mismatch with user selection
      var mismatch = userSelected && userSelected !== detected ? detected : null;

      return {
        type: detected,
        confidence: confidence,
        scores: scores,
        reasons: reasons,
        mismatch: mismatch,
        userSelected: userSelected,
        shouldWarn: mismatch && confidence > 60  // Warn if high confidence mismatch
      };
    },

    _scoreByHeaders: function (text, scores, reasons) {
      for (var type in this[type + "Markers"]) {
        var markers = this[type + "Markers"];
        for (var marker in markers) {
          var weight = markers[marker];
          var regex = new RegExp(marker, "i");
          if (regex.test(text)) {
            scores[type] = (scores[type] || 0) + weight;
            reasons[type].push("Found: " + marker);
          }
        }
      }
    },

    _scoreByCharges: function (text, scores, reasons) {
      for (var type in this.chargePatterns) {
        var patterns = this.chargePatterns[type];
        for (var charge in patterns) {
          var regex = new RegExp(charge, "i");
          if (regex.test(text)) {
            scores[type] = (scores[type] || 0) + 5;
            reasons[type].push("Charge: " + charge);
          }
        }
      }
    },

    _scoreByBalancePatterns: function (rows, scores, reasons) {
      if (!rows || rows.length < 5) return;

      // Analyze first 10 rows for patterns
      var sampleRows = rows.slice(0, 10);
      var hasNegativeBalance = false;
      var hasMaintenanceFee = false;
      var hasInterest = false;

      sampleRows.forEach(function (row) {
        if (!row) return;
        var rowText = String(row).toLowerCase();

        if (/interest|credit.*interest/.test(rowText)) {
          hasInterest = true;
        }
        if (/maintenance|camf/.test(rowText)) {
          hasMaintenanceFee = true;
        }
      });

      // Score based on patterns
      if (hasMaintenanceFee) {
        scores.current = (scores.current || 0) + 8;
        reasons.current.push("Maintenance fees detected");
      }

      if (hasInterest) {
        scores.savings = (scores.savings || 0) + 8;
        reasons.savings.push("Interest income detected");
      }

      // Savings accounts rarely have maintenance fees
      if (!hasMaintenanceFee && hasInterest) {
        scores.savings = (scores.savings || 0) + 5;
        reasons.savings.push("No maintenance fees (typical for savings)");
      }
    },

    /**
     * Get human-readable confidence message
     */
    getConfidenceMessage: function (detection) {
      if (detection.confidence >= 80) {
        return "Very confident this is a " + detection.type.toUpperCase() + " account";
      } else if (detection.confidence >= 60) {
        return "Likely a " + detection.type.toUpperCase() + " account";
      } else if (detection.confidence >= 40) {
        return "Possibly a " + detection.type.toUpperCase() + " account";
      } else {
        return "Unable to determine account type with confidence";
      }
    },

    /**
     * Get warning message if there's a mismatch
     */
    getMismatchWarning: function (detection) {
      if (!detection.shouldWarn) return null;

      return "⚠️ Account type mismatch detected!\n\n" +
        "You selected: " + (detection.userSelected || "unknown").toUpperCase() + "\n" +
        "Statement appears to be: " + detection.detected.toUpperCase() + "\n" +
        "Confidence: " + detection.confidence + "%\n\n" +
        "This affects which charges are flagged as violations.\n" +
        "Should we correct this to " + detection.detected.toUpperCase() + "?";
    }
  };

  window.CBN_ACCOUNT_DETECTOR = ACCOUNT_DETECTOR;
})();
