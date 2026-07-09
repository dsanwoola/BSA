/* =========================================================================
 * PRIVACY-FIRST ANALYTICS CLIENT
 * Sends aggregate interaction events only. Never sends statement contents,
 * rows, narrations, account numbers, names, balances, or raw file data.
 * ========================================================================= */

(function (global) {
  "use strict";

  var ENDPOINT = "/api/analytics";
  var QUEUE_KEY = "bsa-analytics-queue-v1";
  var SESSION_KEY = "bsa-analytics-session-v1";
  var MAX_QUEUE = 40;
  var FLUSH_DELAY = 1200;
  var enabled = true;
  var queue = [];
  var flushTimer = null;

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
  }

  function sessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = uuid();
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      return "session_unavailable";
    }
  }

  function cleanMeta(meta) {
    var out = {};
    meta = meta || {};
    Object.keys(meta).slice(0, 24).forEach(function (key) {
      var value = meta[key];
      if (value == null) return;
      if (typeof value === "boolean") out[key] = value;
      else if (typeof value === "number" && isFinite(value)) out[key] = Math.max(0, Math.round(value));
      else if (typeof value === "string") out[key] = value.replace(/[^a-zA-Z0-9_.:\-/ ]/g, "").slice(0, 80);
    });
    return out;
  }

  function loadOfflineQueue() {
    try {
      var saved = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      if (Array.isArray(saved)) queue = saved.slice(-MAX_QUEUE);
    } catch (e) {
      queue = [];
    }
  }

  function saveOfflineQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE))); } catch (e) { /* ignore */ }
  }

  function clearOfflineQueue() {
    try { localStorage.removeItem(QUEUE_KEY); } catch (e) { /* ignore */ }
  }

  function track(name, meta) {
    if (!enabled || !name) return;
    queue.push({
      name: String(name).slice(0, 80),
      ts: Date.now(),
      sessionId: sessionId(),
      build: global.BSA_BUILD || null,
      path: global.location ? global.location.pathname : "/",
      meta: cleanMeta(meta)
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    saveOfflineQueue();
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush();
    }, FLUSH_DELAY);
  }

  function flush(useBeacon) {
    if (!queue.length) return Promise.resolve(false);
    var events = queue.slice(0, 20);
    var body = JSON.stringify({ events: events });

    if (useBeacon && navigator.sendBeacon) {
      var ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      if (ok) {
        queue = queue.slice(events.length);
        saveOfflineQueue();
        if (!queue.length) clearOfflineQueue();
      }
      return Promise.resolve(ok);
    }

    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true
    }).then(function (res) {
      if (!res.ok) throw new Error("analytics_http_" + res.status);
      queue = queue.slice(events.length);
      saveOfflineQueue();
      if (!queue.length) clearOfflineQueue();
      if (queue.length) scheduleFlush();
      return true;
    }).catch(function () {
      saveOfflineQueue();
      return false;
    });
  }

  function fileType(name) {
    var m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1].slice(0, 12) : "unknown";
  }

  loadOfflineQueue();
  if (global.addEventListener) {
    global.addEventListener("online", function () { flush(); });
    global.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush(true);
    });
    global.addEventListener("pagehide", function () { flush(true); });
  }

  global.BSA_ANALYTICS = {
    track: track,
    flush: flush,
    fileType: fileType,
    disable: function () { enabled = false; },
    _queue: function () { return queue.slice(); }
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) {
  module.exports = typeof window !== "undefined" ? window.BSA_ANALYTICS : {};
}
