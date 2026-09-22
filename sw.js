/* Heavy Iron service worker.
   The app is five static files and a folder of block definitions, so the
   caching rules are short:

   - The shell (page, CSS, JS, manifest, icon) is precached on install and
     served from cache first — the page included, so the page and the scripts
     it names always come from the same release (see the 'navigate' branch
     below). That is what makes the app open instantly in a basement with no
     signal.
   - Blocks are tried on the network first and fall back to the cached copy,
     because a block published to the repo today should show up today — but
     a block you have already seen should still be importable offline.
   - The fonts come from Google and are cached as they are used, so the
     second visit looks the same as the first without a connection.

   Nothing here ever touches localStorage: your training log lives there and
   the cache is disposable. Bump CACHE_VERSION on release — the old caches
   are deleted on activate, and the app shows an "Actualizar" prompt rather
   than swapping the code under a session in progress. */

const CACHE_VERSION = 'v101';
const SHELL_CACHE = 'heavy-iron-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'heavy-iron-runtime-' + CACHE_VERSION;
/* Bumped only when js/vendor/ itself changes (see js/vendor/README.md's
   refresh recipe), not on every CACHE_VERSION release: these 318 KB of QR
   libraries do not change between releases, and re-fetching them on each of
   the ~45 bumps so far cost every phone that opened "Compartir por QR" a
   redownload of bytes it already had. */
const VENDOR_VERSION = 'v1';
const VENDOR_CACHE = 'heavy-iron-vendor-' + VENDOR_VERSION;

const SHELL = [
  './',
  'index.html',
  'js/theme-init.js',
  'css/style.css',
  'js/app.js',
  'js/block-editor.js',
  'js/diagnostics.js',
  'js/review.js',
  'js/profile-transfer.js',
  'js/calculator.js',
  'js/rest-timer.js',
  'js/chart.js',
  'js/volume-sheet.js',
  'js/qr-transfer.js',
  'js/boot-guard.js',
  'js/data.js',
  'manifest.webmanifest',
  'icon.svg',
  /* The PNGs the install prompt reads: Firefox on Android picks its home
     screen icon from the manifest, so they belong in the shell too. */
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'icon-180.png',
];

/* Only pulled in when you open "Compartir por QR", but precached here: the
   whole point of that screen is working in a basement, and a lazy <script>
   that 404s offline would break the feature exactly where it is needed. Kept
   out of SHELL/SHELL_CACHE so a release that touches nothing under
   js/vendor/ does not re-fetch them — see VENDOR_VERSION above. */
const VENDOR = [
  'js/vendor/qrcode.js',
  'js/vendor/jsQR.js',
];

/* A renamed file or a flaky connection during install must not fail the
   whole install and leave the app with no worker at all — but a miss here is
   silent, so a device that hit one activates believing itself fully
   offline-ready with a hole in the cache. repairCache re-`add`s anything
   `cache.match` cannot find, on activate and whenever the page asks
   (see the 'checkShell' message below), so a hole left by a bad first
   install heals itself the next time there is a connection, rather than
   sitting there until the next CACHE_VERSION bump. */
/* Every precache request goes to the server, not the HTTP cache: GitHub
   Pages serves the shell with max-age=600, and cache.add honours that, so a
   worker installing within ten minutes of an earlier fetch could pair a
   stale app.js with a fresh index.html — the mixed shell the 'navigate'
   branch below exists to prevent, by another route. The cache key is still
   the plain URL, so cache.match(url) finds these entries as before. */
const fromServer = url => new Request(url, { cache: 'reload' });

function precache(cacheName, urls) {
  return caches.open(cacheName)
    .then(cache => Promise.all(urls.map(url => cache.add(fromServer(url)).catch(() => null))));
}

function repairCache(cacheName, urls) {
  return caches.open(cacheName).then(cache => Promise.all(urls.map(url =>
    cache.match(url).then(hit => (hit ? null : cache.add(fromServer(url)).catch(() => null)))
  )));
}

function repairAll() {
  return Promise.all([repairCache(SHELL_CACHE, SHELL), repairCache(VENDOR_CACHE, VENDOR)]);
}

self.addEventListener('install', event => {
  event.waitUntil(Promise.all([precache(SHELL_CACHE, SHELL), precache(VENDOR_CACHE, VENDOR)]));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== VENDOR_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(repairAll)
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') { self.skipWaiting(); return; }
  /* "Which version am I running?" is a question about this worker, not about
     the page asking: the page is running whichever copy of the app this
     worker served it. An older worker simply never answers, and the footer
     line stays hidden until one that does is in charge. */
  if (event.data === 'version' && event.ports && event.ports[0]) {
    event.ports[0].postMessage(CACHE_VERSION);
  }
  /* Sent alongside the page's own periodic update check (see
     registerServiceWorker's visibilitychange handler) so a hole left by a
     flaky first install gets a chance to heal on any later visit that has a
     connection, not only on the next release. */
  if (event.data === 'checkShell') { repairAll(); }
});

/* The rest-over notification is posted by the page (see notifyRestOver) but
   it outlives the page that posted it, so answering the tap is the worker's
   job: raise the session that is already open rather than starting a second
   copy of the app on top of it. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.indexOf(self.registration.scope) === 0 && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow('./') : null;
    })
  );
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
      /* Only responses we can actually read the status of. An opaque response
         reports status 0 whether it is a real font or a captive portal's
         interception page, and this cache is served first on every later
         launch — so caching one would pin whatever the network handed back
         until CACHE_VERSION moves. A font re-fetched on each cold load costs
         a request; the webfont is already non-blocking (see index.html). */
      if (response && response.ok) {
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

  /* The page comes from the precache, like the scripts it names: the two
     have to be the same release. It used to go to the network first "so a
     deploy lands on the next open" — but a fresh index.html over the old
     cached scripts is not a deploy landing, it is a shell mixed from two
     releases. Twice now (commit 5ed2906, then the js/chart.js split) the
     new page pulled in a script the old cache never had, that script and
     the old app.js declared the same top-level names, app.js failed to
     parse, and the app sat on "Cargando tu registro…" — with the "Actualizar"
     offer dead inside the script that never ran. A deploy lands the way the
     rest of the shell does: the new worker installs a complete precache, the
     page offers "Actualizar", and the swap reloads onto it. Any other
     in-scope navigation (a block JSON opened directly) is not the app page
     and keeps the network-first path; so does the page when the precache
     has no copy of it. */
  if (request.mode === 'navigate') {
    const scopePath = new URL(self.registration.scope).pathname;
    const isAppPage = sameOrigin && (url.pathname === scopePath || url.pathname === scopePath + 'index.html');
    event.respondWith(
      (isAppPage ? caches.match('index.html') : Promise.resolve(null))
        .then(hit => hit || networkFirst(request, SHELL_CACHE))
        .catch(() => caches.match('index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  if (sameOrigin && url.pathname.indexOf('/blocks/') >= 0) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (sameOrigin && url.pathname.indexOf('/js/vendor/') >= 0) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
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
