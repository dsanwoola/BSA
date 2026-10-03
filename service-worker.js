"use strict";

var CACHE_NAME = "checkam-static-v89";
var CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/css/app.css?v=89",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/vendor/xlsx.full.min.js",
  "/vendor/pdf.min.js",
  "/vendor/pdf.worker.min.js",
  "/vendor/docx-9.6.1.js",
  "/js/rules.js?v=89",
  "/js/bank-profiles.js?v=89",
  "/js/patterns.js?v=89",
  "/js/engine.js?v=89",
  "/js/parser.js?v=89",
  "/js/report.js?v=89",
  "/js/account-detector.js?v=89",
  "/js/account-detector-integration.js?v=89",
  "/js/analytics.js?v=89",
  "/js/analytics-enhanced.js?v=89",
  "/js/pricing.js?v=89",
  "/js/paywall.js?v=89",
  "/js/paid-reports.js?v=89",
  "/js/word-export.js?v=89",
  "/js/app.js?v=89"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS.map(function (url) {
        return new Request(url, { cache: "reload" });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) {
        return name.indexOf("checkam-static-") === 0 && name !== CACHE_NAME;
      }).map(function (name) { return caches.delete(name); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isStaticAsset(url) {
  return url.pathname === "/manifest.webmanifest" ||
    url.pathname.indexOf("/css/") === 0 ||
    url.pathname.indexOf("/js/") === 0 ||
    url.pathname.indexOf("/vendor/") === 0 ||
    url.pathname.indexOf("/icons/") === 0;
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response && response.ok) {
          caches.open(CACHE_NAME).then(function (cache) { cache.put("/index.html", response.clone()); });
        }
        return response;
      }).catch(function () {
        return caches.match("/index.html").then(function (cached) {
          return cached || caches.match("/");
        });
      })
    );
    return;
  }

  if (!isStaticAsset(url)) return;
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, response.clone()); });
        }
        return response;
      });
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
