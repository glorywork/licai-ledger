/* 个人理财台账 Service Worker
   外壳缓存优先；数据由 GitHub 同步，不走缓存 */
const CACHE = "licai-ledger-v6";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  /* 预缓存外壳。这里不能用 cache.addAll(SHELL)：
     addAll 走浏览器 HTTP 缓存，而 GitHub Pages 对静态资源设了 max-age，
     会直接复用旧版 app.js 灌进新版本缓存 —— 结果是推送了代码但用户端永远看不到。
     故显式用 cache:"reload" 强制回源，保证每次 install 拿到的都是线上最新文件。 */
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(SHELL.map(u => {
      const req = new Request(u, { cache: "reload" });
      return fetch(req).then(res => { if (res && res.ok) return c.put(req, res); });
    }))).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  /* 只接管同源静态资源；GitHub API 与净值接口一律走网络 */
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => { });
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
