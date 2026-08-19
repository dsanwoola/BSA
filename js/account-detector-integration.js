/* =========================================================================
 * ACCOUNT DETECTOR INTEGRATION — wire the detector into the app flow
 * =========================================================================
 * Call this in the mapping step after parsing to auto-detect and warn
 * about account type mismatches.
 */

(function () {
  "use strict";

  window.BSA_ACCOUNT_INTEGRATION = {
    /**
     * Check for account type mismatch after parsing
     * Call this after rows are built, before showing mapping step
     * @param {Array} rows - parsed rows
     * @param {Object} state - app state with ctx.accountType
     * @return {Promise} resolves with updated state
     */
    checkAndCorrect: function (rows, state) {
      return new Promise(function (resolve) {
        var detector = window.CBN_ACCOUNT_DETECTOR;
        var analytics = window.BSA_ANALYTICS;
        if (!detector || !rows || rows.length === 0) {
          resolve(state);
          return;
        }

        // Prepare text from rows for analysis
        var allText = rows.slice(0, 50).join(" ");
        var detection = detector.detect(rows, allText, state.ctx.accountType);

        // Track detection in analytics
        if (analytics && analytics.track) {
          analytics.track("account_type_detected", {
            userSelected: state.ctx.accountType,
            detected: detection.type,
            confidence: detection.confidence,
            mismatch: detection.mismatch ? "yes" : "no"
          });
        }

        // If high-confidence mismatch, show modal
        if (detection.shouldWarn) {
          showAccountCorrectionModal(detection, state, resolve);
        } else {
          resolve(state);
        }
      });
    },

    /**
     * Show account type correction modal
     */
    showModal: function (detection, state, onResolve) {
      showAccountCorrectionModal(detection, state, onResolve);
    }
  };

  function showAccountCorrectionModal(detection, state, onResolve) {
    var modal = document.getElementById("acct-correction-modal");
    var msgEl = document.getElementById("acct-correction-msg");
    var keepBtn = document.getElementById("btn-acct-keep");
    var correctBtn = document.getElementById("btn-acct-correct");

    if (!modal || !msgEl) {
      onResolve(state);
      return;
    }

    // Populate message
    var userType = (state.ctx.accountType || "unknown").toUpperCase();
    var detectedType = (detection.type || "unknown").toUpperCase();
    msgEl.innerHTML = "You selected: <strong>" + userType + "</strong><br>" +
      "Statement analysis suggests: <strong>" + detectedType + "</strong><br>" +
      "Confidence: <strong>" + detection.confidence + "%</strong>";

    // Keep selection handler
    keepBtn.onclick = function () {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      onResolve(state);
    };

    // Correct to detected type handler
    correctBtn.onclick = function () {
      state.ctx.accountType = detection.type;
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");

      // Show toast notification
      showNotification("✓ Account type updated to " + detection.type.toUpperCase());

      // Track correction in analytics
      var analytics = window.BSA_ANALYTICS;
      if (analytics && analytics.track) {
        analytics.track("account_type_corrected", {
          from: state.ctx.accountType,
          to: detection.type
        });
      }

      onResolve(state);
    };

    // Show modal
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function showNotification(message) {
    // Simple toast notification
    var toast = document.createElement("div");
    toast.style.cssText = "position:fixed;bottom:20px;right:20px;" +
      "background:var(--accent);color:#0b1210;padding:12px 20px;" +
      "border-radius:6px;font-weight:600;z-index:1000;" +
      "animation:slideIn 0.3s ease;box-shadow:0 4px 12px rgba(0,0,0,0.3)";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.remove();
    }, 3000);
  }
})();
