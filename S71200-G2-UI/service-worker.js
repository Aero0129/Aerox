const CACHE_NAME = "s7-1200-g2-finder-shell-v16";

const ROOT_URL = new URL("./", self.location.href).href;
const INDEX_URL = new URL("./index.html", self.location.href).href;
const STYLE_URL = new URL("./style.css", self.location.href).href;
const APP_URL = new URL("./app.js", self.location.href).href;

const APP_SHELL = [
  ROOT_URL,
  INDEX_URL,
  STYLE_URL,
  APP_URL
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) =>
              key.startsWith("s7-1200-g2-finder-shell-") &&
              key !== CACHE_NAME
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Google Sheet 等外部網址維持直接走網路，
  // Migration_DB 的離線備援由 app.js + localStorage 負責。
  if (url.origin !== self.location.origin) return;

  // 頁面導覽：有網路取最新版；沒網路回傳快取的 index.html。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          return (
            await caches.match(request) ||
            await caches.match(INDEX_URL) ||
            await caches.match(ROOT_URL)
          );
        })
    );
    return;
  }

  // CSS / JS 等同網域檔案：有網路更新快取；沒網路讀快取。
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
