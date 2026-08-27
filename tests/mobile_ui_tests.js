"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");
module.exports = function (check) {
  var app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
  var html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  var nodes = {};
  ["scan-details", "btn-scan-details", "scan-heading", "scan-status", "acct-hint", "diagnostic-box", "mapping-stats", "btn-run-audit", "mapping-problems", "mapping-table", "reconcile-box"].forEach(function (id) {
    nodes["#" + id] = { hidden: false, style: { display: "none" }, dataset: { headerRow: "0" }, setAttribute: function (k, v) { this[k] = v; } };
  });
  var data = { map: { date: 0, narration: 1, debit: 2 }, txns: [{ date: new Date() }], problems: [], ratio: 1, rec: null };
  var ctx = { $: function (id) { return nodes[id]; }, state: { rows: [["Date"], ["2026-01-01"]], meta: null },
    currentMap: function () { return { map: data.map, dup: data.dup }; }, refreshRoleTags: function () {},
    REPORT: { fmtDate: function () { return "1 Jan 2026"; }, esc: String },
    PARSER: { buildTransactions: function () { return { txns: data.txns, problems: data.problems, openingBalance: null }; },
      integrityCheck: function () { return { hasBalance: data.hasBalance !== false, checked: data.checked === undefined ? 6 : data.checked, matched: 6, ratio: data.ratio }; },
      reconcileWithMeta: function () { return data.rec; } } };
  vm.runInNewContext(app.slice(app.indexOf("  function setScanDetails("), app.indexOf("  function wireMapping(")), ctx);
  ctx.setScanDetails(false); ctx.refreshMappingStats();
  check("mobile: clean scan is collapsed with audit enabled", nodes['#scan-details'].hidden && !nodes['#btn-run-audit'].disabled && nodes['#btn-scan-details']['aria-expanded'] === 'false');
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
  check("mobile: paid analysis remains gated and letter focus includes summaries", app.includes('$("#paid-analysis").hidden = locked') && app.includes('textarea, button, summary,'));
  var handlers = {}, details = [{open:false},{open:true}];
  vm.runInNewContext(app.slice(app.indexOf('    var printDetails = null;'), app.lastIndexOf('  });')), {
    $all: function () { return details; }, window: { addEventListener: function (event, fn) { handlers[event] = fn; } }
  });
  handlers.beforeprint(); handlers.beforeprint();
  check("mobile: printing expands all report details", details.every(function (d) { return d.open; }));
  handlers.afterprint();
  check("mobile: printing restores previous disclosure states", !details[0].open && details[1].open);
};
