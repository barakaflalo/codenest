/* ── AppNest · Cloudflare Pages fix (Oct 2026) ──
Cloudflare redirects *.html to clean URLs (/index.html -> /). Chrome refuses a
"redirected" response that a Service Worker hands to a page load (ERR_FAILED).
This strips the redirect flag from every response the SW fetches or reads from cache. */
(function(){
var NB={101:1,204:1,205:1,304:1};
function clean(r){
if(!r||!r.redirected||NB[r.status])return r;
return r.blob().then(function(b){return new Response(b,{status:r.status,statusText:r.statusText,headers:r.headers});});
}
var _fetch=self.fetch.bind(self);
self.fetch=function(input,init){
if(input&&typeof input==='object'&&input.mode==='navigate')input=input.url;
return _fetch(input,init).then(clean);
};
var cm=Cache.prototype.match;
Cache.prototype.match=function(){return cm.apply(this,arguments).then(clean);};
var sm=CacheStorage.prototype.match;
CacheStorage.prototype.match=function(){return sm.apply(this,arguments).then(clean);};
})();

/* ── CodeNest service worker ── */
var V = '1.0.0', DATA_V = '1';
var CACHE = 'codenest-v' + V + '-d' + DATA_V;
var MARK = "VERSION = '" + V + "'";
/* required: install fails (and the previous version stays) unless all arrive and the page carries this version */
var CORE = ['./', 'tanach.json?v=' + DATA_V, 'nt.json?v=' + DATA_V];
/* optional: never block an update */
var OPT = ['manifest.json', 'icon-192.png', 'icon-512.png', 'privacy_policy.html'];

function getReq(url, tries) {
  return fetch(new Request(url, { cache: 'reload' })).then(function (r) {
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r;
  }).catch(function (e) { if (tries > 1) return getReq(url, tries - 1); throw e; });
}
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(CORE.map(function (u) {
      return getReq(u, 3).then(function (r) {
        if (u === './') return r.clone().text().then(function (t) { if (t.indexOf(MARK) < 0) throw new Error('page version mismatch'); return c.put(u, r); });
        return c.put(u, r);
      });
    })).then(function () {
      return Promise.all(OPT.map(function (u) { return getReq(u, 2).then(function (r) { return c.put(u, r); }).catch(function () { }); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('codenest-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; /* AI providers etc. go straight to the network */
  if (req.mode === 'navigate') {
    /* page: network-first; cache only the app page and only if it is this version */
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
        var cp = r.clone();
        cp.text().then(function (t) { if (t.indexOf(MARK) >= 0) caches.open(CACHE).then(function (c) { c.put('./', new Response(t, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })); }); });
      }
      return r;
    }).catch(function () { return caches.match('./'); }));
    return;
  }
  /* versioned files (?v=) and static assets: cache first */
  e.respondWith(caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (r) {
      if (r.ok && (url.search.indexOf('v=') >= 0 || /\.(png|json)$/.test(url.pathname))) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
      return r;
    });
  }));
});
