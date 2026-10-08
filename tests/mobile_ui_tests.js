"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");
module.exports = function (check) {
  var app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
  var html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../css/app.css"), "utf8");
  var nodes = {};
  ["scan-details", "btn-scan-details", "scan-heading", "scan-status", "acct-hint", "diagnostic-box", "mapping-stats", "btn-run-audit", "mapping-problems", "mapping-table", "reconcile-box"].forEach(function (id) {
    nodes["#" + id] = { hidden: false, style: { display: "none" }, dataset: { headerRow: "0" }, setAttribute: function (k, v) { this[k] = v; } };
  });
  var data = { map: { date: 0, narration: 1, debit: 2 }, txns: [{ date: new Date() }], problems: [], ratio: 1, rec: null };
  var ctx = { $: function (id) { return nodes[id]; }, state: { rows: [["Date"], ["2026-01-01"]], meta: null },
    currentMap: function () { return { map: data.map, dup: data.dup }; }, refreshRoleTags: function () {},
    REPORT: { fmtDate: function () { return "1 Jan 2026"; }, fmtN: function (n) { return "₦" + n; }, esc: String },
    PARSER: { buildTransactions: function () { return { txns: data.txns, problems: data.problems, openingBalance: null }; },
      integrityCheck: function () { return { hasBalance: data.hasBalance !== false, checked: data.checked === undefined ? 6 : data.checked, matched: 6, ratio: data.ratio }; },
      reconcileWithMeta: function () { return data.rec; },
      locateDifferences: function () { return { balanceGaps: [], excludedRows: [], summaryDifferences: [], hasDifferences: false }; } } };
  vm.runInNewContext(app.slice(app.indexOf("  function setScanDetails("), app.indexOf("  function wireMapping(")), ctx);
  ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: clean scan is collapsed with audit enabled", nodes['#scan-details'].hidden && !nodes['#btn-run-audit'].disabled && nodes['#btn-scan-details']['aria-expanded'] === 'false');
  var locatorHtml = ctx.renderDifferenceLocator({
    hasDifferences: true,
    balanceGaps: [{ before: { page: 3, row: 20, date: new Date() }, after: { page: 4, row: 21, date: new Date() }, netAmount: 100, neededSide: 'debit', pageBoundary: true, expectedBalance: 900, actualBalance: 800, nextRowsContinue: true, summaryMatch: { interpretation: 'The statement debit total points to the same amount.' } }],
    excludedRows: [{ page: 4, row: 22, issue: 'Unreadable amount' }],
    summaryDifferences: [{ label: 'Total debits', difference: 100, isCount: false, higherSide: 'parsed' }]
  });
  check("mobile: difference locator shows page, net movement, higher side and matching evidence", locatorHtml.includes('page 3') && locatorHtml.includes('page 4') && locatorHtml.includes('₦100 net debit needed') && locatorHtml.includes('parsed result is higher than the PDF summary') && locatorHtml.includes('Strong match:'));
  ctx.setScanDetails(true);
  check("mobile: disclosure toggle exposes details and accessible state", !nodes['#scan-details'].hidden && nodes['#btn-scan-details']['aria-expanded'] === 'true' && nodes['#btn-scan-details'].textContent === 'Hide scanned details');
  data.dup = true; ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: duplicate mapping auto-opens and blocks audit", !nodes['#scan-details'].hidden && nodes['#btn-run-audit'].disabled && ctx.state.integrity === null);
  data.dup = false; data.map = {}; ctx.refreshMappingStats();
  check("mobile: missing required columns stay blocked", nodes['#btn-run-audit'].disabled && nodes['#scan-status'].textContent === 'Correct column mapping.');
  data.map = {date:0,narration:1,debit:2}; data.txns = []; ctx.refreshMappingStats();
  check("mobile: unreadable scan cannot run audit", nodes['#btn-run-audit'].disabled);
  data.txns = [{ date: new Date() }]; data.ratio = 0.5; ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: bad balance checks open details and block audit", !nodes['#scan-details'].hidden && nodes['#btn-run-audit'].disabled);
  data.ratio = 0.95; ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: partial scans show warning without changing existing gate", !nodes['#scan-details'].hidden && !nodes['#btn-run-audit'].disabled && nodes['#scan-status'].className.includes('warn'));
  data.ratio = 1; data.rec = {allOk:false,anyFail:true,checks:[]}; ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: checksum mismatch is never hidden", !nodes['#scan-details'].hidden && nodes['#scan-status'].className.includes('warn'));
  data.rec = null; nodes['#acct-hint'].style.display = ''; ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: account mismatch opens scanned details", !nodes['#scan-details'].hidden);
  nodes['#acct-hint'].style.display = 'none'; data.checked = 2; ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: too few balance rows require visible review", !nodes['#scan-details'].hidden && nodes['#scan-status'].className.includes('warn'));
  data.checked = 6; data.hasBalance = false; ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: missing balance column requires visible review", !nodes['#scan-details'].hidden && !nodes['#btn-run-audit'].disabled);
  data.hasBalance = true; data.problems = [{row:2,issue:'Unreadable row',data:'Example'}]; ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: excluded rows require visible review", !nodes['#scan-details'].hidden && nodes['#mapping-problems'].innerHTML.includes('Unreadable row'));
  nodes['#reconcile-box'].innerHTML = 'Old checksum'; data.dup = true; ctx.refreshMappingStats();
  check("mobile: invalid mapping clears stale checksum", nodes['#reconcile-box'].innerHTML === '' && nodes['#reconcile-box'].style.display === 'none');
  check("mobile: scan controls stay outside collapsed content", html.indexOf('id="btn-run-audit"') < html.indexOf('id="scan-details"') && html.includes('aria-controls="scan-details"'));
  check("mobile: expanded scan details do not repeat the review heading", !html.includes("Review scanned statement") && html.includes(">View scanned details</button>"));
  check("mobile: paid analysis remains gated and letter focus includes summaries", app.includes('$("#paid-analysis").hidden = locked') && app.includes('textarea, button, summary,'));
  check("ux: keyboard users can skip directly to the main workflow", html.includes('class="skip-link" href="#main-content"') && html.includes('<main id="main-content" tabindex="-1">'));
  check("ux: supplied wordmark scales without distortion on mobile", html.includes('class="brand-logo"') && html.includes('width="2172" height="724"') && css.includes('width: min(228px, 70vw);') && css.includes('height: auto;'));
  check("ux: mobile progress announces the current step", html.includes('id="mobile-step-count"') && html.includes('id="mobile-step-name"') && app.includes('d.setAttribute("aria-current", "step")') && app.includes('info.index * 25'));
  check("ux: theme control uses scalable icons and a dynamic accessible name", html.includes('class="icon-moon"') && html.includes('class="icon-sun"') && app.includes('btn.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode")'));
  check("ux: core landing and upload controls avoid platform-dependent emoji icons", html.includes('class="ui-icon"') && html.includes('<div class="dz-icon"><svg') && !/[🔒⚖📄⛔❓ℹ⚠️]/u.test(html));
  check("ux: mobile layout respects safe areas and accessible tap sizes", css.includes('env(safe-area-inset-top)') && css.includes('env(safe-area-inset-bottom)') && css.includes('.btn { min-height: 48px; }'));
  check("landing audience: all eight customer groups and their messages are present", ["SME owners", "Accountants", "Churches &amp; mosques", "Schools", "Cooperatives", "NGOs", "Political campaign accounts", "POS operators"].every(function (group) { return html.includes(group); }) && html.includes("Know how much your bank is charging your business.") && html.includes("Track repeated bank and transfer charges."));
  check("landing audience: mobile uses one readable column and a full-width action", css.includes('.audience-grid { grid-template-columns: minmax(0, 1fr);') && css.includes('.audience-cta { width: 100%; min-height: 52px;'));
  check("landing audience: its action opens the same account workflow", html.includes('id="btn-audience-start"') && app.includes('startWorkflow("audience_section")') && css.includes('body.workflow-open .audience-section { display: none; }'));
  check("ux: reduced motion and visible keyboard focus remain supported", css.includes('@media (prefers-reduced-motion: reduce)') && css.includes('outline: 3px solid var(--accent)'));
  check("landing scanner: anonymized statement artwork has intrinsic dimensions and an accessible caption", html.includes('class="statement-scanner" aria-labelledby="scanner-caption"') && html.includes('class="statement-art" width="320" height="400"') && html.includes('Your statement never leaves this device.'));
  check("landing scanner: one isolated scan beam and one status pulse communicate local processing", html.includes('class="statement-scan-beam"') && html.includes('class="scanner-status-dot"') && css.includes('@keyframes statement-scan') && css.includes('@keyframes scanner-status'));
  check("landing scanner: reduced-motion users receive a static scanner state", css.includes('.statement-scan-beam { animation: none !important;') && css.includes('.scanner-status-dot { animation: none !important;'));
  check("difference locator: critical evidence uses accessible disclosures and mobile tap targets", app.includes('function renderDifferenceLocator(result)') && app.includes('Locate read differences (') && css.includes('.difference-locator > summary') && css.includes('min-height: 48px;'));
  check("difference locator: balance success no longer claims the whole statement parsed correctly", !app.includes('the statement was parsed correctly') && app.includes('the rows that were read are internally consistent'));
  var handlers = {}, details = [{open:false},{open:true}];
  vm.runInNewContext(app.slice(app.indexOf('    var printDetails = null;'), app.lastIndexOf('  });')), {
    $all: function () { return details; }, window: { addEventListener: function (event, fn) { handlers[event] = fn; } }
  });
  handlers.beforeprint(); handlers.beforeprint();
  check("mobile: printing expands all report details", details.every(function (d) { return d.open; }));
  handlers.afterprint();
  check("mobile: printing restores previous disclosure states", !details[0].open && details[1].open);
};
