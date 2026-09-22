/* The harness test/unit.js runs the shell in: the document stubs, the script
 * list and the vm context that loads it. Its own file so that the suite
 * reads as tests rather than opening on scaffolding, and so that a second
 * way of loading the shell sits beside the first instead of somewhere in
 * the middle of six thousand lines of assertions (plans/052).
 *
 * Required by test/unit.js; not a test itself, and runs nothing on load.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Every DOM object the sources touch answers to the same inert stub: the
   datalists app.js fills at load time and the wire*() calls just need
   something that does not throw. It keeps nothing — a handler assigned to
   it is gone, and every element is a fresh one — and a query for a list
   answers with none, so the card builder's `const [wIn, rIn, rirIn] =
   row.querySelectorAll('input')` binds undefined and load()'s first draw
   falls into recovery. That is loadApp()'s whole document: arithmetic
   needs no more. bootApp(), below, is the one that draws. */
const inert = () => ({
  style: {}, dataset: {}, children: [], hidden: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
  appendChild() {}, replaceChildren() {}, remove() {},
  addEventListener() {}, removeEventListener() {}, insertAdjacentHTML() {},
  querySelector() { return inert(); }, querySelectorAll() { return []; },
  focus() {}, select() {},
  get innerHTML() { return ''; }, set innerHTML(v) {},
  get textContent() { return ''; }, set textContent(v) {},
  get value() { return ''; }, set value(v) {},
});

/* The same order as the <script> tags in index.html — theme-init.js first
   because it loads in <head>, app.js after the ten it wires and then calls
   load() from, and boot-guard.js last, after app.js, because it is the one
   script that has to run even when app.js could not.

   Hoisted out of loadApp() because test/unit.js's first section asserts
   index.html and sw.js agree with it; a second copy would be a fourth list
   to keep in step. */
const SHELL_SCRIPTS = [
  'js/theme-init.js', 'js/data.js', 'js/block-editor.js', 'js/diagnostics.js', 'js/review.js',
  'js/profile-transfer.js', 'js/calculator.js', 'js/rest-timer.js',
  'js/chart.js', 'js/volume-sheet.js', 'js/qr-transfer.js',
  'js/app.js', 'js/boot-guard.js',
];

/* The shell loaded into one vm context against inert(): every script's top
   level has run, so every function is there to call directly, but nothing
   has drawn and nothing will — `ready` is false and `frozen` true. What
   most of test/unit.js needs, and cheap enough for the whole file to share
   one. */
function loadApp() {
  const store = {};
  const ctx = vm.createContext({
    document: {
      getElementById: () => inert(), createElement: () => inert(),
      querySelector: () => inert(), querySelectorAll: () => [],
      addEventListener() {}, documentElement: inert(), body: inert(), head: inert(),
    },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    navigator: {},
    location: { hostname: 'localhost', pathname: '/' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
  });
  ctx.window.self = ctx.window;
  ctx.globalThis = ctx;

  SHELL_SCRIPTS.forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

/* ---------- bootApp: the shell booted for real ----------
   loadApp() never boots. Its stub throws every handler away and parses
   nothing, so load()'s first draw falls into recovery and every test that
   uses it runs with `ready` false and `frozen` true. That is fine for
   arithmetic and no use for a handler: a test that wanted "Guardar
   cambios" or a tick copied the handler's code, and a copy cannot catch
   the bug in the original (plans/052).

   bootApp() runs the same scripts against a document that remembers
   instead, and load() runs for real. Still not a DOM — innerHTML is kept
   as a string and never parsed — so what a test here can assert is what a
   handler did to the data: the rows, the record, what save() wrote. What a
   person would see stays in test/smoke.js. */

/* Read off js/app.js rather than written out a third time: js/theme-init.js
   already carries a copy, and test/unit.js is what keeps that one honest. */
const STORAGE_KEY = /^const STORAGE_KEY = '([^']+)';$/m
  .exec(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'))[1];

/* A fixed moment, so a date in a test means the same thing on every run and
   on every machine: a Tuesday evening in September 2026, in UTC and in
   Spain alike. */
const BOOT_TIME = Date.UTC(2026, 8, 22, 18, 0, 0);

/* What the app hung on an element or on the document with
   addEventListener, kept so that fire() can reach it. */
const LISTENERS = Symbol('listeners');
function listening(target) {
  const on = target[LISTENERS] = Object.create(null);
  target.addEventListener = (type, fn) => { (on[type] = on[type] || []).push(fn); };
  target.removeEventListener = (type, fn) => { if (on[type]) on[type] = on[type].filter(f => f !== fn); };
  return target;
}

/* Everything the app hung on `type` — the on<type> property first, then
   each listener — called with the least an event has to carry. For the
   handlers bound with addEventListener, which a test cannot call by name;
   an onclick is simpler called directly, and hands back its promise. */
function fire(target, type, init) {
  const ev = Object.assign({ type, target, preventDefault() {}, stopPropagation() {} }, init);
  const out = [];
  if (typeof target['on' + type] === 'function') out.push(target['on' + type](ev));
  ((target[LISTENERS] || {})[type] || []).slice().forEach(fn => out.push(fn(ev)));
  return out;
}

/* A tag for an element a query conjures up, when the selector names one
   ('input', 'pre'); a class or an id says nothing about it. */
const tagIn = sel => (/^[a-z]+/i.exec(sel) || ['div'])[0];

/* One element of the fake document. What the app writes on it is kept as
   plain data — className, attributes, value, the children it appends, the
   handlers it hangs — and it answers each selector with one element of its
   own, the same one every time it is asked, so the box a card builder read
   back out of its innerHTML and bound handlers on is the box a test finds.
   querySelectorAll answers with three, which is what the set row's
   `const [wIn, rIn, rirIn]` needs. Replacing the subtree through innerHTML
   or textContent forgets those answers and detaches the children, the way
   a real replacement leaves the old nodes behind. */
function node(doc, tag) {
  let html = '', text = '';
  const attrs = Object.create(null), one = new Map(), all = new Map();
  const classes = () => String(el.className).split(/\s+/).filter(Boolean);
  const empty = () => {
    el.children.splice(0).forEach(c => { c.parentNode = null; });
    one.clear(); all.clear();
  };
  const el = listening({
    nodeType: tag === '#text' ? 3 : 1, tagName: String(tag).toUpperCase(),
    id: '', className: '', value: '', hidden: false, disabled: false, checked: false,
    style: {}, dataset: {}, children: [], parentNode: null,
    classList: {
      add: (...cs) => { el.className = classes().concat(cs.filter(c => !classes().includes(c))).join(' '); },
      remove: (...cs) => { el.className = classes().filter(c => !cs.includes(c)).join(' '); },
      toggle: (c, force) => {
        const on = force === undefined ? !classes().includes(c) : !!force;
        if (on) el.classList.add(c); else el.classList.remove(c);
        return on;
      },
      contains: c => classes().includes(c),
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    removeAttribute: k => { delete attrs[k]; },
    hasAttribute: k => k in attrs,
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); text = ''; empty(); },
    get textContent() { return text; },
    set textContent(v) { text = v == null ? '' : String(v); html = ''; empty(); },
    querySelector: sel => {
      if (!one.has(sel)) one.set(sel, node(doc, tagIn(sel)));
      return one.get(sel);
    },
    querySelectorAll: sel => {
      if (!all.has(sel)) all.set(sel, [0, 1, 2].map(() => node(doc, tagIn(sel))));
      return all.get(sel).slice();
    },
    appendChild: child => {
      if (child.parentNode) child.parentNode.removeChild(child);
      el.children.push(child);
      child.parentNode = el;
      return child;
    },
    removeChild: child => {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    remove: () => { if (el.parentNode) el.parentNode.removeChild(el); },
    replaceWith: other => {
      const p = el.parentNode;
      if (!p) return;
      if (other.parentNode) other.parentNode.removeChild(other);
      p.children[p.children.indexOf(el)] = other;
      other.parentNode = p;
      el.parentNode = null;
    },
    replaceChildren: (...kids) => { empty(); kids.forEach(k => el.appendChild(k)); },
    insertAdjacentHTML() {},
    contains: other => { for (let n = other; n; n = n.parentNode) if (n === el) return true; return false; },
    focus: () => { doc.activeElement = el; },
    blur: () => { if (doc.activeElement === el) doc.activeElement = doc.body; },
    select() {}, scrollIntoView() {},
    click: () => { fire(el, 'click'); },
  });
  return el;
}

/* One element per id, made the first time it is asked for: every id the
   app looks up is one index.html has, so there is no id to say null to. */
function fakeDocument() {
  const byId = new Map();
  const doc = listening({
    visibilityState: 'visible', hidden: false,
    getElementById: id => {
      if (!byId.has(id)) byId.set(id, Object.assign(node(doc, 'div'), { id }));
      return byId.get(id);
    },
    createElement: tag => node(doc, tag),
    createTextNode: text => Object.assign(node(doc, '#text'), { textContent: text }),
    execCommand: () => false,
  });
  const root = node(doc, '#document');
  doc.querySelector = root.querySelector;
  doc.querySelectorAll = root.querySelectorAll;
  doc.documentElement = node(doc, 'html');
  doc.head = node(doc, 'head');
  doc.body = node(doc, 'body');
  doc.activeElement = doc.body;
  return doc;
}

/* The clock a booted shell runs on, its timers and its Date alike. A real
   setInterval — the rest timer's is one tick of a set away — would keep
   Node alive after the last assertion; a queue that moves only when a test
   calls advance() cannot, and it lets a test step over save()'s debounce or
   a whole rest in one line instead of sleeping through it. `now` can be set
   outright, and both Date.now() and new Date() inside the shell read it. */
function fakeClock(start) {
  let seq = 0;
  const timers = [];
  const add = (fn, ms, args, every) => {
    timers.push({ id: ++seq, fn, args, every, at: clock.now + Math.max(0, Number(ms) || 0) });
    return seq;
  };
  const clear = id => {
    const i = timers.findIndex(t => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  const clock = {
    now: start,
    setTimeout: (fn, ms, ...args) => add(fn, ms, args, 0),
    setInterval: (fn, ms, ...args) => add(fn, ms, args, Math.max(1, Number(ms) || 0)),
    clearTimeout: clear, clearInterval: clear,
    /* Every timer that falls due in the next `ms`, in the order they fall
       due, each run with `now` standing at its own moment. */
    advance(ms) {
      const until = clock.now + ms;
      for (;;) {
        const due = timers.filter(t => t.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        clock.now = Math.max(clock.now, due.at);
        if (due.every) due.at += due.every; else clear(due.id);
        due.fn(...due.args);
      }
      clock.now = until;
    },
    pending: () => timers.length,
  };
  return clock;
}

/* Date inside the shell, on the fake clock: a subclass, so a date built
   from a timestamp is an ordinary one and only "now" is faked. */
const DATE_ON_CLOCK = `(function (now) {
  const RealDate = Date;
  Date = class Date extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(now()); }
    static now() { return now(); }
  };
})`;

/* A card on screen, found the way drawCard finds it — by exercise id in
   dayCards — or by its place in the day. `q(sel)` is the card's own answer
   to a selector, the element buildExCard bound its handler on; `set(i)` is
   the i-th set row's three boxes, its ↓ and its tick. Every tick and every
   draw builds the card anew, so look it up again after one. */
function cardOnScreen(call, which) {
  const entry = call('dayCards').find((c, i) => (typeof which === 'number' ? i === which : c.ex.id === which));
  if (!entry) return null;
  const el = entry.el;
  const rows = el.querySelector('.sets').children.filter(r => r.classList.contains('set-row'));
  return {
    el, ex: entry.ex, rows: entry.rows,
    q: sel => el.querySelector(sel),
    set(i) {
      const row = rows[i];
      if (!row) return null;
      const [w, r, rir] = row.querySelectorAll('input');
      return { row, w, r, rir, drop: row.querySelector('.drop-add'), tick: row.querySelector('.tick') };
    },
  };
}

/* The shell, booted: every script in SHELL_SCRIPTS against the fake
   document and on the fake clock, and load() run by app.js's own tail the
   way the page runs it. `state` is what localStorage holds before the
   boot — an object is stored as JSON, a string as it is (bytes that do not
   parse are the recovery screen's case); left out, the boot is a first run.
   `omit` leaves scripts out, the shell a returning phone gets when its
   service worker's precache is missing a split-out file: app.js's no-op
   stubs and typeof guards are all that stands between that shell and the
   recovery screen, and test/unit.js boots it without each guarded file.

   Hands back the context and `call` as loadApp's users know them, the
   document, the clock and the storage, and four helpers: `$` for an element
   by id, `saved()` for what save() last wrote, `card()` (above) and
   `type(el, value)`, which types into a box and fires its input handlers
   the way a keystroke does — plus fire(), above. */
function bootApp({ omit = [], state } = {}) {
  const clock = fakeClock(BOOT_TIME);
  const doc = fakeDocument();
  const store = {};
  if (state !== undefined) store[STORAGE_KEY] = typeof state === 'string' ? state : JSON.stringify(state);
  const win = listening({ matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) });
  const ctx = vm.createContext({
    document: doc,
    window: win,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    navigator: {},
    location: { hostname: 'localhost', pathname: '/', reloads: 0, reload() { this.reloads++; } },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    console,
  });
  win.self = win;
  ctx.globalThis = ctx;
  vm.runInContext(DATE_ON_CLOCK, ctx)(() => clock.now);

  SHELL_SCRIPTS.filter(f => !omit.includes(f)).forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  const call = expr => vm.runInContext(expr, ctx);
  return {
    ctx, call, doc, clock, store,
    $: id => doc.getElementById(id),
    saved: () => (STORAGE_KEY in store ? JSON.parse(store[STORAGE_KEY]) : null),
    card: which => cardOnScreen(call, which),
    type: (el, value) => { el.value = String(value); fire(el, 'input'); },
    fire,
  };
}

/* ---------- loadWorker: sw.js run for real ----------
   sw.js decides which release of the app a phone runs, and every serious
   incident this repo has had was in its upgrade path: the stuck loading
   screen twice (commit 5ed2906, then the js/chart.js split — a page and
   scripts from two releases), and an old worker serving a newer release's
   file into a hole in its own cache through the global caches.match
   (plan 058 B). All of them were found by reading the file. The unit suite
   only ever read sw.js as text, and test/smoke.js runs one real worker at
   one version, with stand-ins for the swap.

   loadWorker() runs the real sw.js in a vm context over a fake cache store
   and a fake network, both plain enough for a test to look inside and to
   change between events (plans/066):

     loadWorker({ version, network, caches, scope, transform, globalMatch }) → {
       ctx, call, self, caches, network, clients, url(), version,
       SHELL, VENDOR, SHELL_CACHE, RUNTIME_CACHE, VENDOR_CACHE,
       install(), activate(), message(data, ports), fetch(url, { mode, method }) }

   `version` rewrites the file's CACHE_VERSION line, and a second call
   handed the first one's `caches` and `network` shares its store: two
   releases on one phone, side by side. `transform` edits the source after
   that, for the suite's mutation checks, and `globalMatch` gives this
   worker the cross-cache caches.match the real store has — only for the
   mutation that proves a regression to it would be caught. Without it the
   fake has no caches.match at all, so a regression throws. */
const SW_VERSION_LINE = /^const CACHE_VERSION = '[^']*';$/gm;
const ACROSS = Symbol('match across every cache');

/* The fake CacheStorage. Every key — a Request, 'index.html', './', an
   absolute URL — becomes one absolute URL against the scope, so './' and
   the scope itself are one entry, the way they are one URL to a browser.
   A hit is handed back as a clone, or the second read of an entry would
   find its body already used. `network` and `scope` are kept on the store
   so a second worker sharing it cannot quietly disagree about either. */
function fakeCacheStorage({ abs, fetch, network, scope }) {
  const named = new Map();
  const cacheOf = entries => ({
    match: key => Promise.resolve(entries.has(abs(key)) ? entries.get(abs(key)).clone() : undefined),
    put: (key, response) => { entries.set(abs(key), response); return Promise.resolve(); },
    /* What the real cache.add does with anything but a 2xx: rejects, and
       stores nothing. precache's .catch is what turns that into a hole. */
    add: request => fetch(request).then(response => {
      if (!response.ok) throw new TypeError('cache.add: status ' + response.status);
      entries.set(abs(request), response);
    }),
    keys: () => Promise.resolve([...entries.keys()]),
    delete: key => Promise.resolve(entries.delete(abs(key))),
  });
  return {
    network, scope,
    open: name => {
      if (!named.has(name)) named.set(name, new Map());
      return Promise.resolve(cacheOf(named.get(name)));
    },
    has: name => Promise.resolve(named.has(name)),
    keys: () => Promise.resolve([...named.keys()]),
    delete: name => Promise.resolve(named.delete(name)),
    /* Test-only: every cache's URLs, by name, in creation order. */
    dump: () => {
      const out = {};
      named.forEach((entries, name) => { out[name] = [...entries.keys()]; });
      return out;
    },
    [ACROSS]: key => {
      for (const entries of named.values()) {
        if (entries.has(abs(key))) return Promise.resolve(entries.get(abs(key)).clone());
      }
      return Promise.resolve(undefined);
    },
  };
}

function loadWorker({ version, network, caches, scope = 'https://example.test/app/', transform, globalMatch = false } = {}) {
  let src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  if (version !== undefined) {
    const lines = src.match(SW_VERSION_LINE) || [];
    if (lines.length !== 1) throw new Error('loadWorker: sw.js has ' + lines.length + ' CACHE_VERSION lines, expected 1');
    src = src.replace(SW_VERSION_LINE, "const CACHE_VERSION = '" + version + "';");
  }
  if (transform) src = transform(src);

  const abs = key => new URL(typeof key === 'string' ? key : key.url, scope).href;
  if (caches && caches.scope !== scope) throw new Error('loadWorker: a shared store needs the same scope');
  if (caches && network && caches.network !== network) throw new Error('loadWorker: a shared store needs its own network');
  network = network || (caches && caches.network) || { online: true, files: null };
  if (network.online === undefined) network.online = true;
  if (!network.calls) network.calls = [];

  /* Every URL asked for is recorded, offline or not: that is how a test
     tells a cache hit from a trip to the network that failed. */
  const fetch = input => {
    const url = abs(input);
    network.calls.push(url);
    if (!network.online) return Promise.reject(new TypeError('offline'));
    const file = network.files[url];
    return Promise.resolve(file
      ? new Response(file.body, { status: file.status || 200 })
      : new Response('', { status: 404 }));
  };
  const store = caches || fakeCacheStorage({ abs, fetch, network, scope });
  const workerCaches = globalMatch ? Object.assign(Object.create(store), { match: store[ACROSS] }) : store;

  /* Node's own Request refuses the relative URLs fromServer() passes it
     ('index.html'), so the worker gets one that resolves them against the
     scope, the way a worker's Request resolves against its location. */
  class Request {
    constructor(input, init = {}) {
      this.url = new URL(typeof input === 'string' ? input : input.url, scope).href;
      this.mode = init.mode || (input && input.mode) || 'no-cors';
      this.method = init.method || (input && input.method) || 'GET';
      this.cache = init.cache;
    }
  }

  const clients = {
    claimed: false,
    claim() { clients.claimed = true; return Promise.resolve(); },
    matchAll: () => Promise.resolve([]),
  };
  /* An origin has no path: sw.js tests sameOrigin against location.origin
     and the app page against registration.scope, and a test that set both
     to the scope would skip every same-origin branch without a word. */
  const self = listening({
    location: { origin: new URL(scope).origin },
    registration: { scope },
    clients,
    skipped: false,
    skipWaiting() { self.skipped = true; return Promise.resolve(); },
  });

  const ctx = vm.createContext({
    self, caches: workerCaches, fetch, Request, Response, Headers, URL, setTimeout, console,
  });
  vm.runInContext(src, ctx, { filename: 'sw.js' });
  const call = expr => vm.runInContext(expr, ctx);
  const SHELL = call('SHELL');
  const VENDOR = call('VENDOR');
  const ownVersion = call('CACHE_VERSION');

  /* Every shell and vendor file, its body naming the release that served
     it, so a test can tell whose copy it was handed. */
  if (!network.files) {
    network.files = {};
    SHELL.concat(VENDOR).forEach(u => { network.files[abs(u)] = { status: 200, body: u + '@' + ownVersion }; });
  }

  /* install and activate hand back what the handler passed to waitUntil,
     so a test awaits the same promise the browser would. */
  const extendable = type => {
    const held = [];
    fire(self, type, { waitUntil(p) { held.push(p); } });
    return Promise.all(held);
  };
  return {
    ctx, call, self, caches: store, network, clients, url: abs, version: ownVersion,
    SHELL, VENDOR,
    SHELL_CACHE: call('SHELL_CACHE'), RUNTIME_CACHE: call('RUNTIME_CACHE'), VENDOR_CACHE: call('VENDOR_CACHE'),
    install: () => extendable('install'),
    activate: () => extendable('activate'),
    message: (data, ports) => { fire(self, 'message', { data, ports }); },
    /* Resolves to what the handler answered with, or null when it let the
       request go to the network by not answering at all. A listener that
       throws does so out of this call, synchronously, as one does out of
       install(), activate() and message(), where a browser would only log
       it: a caller that has to outlive a broken sw.js makes the call under
       a guard (attempt() in test/unit.js). */
    fetch: (url, { mode = 'no-cors', method = 'GET' } = {}) => {
      let answer = null;
      fire(self, 'fetch', { request: { url: abs(url), mode, method }, respondWith(p) { answer = Promise.resolve(p); } });
      return answer || Promise.resolve(null);
    },
  };
}

module.exports = { inert, SHELL_SCRIPTS, loadApp, bootApp, loadWorker, BOOT_TIME };
