/* Runs last, after js/app.js has had its turn — and runs whether or not
   app.js managed to. Its one job is the screen this repo has shipped twice
   (commit 5ed2906, then the js/chart.js split): a returning phone whose
   still-active service worker served a page and a set of scripts from two
   different releases, so the old app.js threw at parse time ("Identifier …
   has already been declared"), load() never ran and "Cargando tu registro…"
   stayed up for good. Nothing in app.js can help once app.js itself has not
   parsed — the "Actualizar" offer lives there.

   By the time that happens the browser has already fetched the new sw.js on
   the way in and installed it, and it is sitting there *waiting* for every
   tab to close; on an installed app that is backgrounded rather than quit,
   that is never. So: if nothing has drawn, tell the waiting worker to take
   over and reload onto its complete precache. A boot that worked has
   replaced the skeleton by the time this runs (load() and render() are
   synchronous), and this file does nothing at all; the recovery screen
   replaces the whole body, so it does not count as stuck either. If no
   newer worker turns up, say so, rather than "Cargando…" forever.

   Nothing here may depend on any other script: the whole point is that
   the others cannot be trusted to have loaded. */
(function () {
  var skeleton = function () { return document.querySelector('#list .skel'); };
  var sw = navigator.serviceWorker;
  if (!sw || !skeleton()) return;

  var reloading = false;
  sw.addEventListener('controllerchange', function () {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  /* Only after a fair wait, and only if no swap has come: a slow connection
     may still be precaching the new worker's shell when the timer fires. */
  var explain = function () {
    var el = skeleton();
    if (!el || reloading) return;
    el.textContent = 'La app no ha podido arrancar. Ciérrala del todo y vuelve a abrirla.';
  };
  var explainTimer = setTimeout(explain, 4000);

  var takeOver = function (worker) {
    if (!worker) return;
    worker.postMessage('skipWaiting');
  };
  var watch = function (worker) {
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (worker.state === 'installed') takeOver(worker);
    });
  };

  sw.getRegistration().then(function (reg) {
    if (!reg) return;
    if (reg.waiting) { takeOver(reg.waiting); return; }
    /* Not waiting yet: the update the navigation kicked off may still be
       installing, or may not have been noticed at all. Watch for both, and
       ask, in case this open did not count as a check. */
    watch(reg.installing);
    reg.addEventListener('updatefound', function () { watch(reg.installing); });
    reg.update().catch(function () { /* offline — nothing newer to switch to */ });
  }).catch(function () { clearTimeout(explainTimer); explain(); });
})();
