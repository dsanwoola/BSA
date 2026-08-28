/* =========================================================================
 * PAYWALL — the refund figure is free; the report that proves it is paid.
 * =========================================================================
 * What stays free:  the integrity verdict, the summary cards, and a
 *                   breakdown of *what kinds* of problems were found.
 * What is paid:     every per-charge detail — dates, narrations, the
 *                   arithmetic, the CBN citation — plus the transaction
 *                   ledger, the demand letter, CSV export and print.
 *
 * Locked content is never written into the page. It is not rendered and
 * then hidden; the HTML does not exist until the server has confirmed the
 * payment. Hiding it with CSS would put the whole report one DevTools
 * click away from being free.
 *
 * Honest limit: the audit runs on the reader's own machine, because their
 * statement never leaves it. So a determined developer can still reach the
 * findings by calling the engine directly from the console. Closing that
 * hole entirely would mean uploading statements to a server, which is the
 * one thing this product promises never to do. The gate is built to stop
 * casual sharing and to make paying the easy path — not to defeat someone
 * who is willing to reverse-engineer it.
 * ========================================================================= */

(function (global) {
  "use strict";

  var STORE_KEY = "checkam-receipts-v1";
  var API = {
    quote: "/api/pay/quote",
    verify: "/api/pay/verify",
    status: "/api/pay/status"
  };

  /* Resolved lazily so this file works both in the browser, where the other
   * modules arrive as globals, and under Node in the test suite. */
  function PRICING() {
    return global.CBN_PRICING || (typeof require === "function" ? require("./pricing.js") : null);
  }
  function REPORT() {
    return global.CBN_REPORT || (typeof require === "function" ? require("./report.js") : null);
  }

  /* current unlock state, keyed by statement fingerprint */
  var unlocked = {};
  var onUnlockCallback = null;

  // Operational rollout gate: do not accept money during backend/webhook setup.
  function paymentsLive() {
    return typeof document !== "undefined" && document.documentElement &&
      document.documentElement.getAttribute("data-payments-live") === "true";
  }

  function esc(s) { return REPORT() ? REPORT().esc(s) : String(s == null ? "" : s); }
  function fmtN(n) { return REPORT() ? REPORT().fmtN(n) : String(n); }

  function track(name, meta) {
    var A = global.BSA_ANALYTICS;
    if (A && A.track) { try { A.track(name, meta || {}); } catch (e) { /* analytics must never break the gate */ } }
  }

  /* ---------------- receipt storage ---------------- */

  function readReceipts() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function saveReceipt(fp, receipt) {
    var all = readReceipts();
    all[fp] = receipt;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
    if (!readReceipts()[fp] || readReceipts()[fp].token !== receipt.token) {
      throw new Error("Allow browser storage before paying so your receipt can be restored.");
    }
  }

  /* ---------------- statement fingerprint ----------------
   * Identifies *which* statement was paid for, so one payment unlocks one
   * statement. Built only from the period and the transaction count — no
   * narrations, balances, names or account numbers — then hashed, so the
   * value that reaches the server is non-reversible and carries no content.
   * The inputs are chosen to survive a re-audit: reclassifying a charge
   * changes the refund total, but not the period or the row count. */
  function fingerprint(audit) {
    var s = (audit && audit.summary) || {};
    var p = s.period || {};
    var basis = [
      p.from ? new Date(p.from).toISOString().slice(0, 10) : "?",
      p.to ? new Date(p.to).toISOString().slice(0, 10) : "?",
      s.txnCount || 0
    ].join("|");

    if (global.crypto && global.crypto.subtle) {
      return global.crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(basis))
        .then(function (buf) {
          return Array.prototype.map
            .call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); })
            .join("");
        });
    }
    /* crypto.subtle needs a secure context; on plain http:// during local
     * testing we fall back to a non-cryptographic digest of the same basis.
     * The server treats any malformed value as "no fingerprint". */
    var h = 0;
    for (var i = 0; i < basis.length; i++) { h = ((h << 5) - h + basis.charCodeAt(i)) | 0; }
    var hex = (h >>> 0).toString(16);
    return Promise.resolve(new Array(65 - hex.length).join("0") + hex);
  }

  /* ---------------- server calls ---------------- */

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { status: r.status, body: j };
      });
    });
  }

  /** Ask the server whether a stored receipt still unlocks this statement. */
  function restore(fp) {
    var rec = readReceipts()[fp];
    if (!rec || !rec.txRef || !rec.token) return Promise.resolve(false);
    var payload = { txRef: rec.txRef, token: rec.token, fingerprint: fp };
    return post(API.status, payload)
      .then(function (r) {
        if (r.status === 200 && r.body && !r.body.paid && rec.transactionId) {
          payload.transactionId = rec.transactionId;
          return post(API.verify, payload);
        }
        return r;
      })
      .then(function (r) {
        var ok = r.status === 200 && r.body && r.body.paid === true;
        if (ok) { unlocked[fp] = true; track("unlock_restored", {}); }
        return ok;
      })
      .catch(function () { return false; });
  }

  function isUnlocked(fp) { return !!unlocked[fp]; }

  /* ---------------- teaser: what was found, not what it says ---------------- */

  /** Group findings by charge type so the reader sees the shape of the
   *  problem — "3 excess maintenance fees" — without the evidence. */
  function summariseLocked(audit) {
    var groups = {};
    (audit.findings || []).forEach(function (f) {
      if (f.verdict !== "violation" && f.verdict !== "review") return;
      var key = f.verdict + "|" + (f.typeName || "Other charge");
      if (!groups[key]) groups[key] = { verdict: f.verdict, name: f.typeName || "Other charge", count: 0, excess: 0 };
      groups[key].count++;
      groups[key].excess += Number(f.excess) || 0;
    });
    (audit.aggregates || []).forEach(function (a) {
      if (a.verdict !== "violation" && a.verdict !== "review") return;
      var key = a.verdict + "|" + (a.title || "Cross-check");
      if (!groups[key]) groups[key] = { verdict: a.verdict, name: a.title || "Cross-check", count: 0, excess: 0 };
      groups[key].count++;
      groups[key].excess += Number(a.excess) || 0;
    });
    return Object.keys(groups)
      .map(function (k) { return groups[k]; })
      .sort(function (a, b) { return b.excess - a.excess; });
  }

  function renderTeaser(audit) {
    var items = summariseLocked(audit);
    if (!items.length) {
      return '<p class="muted">No violations or review items were found in this statement, so there is nothing locked here.</p>';
    }
    var rows = items.map(function (g) {
      var icon = g.verdict === "violation" ? "⛔" : "❓";
      var cls = g.verdict === "violation" ? "v-violation" : "v-review";
      return '<li class="lock-row">' +
        '<span class="badge ' + cls + '">' + icon + "</span>" +
        '<span class="lock-name">' + esc(g.name) + "</span>" +
        '<span class="lock-count">' + g.count + (g.count === 1 ? " charge" : " charges") + "</span>" +
        '<span class="lock-amt">' + (g.excess > 0 ? fmtN(g.excess) : "—") + "</span>" +
        "</li>";
    }).join("");
    return '<ul class="lock-list">' + rows + "</ul>" +
      '<p class="muted lock-foot">Each line above unlocks into the individual charges behind it — the date, the narration on your statement, the arithmetic that proves the excess, and the CBN provision it breaches.</p>';
  }

  /* ---------------- the paywall panel ---------------- */

  function renderPanel(audit, ctx, quote) {
    var s = audit.summary || {};
    var proven = s.refundDue || 0;
    var review = s.underReview || 0;
    var period = s.period || {};
    var periodLabel = (period.from && period.to)
      ? REPORT().fmtDate(period.from) + " – " + REPORT().fmtDate(period.to)
      : "period not detected";

    var priceLine = quote
      ? PRICING().formatNaira(quote.amount)
      : PRICING().formatNaira(PRICING().quote({ holderType: ctx.holderType, from: period.from, to: period.to }).amount);

    var q = quote || PRICING().quote({ holderType: ctx.holderType, from: period.from, to: period.to });
    var blockLine = q.blocks === 1
      ? "1 × 6-month block"
      : q.blocks + " × 6-month blocks (" + PRICING().formatNaira(q.unitAmount) + " each)";
    var whoLine = q.holderType === "individual" ? "Individual statement" : "Business statement";

    return '<section class="paywall no-print" aria-labelledby="paywall-title">' +
      '<div class="paywall-head">' +
        '<span class="eyebrow">🔒 Full report locked</span>' +
        '<h3 id="paywall-title">Unlock full report</h3>' +
        '<details class="info-disclosure"><summary>Why unlock?</summary>' +
        '<p>' + (proven > 0
          ? "Checkam found " + fmtN(proven) + " in charges it can prove breach CBN rules" +
            (review > 0 ? ", and a further " + fmtN(review) + " that needs review" : "") + "."
          : "Checkam has read and reconciled your statement." ) +
          " The full report names every charge, shows the arithmetic, and cites the rule it breaks — that is what you need to claim it back.</p></details>" +
      "</div>" +

      '<div class="paywall-grid">' +
        '<div class="paywall-buy">' +
          '<div class="paywall-price">' + esc(priceLine) + "</div>" +
          '<div class="paywall-terms">' +
            "<div>" + esc(whoLine) + "</div>" +
            "<div>" + esc(periodLabel) + "</div>" +
            "<div>" + esc(blockLine) + "</div>" +
          "</div>" +
          '<label for="payment-email">Receipt email</label>' +
          '<input id="payment-email" type="email" autocomplete="email" required placeholder="you@example.com">' +
          '<button class="btn btn-primary paywall-cta" id="btn-unlock-report" type="button"' + (paymentsLive() ? "" : " disabled") + '>Unlock full report — ' + esc(priceLine) + "</button>" +
          (paymentsLive() ? "" : '<p class="paywall-note" role="status">Payments are being activated. Please check back shortly; no payment will be taken.</p>') +
          '<details class="info-disclosure"><summary>Payment &amp; privacy</summary><p class="paywall-note">One payment unlocks this statement. Paid securely through Flutterwave — card, bank transfer or USSD.</p>' +
          '<p class="paywall-note privacy-note">🔒 Your statement stays in this browser. Checkam receives the holder type, date range and statement fingerprint; Flutterwave receives your email and payment details. Keep this browser’s site data to restore your receipt.</p></details>' +
          '<p class="paywall-error" id="paywall-error" role="alert" hidden></p>' +
        "</div>" +
        '<details class="paywall-get info-disclosure"><summary>What’s included</summary>' +

          "<ul>" +
            "<li>Every flagged charge with its date, narration and amount</li>" +
            "<li>The arithmetic proving each excess, and the CBN provision breached</li>" +
            "<li>The full transaction ledger, with reclassification</li>" +
            "<li>A refund demand letter addressed to your bank</li>" +
            "<li>CSV export and printable PDF of the whole report</li>" +
          "</ul>" +
        "</details>" +

      "</div>" +

      '<details class="paywall-preview info-disclosure"><summary>View charge preview</summary>' +
        renderTeaser(audit) +
      "</details>" +
      "</section>";
  }

  /* ---------------- checkout ----------------
   * Flutterwave's checkout script is third-party code with full DOM access,
   * so it is not loaded with the page. It is fetched only when someone
   * chooses to pay — by which point the statement has already been parsed —
   * and never on the parsing or upload screens. */

  var FLW_SCRIPT = "https://checkout.flutterwave.com/v3.js";
  var flwLoading = null;

  function loadFlutterwave() {
    if (typeof global.FlutterwaveCheckout === "function") return Promise.resolve();
    if (flwLoading) return flwLoading;
    flwLoading = new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = FLW_SCRIPT;
      el.async = true;
      el.onload = function () {
        if (typeof global.FlutterwaveCheckout === "function") resolve();
        else reject(new Error("The payment window could not start. Please try again."));
      };
      el.onerror = function () {
        flwLoading = null;
        reject(new Error("The payment window could not load. Check your connection, or disable any ad-blocker for this page."));
      };
      document.head.appendChild(el);
    });
    return flwLoading;
  }


  function showError(msg) {
    var el = document.getElementById("paywall-error");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function startCheckout(audit, ctx, fp) {
    if (!paymentsLive()) { showError("Payments are being activated. Please check back shortly."); return; }
    var btn = document.getElementById("btn-unlock-report");
    var receipt = readReceipts()[fp];
    // A retry must confirm the existing payment, never start another charge.
    if (receipt && receipt.transactionId) {
      confirmPayment(receipt.txRef, receipt.transactionId, audit, ctx, fp);
      return;
    }
    var emailInput = document.getElementById("payment-email");
    if (!emailInput || !emailInput.checkValidity()) {
      if (emailInput) emailInput.reportValidity();
      return;
    }
    var email = emailInput.value.trim();
    var period = (audit.summary && audit.summary.period) || {};
    var errEl = document.getElementById("paywall-error");
    if (errEl) errEl.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = "Preparing secure checkout…"; }

    track("pay_quote_requested", { holderType: ctx.holderType });

    restore(fp).then(function (paid) {
      if (paid) {
        if (onUnlockCallback) onUnlockCallback();
        return null;
      }
      // Reopening a cancelled checkout reuses the same order and receipt.
      if (receipt && receipt.quote && receipt.token) {
        return { status: 200, body: receipt.quote };
      }
      return post(API.quote, {
        holderType: ctx.holderType,
        from: PRICING().dateKey(period.from),
        to: PRICING().dateKey(period.to),
        fingerprint: fp
      });
    }).then(function (r) {
      if (!r) return;
      if (r.status !== 200 || !r.body || !r.body.ok) {
        var reason = r.body && r.body.error === "payments_unconfigured"
          ? "Payments are not switched on yet. Please try again shortly."
          : "Could not start checkout. Please check your connection and try again.";
        throw new Error(reason);
      }
      if (!receipt || !receipt.quote) {
        receipt = { txRef: r.body.txRef, token: r.body.token, quote: r.body, at: Date.now() };
        // Refuse to open checkout if recovery cannot be saved first.
        saveReceipt(fp, receipt);
      }

      return loadFlutterwave().then(function () {
      track("pay_checkout_opened", { amount: r.body.amount, blocks: r.body.blocks, holderType: r.body.holderType });

      global.FlutterwaveCheckout({
        public_key: r.body.publicKey,
        tx_ref: r.body.txRef,
        amount: r.body.amount,
        currency: r.body.currency,
        payment_options: "card,banktransfer,ussd",
        customer: { email: email },
        customizations: {
          title: "Checkam",
          description: "Full bank charge audit report — " + r.body.description
        },
        callback: function (payment) {
          confirmPayment(r.body.txRef, payment && payment.transaction_id, audit, ctx, fp);
        },
        onclose: function () {
          track("pay_checkout_closed", {});
          restore(fp).then(function (paid) {
            if (paid && onUnlockCallback) onUnlockCallback();
            else if (btn) { btn.disabled = false; btn.textContent = "Continue / check payment"; }
          });
        }
      });
      });
    }).catch(function (err) {
      showError(err.message || "Something went wrong starting checkout.");
      track("pay_failed", { stage: "quote" });
      if (btn) { btn.disabled = false; btn.textContent = "Try again"; }
    });
  }

  function confirmPayment(txRef, transactionId, audit, ctx, fp) {
    var btn = document.getElementById("btn-unlock-report");
    var receipt = readReceipts()[fp];
    if (!receipt || receipt.txRef !== txRef || !receipt.token) {
      showError("Your payment receipt is missing. Do not pay again; contact support with your Flutterwave receipt.");
      return;
    }
    receipt.transactionId = transactionId;
    try { saveReceipt(fp, receipt); } catch (err) { showError("Keep this tab open until payment is confirmed; browser storage is unavailable."); }
    if (btn) { btn.disabled = true; btn.textContent = "Confirming payment…"; }

    post(API.verify, { txRef: txRef, transactionId: transactionId, token: receipt.token, fingerprint: fp })
      .then(function (r) {
        if (r.status === 200 && r.body && r.body.paid) {
          unlocked[fp] = true;
          track("pay_succeeded", { txRef: txRef });
          if (onUnlockCallback) onUnlockCallback();
          return;
        }
        throw new Error("Payment is not confirmed yet. Use Retry confirmation or reload and re-audit this statement. Do not pay again if you were charged.");
      })
      .catch(function (err) {
        showError(err.message || "Payment confirmation failed.");
        track("pay_failed", { stage: "verify" });
        if (btn) { btn.disabled = false; btn.textContent = "Retry confirmation"; }
      });
  }

  /* ---------------- public API ---------------- */

  var PAYWALL = {
    fingerprint: fingerprint,
    isUnlocked: isUnlocked,
    restore: restore,
    renderPanel: renderPanel,
    renderTeaser: renderTeaser,
    summariseLocked: summariseLocked,

    /** Called by the app once the results view is built. */
    mount: function (mountEl, audit, ctx, fp, onUnlock) {
      onUnlockCallback = onUnlock;
      var receipt = readReceipts()[fp];
      mountEl.innerHTML = renderPanel(audit, ctx, receipt && receipt.quote);
      var btn = document.getElementById("btn-unlock-report");
      if (btn) {
        btn.addEventListener("click", function () { startCheckout(audit, ctx, fp); });
      }
      track("paywall_shown", {
        holderType: ctx.holderType,
        refundDue: (audit.summary && audit.summary.refundDue) || 0
      });
    },

    /** Test seam: let the suite drive unlock state without a real payment. */
    _setUnlocked: function (fp, value) { unlocked[fp] = !!value; }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PAYWALL;
  else global.CBN_PAYWALL = PAYWALL;

})(typeof window !== "undefined" ? window : globalThis);
