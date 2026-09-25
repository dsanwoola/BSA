"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");

module.exports = async function (check) {
  var app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
  var html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  var picked = [], errors = [];
  var context = {
    window: {}, Promise: Promise,
    handleFile: function (file) { picked.push(file); },
    showError: function (message) { errors.push(message); }
  };
  vm.runInNewContext(app.slice(app.indexOf("  function statementPickerOptions("), app.indexOf("  function wireUpload(")), context);
  var options = context.statementPickerOptions();
  var accepts = options.types[0].accept;

  check("file chooser: dedicated picker permits one bank statement only", options.multiple === false && options.excludeAcceptAllOption === true && options.id === "checkam-bank-statement");
  check("file chooser: picker requests only supported document MIME types", !!accepts["application/pdf"] && !!accepts["text/csv"] && !!accepts["text/plain"] && !!accepts["application/vnd.ms-excel"] && !!accepts["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
  check("file chooser: picker never requests camera media", Object.keys(accepts).every(function (type) { return !/^(image|video|audio)\//.test(type); }));
  check("file chooser: fallback input uses MIME filters without capture", html.includes("application/pdf") && html.includes("text/csv") && html.includes("application/vnd.ms-excel") && !/<input[^>]+id="file-input"[^>]+capture/i.test(html));

  var clicks = 0, input = { click: function () { clicks++; } };
  await context.chooseStatementFile(input);
  check("file chooser: unsupported browsers use the restricted file input", clicks === 1);

  var file = { name: "statement.pdf" };
  context.window.showOpenFilePicker = function (received) {
    check("file chooser: browser receives document-only options", received.excludeAcceptAllOption && received.types[0].accept["application/pdf"][0] === ".pdf");
    return Promise.resolve([{ getFile: function () { return Promise.resolve(file); } }]);
  };
  var opened = await context.chooseStatementFile(input);
  check("file chooser: selected file enters the existing scan pipeline", opened === true && picked.length === 1 && picked[0] === file && clicks === 1);

  context.window.showOpenFilePicker = function () { return Promise.reject({ name: "AbortError" }); };
  await context.chooseStatementFile(input);
  check("file chooser: cancelling is quiet and never opens a second chooser", errors.length === 0 && clicks === 1);
};
