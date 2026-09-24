"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");

module.exports = function (check) {
  var BANKS = require("../js/bank-profiles.js");
  var app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
  var html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  var names = BANKS.list().map(function (p) { return p.name; });
  var sorted = names.slice().sort(function (a, b) {
    a = a.toUpperCase(); b = b.toUpperCase();
    return a < b ? -1 : a > b ? 1 : 0;
  });
  check("bank picker: profile API returns every bank alphabetically", names.join("|") === sorted.join("|") && names.length === BANKS.order.length);

  var nodes = {
    "#bank-profile": {innerHTML:"",value:""},
    "#bank-search-status": {textContent:""},
    "#bank-search-results": {innerHTML:"",hidden:true},
    "#bank-search": {attributes:{},value:"",setAttribute:function (name, value) { this.attributes[name] = value; }},
    "#bank-profile-note": {textContent:""}
  };
  var context = {
    BANKS:BANKS, REPORT:{esc:function (s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }},
    ANALYTICS:{track:function () {}}, state:{ctx:{bankId:"other"}},
    $:function (id) { return nodes[id] || null; }
  };
  vm.runInNewContext(app.slice(app.indexOf("  function populateBankProfiles("), app.indexOf("  /* ---------------- step 2")), context);
  context.populateBankProfiles();
  var values = Array.from(nodes["#bank-profile"].innerHTML.matchAll(/<option value="([^"]+)"/g), function (m) { return m[1]; });
  check("bank picker: rendered full list follows alphabetical API order", values.join("|") === BANKS.list().map(function (p) { return p.id; }).join("|"));
  check("bank picker: initial status explains alphabetical list", /banks listed alphabetically/.test(nodes["#bank-search-status"].textContent));

  context.renderBankOptions("GT");
  check("bank picker: suggestions wait for three characters", nodes["#bank-search-results"].hidden && nodes["#bank-search-results"].innerHTML === "" && nodes["#bank-search-status"].textContent === "Type 1 more letter to see matches");

  context.renderBankOptions("GTB");
  check("bank picker: aliases reveal the corresponding bank immediately", !nodes["#bank-search-results"].hidden && nodes["#bank-search-results"].innerHTML.includes('data-bank-id="gtbank"') && !nodes["#bank-search-results"].innerHTML.includes('data-bank-id="zenith"') && nodes["#bank-search-status"].textContent === "1 bank found");
  check("bank picker: suggestions never silently change the selected profile", context.state.ctx.bankId === "other" && /value="other" selected/.test(nodes["#bank-profile"].innerHTML));
  check("bank picker: the alphabetical selector remains complete while searching", (nodes["#bank-profile"].innerHTML.match(/<option /g) || []).length === BANKS.list().length);

  context.renderBankOptions("Fir");
  check("bank picker: three-letter prefixes can reveal multiple banks", nodes["#bank-search-results"].innerHTML.includes('data-bank-id="firstbank"') && nodes["#bank-search-results"].innerHTML.includes('data-bank-id="fcmb"'));

  context.renderBankOptions("ALAT");
  check("bank picker: digital bank aliases are searchable", nodes["#bank-search-results"].innerHTML.includes('data-bank-id="wema"'));
  nodes["#bank-search"].value = "ALAT";
  context.chooseBankSearchResult("wema");
  check("bank picker: choosing a visible suggestion selects it and closes search", context.state.ctx.bankId === "wema" && nodes["#bank-search"].value === "" && nodes["#bank-search-results"].hidden);
  context.renderBankOptions("no such bank");
  check("bank picker: empty results are clear and safe", nodes["#bank-search-results"].innerHTML.includes("No matching bank found") && nodes["#bank-search-status"].textContent === "0 banks found");
  context.renderBankOptions("");
  check("bank picker: clearing search hides suggestions and restores the full status", nodes["#bank-search-results"].hidden && nodes["#bank-search-status"].textContent === "19 banks listed alphabetically");

  check("bank picker: search field exposes an accessible autocomplete", html.includes('id="bank-search" type="search" inputmode="search"') && html.includes('role="combobox" aria-autocomplete="list"') && html.includes('aria-controls="bank-search-results"') && html.includes('id="bank-search-results" class="bank-search-results" role="listbox"'));
};
