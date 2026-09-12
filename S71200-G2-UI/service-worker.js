const CACHE_NAME = "s7-1200-g2-finder-shell-v29";
const CACHE_PREFIX = "s7-1200-g2-finder-shell-";

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

// 第一次安裝時先建立基本離線快取。
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// 啟用新版時，自動刪除所有舊版本 Cache。
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

async function networkFirst(request, fallbackUrl = null) {
  try {
    // cache: "no-store" 讓請求優先向伺服器確認最新版本，
    // 避免瀏覽器 HTTP Cache 把舊 index / CSS / JS 直接回給 Service Worker。
    const response = await fetch(request, { cache: "no-store" });

    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }

    return response;
  } catch (err) {
    // 完全離線或網路失敗時才使用 Service Worker Cache。
    const cached = await caches.match(request);
    if (cached) return cached;

    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }

    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Google Sheet 等外部來源維持直接走網路。
  // Migration_DB 離線備援仍由 app.js + localStorage 負責。
  if (url.origin !== self.location.origin) return;

  // 網頁導覽：有網路一定優先抓 GitHub Pages 最新頁面。
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, INDEX_URL));
    return;
  }

  // 同網域的 index / CSS / JS / 其他靜態資源：
  // 有網路抓最新版並更新 Cache；沒網路才讀 Cache。
  event.respondWith(networkFirst(request));
});
