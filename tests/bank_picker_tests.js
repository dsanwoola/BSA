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

  context.renderBankOptions("GTB");
  check("bank picker: aliases find the corresponding bank", nodes["#bank-profile"].innerHTML.includes('value="gtbank"') && !nodes["#bank-profile"].innerHTML.includes('value="zenith"') && nodes["#bank-search-status"].textContent === "1 bank found");
  check("bank picker: filtering never silently changes the selected profile", context.state.ctx.bankId === "other" && nodes["#bank-profile"].innerHTML.includes("Choose a matching bank"));

  context.renderBankOptions("ALAT");
  check("bank picker: digital bank aliases are searchable", nodes["#bank-profile"].innerHTML.includes('value="wema"'));
  context.renderBankOptions("no such bank");
  check("bank picker: empty results are clear and safe", nodes["#bank-profile"].innerHTML.includes("No matching bank") && nodes["#bank-search-status"].textContent === "0 banks found");
  context.renderBankOptions("");
  check("bank picker: clearing search restores the full list", (nodes["#bank-profile"].innerHTML.match(/<option /g) || []).length === BANKS.list().length);

  check("bank picker: search field has mobile and assistive attributes", html.includes('id="bank-search" type="search" inputmode="search"') && html.includes('aria-controls="bank-profile"') && html.includes('id="bank-search-status" role="status"'));
};
