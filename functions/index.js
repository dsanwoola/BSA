"use strict";

const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

const ALLOWED_ORIGINS = new Set([
  "https://bank-statement-auditor.web.app",
  "https://bank-statement-auditor.firebaseapp.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765"
]);

const ALLOWED_EVENTS = new Set([
  "app_load",
  "step_view",
  "theme_toggle",
  "context_continue",
  "demo_started",
  "file_selected",
  "file_read_success",
  "file_read_error",
  "mapping_built",
  "audit_started",
  "audit_completed",
  "export_csv",
  "print_report",
  "copy_demand_letter",
  "recovery_pack_request",
  "premium_unlock_click",
  "sme_report_download",
  "sme_whatsapp_copy",
  "diagnostic_download"
]);

const MAX_BATCH = 20;
const MAX_STRING = 80;
const MAX_KEYS = 24;

function todayKey(date) {
  return date.toISOString().slice(0, 10);
}

function hourKey(date) {
  return date.toISOString().slice(0, 13).replace("T", "-");
}

function setCors(req, res) {
  const origin = req.get("origin") || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
}

function bucketNumber(value, buckets) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "unknown";
  for (const bucket of buckets) {
    if (n <= bucket.max) return bucket.label;
  }
  return buckets[buckets.length - 1].overflow;
}

function cleanString(value) {
  if (typeof value !== "string") return null;
  return value.replace(/[^a-zA-Z0-9_.:\-/ ]/g, "").slice(0, MAX_STRING);
}

function cleanMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return out;
  const keys = Object.keys(meta).slice(0, MAX_KEYS);
  for (const key of keys) {
    const safeKey = cleanString(key);
    if (!safeKey) continue;
    const value = meta[key];
    if (typeof value === "boolean") out[safeKey] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[safeKey] = Math.max(0, Math.round(value));
    else if (typeof value === "string") out[safeKey] = cleanString(value);
  }
  return out;
}

function analyticsDimensions(event) {
  const meta = cleanMeta(event.meta || {});
  const dims = {};

  ["step", "source", "fileType", "accountType", "holderType", "theme", "errorType"].forEach((key) => {
    if (meta[key]) dims[key] = meta[key];
  });

  if (meta.txnCount !== undefined) {
    dims.txnBucket = bucketNumber(meta.txnCount, [
      { max: 0, label: "0" },
      { max: 25, label: "1-25" },
      { max: 100, label: "26-100" },
      { max: 250, label: "101-250" },
      { max: 1000, label: "251-1000", overflow: "1001+" }
    ]);
  }

  if (meta.refundDue !== undefined) {
    dims.refundBucket = bucketNumber(meta.refundDue, [
      { max: 0, label: "0" },
      { max: 5000, label: "1-5000" },
      { max: 25000, label: "5001-25000" },
      { max: 100000, label: "25001-100000" },
      { max: 500000, label: "100001-500000", overflow: "500001+" }
    ]);
  }

  if (meta.underReview !== undefined) {
    dims.reviewBucket = bucketNumber(meta.underReview, [
      { max: 0, label: "0" },
      { max: 5000, label: "1-5000" },
      { max: 25000, label: "5001-25000" },
      { max: 100000, label: "25001-100000" },
      { max: 500000, label: "100001-500000", overflow: "500001+" }
    ]);
  }

  return dims;
}

function dimPath(prefix, key, value) {
  const k = encodeURIComponent(String(key)).replace(/%/g, "_").slice(0, 60);
  const v = encodeURIComponent(String(value)).replace(/%/g, "_").slice(0, 80);
  return `${prefix}.${k}.${v}`;
}

exports.analytics = onRequest({ region: "us-central1", cors: false }, async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const payload = req.body || {};
  const rawEvents = Array.isArray(payload.events) ? payload.events : [];
  const events = rawEvents.slice(0, MAX_BATCH).filter((event) => event && ALLOWED_EVENTS.has(event.name));

  if (!events.length) {
    res.status(400).json({ ok: false, error: "no_valid_events" });
    return;
  }

  const now = new Date();
  const day = todayKey(now);
  const hour = hourKey(now);
  const batch = db.batch();
  const totalsRef = db.doc("analytics/summary");
  const dayRef = db.doc(`analytics_daily/${day}`);
  const hourRef = db.doc(`analytics_hourly/${hour}`);
  const increment = FieldValue.increment;
  const serverTimestamp = FieldValue.serverTimestamp;

  const baseUpdate = {
    eventCount: increment(events.length),
    lastEventAt: serverTimestamp()
  };

  batch.set(totalsRef, baseUpdate, { merge: true });
  batch.set(dayRef, { day, ...baseUpdate }, { merge: true });
  batch.set(hourRef, { hour, day, ...baseUpdate }, { merge: true });

  for (const event of events) {
    const name = event.name;
    const dims = analyticsDimensions(event);
    const update = {
      [`events.${name}`]: increment(1),
      lastEventAt: serverTimestamp()
    };
    const dailyUpdate = { ...update, day };
    const hourlyUpdate = { ...update, hour, day };

    for (const [key, value] of Object.entries(dims)) {
      update[dimPath("dimensions", key, value)] = increment(1);
      dailyUpdate[dimPath("dimensions", key, value)] = increment(1);
      hourlyUpdate[dimPath("dimensions", key, value)] = increment(1);
      update[dimPath(`eventDimensions.${name}`, key, value)] = increment(1);
      dailyUpdate[dimPath(`eventDimensions.${name}`, key, value)] = increment(1);
      hourlyUpdate[dimPath(`eventDimensions.${name}`, key, value)] = increment(1);
    }

    batch.set(totalsRef, update, { merge: true });
    batch.set(dayRef, dailyUpdate, { merge: true });
    batch.set(hourRef, hourlyUpdate, { merge: true });
  }

  await batch.commit();
  res.status(200).json({ ok: true, accepted: events.length });
});
