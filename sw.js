/* Heavy Iron service worker.
   The app is five static files and a folder of block definitions, so the
   caching rules are short:

   - The shell (page, CSS, JS, manifest, icon) is precached on install and
     served from cache first. That is what makes the app open instantly in a
     basement with no signal.
   - Blocks are tried on the network first and fall back to the cached copy,
     because a block published to the repo today should show up today — but
     a block you have already seen should still be importable offline.
   - The fonts come from Google and are cached as they are used, so the
     second visit looks the same as the first without a connection.

   Nothing here ever touches localStorage: your training log lives there and
   the cache is disposable. Bump CACHE_VERSION on release — the old caches
   are deleted on activate, and the app shows an "Actualizar" prompt rather
   than swapping the code under a session in progress. */

const CACHE_VERSION = 'v32';
const SHELL_CACHE = 'heavy-iron-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'heavy-iron-runtime-' + CACHE_VERSION;

const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/block-editor.js',
  'js/diagnostics.js',
  'js/review.js',
  'js/profile-transfer.js',
  'js/data.js',
  'manifest.webmanifest',
  'icon.svg',
  /* Only pulled in when you open "Compartir por QR", but precached here: the
     whole point of that screen is working in a basement, and a lazy <script>
     that 404s offline would break the feature exactly where it is needed. */
  'js/vendor/qrcode.js',
  'js/vendor/jsQR.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      /* One miss (a renamed file, a flaky connection) must not fail the whole
         install and leave the app with no worker at all. */
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function networkFirst(request, cacheName) {
  return fetch(request)
    .then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(cacheName).then(cache => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request).then(hit => hit || Promise.reject(new Error('offline'))));
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(hit => {
    if (hit) return hit;
    return fetch(request).then(response => {
      if (response && (response.ok || response.type === 'opaque')) {
        const copy = response.clone();
        caches.open(cacheName).then(cache => cache.put(request, copy));
      }
      return response;
    });
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  /* Navigations go to the network first so a deploy lands on the next open,
     and fall back to the cached page when there is nothing to reach. */
  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(() => caches.match('index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  if (sameOrigin && url.pathname.indexOf('/blocks/') >= 0) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (sameOrigin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
});
