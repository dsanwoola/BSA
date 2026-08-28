"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");

module.exports = async function (check) {
  var fp = "a".repeat(64), store = {}, nodes, calls = [], unlocked = 0, live = true;
  var reply = async function () { return { status: 200, body: { paid: true } }; };
  var context = {
    require: require,
    CBN_REPORT: require("../js/report.js"), CBN_PRICING: require("../js/pricing.js"),
    localStorage: { getItem: function () { return JSON.stringify(store); } },
    document: {
      documentElement: { getAttribute: function () { return live ? "true" : "false"; } },
      getElementById: function (id) { return nodes[id] || null; },
      head: { appendChild: function () { throw Error("Restore must not load Flutterwave"); } }
    },
    FlutterwaveCheckout: function () { throw Error("Restore must never open checkout"); },
    fetch: async function (url, options) {
      calls.push({url:url, body:JSON.parse(options.body)});
      var response = await reply(url);
      return { status:response.status, json:async function () { return response.body; } };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/paywall.js"), "utf8"), context);
  var wall = context.CBN_PAYWALL, markup;
  function button() { return { disabled:false, textContent:"", addEventListener:function (event, fn) { this[event] = fn; } }; }
  function mount(fingerprint) {
    nodes = {
      "btn-restore-access":button(), "btn-unlock-report":button(),
      "restore-status":{hidden:true,textContent:""}, "paywall-error":{hidden:true},
      "payment-email":{value:"",checkValidity:function () { throw Error("Restore must not require email"); }}
    };
    nodes["btn-unlock-report"].disabled = !live;
    var el = {innerHTML:""};
    wall.mount(el, {summary:{}}, {holderType:"individual"}, fingerprint || fp, function () { unlocked++; });
    markup = el.innerHTML;
    return nodes["btn-restore-access"];
  }
  function receipt(transactionId) { store[fp] = {txRef:"checkam-test",token:"b".repeat(64),transactionId:transactionId}; }
  async function settle() { await new Promise(function (resolve) { setImmediate(resolve); }); }

  var btn = mount();
  check("restore UI: visible button precedes payment email with accessible status", markup.includes('Already paid? Restore access') && markup.indexOf('id="btn-restore-access"') < markup.indexOf('id="payment-email"') && markup.includes('id="restore-status" role="status"'));
  btn.click(); await settle();
  check("restore UI: missing receipt gives safe guidance without server calls", calls.length === 0 && nodes["restore-status"].textContent.includes("original browser") && nodes["restore-status"].textContent.includes("do not pay again") && !btn.disabled);

  receipt(); btn = mount(); btn.click(); await settle();
  check("restore UI: verified receipt unlocks without email or checkout", unlocked === 1 && calls.length === 1 && calls[0].url === '/api/pay/status' && calls[0].body.fingerprint === fp && wall.isUnlocked(fp));

  reply = async function () { return {status:200,body:{paid:false}}; };
  btn = mount(); btn.click(); await settle();
  check("restore UI: pending payment asks customer to retry, not repay", unlocked === 1 && nodes["restore-status"].textContent.includes("not confirmed yet") && !nodes["btn-unlock-report"].disabled);

  reply = async function () { return {status:403,body:{error:"receipt_expired"}}; };
  btn = mount(); btn.click(); await settle();
  check("restore UI: expired receipt is explained without unlocking", unlocked === 1 && nodes["restore-status"].textContent.includes("expired"));

  reply = async function () { return {status:403,body:{error:"different_statement"}}; };
  btn = mount(); btn.click(); await settle();
  check("restore UI: wrong statement is not unlocked", unlocked === 1 && nodes["restore-status"].textContent.includes("original file"));

  reply = async function () { throw Error("offline"); };
  btn = mount(); btn.click(); await settle();
  check("restore UI: network failure permits retry and never claims payment missing", unlocked === 1 && nodes["restore-status"].textContent.includes("connection") && !btn.disabled);

  var finish;
  reply = function () { return new Promise(function (resolve) { finish = resolve; }); };
  var before = calls.length;
  btn = mount(); btn.click(); btn.click();
  check("restore UI: duplicate taps issue one request and pause checkout", calls.length === before + 1 && btn.disabled && nodes["btn-unlock-report"].disabled);
  finish({status:200,body:{paid:true}}); await settle();

  live = false; reply = async function () { return {status:200,body:{paid:true}}; };
  btn = mount(); before = unlocked; btn.click(); await settle();
  check("restore UI: paid access can restore while new payments are paused", unlocked === before + 1 && nodes["btn-unlock-report"].disabled);
  live = true;

  receipt(123); calls = [];
  reply = async function (url) { return {status:200,body:{paid:url === '/api/pay/verify'}}; };
  btn = mount(); before = unlocked; btn.click(); await settle();
  check("restore UI: interrupted confirmation verifies the existing transaction only", unlocked === before + 1 && calls.length === 2 && calls[1].url === '/api/pay/verify' && calls[1].body.transactionId === 123);

  receipt(); reply = function () { return new Promise(function (resolve) { finish = resolve; }); };
  btn = mount(); before = unlocked; btn.click(); mount("c".repeat(64));
  finish({status:200,body:{paid:true}}); await settle();
  check("restore UI: late response cannot alter a different mounted report", unlocked === before && nodes["restore-status"].hidden);
  check("restore UI: no restore path creates a payment quote", calls.every(function (call) { return call.url !== '/api/pay/quote'; }));
};
