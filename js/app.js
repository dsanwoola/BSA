/* =========================================================================
 * APP CONTROLLER — wires the four steps together:
 *   1. account context  →  2. upload  →  3. confirm mapping  →  4. results
 * ========================================================================= */

(function () {
  "use strict";

  var APP_BUILD = 42; // shown in the header so stale cached code is obvious

  var PARSER = window.CBN_PARSER, ENGINE = window.CBN_ENGINE,
      REPORT = window.CBN_REPORT, RULES = window.CBN_RULES;

  var state = {
    ctx: { accountType: "current", holderType: "individual", salaryAccount: false, overrides: {} },
    rows: null, source: null, fileName: null,
    txns: null, problems: null, integrity: null,
    audit: null, filter: "all",
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

  function gotoStep(id) {
    state.currentStep = id;
    $all(".step-section").forEach(function (s) { s.classList.toggle("active", s.id === id); });
    $all(".step-dot").forEach(function (d) {
      d.classList.toggle("on", d.getAttribute("data-step") === id);
    });
    updateGlobalBackButton(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
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
    btn.setAttribute("title", isLight ? "Switch to dark mode" : "Switch to light mode");
    var icon = btn.querySelector(".theme-icon");
    var label = btn.querySelector(".theme-label");
    if (icon) icon.textContent = isLight ? "☀️" : "🌙";
    if (label) label.textContent = isLight ? "Light" : "Dark";
  }

  function wireTheme() {
    updateThemeToggle(getTheme());
    var btn = $("#theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      setTheme(getTheme() === "light" ? "dark" : "light");
    });
  }

  /* ---------------- step 1: context ---------------- */
  function wireContext() {
    $all('input[name="acctType"], input[name="holderType"]').forEach(function (r) {
      r.addEventListener("change", function () {
        state.ctx.accountType = ($('input[name="acctType"]:checked') || {}).value || "current";
        state.ctx.holderType = ($('input[name="holderType"]:checked') || {}).value || "individual";
      });
    });
    $("#salaryAccount").addEventListener("change", function (e) {
      state.ctx.salaryAccount = e.target.checked;
    });
    $("#btn-context-next").addEventListener("click", function () { gotoStep("step-upload"); });
  }

  /* ---------------- step 2: upload ---------------- */
  function wireUpload() {
    var dz = $("#dropzone"), fi = $("#file-input");
    dz.addEventListener("click", function () { fi.click(); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); }
    });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
    dz.addEventListener("drop", function (e) {
      e.preventDefault(); dz.classList.remove("over");
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fi.addEventListener("change", function () { if (fi.files.length) handleFile(fi.files[0]); fi.value = ""; });
    $("#btn-demo").addEventListener("click", function () {
      state.rows = PARSER.parseCSVText(DEMO_CSV);
      state.source = "demo"; state.fileName = "demo_statement.csv";
      state.pageCount = null; state.sheetCount = null;
      buildMappingUI();
      gotoStep("step-mapping");
    });
    $("#btn-upload-back").addEventListener("click", goBack);
  }

  function handleFile(file, opts) {
    opts = opts || {};
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
    var headerRow = auto ? (det ? det.headerRow : 0) : headerRowOverride;
    var roles = auto ? det : PARSER.detectColumnsAt(rows, headerRow);

    // everything ABOVE the chosen header row is the hero/summary section
    state.meta = PARSER.extractStatementMeta(rows, headerRow);
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
      return '<div class="role-row"><label>' + rf.name + (rf.req ? " <em>required</em>" : "") + "</label>" +
        '<select class="role-pick" data-role="' + rf.key + '">' + opts + "</select></div>";
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

  function refreshMappingStats() {
    var diagBox = $("#diagnostic-box");
    if (diagBox) diagBox.style.display = state.rows ? "" : "none";
    var mr = currentMap();
    refreshRoleTags(mr.map);
    var stat = $("#mapping-stats"), btn = $("#btn-run-audit");
    var problemsEl = $("#mapping-problems");
    problemsEl.innerHTML = "";
    state.txns = null;

    if (mr.dup) { stat.className = "map-stat bad"; stat.textContent = "Two roles point to the same column label — each column can only play one role."; btn.disabled = true; return; }
    var m = mr.map;
    if (m.date === undefined || m.narration === undefined || (m.debit === undefined && m.amount === undefined)) {
      stat.className = "map-stat bad";
      stat.textContent = "Required: a Date column, a Narration column, and a Debit (or signed Amount) column.";
      btn.disabled = true; return;
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
      btn.disabled = true; return;
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
      if (ic.ratio >= 0.98) msg += " Balance arithmetic verified on " + ic.matched + "/" + ic.checked + " rows (" + pct + "%) — the statement was parsed correctly.";
      else if (ic.ratio >= 0.9) { msg += " Balance check passed on only " + pct + "% of rows — a few rows may be misread; review the findings carefully."; cls = "warn"; }
      else { msg += " Balance check FAILED (" + pct + "% consistent). The column mapping is probably wrong — fix it before auditing. Auditing a misread statement produces wrong results."; cls = "bad"; }
    } else if (ic.hasBalance) {
      msg += " Balance column found, but too few rows to fully verify the parse arithmetic.";
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
    var recBox = $("#reconcile-box");
    if (rec) {
      recBox.style.display = "";
      recBox.innerHTML = '<div class="meta-title">' + (rec.allOk ? "✅" : "⚠️") + " Checksum against the statement's own summary figures</div>" +
        '<ul class="rec-list">' + rec.checks.map(function (ch) {
          return '<li class="' + (ch.ok ? "ok" : "fail") + '">' + (ch.ok ? "✓" : "✗") + " <strong>" + REPORT.esc(ch.label) + ":</strong> " + REPORT.esc(ch.detail) + "</li>";
        }).join("") + "</ul>";
      if (rec.anyFail) {
        if (rec.summaryBoundaryOnly && ic.hasBalance && ic.ratio >= 0.98) {
          msg += " The transaction rows, totals and closing balance reconcile; only the statement's opening/closing summary arithmetic differs, so this looks like a small inconsistency in the bank's own summary rather than a misread table.";
        } else {
          msg += " The statement's own summary figures do not match the parsed rows — rows may be missing or misread (or the file may be missing pages). Fix this before trusting the audit.";
          if (cls === "ok") cls = "warn";
        }
      } else {
        msg += " The parsed rows also add up exactly to the statement's own summary totals — the read is provably complete.";
      }
    } else { recBox.style.display = "none"; recBox.innerHTML = ""; }

    stat.className = "map-stat " + cls;
    stat.textContent = msg;
    btn.disabled = (cls === "bad");
  }

  function wireMapping() {
    $("#btn-run-audit").addEventListener("click", function () {
      if (!state.txns || !state.txns.length) return;
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
      downloadParserDiagnostic();
    });
  }

  /* ---------------- step 4: results ---------------- */
  function runAudit() {
    // engine annotates txns in place; give it fresh shallow copies
    var txns = state.txns.map(function (t, i) {
      return { index: i, date: t.date, narration: t.narration, debit: t.debit, credit: t.credit, balance: t.balance };
    });
    state.ctx.overrides = state.ctx.overrides || {};
    // the statement's declared period widens month-coverage for cross-checks
    state.ctx.statementFrom = state.meta ? state.meta.periodFrom : null;
    state.ctx.statementTo = state.meta ? state.meta.periodTo : null;
    var audit = ENGINE.audit(txns, state.ctx);
    state.audit = audit;
    state.auditTxns = txns;

    $("#summary-cards").innerHTML = REPORT.renderSummary(audit);
    $("#report-meta").innerHTML = REPORT.reportMeta(audit, state.ctx, {
      fileName: state.fileName, pageCount: state.pageCount, sheetCount: state.sheetCount
    });
    $("#aggregates").innerHTML = REPORT.renderAggregates(audit);
    renderFindingsPane();
    $("#all-txns").innerHTML = REPORT.renderAllTxns(txns, audit, RULES.typeNames);

    var anyViolation = audit.summary.refundDue > 0;
    $("#btn-letter").style.display = anyViolation ? "" : "none";

    var ic = state.integrity;
    var banner = $("#integrity-banner");
    if (ic && ic.hasBalance && ic.checked >= 5 && ic.ratio >= 0.98) {
      banner.className = "integrity ok";
      banner.innerHTML = "✓ <strong>Statement integrity verified:</strong> the running balance reconciles on " + ic.matched + " of " + ic.checked + " rows — these results are computed from a provably correct read of your statement.";
    } else if (ic && ic.hasBalance && ic.checked >= 5) {
      banner.className = "integrity warn";
      banner.innerHTML = "⚠ <strong>Partial integrity:</strong> the running balance reconciled on " + Math.round(ic.ratio * 100) + "% of rows. Treat results as indicative and double-check flagged items against the original statement.";
    } else if (ic && ic.hasBalance) {
      banner.className = "integrity ok";
      banner.innerHTML = "✓ Statement parsed; too few rows for a full balance reconciliation.";
    } else {
      banner.className = "integrity warn";
      banner.innerHTML = "⚠ <strong>Unverified parse:</strong> this statement has no balance column, so the read could not be independently confirmed. Double-check flagged items against the original statement.";
    }
    if (state.reconcile && state.reconcile.allOk) {
      banner.innerHTML += " The parsed rows also reconcile exactly with the statement's own summary totals.";
      if (banner.className === "integrity warn" && (!ic || !ic.hasBalance)) banner.className = "integrity ok";
    }
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
      download("audit_findings.csv", REPORT.findingsCSV(state.audit), "text/csv");
    });
    $("#btn-print").addEventListener("click", function () { window.print(); });

    $("#btn-letter").addEventListener("click", function () {
      var letter = REPORT.demandLetter(state.audit, state.ctx);
      if (!letter) return;
      $("#letter-text").value = letter;
      openLetterModal();
    });
    $("#btn-letter-close").addEventListener("click", closeLetterModal);
    $("#letter-modal").addEventListener("keydown", trapLetterModalFocus);
    $("#btn-letter-copy").addEventListener("click", function () {
      var ta = $("#letter-text");
      ta.select();
      try { navigator.clipboard.writeText(ta.value); } catch (e) { document.execCommand("copy"); }
      $("#btn-letter-copy").textContent = "Copied ✓";
      setTimeout(function () { $("#btn-letter-copy").textContent = "Copy to clipboard"; }, 1500);
    });
    $("#btn-letter-download").addEventListener("click", function () {
      download("refund_demand_letter.txt", $("#letter-text").value, "text/plain");
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
    var btn = $("#btn-letter");
    if (btn && btn.style.display !== "none") btn.focus();
  }

  function trapLetterModalFocus(e) {
    if (e.key === "Escape") { closeLetterModal(); return; }
    if (e.key !== "Tab") return;
    var modal = $("#letter-modal");
    if (!modal.classList.contains("open")) return;
    var focusables = Array.prototype.slice.call(modal.querySelectorAll("textarea, button, [href], input, select, [tabindex]:not([tabindex='-1'])"))
      .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function download(name, content, mime) {
    var blob = new Blob(["﻿" + content], { type: mime + ";charset=utf-8" });
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
    console.log("Bank Charge Auditor — build " + APP_BUILD);

    wireNavigation(); wireTheme(); wireContext(); wireUpload(); wireMapping(); wireResults();
    gotoStep("step-context");
    // open every finding before printing so the full evidence appears on paper
    window.addEventListener("beforeprint", function () {
      $all("details.finding").forEach(function (d) { d.setAttribute("open", ""); });
    });
  });
})();
