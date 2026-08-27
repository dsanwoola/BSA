"use strict";

/* =========================================================================
 * PAYMENTS — Flutterwave Standard checkout, verified server-side.
 * =========================================================================
 * The client never states a price. It states who owns the account and what
 * period the statement covers; this module computes the amount, and refuses
 * to unlock unless Flutterwave independently confirms that that exact amount
 * was actually paid.
 *
 * Flow:
 *   1. POST /api/pay/quote   → server prices it, opens a pending order,
 *                              returns tx_ref + amount + public key
 *   2. browser runs FlutterwaveCheckout() with that tx_ref and amount
 *   3. POST /api/pay/verify  → server calls Flutterwave's verify endpoint
 *                              with the SECRET key, checks status/amount/
 *                              currency/tx_ref, then marks the receipt paid
 *   4. POST /api/pay/webhook → same fulfilment path, driven by Flutterwave,
 *                              so a customer who closes the tab still gets
 *                              what they paid for
 *   5. POST /api/pay/status  → exchange a stored token for the unlock again
 *                              on a later visit
 *
 * Docs this implements (fetched 2026-08-20, v3):
 *   checkout  https://developer.flutterwave.com/v3.0.0/docs/inline
 *   verify    https://developer.flutterwave.com/v3.0.0/reference/verify-transaction
 *   webhooks  https://developer.flutterwave.com/v3.0.0/docs/webhooks
 * ========================================================================= */

const crypto = require("crypto");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { FieldValue } = require("firebase-admin/firestore");

const PRICING = require("./pricing.js");

/* Secrets live in Secret Manager, never in the repo. See HANDOFF.md for the
 * `firebase functions:secrets:set` commands that populate these. */
const FLW_SECRET_KEY = defineSecret("FLW_SECRET_KEY");
const FLW_WEBHOOK_HASH = defineSecret("FLW_WEBHOOK_HASH");
/* The public key is safe to expose — the browser receives it — but it is kept
 * in Secret Manager alongside the others so that all Flutterwave credentials
 * are configured the same way, and none of them live in the repo or in a
 * .env file that has to be remembered at deploy time. */
const FLW_PUBLIC_KEY = defineSecret("FLW_PUBLIC_KEY");

const FLW_VERIFY_URL = "https://api.flutterwave.com/v3/transactions";
// Existing live merchant destination. Never derive a forwarding URL from input.
const FOODCARD_WEBHOOK_URL = "https://europe-west1-foodcard-ng-dev.cloudfunctions.net/handleFlutterwaveWebhook";
const ORDERS = "orders";
const ORDER_TTL_MS = 1000 * 60 * 60 * 24 * 400; // receipts stay valid ~13 months

const ALLOWED_ORIGINS = new Set([
  "https://checkam.ng",
  "https://www.checkam.ng",
  "https://bank-statement-auditor.web.app",
  "https://bank-statement-auditor.firebaseapp.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765"
]);

function db() {
  return admin.firestore();
}

function setCors(req, res) {
  res.set("Cache-Control", "no-store");
  const origin = req.get("origin") || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
}

/** Reject anything that is not a same-product POST with a JSON body. */
function guard(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return false; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method_not_allowed" }); return false; }
  if (req.get("origin") && !ALLOWED_ORIGINS.has(req.get("origin"))) {
    res.status(403).json({ ok: false, error: "origin_not_allowed" }); return false;
  }
  return true;
}

function validTxRef(value) {
  return typeof value === "string" && /^checkam-[a-z0-9]+-[a-f0-9]{16}$/.test(value);
}

function validToken(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function ownsOrder(order, token, fingerprint) {
  return validToken(token) && safeEqual(hashToken(token), order.tokenHash || "") &&
    !!order.fingerprint && cleanFingerprint(fingerprint) === order.fingerprint;
}

function receiptExpired(order) {
  const paidAtMs = order.paidAt && order.paidAt.toMillis ? order.paidAt.toMillis() : 0;
  return !!paidAtMs && Date.now() - paidAtMs > ORDER_TTL_MS;
}

function newTxRef() {
  return "checkam-" + Date.now().toString(36) + "-" + crypto.randomBytes(8).toString("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* Tokens are stored only as hashes, so a leaked database backup cannot be
 * replayed to unlock reports. */
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/* Timing-safe compare for the webhook secret. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* A statement fingerprint is a SHA-256 of period-start|period-end|txn-count,
 * computed in the browser. It scopes an unlock to the one statement that was
 * paid for, without any statement content ever reaching this server: it is
 * non-reversible, and carries no narrations, balances, names or account
 * numbers. Anything that is not 64 hex characters is ignored. */
function cleanFingerprint(value) {
  const fp = String(value || "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(fp) ? fp : null;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/* ---------------- 1. quote + open a pending order ---------------- */

const payQuote = onRequest(
  { region: "us-central1", cors: false, secrets: [FLW_PUBLIC_KEY] },
  async (req, res) => {
    if (!guard(req, res)) return;

    const body = req.body || {};
    const fingerprint = cleanFingerprint(body.fingerprint);
    if (!fingerprint) {
      res.status(400).json({ ok: false, error: "invalid_fingerprint" }); return;
    }
    const from = parseDate(body.from);
    const to = parseDate(body.to);

    /* The client's claimed period only ever decides how many 6-month blocks
     * are billed; it can never set the price directly. */
    const quote = PRICING.quote({ holderType: body.holderType, from, to });

    const publicKey = (FLW_PUBLIC_KEY.value() || "").trim();
    if (!publicKey) {
      res.status(503).json({ ok: false, error: "payments_unconfigured" });
      return;
    }

    const txRef = newTxRef();
    // Issue the receipt before checkout, so a lost callback can be recovered.
    // Only its hash is stored on the server; it grants no access until paid.
    const token = newToken();
    await db().collection(ORDERS).doc(txRef).set({
      txRef,
      status: "pending",
      amount: quote.amount,
      currency: quote.currency,
      holderType: quote.holderType,
      blocks: quote.blocks,
      days: quote.days,
      periodFrom: from ? from.toISOString().slice(0, 10) : null,
      periodTo: to ? to.toISOString().slice(0, 10) : null,
      fingerprint,
      tokenHash: hashToken(token),
      createdAt: FieldValue.serverTimestamp()
    });

    res.status(200).json({
      ok: true,
      txRef,
      token,
      publicKey,
      amount: quote.amount,
      currency: quote.currency,
      blocks: quote.blocks,
      unitAmount: quote.unitAmount,
      holderType: quote.holderType,
      days: quote.days,
      months: quote.months,
      periodKnown: quote.periodKnown,
      description: PRICING.describe(quote)
    });
  }
);

/* ---------------- shared fulfilment ---------------- */

/**
 * Ask Flutterwave what actually happened, then unlock only if every field
 * matches the order we opened. The receipt was already issued at quote time.
 *
 * Idempotent: a webhook and a browser callback racing each other both land
 * on the same paid order without rotating its receipt or overwriting payment.
 */
async function fulfil(txRef, transactionId, secretKey) {
  if (!validTxRef(txRef) || !/^[1-9][0-9]{0,19}$/.test(String(transactionId))) {
    return { ok: false, error: "invalid_reference" };
  }
  const ref = db().collection(ORDERS).doc(String(txRef));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "unknown_order" };

  const order = snap.data();
  if (order.status === "paid") {
    return { ok: true, amount: order.amount, alreadyPaid: true };
  }

  const resp = await fetch(`${FLW_VERIFY_URL}/${encodeURIComponent(transactionId)}/verify`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(15000)
  });

  if (!resp.ok) {
    await ref.set({ lastError: `verify_http_${resp.status}`, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: false, error: "verify_failed" };
  }

  const payload = await resp.json();
  const data = (payload && payload.data) || {};

  /* Every one of these must line up. Flutterwave's own docs are explicit
   * that status, amount, currency and tx_ref should all be re-checked
   * against your records before the order is confirmed. */
  const checks = {
    status: data.status === "successful",
    txRef: data.tx_ref === order.txRef,
    currency: data.currency === order.currency,
    amount: Number(data.amount) >= Number(order.amount)
  };
  const failed = Object.keys(checks).filter((k) => !checks[k]);

  if (failed.length) {
    // Never let a failing callback downgrade a concurrent successful webhook.
    await db().runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.data().status === "paid") return;
      transaction.set(ref, {
        lastError: "mismatch:" + failed.join(","),
        seenAmount: Number(data.amount) || 0,
        seenStatus: data.status || null,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    return { ok: false, error: "verification_mismatch", failed };
  }

  await db().runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (current.data().status === "paid") return;
    transaction.set(ref, {
      status: "paid",
      flwTransactionId: String(transactionId),
      flwRef: data.flw_ref || null,
      paidAmount: Number(data.amount) || 0,
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return { ok: true, amount: order.amount };
}

/* ---------------- 2. verify from the browser callback ---------------- */

const payVerify = onRequest(
  { region: "us-central1", cors: false, secrets: [FLW_SECRET_KEY] },
  async (req, res) => {
    if (!guard(req, res)) return;

    const { txRef, transactionId, token, fingerprint } = req.body || {};
    if (!validTxRef(txRef) || !validToken(token) || !/^[1-9][0-9]{0,19}$/.test(String(transactionId))) {
      res.status(400).json({ ok: false, error: "missing_fields" });
      return;
    }

    const snap = await db().collection(ORDERS).doc(txRef).get();
    if (!snap.exists || !ownsOrder(snap.data(), token, fingerprint)) {
      res.status(403).json({ ok: false, error: "invalid_receipt" }); return;
    }
    if (receiptExpired(snap.data())) {
      res.status(403).json({ ok: false, error: "receipt_expired" }); return;
    }
    let result;
    try {
      result = await fulfil(txRef, transactionId, FLW_SECRET_KEY.value());
    } catch (err) {
      res.status(503).json({ ok: false, error: "verification_unavailable" }); return;
    }
    if (!result.ok) {
      res.status(402).json({ ok: false, error: result.error, failed: result.failed || null });
      return;
    }
    res.status(200).json({ ok: true, paid: true, txRef });
  }
);

/* ---------------- 3. restore an unlock on a later visit ---------------- */

const payStatus = onRequest(
  { region: "us-central1", cors: false },
  async (req, res) => {
    if (!guard(req, res)) return;

    const { txRef, token } = req.body || {};
    if (!validTxRef(txRef) || !validToken(token)) {
      res.status(400).json({ ok: false, error: "missing_fields" });
      return;
    }
    const fingerprint = cleanFingerprint((req.body || {}).fingerprint);

    const snap = await db().collection(ORDERS).doc(String(txRef)).get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, paid: false, error: "unknown_order" });
      return;
    }

    const order = snap.data();
    const valid = safeEqual(hashToken(token), order.tokenHash || "");

    if (!valid) {
      res.status(403).json({ ok: false, paid: false, error: "invalid_token" });
      return;
    }

    /* An unlock is bought for one statement. Presenting a valid receipt
     * alongside a different statement does not unlock it. */
    if (order.fingerprint && fingerprint !== order.fingerprint) {
      res.status(403).json({ ok: false, paid: false, error: "different_statement" });
      return;
    }

    if (order.status !== "paid") {
      res.status(200).json({ ok: true, paid: false, txRef }); return;
    }

    if (receiptExpired(order)) {
      res.status(403).json({ ok: false, paid: false, error: "receipt_expired" });
      return;
    }

    res.status(200).json({
      ok: true,
      paid: true,
      txRef: order.txRef,
      amount: order.amount,
      blocks: order.blocks,
      holderType: order.holderType
    });
  }
);

/* ---------------- 4. webhook ---------------- */

async function handleCheckamWebhook(req, res) {
    if (req.method !== "POST") { res.status(405).send("method_not_allowed"); return; }

    /* Flutterwave sends the shared secret in a `verif-hash` header. Anything
     * without a matching hash is not from Flutterwave and is dropped. */
    const sent = req.get("verif-hash") || "";
    const expected = FLW_WEBHOOK_HASH.value() || "";
    if (!expected || !safeEqual(sent, expected)) {
      res.status(401).send("unauthorised");
      return;
    }

    const body = req.body || {};
    const data = body.data || {};

    /* Acknowledge fast — Flutterwave expects a 200 within 60 seconds — but
     * only after fulfilment, which is a single verify call plus one write. */
    if (body.event === "charge.completed" && data.status === "successful" && data.tx_ref && data.id) {
      try {
        const result = await fulfil(data.tx_ref, data.id, FLW_SECRET_KEY.value());
        if (!result.ok && result.error === "verify_failed") {
          res.status(503).send("verification_unavailable"); return;
        }
      } catch (err) {
        console.error("webhook fulfil failed", data.tx_ref);
        res.status(503).send("verification_unavailable"); return;
      }
    }

    res.status(200).send("ok");
}

const flwWebhook = onRequest(
  { region: "us-central1", cors: false, secrets: [FLW_SECRET_KEY, FLW_WEBHOOK_HASH] },
  handleCheckamWebhook
);

// Shared merchant entry point. Authenticate before forwarding; preserve original
// FoodCard bytes, hash, and signature. Only acknowledge after downstream success.
// The separate Checkam webhook remains available for isolated integration tests.
const flwRouter = onRequest(
  { region: "us-central1", cors: false, timeoutSeconds: 60, secrets: [FLW_SECRET_KEY, FLW_WEBHOOK_HASH] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("method_not_allowed"); return; }
    const expected = FLW_WEBHOOK_HASH.value() || "";
    const sent = req.get("verif-hash") || "";
    if (!expected || !safeEqual(sent, expected)) {
      res.status(401).send("unauthorised"); return;
    }
    const body = req.body || {};
    if (validTxRef(body.data && body.data.tx_ref)) {
      await handleCheckamWebhook(req, res);
      return;
    }
    // Fail closed if the platform did not preserve the raw request. Re-encoding
    // JSON could invalidate an HMAC signature used by the downstream handler.
    if (!Buffer.isBuffer(req.rawBody)) {
      res.status(503).send("raw_body_unavailable"); return;
    }
    const headers = { "Content-Type": "application/json", "verif-hash": sent };
    const signature = req.get("flutterwave-signature");
    if (signature) headers["flutterwave-signature"] = signature;
    try {
      const response = await fetch(FOODCARD_WEBHOOK_URL, {
        method: "POST", headers, body: req.rawBody,
        redirect: "manual", signal: AbortSignal.timeout(25000)
      });
      if (response.body) await response.body.cancel();
      if (response.status !== 200) {
        res.status(503).send("foodcard_delivery_failed"); return;
      }
      res.status(200).send("ok");
    } catch (err) {
      res.status(503).send("foodcard_delivery_unavailable");
    }
  }
);

module.exports = { payQuote, payVerify, payStatus, flwWebhook, flwRouter, fulfil, ALLOWED_ORIGINS };
