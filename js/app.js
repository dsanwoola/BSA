/* =========================================================================
 * APP CONTROLLER — wires the four steps together:
 *   1. account context  →  2. upload  →  3. confirm mapping  →  4. results
 * ========================================================================= */

(function () {
  "use strict";

  var APP_BUILD = 93; // shown in the header so stale cached code is obvious
  window.BSA_BUILD = APP_BUILD;
  var ANALYTICS = window.BSA_ANALYTICS || { track: function () {}, flush: function () {}, fileType: function () { return "unknown"; } };

  var PARSER = window.CBN_PARSER, ENGINE = window.CBN_ENGINE,
      REPORT = window.CBN_REPORT, RULES = window.CBN_RULES, BANKS = window.CBN_BANK_PROFILES,
      PAYWALL = window.CBN_PAYWALL, PAID_REPORTS = window.CBN_PAID_REPORTS,
      COMPLAINTS = window.CHECKAM_COMPLAINTS;

  var state = {
    ctx: { accountType: "current", holderType: "individual", salaryAccount: false, bankId: "other", overrides: {} },
    rows: null, source: null, fileName: null,
    txns: null, problems: null, integrity: null, differences: null,
    audit: null, filter: "all",
    fingerprint: null, restoredReport: false,
    letterFileName: "refund_demand_letter.docx", letterReturnId: "btn-letter",
    currentStep: "step-context"
  };

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /* ---------------- scanning overlay ---------------- */
  var scan = {
    show: function (title, sub) {
      var ov = $("#scan-overlay");
      $("#scan-title").textContent = title || "Working";
      this.sub(sub || "");
      var fill = $("#scan-bar-fill");
      fill.classList.add("indeterminate");
      fill.style.width = "";
      ov.classList.add("open");
      ov.setAttribute("aria-hidden", "false");
    },
    sub: function (text) {
      var el = $("#scan-sub");
      if (!el) return;
      el.innerHTML = REPORT.esc(text) + '<span class="scan-dots"><i>.</i><i>.</i><i>.</i></span>';
    },
    progress: function (done, total) {
      var fill = $("#scan-bar-fill");
      if (!total) { fill.classList.add("indeterminate"); return; }
      fill.classList.remove("indeterminate");
      fill.style.width = Math.round((done / total) * 100) + "%";
    },
    hide: function () {
      var ov = $("#scan-overlay");
      ov.classList.remove("open");
      ov.setAttribute("aria-hidden", "true");
    }
  };
  // let the browser paint before continuing a heavy synchronous step
  function nextFrame() {
    return new Promise(function (res) { requestAnimationFrame(function () { setTimeout(res, 0); }); });
  }

  /* ---------------- demo statement (current account, May 2025) ----------
   * Includes a realistic "hero" summary section above the table, like real
   * Nigerian bank statements — the parser mines it and uses it as a
   * checksum for the transaction rows. */
  var DEMO_CSV = [
    "FIRST DEMO BANK PLC,,,,",
    "STATEMENT OF ACCOUNT,,,,",
    "Account Name:,CHIOMA OBI,,,",
    "Account No:,0123456789,Account Type:,CURRENT ACCOUNT,",
    "Statement Period:,01/05/2025 - 31/05/2025,,,",
    'Opening Balance:,0.00,Closing Balance:,"62,263.24",',
    'Total Debit:,"202,736.76",Total Credit:,"265,000.00",',
    ",,,,",
    "Trans Date,Narration,Debit,Credit,Balance",
    '01/05/2025,"NIP/TRF FROM ACME PROJECTS LTD/INV 0142",,"250,000.00","250,000.00"',
    '02/05/2025,"POS PURCHASE SHOPRITE LEKKI","35,000.00",,"215,000.00"',
    '03/05/2025,"NIP/TRF TO MAMA ADE FOODS","3,000.00",,"212,000.00"',
    '03/05/2025,"NIP TRANSFER CHARGE",26.88,,"211,973.12"',
    '03/05/2025,"STAMP DUTY",50.00,,"211,923.12"',
    '05/05/2025,"ATM WD ZENITH BANK ALLEN AVE","20,000.00",,"191,923.12"',
    '05/05/2025,"ATM WD FEE",107.50,,"191,815.62"',
    '08/05/2025,"AIRTIME PURCHASE MTN VIA USSD","1,000.00",,"190,815.62"',
    '10/05/2025,"NIP/TRF TO KUNLE PROPERTIES","50,000.00",,"140,815.62"',
    '10/05/2025,"NIP TRANSFER CHARGE",25.00,,"140,790.62"',
    '10/05/2025,"VAT ON NIP TRANSFER CHARGE",1.88,,"140,788.74"',
    '10/05/2025,"STAMP DUTY",50.00,,"140,738.74"',
    '12/05/2025,"NIP/TRF FROM TUNDE OKAFOR","","15,000.00","155,738.74"',
    '12/05/2025,"STAMP DUTY",50.00,,"155,688.74"',
    '15/05/2025,"POS PURCHASE TOTAL FILLING STATION AJAH","22,000.00",,"133,688.74"',
    '18/05/2025,"CARD MAINT FEE MAY",53.75,,"133,634.99"',
    '20/05/2025,"COT CHARGE APRIL","1,200.00",,"132,434.99"',
    '22/05/2025,"WEB PURCHASE NETFLIX.COM","7,000.00",,"125,434.99"',
    '25/05/2025,"ACCT SERVICES PROCESSING CHARGE","2,500.00",,"122,934.99"',
    '28/05/2025,"NIP/TRF TO BLESSING STORES","60,000.00",,"62,934.99"',
    '28/05/2025,"NIP TRANSFER CHARGE",53.75,,"62,881.24"',
    '31/05/2025,"SMS ALERT CHARGES 01MAY-31MAY",168.00,,"62,713.24"',
    '31/05/2025,"ACCOUNT MAINTENANCE FEE MAY",450.00,,"62,263.24"'
  ].join("\n");

  /* ---------------- step navigation ---------------- */
  var PREV_STEP = {
    "step-upload": "step-context",
    "step-mapping": "step-upload",
    "step-results": "step-mapping"
  };
  var STEP_INFO = {
    "step-context": { index: 1, name: "Your account" },
    "step-upload": { index: 2, name: "Statement" },
    "step-mapping": { index: 3, name: "Verify the read" },
    "step-results": { index: 4, name: "Audit report" }
  };

  function gotoStep(id) {
    state.currentStep = id;
    document.body.classList.toggle("landing-mode", id === "step-context" && !document.body.classList.contains("workflow-open"));
    ANALYTICS.track("step_view", { step: id });
    $all(".step-section").forEach(function (s) { s.classList.toggle("active", s.id === id); });
    $all(".step-dot").forEach(function (d) {
      var current = d.getAttribute("data-step") === id;
      d.classList.toggle("on", current);
      if (current) d.setAttribute("aria-current", "step");
      else d.removeAttribute("aria-current");
    });
    var info = STEP_INFO[id] || STEP_INFO["step-context"];
    var count = $("#mobile-step-count"), name = $("#mobile-step-name"), fill = $("#mobile-step-fill");
    if (count) count.textContent = "Step " + info.index + " of 4";
    if (name) name.textContent = info.name;
    if (fill) fill.style.width = (info.index * 25) + "%";
    updateGlobalBackButton(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    if (state.currentStep === "step-results" && state.restoredReport) {
      state.restoredReport = false;
      gotoStep("step-context");
      return;
    }
    gotoStep(PREV_STEP[state.currentStep] || "step-context");
  }

  function updateGlobalBackButton(id) {
    var btn = $("#btn-global-back");
    if (!btn) return;
    var canGoBack = !!PREV_STEP[id];
    btn.hidden = !canGoBack;
    btn.setAttribute("aria-hidden", canGoBack ? "false" : "true");
  }

  function wireNavigation() {
    var btn = $("#btn-global-back");
    if (btn) btn.addEventListener("click", goBack);
  }

  /* ---------------- theme toggle ---------------- */
  function getTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function setTheme(theme) {
    theme = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("bsa-theme", theme); } catch (e) { /* private mode */ }
    updateThemeToggle(theme);
  }

  function updateThemeToggle(theme) {
    var btn = $("#theme-toggle");
    if (!btn) return;
    var isLight = theme === "light";
    btn.setAttribute("aria-pressed", isLight ? "true" : "false");
    btn.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
    btn.setAttribute("title", isLight ? "Switch to dark mode" : "Switch to light mode");
    var label = btn.querySelector(".theme-label");
    if (label) label.textContent = isLight ? "Light" : "Dark";
  }

  function wireTheme() {
    updateThemeToggle(getTheme());
    var btn = $("#theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = getTheme() === "light" ? "dark" : "light";
      setTheme(next);
      ANALYTICS.track("theme_toggle", { theme: next });
    });
  }

  /* ---------------- installable web app ---------------- */
  var deferredInstallPrompt = null;

  function wirePwa() {
    var installButton = $("#btn-install-app");
    var installHelp = $("#pwa-install-help");
    var standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    var iosStandalone = typeof navigator.standalone === "boolean" && navigator.standalone;
    var iosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" }).then(function (registration) {
        registration.update().catch(function () { /* the installed worker remains usable */ });
      }).catch(function (error) {
        console.warn("Checkam offline setup could not start:", error);
      });
    }

    if (!installButton || standalone || iosStandalone) return;

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredInstallPrompt = event;
      installButton.hidden = false;
    });

    if (iosDevice) installButton.hidden = false;

    installButton.addEventListener("click", function () {
      if (!deferredInstallPrompt) {
        installHelp.textContent = "Open your browser's Share menu, then choose Add to Home Screen.";
        installHelp.hidden = false;
        return;
      }
      var promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      installButton.disabled = true;
      promptEvent.prompt();
      promptEvent.userChoice.then(function (choice) {
        installButton.disabled = false;
        if (choice && choice.outcome === "accepted") {
          installButton.hidden = true;
          installHelp.textContent = "Checkam was added to your device.";
          installHelp.hidden = false;
          ANALYTICS.track("pwa_installed", {});
        }
      }).catch(function () { installButton.disabled = false; });
    });

    window.addEventListener("appinstalled", function () {
      deferredInstallPrompt = null;
      installButton.hidden = true;
      installHelp.textContent = "Checkam was added to your device.";
      installHelp.hidden = false;
    });
  }

  /* ---------------- step 1: context ---------------- */
  function wireContext() {
    populateBankProfiles();
    var heroStart = $("#btn-hero-start");
    var audienceStart = $("#btn-audience-start");
    function startWorkflow(source) {
      ANALYTICS.track("context_continue", { source: source });
      document.body.classList.add("workflow-open");
      document.body.classList.remove("landing-mode");
      var details = $("#workflow-details");
      if (details) details.setAttribute("aria-hidden", "false");
      var target = $(".context-title");
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (target) target.focus({ preventScroll: true });
    }
    if (heroStart) heroStart.addEventListener("click", function () { startWorkflow("hero_start"); });
    if (audienceStart) audienceStart.addEventListener("click", function () { startWorkflow("audience_section"); });
    var heroDemo = $("#btn-hero-demo");
    if (heroDemo) heroDemo.addEventListener("click", loadDemo);
    var savedBtn = $("#btn-saved-reports");
    var savedClose = $("#btn-saved-reports-close");
    var savedList = $("#saved-reports-list");
    if (savedBtn) savedBtn.addEventListener("click", function () {
      renderSavedReportsList();
      var panel = $("#saved-reports-panel");
      if (panel) { panel.hidden = false; panel.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    });
    if (savedClose) savedClose.addEventListener("click", function () { $("#saved-reports-panel").hidden = true; });
    if (savedList) savedList.addEventListener("click", function (e) {
      var button = e.target.closest("[data-paid-report]");
      if (button) openSavedReport(button.getAttribute("data-paid-report"), button);
    });
    var complaintButton = $("#btn-open-complaint");
    if (complaintButton) complaintButton.addEventListener("click", function () {
      openSavedReport(complaintButton.getAttribute("data-complaint-report"), complaintButton);
    });

    $all('input[name="acctType"], input[name="holderType"]').forEach(function (r) {
      r.addEventListener("change", function () {
        state.ctx.accountType = ($('input[name="acctType"]:checked') || {}).value || "current";
        state.ctx.holderType = ($('input[name="holderType"]:checked') || {}).value || "individual";
      });
    });
    var bankSel = $("#bank-profile");
    var bankSearch = $("#bank-search");
    var bankResults = $("#bank-search-results");
    if (bankSel) bankSel.addEventListener("change", function () {
      if (!bankSel.value) return;
      setBankProfile(bankSel.value, true);
      if (bankSearch) bankSearch.value = "";
      renderBankOptions("");
    });
    if (bankSearch) {
      bankSearch.addEventListener("input", function () { renderBankOptions(bankSearch.value); });
      bankSearch.addEventListener("search", function () { renderBankOptions(bankSearch.value); });
    }
    if (bankResults) bankResults.addEventListener("click", function (e) {
      var result = e.target.closest("[data-bank-id]");
      if (!result) return;
      chooseBankSearchResult(result.getAttribute("data-bank-id"));
    });
    $("#salaryAccount").addEventListener("change", function (e) {
      state.ctx.salaryAccount = e.target.checked;
    });
    $("#btn-context-next").addEventListener("click", function () {
      ANALYTICS.track("context_continue", { accountType: state.ctx.accountType, holderType: state.ctx.holderType, salaryAccount: state.ctx.salaryAccount, bankId: state.ctx.bankId || "other" });
      gotoStep("step-upload");
    });
  }

  function populateBankProfiles() {
    var sel = $("#bank-profile");
    if (!sel || !BANKS) return;
    renderBankOptions("");
    setBankProfile(state.ctx.bankId || "other", false);
  }

  function filterBankProfiles(query) {
    if (!BANKS) return [];
    var q = String(query || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return BANKS.list().filter(function (p) {
      if (!q) return true;
      return [p.name, p.id].concat(p.aliases || []).some(function (term) {
        var value = String(term || "").toUpperCase();
        if (value.replace(/[^A-Z0-9]/g, "").indexOf(q) === 0) return true;
        return value.split(/[^A-Z0-9]+/).some(function (word) { return word.indexOf(q) === 0; });
      });
    });
  }

  function chooseBankSearchResult(id) {
    setBankProfile(id, true);
    var search = $("#bank-search");
    if (search) search.value = "";
    renderBankOptions("");
  }

  /* ---------------- locally saved paid reports ---------------- */
  function savedReportItems() {
    try { return PAID_REPORTS ? PAID_REPORTS.list() : []; } catch (e) { return []; }
  }

  function refreshSavedReportsButton() {
    var button = $("#btn-saved-reports");
    if (!button) return;
    var count = savedReportItems().length;
    button.hidden = count === 0;
    button.textContent = count === 1 ? "View paid report" : "View paid reports (" + count + ")";
  }

  function renderSavedReportsList() {
    var list = $("#saved-reports-list"), items = savedReportItems();
    if (!list) return;
    list.innerHTML = items.map(function (item) {
      var from = item.periodFrom ? REPORT.fmtDate(new Date(item.periodFrom)) : "Unknown date";
      var to = item.periodTo ? REPORT.fmtDate(new Date(item.periodTo)) : "Unknown date";
      var saved = item.savedAt ? new Date(item.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
      return '<button class="saved-report-item" type="button" data-paid-report="' + REPORT.esc(item.fingerprint) + '">' +
        '<strong>' + REPORT.esc(item.bankName) + '</strong>' +
        '<span>' + REPORT.esc(from + " – " + to) + '</span>' +
        '<small>Refund ' + REPORT.esc(REPORT.fmtN(item.refundDue)) + ' · Saved ' + REPORT.esc(saved) + '</small>' +
        '</button>';
    }).join("");
  }

  function openSavedReport(fingerprint, button) {
    var status = $("#saved-reports-status");
    if (!PAYWALL || !PAID_REPORTS || !fingerprint) return;
    if (button) button.disabled = true;
    if (status) { status.className = "scan-status"; status.textContent = "Checking saved payment…"; }
    var confirmation = PAYWALL.isUnlocked(fingerprint) ? Promise.resolve(true) : PAYWALL.restore(fingerprint);
    confirmation.then(function (paid) {
      if (!paid) throw new Error("Payment could not be confirmed. Keep your Flutterwave receipt and do not pay again.");
      var saved = PAID_REPORTS.load(fingerprint);
      if (!saved) throw new Error("This saved report is unavailable in this browser. Do not pay again; re-scan the original statement to restore access.");
      state.audit = saved.audit;
      state.auditTxns = [];
      state.ctx = Object.assign({ accountType: "current", holderType: "individual", salaryAccount: false, bankId: "other", overrides: {} }, saved.ctx || {});
      state.ctx.overrides = {};
      state.fingerprint = fingerprint;
      state.fileName = saved.source && saved.source.fileName;
      state.pageCount = saved.source && saved.source.pageCount;
      state.sheetCount = saved.source && saved.source.sheetCount;
      state.source = "saved_paid_report";
      state.restoredReport = true;
      state.filter = "all";
      $("#summary-cards").innerHTML = REPORT.renderSummary(state.audit);
      $("#health-score").innerHTML = REPORT.renderHealthScore(state.audit.health || REPORT.statementHealth(state.audit));
      $("#report-meta").innerHTML = REPORT.reportMeta(state.audit, state.ctx, saved.source || {});
      $("#report-read-status").textContent = "Saved paid report restored";
      $("#report-read-status").className = "scan-status ok";
      $("#integrity-banner").className = "integrity ok";
      $("#integrity-banner").innerHTML = "<strong>Saved audit copy:</strong> the paid findings and cross-checks were restored from this browser. Re-scan the original statement only if you need the complete transaction ledger or want to change classifications.";
      $("#report-read-details").open = false;
      $all(".tab-btn").forEach(function (tab) { tab.classList.toggle("on", tab.getAttribute("data-tab") === "findings"); });
      $("#pane-findings").style.display = "";
      $("#pane-all").style.display = "none";
      applyGate();
      $("#saved-reports-panel").hidden = true;
      gotoStep("step-results");
      ANALYTICS.track("saved_paid_report_opened", {});
    }).catch(function (err) {
      if (status) { status.className = "scan-status warn"; status.textContent = err.message || "Could not open this saved report."; }
      if (button) button.disabled = false;
    });
  }

  function saveCurrentPaidReport() {
    if (!PAID_REPORTS || !state.fingerprint || !state.audit || state.restoredReport) return false;
    var saved = PAID_REPORTS.save(state.fingerprint, state.audit, state.ctx, {
      fileName: state.fileName, pageCount: state.pageCount, sheetCount: state.sheetCount
    });
    refreshSavedReportsButton();
    return saved;
  }

  /* ---------------- complaint journey ---------------- */
  function complaintBankName() {
    var name = (state.audit && state.audit.bankProfile && state.audit.bankProfile.name) || "Your bank";
    return /other|not sure/i.test(name) ? "Your bank" : name;
  }

  function complaintJourney() {
    if (!COMPLAINTS || !state.fingerprint) return null;
    return COMPLAINTS.load(state.fingerprint) || {
      fingerprint: state.fingerprint,
      bankName: complaintBankName(),
      refundDue: state.audit && state.audit.summary ? state.audit.summary.refundDue : 0,
      response: {}
    };
  }

  function saveComplaint(patch) {
    if (!COMPLAINTS || !state.fingerprint) return false;
    patch = Object.assign({
      bankName: complaintBankName(),
      refundDue: state.audit && state.audit.summary ? state.audit.summary.refundDue : 0
    }, patch || {});
    var saved = COMPLAINTS.save(state.fingerprint, patch);
    renderComplaintTracker();
    refreshComplaintReminder();
    return saved;
  }

  function complaintStepSummary(number, title, done, current) {
    return '<span class="journey-number" aria-hidden="true">' + number + '</span>' +
      '<span><strong>' + REPORT.esc(title) + '</strong><small>' + (done ? "Complete" : current ? "Current step" : "Not complete") + '</small></span>';
  }

  function renderComplaintTracker() {
    var host = $("#complaint-tracker");
    if (!host || !state.audit || !state.audit.summary || !state.fingerprint || !COMPLAINTS) return;
    if (!(Number(state.audit.summary.refundDue) > 0)) { host.hidden = true; host.innerHTML = ""; return; }
    var journey = complaintJourney();
    var progress = COMPLAINTS.status(journey);
    var response = journey.response || {};
    var letterDone = !!journey.letterGeneratedAt;
    var submitted = !!journey.complaintDate;
    var reminderReady = submitted;
    var escalationDone = !!journey.escalationGeneratedAt || progress.resolved;
    var responseDone = !!(response.status || response.date || response.reference || response.notes);
    var current = !letterDone ? 1 : !submitted ? 2 : (!progress.due && !progress.resolved) ? 4 : (!escalationDone ? 5 : 6);
    var deadlineCopy = !submitted ? "Add the bank complaint date first."
      : progress.resolved ? "The bank response is marked resolved."
      : progress.due ? "The two-week period has passed. You can prepare the CBN escalation letter."
      : progress.daysRemaining + " day" + (progress.daysRemaining === 1 ? "" : "s") + " until " + COMPLAINTS.formatDate(progress.deadline) + ".";
    var escalationDisabled = !progress.due || progress.resolved;
    var statusOptions = [
      ["", "Choose status"], ["resolved", "Resolved"], ["partly_resolved", "Partly resolved"], ["not_resolved", "Not resolved"]
    ].map(function (option) {
      return '<option value="' + option[0] + '"' + (response.status === option[0] ? " selected" : "") + '>' + option[1] + '</option>';
    }).join("");

    host.hidden = false;
    host.innerHTML = '<div class="journey-head"><div><span class="eyebrow">Complaint tracker</span><h3 id="complaint-tracker-title">Your complaint journey</h3></div>' +
      '<span class="journey-progress">' + progress.completed + ' of 6 complete</span></div>' +
      '<p class="journey-intro">Track the bank complaint, the two-week follow-up date and any response.</p>' +
      '<div class="journey-steps">' +
      '<details class="journey-step"' + (current === 1 ? " open" : "") + '><summary>' + complaintStepSummary(1, "Generate bank complaint", letterDone, current === 1) + '</summary><div class="journey-body">' +
        '<button class="btn btn-primary" id="btn-complaint-letter" type="button">' + (letterDone ? "Open complaint letter" : "Generate complaint letter") + '</button></div></details>' +
      '<details class="journey-step"' + (current === 2 ? " open" : "") + '><summary>' + complaintStepSummary(2, "Submit to your bank", submitted, current === 2) + '</summary><div class="journey-body">' +
        '<label for="complaint-date">Date the bank received it</label><input id="complaint-date" type="date" max="' + COMPLAINTS.todayIso() + '" value="' + REPORT.esc(journey.complaintDate || "") + '">' +
        '<button class="btn btn-primary" id="btn-save-complaint-date" type="button">Save submission date</button><p class="field-status" id="complaint-date-status" role="status"></p></div></details>' +
      '<details class="journey-step"><summary>' + complaintStepSummary(3, "Complaint date recorded", submitted, current === 3) + '</summary><div class="journey-body"><p>' +
        (submitted ? "Submitted " + REPORT.esc(COMPLAINTS.formatDate(journey.complaintDate)) + ". Follow-up date: " + REPORT.esc(COMPLAINTS.formatDate(progress.deadline)) + "." : "Save the date after the bank receives your complaint.") + '</p></div></details>' +
      '<details class="journey-step"' + (current === 4 ? " open" : "") + '><summary>' + complaintStepSummary(4, "Set the 14-day reminder", reminderReady, current === 4) + '</summary><div class="journey-body"><p>' + REPORT.esc(deadlineCopy) + '</p>' +
        '<button class="btn btn-ghost" id="btn-complaint-calendar" type="button"' + (!submitted ? " disabled" : "") + '>Add reminder to calendar</button><small>Checkam also shows a reminder here when you return after the due date.</small></div></details>' +
      '<details class="journey-step"' + (current === 5 ? " open" : "") + '><summary>' + complaintStepSummary(5, "Escalate to CBN", escalationDone, current === 5) + '</summary><div class="journey-body"><p>' + REPORT.esc(deadlineCopy) + '</p>' +
        '<button class="btn btn-primary" id="btn-cbn-letter" type="button"' + (escalationDisabled ? " disabled" : "") + '>Generate CBN escalation letter</button>' +
        '<details class="help-link"><summary>CBN submission guidance</summary><div class="disclosure-body"><p>Include proof that you complained to the bank, the disputed transaction history, the amount claimed and supporting documents. Never include a PIN or password.</p><a href="https://www.cbn.gov.ng/supervision/cpdcomgt.html" target="_blank" rel="noopener noreferrer">Read CBN complaints guidance</a></div></details></div></details>' +
      '<details class="journey-step"' + (current === 6 ? " open" : "") + '><summary>' + complaintStepSummary(6, "Save the bank response", responseDone, current === 6) + '</summary><div class="journey-body journey-response">' +
        '<label for="bank-response-date">Response date</label><input id="bank-response-date" type="date" max="' + COMPLAINTS.todayIso() + '" value="' + REPORT.esc(response.date || "") + '">' +
        '<label for="bank-response-status">Outcome</label><select id="bank-response-status">' + statusOptions + '</select>' +
        '<label for="bank-response-reference">Bank reference</label><input id="bank-response-reference" type="text" maxlength="120" value="' + REPORT.esc(response.reference || "") + '" autocomplete="off">' +
        '<label for="bank-response-notes">Response notes</label><textarea id="bank-response-notes" maxlength="3000" rows="4">' + REPORT.esc(response.notes || "") + '</textarea>' +
        '<button class="btn btn-primary" id="btn-save-bank-response" type="button">Save bank response</button><p class="field-status" id="bank-response-save-status" role="status"></p></div></details>' +
      '</div><details class="help-link"><summary>Privacy and storage</summary><div class="disclosure-body"><p>Checkam stores this tracker in this browser. It does not upload the complaint record or the bank response. Save only a short response summary, not passwords, a PIN or full card details.</p></div></details>';
  }

  function refreshComplaintReminder() {
    var panel = $("#complaint-reminder");
    if (!panel || !COMPLAINTS) return;
    var due = COMPLAINTS.dueItems();
    panel.hidden = due.length === 0;
    if (!due.length) return;
    var first = due[0], status = COMPLAINTS.status(first);
    $("#complaint-reminder-text").textContent = "The two-week follow-up date for " + first.bankName + " was " + COMPLAINTS.formatDate(status.deadline) + ". Open the paid report to continue.";
    $("#btn-open-complaint").setAttribute("data-complaint-report", first.fingerprint);
  }

  function renderBankOptions(query) {
    var sel = $("#bank-profile");
    if (!sel || !BANKS) return;
    var current = state.ctx.bankId || "other";
    var q = String(query || "").trim();
    var allProfiles = BANKS.list();
    var profiles = q.length >= 3 ? filterBankProfiles(q) : [];
    sel.innerHTML = allProfiles.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === current ? " selected" : "") + '>' + REPORT.esc(p.name) + (p.confidence && p.id !== "other" ? " — " + REPORT.esc(p.confidence) : "") + '</option>';
    }).join("");
    var results = $("#bank-search-results");
    if (results) {
      results.hidden = q.length < 3;
      results.innerHTML = q.length < 3 ? "" : profiles.length ? profiles.map(function (p) {
        return '<button type="button" role="option" class="bank-search-result" data-bank-id="' + REPORT.esc(p.id) + '"><strong>' + REPORT.esc(p.name) + '</strong><span>Select bank</span></button>';
      }).join("") : '<p class="bank-search-empty">No matching bank found</p>';
    }
    var search = $("#bank-search");
    if (search) search.setAttribute("aria-expanded", q.length >= 3 ? "true" : "false");
    var status = $("#bank-search-status");
    if (status) status.textContent = !q
      ? allProfiles.length + " banks listed alphabetically"
      : q.length < 3
        ? "Type " + (3 - q.length) + " more " + (3 - q.length === 1 ? "letter" : "letters") + " to see matches"
        : profiles.length + (profiles.length === 1 ? " bank found" : " banks found");
  }

  function setBankProfile(id, track) {
    state.ctx.bankId = id || "other";
    var p = BANKS ? BANKS.get(state.ctx.bankId) : null;
    var note = $("#bank-profile-note");
    if (note && p) note.textContent = p.id === "other" ? "CBN baseline only until a bank is selected." : (p.sourceLabel + " • confidence: " + p.confidence);
    if (track) ANALYTICS.track("bank_profile_selected", { bankId: state.ctx.bankId, confidence: p && p.confidence });
  }

  /* ---------------- step 2: upload ---------------- */
  function loadDemo() {
    document.body.classList.add("workflow-open");
    document.body.classList.remove("landing-mode");
    ANALYTICS.track("demo_started", { source: "demo" });
    state.rows = PARSER.parseCSVText(DEMO_CSV);
    state.source = "demo"; state.fileName = "demo_statement.csv";
    state.pageCount = null; state.sheetCount = null;
    buildMappingUI();
    gotoStep("step-mapping");
  }

  function statementPickerOptions() {
    return {
      id: "checkam-bank-statement",
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{
        description: "Bank statements",
        accept: {
          "application/pdf": [".pdf"],
          "text/csv": [".csv"],
          "text/plain": [".txt"],
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
          "application/vnd.ms-excel": [".xls"]
        }
      }]
    };
  }

  function chooseStatementFile(fileInput) {
    // A typed document picker avoids Android offering camera apps for a bank
    // statement. Browsers without this API use the MIME-restricted input.
    if (typeof window.showOpenFilePicker !== "function") {
      fileInput.click();
      return Promise.resolve(false);
    }
    var picker;
    try { picker = window.showOpenFilePicker(statementPickerOptions()); }
    catch (err) { fileInput.click(); return Promise.resolve(false); }
    return picker.then(function (handles) {
      if (!handles || !handles[0]) return false;
      return handles[0].getFile().then(function (file) {
        if (!file) return false;
        handleFile(file);
        return true;
      });
    }).catch(function (err) {
      if (!err || err.name !== "AbortError") showError("Could not open the file picker. Please tap Choose statement and try again.");
      return false;
    });
  }

  function wireUpload() {
    var dz = $("#dropzone"), fi = $("#file-input");
    dz.addEventListener("click", function () { chooseStatementFile(fi); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chooseStatementFile(fi); }
    });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
    dz.addEventListener("drop", function (e) {
      e.preventDefault(); dz.classList.remove("over");
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fi.addEventListener("change", function () { if (fi.files.length) handleFile(fi.files[0]); fi.value = ""; });
    $("#btn-demo").addEventListener("click", loadDemo);
    $("#btn-upload-back").addEventListener("click", goBack);
  }

  function handleFile(file, opts) {
    opts = opts || {};
    ANALYTICS.track("file_selected", { fileType: ANALYTICS.fileType(file && file.name), source: opts.pdfPassword ? "pdf_retry" : "user_file" });
    showError("");
    $("#dropzone").classList.add("busy");
    var isPdf = /\.pdf$/i.test(file.name || "");
    scan.show("Scanning your statement", isPdf && opts.pdfPassword ? "Unlocking the protected PDF" : (isPdf ? "Opening the PDF" : "Reading the file"));

    var onProgress = function (page, total) {
      scan.sub("Scanning page " + page + " of " + total);
      scan.progress(page, total);
    };

    PARSER.readFile(file, onProgress, opts).then(function (res) {
      scan.sub("Reconstructing the transaction table");
      scan.progress(1, 1);
      return nextFrame().then(function () { return res; });
    }).then(function (res) {
      $("#dropzone").classList.remove("busy");
      if (!res.rows || res.rows.length < 2) {
        scan.hide();
        return showError("No table could be read from this file. Please export your statement as CSV or Excel from your bank's internet banking and try again.");
      }
      state.rows = res.rows; state.source = res.source; state.fileName = file.name;
      state.pageCount = res.pageCount || null;
      state.sheetCount = res.sheetCount || null;
      ANALYTICS.track("file_read_success", { fileType: ANALYTICS.fileType(file && file.name), source: res.source, rowCount: res.rows.length, pageCount: res.pageCount || 0, sheetCount: res.sheetCount || 0 });
      state.ctx.overrides = {};
      buildMappingUI();
      scan.hide();
      gotoStep("step-mapping");
    }).catch(function (err) {
      $("#dropzone").classList.remove("busy");
      scan.hide();
      if (isPdf && err && err.pdfPasswordRequired) {
        return askPdfPassword(err.pdfPasswordIncorrect).then(function (password) {
          if (!password) {
            showError("PDF unlock cancelled. This statement is password-protected, so the app needs the password before it can read the transactions.");
            return;
          }
          handleFile(file, { pdfPassword: password });
        });
      }
      ANALYTICS.track("file_read_error", { fileType: ANALYTICS.fileType(file && file.name), errorType: err && err.pdfPasswordRequired ? "pdf_password_required" : "read_error" });
      showError(err.message || String(err));
    });
  }

  function askPdfPassword(wasIncorrect) {
    var modal = $("#pdf-password-modal"), input = $("#pdf-password-input"), msg = $("#pdf-password-msg");
    return new Promise(function (resolve) {
      if (!modal || !input) {
        resolve(window.prompt(wasIncorrect ? "That password did not work. Enter the PDF password again:" : "This PDF is password-protected. Enter the statement password:"));
        return;
      }
      msg.textContent = wasIncorrect ? "That password did not work. Please check it and try again." : "This PDF is password-protected. Enter the statement password to unlock it locally on this device.";
      input.value = "";
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      setTimeout(function () { input.focus(); }, 30);

      var done = false;
      function cleanup(value) {
        if (done) return;
        done = true;
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
        $("#btn-pdf-password-unlock").removeEventListener("click", unlock);
        $("#btn-pdf-password-cancel").removeEventListener("click", cancel);
        input.removeEventListener("keydown", keydown);
        resolve(value);
      }
      function unlock() { cleanup(input.value); }
      function cancel() { cleanup(""); }
      function keydown(e) {
        if (e.key === "Enter") { e.preventDefault(); unlock(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
      }
      $("#btn-pdf-password-unlock").addEventListener("click", unlock);
      $("#btn-pdf-password-cancel").addEventListener("click", cancel);
      input.addEventListener("keydown", keydown);
    });
  }

  function showError(msg) {
    var el = $("#upload-error");
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
  }

  /* ---------------- step 3: mapping confirmation ---------------- */
  var ROLE_FIELDS = [
    { key: "date", name: "Date (Trans/Post Date)", req: true },
    { key: "valueDate", name: "Value Date", req: false },
    { key: "narration", name: "Narration / Remarks", req: true },
    { key: "debit", name: "Debit (money out)", req: true },
    { key: "credit", name: "Credit (money in)", req: false },
    { key: "balance", name: "Balance", req: false },
    { key: "reference", name: "Reference", req: false },
    { key: "amount", name: "Amount (single signed column)", req: false },
    { key: "drcr", name: "DR/CR indicator", req: false }
  ];

  function buildMappingUI(headerRowOverride) {
    var rows = state.rows;
    var det = PARSER.detectColumns(rows);
    var auto = headerRowOverride === undefined || headerRowOverride === null;
    if (auto) setScanDetails(false);
    var headerRow = auto ? (det ? det.headerRow : 0) : headerRowOverride;
    var roles = auto ? det : PARSER.detectColumnsAt(rows, headerRow);

    // everything ABOVE the chosen header row is the hero/summary section
    state.meta = PARSER.extractStatementMeta(rows, headerRow);
    detectBankFromStatement(rows, headerRow);
    renderMetaCard();
    renderHeaderPicker(rows, headerRow, !!det);

    var nCols = 0;
    for (var i = headerRow; i < Math.min(rows.length, headerRow + 12); i++) nCols = Math.max(nCols, rows[i].length);

    // the bank's own field labels on the header row become the dropdown options
    var labels = [];
    for (var c = 0; c < nCols; c++) {
      var lb = rows[headerRow][c];
      if (lb instanceof Date) lb = lb.toLocaleDateString("en-GB");
      lb = String(lb == null ? "" : lb).trim();
      labels[c] = lb || "Column " + (c + 1);
    }
    state.headerLabels = labels;

    var roleMap = roles ? roles.map : {};

    // one picker per role, its options taken from the statement's own header
    $("#mapping-roles").innerHTML = ROLE_FIELDS.map(function (rf) {
      var opts = '<option value="">— not in this statement —</option>' + labels.map(function (lbl, ci) {
        return '<option value="' + ci + '"' + (roleMap[rf.key] === ci ? " selected" : "") + ">" + REPORT.esc(lbl) + "</option>";
      }).join("");
      return '<div class="role-row"><label for="map-role-' + rf.key + '">' + rf.name + (rf.req ? " <em>required</em>" : "") + "</label>" +
        '<select id="map-role-' + rf.key + '" class="role-pick" data-role="' + rf.key + '">' + opts + "</select></div>";
    }).join("");

    // preview: the bank's header labels on top; the row immediately after
    // the header IS the first transaction row
    var previewWidth = previewTableWidth(roleMap, nCols);
    var html = '<table class="map-table" style="width:' + previewWidth + 'px;min-width:' + previewWidth + 'px"><colgroup>';
    for (c = 0; c < nCols; c++) html += '<col style="width:' + previewColWidth(roleAtColumn(roleMap, c)) + 'px">';
    html += '</colgroup><thead><tr>';
    for (c = 0; c < nCols; c++) {
      html += '<th><div class="col-label">' + REPORT.esc(labels[c]) + '</div><div class="role-tag" data-col="' + c + '"></div></th>';
    }
    html += "</tr></thead><tbody>";
    for (var r = headerRow + 1; r < Math.min(rows.length, headerRow + 10); r++) {
      html += "<tr>";
      for (var c2 = 0; c2 < nCols; c2++) {
        var cell = rows[r][c2];
        if (cell instanceof Date) cell = cell.toLocaleDateString("en-GB");
        html += "<td>" + REPORT.esc(cell == null ? "" : String(cell).slice(0, 220)) + "</td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    $("#mapping-table").innerHTML = html;
    $("#mapping-table").dataset.headerRow = headerRow;
    $("#map-note").textContent = det
      ? (det.complete
        ? "The statement's summary section was separated out (above) and the transaction table was found automatically. Each dropdown below holds the statement's own column labels — confirm the assignments, then run the audit."
        : "The transaction table header was recognised by its column labels (" + det.labels + " matched), but one or more required roles could not be matched to a known label — pick the right column label in the dropdown(s) below (Date, Narration and Debit or Amount are required).")
      : "We could not auto-detect the transaction table in this file. Pick the row where the table starts, then assign the statement's column labels to each role below (Date, Narration and Debit or Amount are required).";

    $all(".role-pick").forEach(function (s) { s.addEventListener("change", refreshMappingStats); });
    refreshMappingStats();
  }

  function roleAtColumn(map, col) {
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k) && map[k] === col) return k;
    return "";
  }

  function previewColWidthClass(role) {
    if (role === "date" || role === "drcr") return "w-date";
    if (role === "valueDate") return "w-value-date";
    if (role === "narration") return "w-narration";
    if (role === "reference") return "w-reference";
    if (role === "debit" || role === "credit" || role === "balance" || role === "amount") return "w-money";
    return "w-generic";
  }

  function previewColWidth(role) {
    if (role === "date" || role === "drcr") return 96;
    if (role === "valueDate") return 96;
    if (role === "narration") return 320;
    if (role === "reference") return 155;
    if (role === "debit" || role === "credit" || role === "balance" || role === "amount") return 160;
    return 125;
  }

  function previewTableWidth(map, nCols) {
    var total = 0;
    for (var c = 0; c < nCols; c++) total += previewColWidth(roleAtColumn(map, c));
    return Math.max(total, 760);
  }

  /** Lets the user move the start of the transaction table if the automatic
   *  choice is wrong — everything above it is re-read as the hero section. */
  function renderHeaderPicker(rows, headerRow, detected) {
    var pick = $("#header-pick");
    var opts = "";
    var max = Math.min(rows.length, 40);
    for (var r = 0; r < max; r++) {
      var label = (rows[r] || []).slice(0, 6).map(function (cl) {
        var s = cl instanceof Date ? cl.toLocaleDateString("en-GB") : String(cl == null ? "" : cl);
        return s.trim();
      }).filter(Boolean).join("  |  ").slice(0, 80);
      if (!label) label = "(empty row)";
      opts += '<option value="' + r + '"' + (r === headerRow ? " selected" : "") + ">Row " + (r + 1) + ":  " + REPORT.esc(label) + "</option>";
    }
    pick.innerHTML =
      '<label for="header-row-sel">Transaction table starts at</label>' +
      '<select id="header-row-sel">' + opts + "</select>" +
      '<span class="muted">' + (detected ? "auto-detected — change it if the highlighted row is not the table header" : "pick the row that names the columns (Date, Debit, Balance…)") + "</span>";
    $("#header-row-sel").addEventListener("change", function () {
      buildMappingUI(+this.value);
    });
  }

  function detectBankFromStatement(rows, headerRow) {
    if (!BANKS || (state.ctx.bankId && state.ctx.bankId !== "other")) return;
    var hero = rows.slice(0, Math.max(1, Math.min(headerRow || 12, 18))).map(function (r) { return (r || []).join(" "); }).join(" ");
    var p = BANKS.detect(hero + " " + (state.fileName || ""));
    if (!p) return;
    setBankProfile(p.id, false);
    var sel = $("#bank-profile");
    if (sel) sel.value = p.id;
  }

  /** Show what was mined from the statement's hero/summary section, and
   *  offer a one-click fix if the statement disagrees with the chosen
   *  account type (account type decides which CBN rules apply). */
  function renderMetaCard() {
    var meta = state.meta, box = $("#statement-meta"), hint = $("#acct-hint");
    hint.innerHTML = ""; box.innerHTML = "";
    if (!meta) { box.style.display = "none"; hint.style.display = "none"; return; }

    var items = [];
    function add(label, val) { if (val !== null && val !== undefined && val !== "") items.push("<div><span>" + REPORT.esc(label) + "</span><strong>" + REPORT.esc(val) + "</strong></div>"); }
    add("Account name", meta.accountName);
    add("Account number", meta.accountNumber);
    add("Account type (per statement)", meta.accountType ? meta.accountType.toUpperCase() : null);
    if (meta.periodFrom && meta.periodTo) add("Statement period", REPORT.fmtDate(meta.periodFrom) + " – " + REPORT.fmtDate(meta.periodTo));
    add("Opening balance", meta.openingBalance !== null ? REPORT.fmtN(meta.openingBalance) : null);
    add("Closing balance", meta.closingBalance !== null ? REPORT.fmtN(meta.closingBalance) : null);
    add("Total debits", meta.totalDebit !== null ? REPORT.fmtN(meta.totalDebit) : null);
    add("Total credits", meta.totalCredit !== null ? REPORT.fmtN(meta.totalCredit) : null);
    add("Currency", meta.currency);

    if (items.length) {
      box.style.display = "";
      box.innerHTML = '<div class="meta-title">📋 Read from the statement\'s own header section</div><div class="meta-grid">' + items.join("") + "</div>" +
        '<p class="meta-note">These figures are used below as an independent checksum: the parsed transactions must add up to the statement\'s own totals before the audit is trusted.</p>';
    } else box.style.display = "none";

    if (meta.accountType && meta.accountType !== state.ctx.accountType) {
      hint.style.display = "";
      hint.innerHTML = '<span>⚠ The statement\'s header says this is a <strong>' + meta.accountType.toUpperCase() +
        '</strong> account, but you selected <strong>' + state.ctx.accountType.toUpperCase() +
        "</strong>. Account type decides which CBN rules apply (e.g. maintenance fees vs card fees).</span> " +
        '<button class="btn btn-ghost btn-small" id="btn-acct-switch">Switch to ' + meta.accountType + "</button>";
      $("#btn-acct-switch").addEventListener("click", function () {
        state.ctx.accountType = meta.accountType;
        var radio = document.querySelector('input[name="acctType"][value="' + meta.accountType + '"]');
        if (radio) radio.checked = true;
        renderMetaCard();
      });
    } else hint.style.display = "none";
  }

  function currentMap() {
    var map = {}, dup = false, used = {};
    $all(".role-pick").forEach(function (s) {
      if (s.value === "") return;
      var col = +s.value;
      if (used[col] !== undefined) dup = true;
      used[col] = true;
      map[s.getAttribute("data-role")] = col;
    });
    return { map: map, dup: dup };
  }

  /** Show each assigned role as a tag under the bank's own column label,
   *  and format every preview column like the bank's own layout:
   *  money right-aligned, dates compact, remarks wrapping in a wide column. */
  function refreshRoleTags(map) {
    var rev = {};
    Object.keys(map).forEach(function (k) { rev[map[k]] = k; });
    $all(".role-tag").forEach(function (tag) {
      var role = rev[+tag.getAttribute("data-col")];
      var rf = role && ROLE_FIELDS.filter(function (x) { return x.key === role; })[0];
      tag.textContent = rf ? rf.name.replace(/\s*\(.*\)$/, "") : "";
      tag.classList.toggle("on", !!role);
    });

    var table = document.querySelector("#mapping-table table");
    if (!table) return;
    Array.prototype.forEach.call(table.querySelectorAll("col"), function (col, ci) {
      col.className = previewColWidthClass(rev[ci]);
      col.style.width = previewColWidth(rev[ci]) + "px";
    });
    var width = previewTableWidth(rev, table.querySelectorAll("col").length);
    table.style.width = width + "px";
    table.style.minWidth = width + "px";
    function colCls(role) {
      if (role === "debit" || role === "credit" || role === "balance" || role === "amount") return "c-num";
      if (role === "date" || role === "drcr") return "c-date";
      if (role === "narration") return "c-narr";
      if (role === "reference") return "c-ref";
      return "";
    }
    Array.prototype.forEach.call(table.rows, function (tr) {
      Array.prototype.forEach.call(tr.cells, function (cell, ci) {
        cell.classList.remove("c-num", "c-date", "c-narr", "c-ref");
        var cls = colCls(rev[ci]);
        if (cls) cell.classList.add(cls);
      });
    });
  }

  function setScanDetails(open) {
    $("#scan-details").hidden = !open;
    var toggle = $("#btn-scan-details");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide scanned details" : "View scanned details";
  }

  function updateScanSummary(level) {
    var mismatch = $("#acct-hint").style.display !== "none";
    var review = level !== "ok" || mismatch;
    $("#scan-heading").textContent = review ? "Review scan" : "Scan complete";
    var status = $("#scan-status");
    status.className = "scan-status " + (level === "bad" ? "bad" : review ? "warn" : "ok");
    status.textContent = level === "bad" ? "Correct column mapping." : review ? "Review required — check details." :
      (state.txns || []).length + " transactions · Ready";
    if (review) setScanDetails(true);
  }

  function renderDifferenceLocator(result) {
    if (!result || !result.hasDifferences) return "";
    var total = result.balanceGaps.length + result.excludedRows.length + result.summaryDifferences.length;
    function where(ref) {
      var parts = [];
      if (ref.page) parts.push("page " + ref.page);
      if (ref.row) parts.push("parsed row " + ref.row);
      if (ref.date) parts.push(REPORT.fmtDate(ref.date));
      return parts.join(" · ") || "the parsed statement";
    }
    function fmtValue(item, value) {
      return item.isCount ? String(Math.round(Math.abs(value))) : REPORT.fmtN(Math.abs(value));
    }
    var groups = [];
    if (result.balanceGaps.length) {
      groups.push('<section class="difference-group"><h5>Balance breaks</h5>' + result.balanceGaps.map(function (gap, index) {
        var boundary = gap.pageBoundary ? " · page boundary" : "";
        var summary = REPORT.fmtN(gap.netAmount) + " net " + gap.neededSide + " needed" + boundary;
        var alternatives = gap.neededSide === "debit" ? "a missing debit, an overstated credit" : "a missing credit, an overstated debit";
        var continuity = gap.nextRowsContinue ? " The rows after this point resume a consistent balance chain, so this is a focused candidate location; a separate balance section is also possible." : "";
        var matchedEvidence = gap.summaryMatch ? '<p class="difference-match"><strong>Strong match:</strong> ' + REPORT.esc(gap.summaryMatch.interpretation) + "</p>" : "";
        return '<details class="difference-item"' + (index === 0 ? " open" : "") + '><summary>' + REPORT.esc(summary) + '</summary><p>Between ' +
          REPORT.esc(where(gap.before)) + " and " + REPORT.esc(where(gap.after)) + ", the calculated balance is " +
          REPORT.esc(REPORT.fmtN(gap.expectedBalance)) + " but the PDF row shows " + REPORT.esc(REPORT.fmtN(gap.actualBalance)) +
          ". This can mean " + REPORT.esc(alternatives) + ", or a misread running balance." + REPORT.esc(continuity) + "</p>" + matchedEvidence + "</details>";
      }).join("") + "</section>");
    }
    if (result.excludedRows.length) {
      groups.push('<details class="difference-group"><summary>Excluded PDF rows (' + result.excludedRows.length + ")</summary><ul>" +
        result.excludedRows.slice(0, 50).map(function (problem) {
          var location = (problem.page ? "Page " + problem.page + " · " : "") + "parsed row " + problem.row;
          return "<li><strong>" + REPORT.esc(location) + ":</strong> " + REPORT.esc(problem.issue) + "</li>";
        }).join("") + "</ul></details>");
    }
    if (result.summaryDifferences.length) {
      groups.push('<details class="difference-group"><summary>PDF summary versus parsed result (' + result.summaryDifferences.length + ")</summary><ul>" +
        result.summaryDifferences.map(function (item) {
          var diff = fmtValue(item, item.difference);
          var wording = item.isCount ? " by " + diff + " transaction(s)" : " by " + diff;
          return "<li><strong>" + REPORT.esc(item.label) + ":</strong> " +
            (item.higherSide === "parsed" ? "the parsed result is higher than the PDF summary" : "the PDF summary is higher than the parsed result") +
            REPORT.esc(wording) + ".</li>";
        }).join("") + "</ul></details>");
    }
    return '<details class="difference-locator" open><summary>Locate read differences (' + total + ')</summary><div class="difference-body">' +
      '<p class="evidence-note"><strong>What this proves:</strong> balance breaks identify where the numbers stop reconciling. A single PDF cannot prove whether the PDF omitted a row, the parser misread it, or the bank summary is wrong.</p>' +
      groups.join("") + "</div></details>";
  }

  function refreshMappingStats() {
    var diagBox = $("#diagnostic-box");
    if (diagBox) diagBox.style.display = state.rows ? "" : "none";
    var mr = currentMap();
    refreshRoleTags(mr.map);
    var stat = $("#mapping-stats"), btn = $("#btn-run-audit");
    var problemsEl = $("#mapping-problems");
    problemsEl.innerHTML = "";
    state.txns = null;
    state.integrity = null; state.reconcile = null; state.differences = null; state.lastBuilt = null;
    $("#reconcile-box").style.display = "none";
    $("#reconcile-box").innerHTML = "";

    if (mr.dup) { stat.className = "map-stat bad"; stat.textContent = "Two roles point to the same column label — each column can only play one role."; btn.disabled = true; updateScanSummary("bad"); return; }
    var m = mr.map;
    if (m.date === undefined || m.narration === undefined || (m.debit === undefined && m.amount === undefined)) {
      stat.className = "map-stat bad";
      stat.textContent = "Required: a Date column, a Narration column, and a Debit (or signed Amount) column.";
      btn.disabled = true; updateScanSummary("bad"); return;
    }

    var headerRow = +$("#mapping-table").dataset.headerRow;
    var built = PARSER.buildTransactions(state.rows, headerRow, m);
    state.txns = built.txns; state.problems = built.problems; state.lastBuilt = built;

    if (!built.txns.length) {
      // show what the date column actually contains, so the problem is visible
      var samples = [];
      for (var sr = headerRow + 1; sr < state.rows.length && samples.length < 4; sr++) {
        var sv = (state.rows[sr] || [])[m.date];
        if (sv instanceof Date) sv = sv.toLocaleDateString("en-GB");
        sv = String(sv == null ? "" : sv).trim();
        if (sv) samples.push("“" + sv.slice(0, 24) + "”");
      }
      stat.className = "map-stat bad";
      stat.textContent = "No transactions could be read with this mapping. The Date column contains: " +
        (samples.length ? samples.join("  ·  ") : "(only empty cells)") +
        " — if these are not dates, pick a different column for Date (or move the 'Transaction table starts at' row). If they ARE dates, this date format is not yet supported — please report it so it can be added.";
      btn.disabled = true; updateScanSummary("bad"); return;
    }

    var ic = PARSER.integrityCheck(built.txns);
    state.integrity = ic;
    var range = REPORT.fmtDate(built.txns[0].date) + " – " + REPORT.fmtDate(built.txns[built.txns.length - 1].date);
    var srcInfo = state.pageCount ? state.pageCount + " PDF page(s) scanned. "
      : (state.sheetCount ? state.sheetCount + " worksheet(s) detected. " : "");
    var msg = srcInfo + built.txns.length + " transactions read (" + range + ").";
    var cls = "ok";

    if (ic.hasBalance && ic.checked >= 5) {
      var pct = Math.round(ic.ratio * 100);
      if (ic.ratio >= 0.98) msg += " Balance arithmetic verified on " + ic.matched + "/" + ic.checked + " rows (" + pct + "%) — the rows that were read are internally consistent.";
      else if (ic.ratio >= 0.9) { msg += " Balance check passed on only " + pct + "% of rows — a few rows may be misread; review the findings carefully."; cls = "warn"; }
      else { msg += " Balance check FAILED (" + pct + "% consistent). The column mapping is probably wrong — fix it before auditing. Auditing a misread statement produces wrong results."; cls = "bad"; }
    } else if (ic.hasBalance) {
      msg += " Balance column found, but too few rows to fully verify the parse arithmetic.";
      cls = "warn";
    } else {
      msg += " No balance column found, so the parse could not be independently verified — adding the Balance column is recommended.";
      cls = "warn";
    }
    if (built.duplicates) {
      msg += " " + built.duplicates + " row(s) duplicated by the bank's PDF at page boundaries were detected (same date, amounts and running balance) and merged.";
    }
    if (built.resequenced) {
      msg += " " + built.resequenced + " page-boundary row pair(s) printed out of order were re-sequenced (proven by the balance arithmetic).";
    }
    if (built.problems.length) {
      msg += " " + built.problems.length + " row(s) could not be read and were excluded (listed below) — the auditor never guesses unreadable rows.";
      if (cls === "ok") cls = "warn";
      problemsEl.innerHTML = "<details><summary>Excluded rows (" + built.problems.length + ")</summary><ul>" +
        built.problems.slice(0, 50).map(function (p) {
          return "<li>Row " + p.row + ": " + REPORT.esc(p.issue) + " — <code>" + REPORT.esc(p.data) + "</code></li>";
        }).join("") + "</ul></details>";
    }

    // hero checksum: the parsed rows must add up to the statement's own
    // summary figures (opening/closing balance, total debits/credits)
    if (state.meta && state.meta.openingBalance === null && built.openingBalance !== null) {
      state.meta.openingBalance = built.openingBalance;
    }
    var rec = PARSER.reconcileWithMeta(built.txns, state.meta);
    state.reconcile = rec;
    var differences = PARSER.locateDifferences(built.txns, built.problems, rec);
    state.differences = differences;
    var locatorHtml = renderDifferenceLocator(differences);
    var recBox = $("#reconcile-box");
    if (rec) {
      recBox.style.display = "";
      recBox.innerHTML = '<div class="meta-title">' + (rec.allOk ? "Verified: " : "Review: ") + "checksum against the statement's own summary figures</div>" +
        '<ul class="rec-list">' + rec.checks.map(function (ch) {
          return '<li class="' + (ch.ok ? "ok" : "fail") + '"><strong>' + (ch.ok ? "Passed — " : "Review — ") + REPORT.esc(ch.label) + ":</strong> " + REPORT.esc(ch.detail) + "</li>";
        }).join("") + "</ul>" + locatorHtml;
      if (rec.anyFail) {
        if (rec.summaryBoundaryOnly && ic.hasBalance && ic.ratio >= 0.98) {
          msg += " The transaction rows, totals and closing balance reconcile; only the statement's opening/closing summary arithmetic differs, so this looks like a small inconsistency in the bank's own summary rather than a misread table.";
          if (cls === "ok") cls = "warn";
        } else {
          msg += " The statement's own summary figures do not match the parsed rows — rows may be missing or misread (or the file may be missing pages). Fix this before trusting the audit.";
          if (cls === "ok") cls = "warn";
        }
      } else {
        msg += " The parsed rows also add up exactly to the statement's own summary totals — the read is provably complete.";
      }
    } else if (locatorHtml) {
      recBox.style.display = "";
      recBox.innerHTML = locatorHtml;
    } else { recBox.style.display = "none"; recBox.innerHTML = ""; }

    stat.className = "map-stat " + cls;
    stat.textContent = msg;
    btn.disabled = (cls === "bad");
    updateScanSummary(cls);
  }

  function wireMapping() {
    $("#btn-scan-details").addEventListener("click", function () {
      setScanDetails($("#scan-details").hidden);
    });
    $("#btn-run-audit").addEventListener("click", function () {
      if (!state.txns || !state.txns.length) return;
      ANALYTICS.track("audit_started", { source: state.source || "unknown", accountType: state.ctx.accountType, holderType: state.ctx.holderType, txnCount: state.txns.length });
      // big statements take a few seconds to audit + render; show the overlay
      if (state.txns.length > 250) {
        scan.show("Auditing against CBN rules", "Checking " + state.txns.length + " transactions");
        nextFrame().then(function () {
          runAudit();
          gotoStep("step-results");
          scan.hide();
        });
      } else {
        runAudit();
        gotoStep("step-results");
      }
    });
    $("#btn-mapping-back").addEventListener("click", goBack);

    $("#btn-download-diagnostic").addEventListener("click", function () {
      ANALYTICS.track("diagnostic_download", { source: state.source || "unknown" });
      downloadParserDiagnostic();
    });
  }

  /* ---------------- step 4: results ---------------- */
  function runAudit() {
    state.restoredReport = false;
    // A new or re-run audit must prove its own fingerprint before any prior
    // in-memory unlock can expose paid details.
    state.fingerprint = null;
    // engine annotates txns in place; give it fresh shallow copies
    var txns = state.txns.map(function (t, i) {
      return { index: i, date: t.date, narration: t.narration, debit: t.debit, credit: t.credit, balance: t.balance };
    });
    state.ctx.overrides = state.ctx.overrides || {};
    // the statement's declared period widens month-coverage for cross-checks
    state.ctx.statementFrom = state.meta ? state.meta.periodFrom : null;
    state.ctx.statementTo = state.meta ? state.meta.periodTo : null;
    var audit = ENGINE.audit(txns, state.ctx);
    audit.health = REPORT.statementHealth(audit, {
      transactionCount: txns.length,
      duplicateRowsMerged: state.lastBuilt ? state.lastBuilt.duplicates : 0,
      excludedRowCount: state.problems ? state.problems.length : 0,
      hasBalance: state.integrity ? state.integrity.hasBalance : false,
      balanceRatio: state.integrity ? state.integrity.ratio : null,
      reconciliationFailed: !!(state.reconcile && state.reconcile.anyFail)
    });
    state.audit = audit;
    state.auditTxns = txns;

    /* Free, always: the verdict and the headline numbers. */
    $("#summary-cards").innerHTML = REPORT.renderSummary(audit);
    $("#health-score").innerHTML = REPORT.renderHealthScore(audit.health);
    $("#report-meta").innerHTML = REPORT.reportMeta(audit, state.ctx, {
      fileName: state.fileName, pageCount: state.pageCount, sheetCount: state.sheetCount
    });

    /* Paid: the evidence. Rendered locked-first, so paid HTML never briefly
     * exists in the page while we ask the server about a stored receipt. */
    applyGate();
    resolveUnlock();

    var summary = audit.summary || {};
    ANALYTICS.track("audit_completed", {
      source: state.source || "unknown",
      accountType: state.ctx.accountType,
      holderType: state.ctx.holderType,
      txnCount: summary.txnCount || txns.length,
      chargeCount: summary.chargeCount || 0,
      refundDue: summary.refundDue || 0,
      underReview: summary.underReview || 0,
      violationCount: summary.counts ? summary.counts.violation || 0 : 0,
      reviewCount: summary.counts ? summary.counts.review || 0 : 0
    });

    var recoveryButton = document.getElementById("btn-recovery-pack");
    if (recoveryButton) {
      recoveryButton.addEventListener("click", function () {
        ANALYTICS.track("recovery_pack_request", {
          source: state.source || "unknown",
          refundDue: summary.refundDue || 0,
          underReview: summary.underReview || 0,
          reviewCount: summary.counts ? summary.counts.review || 0 : 0
        });
        ANALYTICS.flush(true);
      });
    }

    var ic = state.integrity;
    var banner = $("#integrity-banner");
    if (ic && ic.hasBalance && ic.checked >= 5 && ic.ratio >= 0.98) {
      banner.className = "integrity ok";
      banner.innerHTML = "<strong>Balance integrity verified:</strong> the running balance reconciles on " + ic.matched + " of " + ic.checked + " rows — the rows that were read are internally consistent.";
    } else if (ic && ic.hasBalance && ic.checked >= 5) {
      banner.className = "integrity warn";
      banner.innerHTML = "⚠ <strong>Partial integrity:</strong> the running balance reconciled on " + Math.round(ic.ratio * 100) + "% of rows. Treat results as indicative and double-check flagged items against the original statement.";
    } else if (ic && ic.hasBalance) {
      banner.className = "integrity warn";
      banner.innerHTML = "⚠ Statement parsed; too few rows for a full balance reconciliation.";
    } else {
      banner.className = "integrity warn";
      banner.innerHTML = "⚠ <strong>Unverified parse:</strong> this statement has no balance column, so the read could not be independently confirmed. Double-check flagged items against the original statement.";
    }
    if (state.reconcile && state.reconcile.allOk) {
      banner.innerHTML += " The parsed rows also reconcile exactly with the statement's own summary totals.";
      if (banner.className === "integrity warn" && (!ic || !ic.hasBalance)) banner.className = "integrity ok";
    }
    if ((state.reconcile && state.reconcile.anyFail) || (state.problems && state.problems.length)) {
      banner.className = "integrity warn";
      banner.innerHTML += " Some summary checks or excluded rows need review. Check the scanned details against your statement.";
    }
    var needsReview = banner.classList.contains("warn");
    $("#report-read-status").textContent = needsReview ? "Read confidence needs review" : "Read checks complete";
    $("#report-read-status").className = "scan-status " + (needsReview ? "warn" : "ok");
    $("#report-read-details").open = needsReview;
  }

  /* ---------------- paywall gate ----------------
   * Locked sections are left empty rather than hidden: the detail of the
   * report is simply not in the document until an unlock is confirmed. */
  function applyGate() {
    var audit = state.audit;
    if (!audit) return;
    var locked = !(PAYWALL && PAYWALL.isUnlocked(state.fingerprint));
    $("#paid-analysis").hidden = locked;
    if (locked) $("#paid-analysis").open = false;
    var txns = state.auditTxns || [];

    var tabs = $(".tabs"), chips = $(".filter-chips"), paneAll = $("#pane-all");
    var letterBtn = $("#btn-letter"), csvBtn = $("#btn-export-csv"), printBtn = $("#btn-print");

    if (locked) {
      $("#aggregates").innerHTML = "";
      $("#findings-list").innerHTML = "";
      $("#all-txns").innerHTML = "";
      $("#complaint-tracker").hidden = true;
      $("#complaint-tracker").innerHTML = "";
      if (tabs) tabs.style.display = "none";
      if (chips) chips.style.display = "none";
      if (paneAll) paneAll.style.display = "none";
      [letterBtn, csvBtn, printBtn].forEach(function (b) { if (b) b.style.display = "none"; });

      if (PAYWALL) {
        PAYWALL.mount($("#monetization-panel"), audit, state.ctx, state.fingerprint, function () {
          applyGate();
          $("#monetization-panel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      return;
    }

    var savedLocally = saveCurrentPaidReport();
    $("#monetization-panel").innerHTML = '<div class="unlock-receipt no-print">' + (state.restoredReport ? "Saved paid report reopened" : "Full report unlocked") + '</div>' +
      '<p class="saved-report-note no-print">' + (state.restoredReport
        ? "This copy is stored only in this browser."
        : savedLocally ? "Paid findings saved in this browser for your next visit." : "This browser could not save a return copy. Download or print the report before leaving.") + '</p>';
    $("#aggregates").innerHTML = REPORT.renderAggregates(audit);
    renderFindingsPane();
    $("#all-txns").innerHTML = state.restoredReport ? "" : REPORT.renderAllTxns(txns, audit, RULES.typeNames);
    var allTab = $('.tab-btn[data-tab="all"]');
    if (allTab) allTab.style.display = state.restoredReport ? "none" : "";
    if (tabs) tabs.style.display = "";
    if (chips) chips.style.display = "";
    if (paneAll && state.restoredReport) paneAll.style.display = "none";
    if (letterBtn) letterBtn.style.display = audit.summary.refundDue > 0 ? "" : "none";
    if (csvBtn) csvBtn.style.display = "";
    if (printBtn) printBtn.style.display = "";
    renderComplaintTracker();
  }

  /* Fingerprint this statement, then ask the server whether a receipt we
   * already hold still covers it. Failure here leaves the report locked. */
  function resolveUnlock() {
    if (!PAYWALL) return;
    PAYWALL.fingerprint(state.audit).then(function (fp) {
      state.fingerprint = fp;
      if (PAYWALL.isUnlocked(fp)) { applyGate(); return; }
      return PAYWALL.restore(fp).then(function (ok) { if (ok) applyGate(); else applyGate(); });
    }).catch(function () { /* stay locked */ });
  }

  function renderFindingsPane() {
    $("#findings-list").innerHTML = REPORT.renderFindings(state.audit, state.filter);
    $all(".filter-chip").forEach(function (ch) {
      ch.classList.toggle("on", ch.getAttribute("data-filter") === state.filter);
      var v = ch.getAttribute("data-filter");
      var n = v === "all" ? state.audit.findings.length : (state.audit.summary.counts[v] || 0);
      ch.querySelector(".chip-count").textContent = n;
    });
  }

  function showDemandLetter(returnId) {
    var letter = REPORT.demandLetter(state.audit, state.ctx);
    if (!letter) return;
    saveComplaint({ letterGeneratedAt: new Date().toISOString() });
    state.letterFileName = "refund_demand_letter.docx";
    state.letterReturnId = returnId || "btn-letter";
    $("#letter-modal-title").textContent = "Refund demand letter";
    $("#letter-help-text").textContent = "Fill in the bracketed details, then send the letter to your bank. Keep proof that the bank received it.";
    $("#letter-text").value = letter;
    openLetterModal();
  }

  function showCbnLetter() {
    var journey = complaintJourney();
    var progress = COMPLAINTS.status(journey);
    if (!progress.due || progress.resolved) return;
    var letter = COMPLAINTS.escalationLetter(state.audit, state.ctx, journey);
    if (!letter) return;
    saveComplaint({ escalationGeneratedAt: new Date().toISOString() });
    state.letterFileName = "cbn_escalation_letter.docx";
    state.letterReturnId = "btn-cbn-letter";
    $("#letter-modal-title").textContent = "CBN escalation letter";
    $("#letter-help-text").textContent = "Fill in the bracketed details. Attach proof of the bank complaint, the bank response if any, the statement and the audit schedule.";
    $("#letter-text").value = letter;
    openLetterModal();
  }

  function wireResults() {
    $all(".filter-chip").forEach(function (ch) {
      ch.addEventListener("click", function () {
        state.filter = ch.getAttribute("data-filter");
        renderFindingsPane();
      });
    });

    $all(".tab-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        $all(".tab-btn").forEach(function (x) { x.classList.toggle("on", x === b); });
        $("#pane-findings").style.display = b.getAttribute("data-tab") === "findings" ? "" : "none";
        $("#pane-all").style.display = b.getAttribute("data-tab") === "all" ? "" : "none";
      });
    });

    // reclassify dropdowns get their (long) option list only when focused
    var TYPE_OPTIONS = REPORT.typeOptionsHTML(RULES.typeNames);
    $("#all-txns").addEventListener("focusin", function (e) {
      var s = e.target;
      if (!s.classList || !s.classList.contains("reclass") || s.dataset.filled) return;
      s.dataset.filled = "1";
      s.innerHTML = s.options[0].outerHTML +
        (s.dataset.hastype === "1" ? '<option value="ignore">Not a charge (ignore)</option>' : "") +
        TYPE_OPTIONS;
    });

    // manual reclassification (event delegation)
    $("#all-txns").addEventListener("change", function (e) {
      if (!e.target.classList.contains("reclass")) return;
      var idx = +e.target.getAttribute("data-idx");
      var val = e.target.value;
      if (val === "") return;
      state.ctx.overrides[idx] = val;
      runAudit();
      // stay on the All-transactions tab
      $all(".tab-btn").forEach(function (x) { x.classList.toggle("on", x.getAttribute("data-tab") === "all"); });
      $("#pane-findings").style.display = "none";
      $("#pane-all").style.display = "";
    });

    $("#btn-export-csv").addEventListener("click", function () {
      ANALYTICS.track("export_csv", { source: state.source || "unknown" });
      download("audit_findings.csv", REPORT.findingsCSV(state.audit), "text/csv");
    });
    $("#btn-print").addEventListener("click", function () { ANALYTICS.track("print_report", { source: state.source || "unknown" }); window.print(); });

    $("#btn-letter").addEventListener("click", function () {
      ANALYTICS.track("copy_demand_letter", { source: state.source || "unknown" });
      showDemandLetter("btn-letter");
    });
    $("#btn-letter-close").addEventListener("click", closeLetterModal);
    $("#letter-modal").addEventListener("keydown", trapLetterModalFocus);
    $("#btn-letter-copy").addEventListener("click", function () {
      ANALYTICS.track("copy_demand_letter", { source: state.source || "unknown" });
      var ta = $("#letter-text");
      ta.select();
      try { navigator.clipboard.writeText(ta.value); } catch (e) { document.execCommand("copy"); }
      $("#btn-letter-copy").textContent = "Copied";
      setTimeout(function () { $("#btn-letter-copy").textContent = "Copy to clipboard"; }, 1500);
    });
    $("#btn-letter-download").addEventListener("click", function () {
      var btn = $("#btn-letter-download"), errorEl = $("#letter-download-error");
      btn.disabled = true;
      btn.textContent = "Preparing Word document…";
      errorEl.hidden = true;
      window.BSA_WORD_EXPORT.toBlob($("#letter-text").value, $("#letter-modal-title").textContent).then(function (blob) {
        download(state.letterFileName, blob);
      }).catch(function () {
        errorEl.textContent = "Could not create the Word document. Please try again, or copy the letter into Word.";
        errorEl.hidden = false;
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = "Download Word (.docx)";
      });
    });

    $("#complaint-tracker").addEventListener("click", function (event) {
      var target = event.target;
      if (target.id === "btn-complaint-letter") {
        ANALYTICS.track("complaint_letter_generated", {});
        showDemandLetter("btn-complaint-letter");
      }
      if (target.id === "btn-save-complaint-date") {
        var input = $("#complaint-date"), status = $("#complaint-date-status");
        if (!input.value) { status.textContent = "Choose the date the bank received the complaint."; input.focus(); return; }
        if (input.value > COMPLAINTS.todayIso()) { status.textContent = "The complaint date cannot be in the future."; input.focus(); return; }
        saveComplaint({ complaintDate: input.value, submittedAt: new Date().toISOString() });
        $("#complaint-date-status").textContent = "Submission date saved.";
        ANALYTICS.track("complaint_submitted_recorded", {});
      }
      if (target.id === "btn-complaint-calendar") {
        var journey = complaintJourney(), calendar = COMPLAINTS.calendarEvent(journey);
        if (!calendar) return;
        download("checkam_bank_complaint_reminder.ics", calendar, "text/calendar");
        saveComplaint({ reminderDownloadedAt: new Date().toISOString() });
        ANALYTICS.track("complaint_reminder_downloaded", {});
      }
      if (target.id === "btn-cbn-letter") {
        ANALYTICS.track("cbn_escalation_letter_generated", {});
        showCbnLetter();
      }
      if (target.id === "btn-save-bank-response") {
        var date = $("#bank-response-date").value;
        var responseStatus = $("#bank-response-status").value;
        var responseMessage = $("#bank-response-save-status");
        if (date && date > COMPLAINTS.todayIso()) { responseMessage.textContent = "The response date cannot be in the future."; return; }
        if (!date && !responseStatus && !$("#bank-response-reference").value.trim() && !$("#bank-response-notes").value.trim()) {
          responseMessage.textContent = "Add at least one response detail before saving."; return;
        }
        saveComplaint({ response: {
          date: date,
          status: responseStatus,
          reference: $("#bank-response-reference").value,
          notes: $("#bank-response-notes").value
        } });
        $("#bank-response-save-status").textContent = "Bank response saved in this browser.";
        ANALYTICS.track("bank_response_saved", { status: responseStatus || "not_set" });
      }
    });

    $("#btn-restart").addEventListener("click", function () {
      state.rows = null; state.txns = null; state.audit = null; state.ctx.overrides = {};
      gotoStep("step-upload");
    });
    $("#btn-results-back").addEventListener("click", goBack);
  }



  function downloadParserDiagnostic() {
    if (!state.rows) return;
    var headerRow = +$("#mapping-table").dataset.headerRow || 0;
    var mr = currentMap();
    var built = state.lastBuilt || { txns: [], problems: [] };
    var diagnostic = PARSER.anonymizedLayoutDiagnostic(state.rows, headerRow, mr.map, built, state.integrity, state.reconcile, {
      source: state.source,
      fileName: state.fileName,
      pageCount: state.pageCount,
      sheetCount: state.sheetCount
    });
    diagnostic.appBuild = APP_BUILD;
    diagnostic.generatedAt = new Date().toISOString();
    download("bank_charge_auditor_parser_diagnostic.json", JSON.stringify(diagnostic, null, 2), "application/json");
  }

  function openLetterModal() {
    var modal = $("#letter-modal");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(function () { $("#letter-text").focus(); }, 0);
  }

  function closeLetterModal() {
    var modal = $("#letter-modal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    var btn = $("#" + state.letterReturnId) || $("#btn-letter");
    if (btn && btn.style.display !== "none") btn.focus();
  }

  function trapLetterModalFocus(e) {
    if (e.key === "Escape") { closeLetterModal(); return; }
    if (e.key !== "Tab") return;
    var modal = $("#letter-modal");
    if (!modal.classList.contains("open")) return;
    var focusables = Array.prototype.slice.call(modal.querySelectorAll("textarea, button, summary, [href], input, select, [tabindex]:not([tabindex='-1'])"))
      .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function download(name, content, mime) {
    // Preserve binary downloads; the UTF-8 BOM is only for existing text exports.
    var blob = content instanceof Blob ? content : new Blob(["﻿" + content], { type: mime + ";charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------------- boot ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    // pdf.js fake-worker setup so the app works from file:// with no server
    if (window.pdfjsLib) {
      try { pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; } catch (e) { /* fake worker fallback */ }
    }
    var badge = document.getElementById("build-badge");
    if (badge) badge.textContent = "build " + APP_BUILD;
    ANALYTICS.track("app_load", { build: APP_BUILD, theme: getTheme() });
    console.log("Bank Charge Auditor — build " + APP_BUILD);
    wireNavigation(); wireTheme(); wirePwa(); wireContext(); wireUpload(); wireMapping(); wireResults();
    refreshSavedReportsButton();
    refreshComplaintReminder();
    gotoStep("step-context");
    // Print all available evidence, then restore the reader's disclosure choices.
    var printDetails = null;
    window.addEventListener("beforeprint", function () {
      if (printDetails) return;
      printDetails = $all("#report-root details, footer details").map(function (d) { return { node: d, open: d.open }; });
      printDetails.forEach(function (item) { item.node.open = true; });
    });
    window.addEventListener("afterprint", function () {
      (printDetails || []).forEach(function (item) { item.node.open = item.open; });
      printDetails = null;
    });
  });
})();
