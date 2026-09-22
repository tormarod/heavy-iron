# Plan 066: The service worker runs under test — install with a hole, activate offline, two releases side by side, and the swap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` unless you were told otherwise.
>
> **Drift check (run first)**:
> `git diff --stat b15ae87..origin/main -- sw.js test/harness.js test/unit.js`
> Re-locate every anchor by `grep`, never by line number alone.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW — test-only; `sw.js` is not changed, so no `CACHE_VERSION`
  bump.
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `b15ae87`, 2026-09-22 (tenth audit, finding 13)

## Why this matters

`sw.js` decides which release of the app a phone runs, and every serious
incident this repo has had was in its upgrade path: the stuck loading
screen twice (commit `5ed2906`, then the `js/chart.js` split — a page and
scripts from two releases), and, on 2026-09-22, the fetch handler reading
the global `caches.match`, which let an old worker serve a newer release's
file into a hole in its own cache (plan 058 B). All were found by reading
the code. Today nothing *runs* `sw.js`:

- `test/unit.js` reads it as text (the `SHELL` list; "no bare
  `caches.match(`").
- `test/smoke.js` runs one real worker at one version; its "Actualizar"
  and boot-guard sections replace the registration with stand-ins.

Nothing executes `install` with a failed precache entry, `activate`
offline, the fetch handler with two releases' caches present, or an N→N+1
swap. `sw.js` is 233 lines of plain event handlers over `caches`,
`fetch` and `clients` — cheap to run in a Node `vm` context with fakes,
the same way `test/harness.js` already runs the page scripts.

## Current state

- `sw.js` (read it whole before starting — 233 lines). The parts the
  tests exercise:
  - Constants: `CACHE_VERSION` (`'v126'` at planning time), `SHELL_CACHE =
    'heavy-iron-shell-' + CACHE_VERSION`, `RUNTIME_CACHE =
    'heavy-iron-runtime-' + CACHE_VERSION`, `VENDOR_CACHE =
    'heavy-iron-vendor-' + VENDOR_VERSION`, the `SHELL` and `VENDOR` lists.
  - `fromServer(url)` → `new Request(url, { cache: 'reload' })`;
    `fromCache(name, key)` → `caches.open(name).then(c => c.match(key))`.
  - `precache(cacheName, urls)`: `cache.add(fromServer(url)).catch(() => null)`
    per URL — a failure is swallowed.
  - `repairCache(cacheName, urls)`: re-`add`s what `cache.match(url)`
    misses. `repairAll()` does SHELL and VENDOR.
  - `install`: `event.waitUntil(Promise.all([precache(SHELL_CACHE, SHELL), precache(VENDOR_CACHE, VENDOR)]))`.
  - `activate`: deletes every cache not named `SHELL_CACHE`,
    `RUNTIME_CACHE` or `VENDOR_CACHE`, then `repairAll`, then
    `self.clients.claim()`.
  - `message`: `'skipWaiting'` → `self.skipWaiting()`; `'version'` with a
    port → `ports[0].postMessage(CACHE_VERSION)`; `'checkShell'` → `repairAll()`.
  - `fetch`: non-GET ignored; `navigate` to the app page → shell cache's
    `index.html`, else network-first into `SHELL_CACHE`, falling back to
    the shell cache's `index.html` / `./`; same-origin `/blocks/` →
    `networkFirst(…, RUNTIME_CACHE)`; `/js/vendor/` → `cacheFirst(…,
    VENDOR_CACHE)`; other same-origin → `cacheFirst(…, SHELL_CACHE)`;
    Google Fonts hosts → `cacheFirst(…, RUNTIME_CACHE)`. `cacheFirst`
    caches only `response.ok` responses (so an opaque response is never
    cached).
- `test/harness.js` — the model to follow. It builds a `vm` context with
  hand-written fakes and runs the shell scripts in it; `listening(target)`
  gives any object `addEventListener`/`removeEventListener`, and
  `fire(target, type, init)` calls a target's listeners (search both).
  `module.exports = { inert, SHELL_SCRIPTS, loadApp, bootApp, BOOT_TIME };`
  is at the end.
- `test/unit.js` — the async part of the suite is one
  `(async () => { … })();` block starting ≈ line 7049 and ending with
  `console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);`.
  Async tests go inside it, before that line. Sections start with
  `console.log('\n== <title> ==');`; assertions are `ok(name, cond, extra)`.
- Node: CI runs Node 22 (`.github/workflows/test.yml`), which has global
  `Request`, `Response`, `Headers` and `URL` — but a `vm` context does not
  inherit them, and Node's `Request` rejects relative URLs; Step 1 says
  what to pass in and what to fake.
- Two behaviours the ninth audit recorded as **decisions pending, not
  bugs** (`plans/README.md`, "Ninth audit", finding 7): `RUNTIME_CACHE` is
  keyed on `CACHE_VERSION`, so every release discards cached blocks and
  fonts; and `activate` deletes the old shell cache before `repairAll`.
  Tests here **characterize** those as they are, and say so in their
  names, so a future change to them is a visible, deliberate test edit.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check test/harness.js` / `node --check test/unit.js` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |

## Scope

**In scope**: `test/harness.js` (a new `loadWorker()` export),
`test/unit.js` (a new section), `AGENTS.md` (one bullet, Step 3).

**Out of scope**: `sw.js` (no change — if a test shows a real bug, record
it in Maintenance notes and write the test to characterize current
behaviour, named as such; do not fix it here); `test/smoke.js`;
`js/boot-guard.js`.

## Git workflow

Branch `claude/066-sw-tests` from `origin/main`, one commit per step,
plain-sentence subjects, your session's `Co-Authored-By:` line. No bump
(nothing in the shell changes; the `cache-version` CI job will agree).

## Steps

### Step 1: `loadWorker()` in `test/harness.js`

Add, with a comment in the file's style explaining what it is for (the
upgrade path is where this repo's worst bugs were; this runs the real
`sw.js`):

```js
/* loadWorker({ version, network, caches, scope, transform, globalMatch }) → {
     ctx, self, caches, network, clients,
     install(), activate(), message(data, ports), fetch(url, { mode }) } */
```

- **`version`**: optional. When given, the source of `sw.js` is loaded with
  its `const CACHE_VERSION = '…';` line replaced by that version — the one
  way to have two releases side by side. Assert the replacement happened
  (the line must exist exactly once) and throw otherwise.
- **`caches`**: a fake `CacheStorage`, shared when passed in (so an old
  and a new worker see one store), else a new one. Implement:
  `open(name)` (creates), `keys()`, `delete(name)`, `has(name)`, and a
  test-only `dump()` → `{ name: [urls…] }`. Each cache: `match(key)`,
  `put(key, response)`, `add(request)` (fetch it through the fake network;
  reject unless `response.ok` — that is what the real `cache.add` does),
  `keys()`, `delete(key)`. Normalise every key (a `Request`, a relative
  string like `'index.html'` or `'./'`, or an absolute URL) to an absolute
  URL string against the **scope** (default `'https://example.test/app/'`),
  so `'./'` and `'https://example.test/app/'` are one key. Store responses
  and hand back a **clone** from `match` (`response.clone()`), or a second
  read of the same entry throws "Body already used". **No global
  search across caches** — by default there is deliberately no
  `caches.match` on the fake, so a regression to the global read throws.
  Only `globalMatch: true` (Step 2's mutation check (a), nowhere else)
  adds one that searches every cache in creation order.
- **`network`**: a plain object the test controls — `{ online: true,
  files: { '<abs url>': { status: 200, body: '…' } } }`. The fake `fetch`
  rejects with `TypeError('offline')` when `online` is false, resolves a
  `404` `Response` for an unknown URL, and records every URL it was asked
  for in `network.calls`. Pass it in to share it; default: every `SHELL`
  and `VENDOR` URL present with a body naming the version (e.g.
  `'<url>@' + version`), so a test can tell which release served a file.
- **Origin vs scope — get this right or every same-origin branch is
  skipped silently.** `sw.js` computes `sameOrigin` as
  `new URL(request.url).origin === self.location.origin`, and an origin
  has no path. So with `scope = 'https://example.test/app/'`, set
  `self.location.origin = new URL(scope).origin` (`'https://example.test'`)
  and `self.registration.scope = scope`. Build every test URL from the
  scope (`new URL('js/chart.js', scope).href`).
- **Globals the context needs** — a `vm` context has none of them by
  default: `URL` (pass Node's), `Response` and `Headers` (pass Node's), and
  a **fake `Request`**: Node's own `Request` throws on the relative URLs
  `fromServer` passes (`new Request('index.html', …)` → "Failed to parse
  URL"). A small class is enough:
  `class Request { constructor(input, init = {}) { this.url = new URL(typeof input === 'string' ? input : input.url, scope).href; this.mode = init.mode || (input && input.mode) || 'no-cors'; this.method = init.method || (input && input.method) || 'GET'; this.cache = init.cache; } }`.
  Plus `caches`, `fetch`, `self`, `setTimeout`, `console`.
- **`self`**: `listening({ location: { origin: new URL(scope).origin }, registration: { scope },
  skipWaiting() { self.skipped = true; } })`, and **`self.clients = clients`**
  where `clients` is
  `{ claim() { clients.claimed = true; return Promise.resolve(); }, matchAll: () => Promise.resolve([]) }`
  — `sw.js` calls `self.clients.claim()`.
- **Event helpers**: `install()` fires `install` with an event whose
  `waitUntil(p)` collects `p`, and returns `Promise.all` of what was
  collected. Same for `activate()`. `message(data, ports)` fires
  `message`. `fetch(url, { mode = 'no-cors', method = 'GET' } = {})` builds
  a `Request`-like object `{ url: abs, mode, method }` (a plain object is
  fine; `sw.js` reads `.url`, `.mode`, `.method`), fires `fetch` with an
  event whose `respondWith(p)` stores `p`, and resolves to the response
  (or `null` if the handler did not respond).

Export it beside `bootApp`. Give it a test-only `transform(src)` option
(applied to the source after the version replacement) for Step 2's
mutation checks.

`networkFirst` and `cacheFirst` call `cache.put` without awaiting it, so
after any fetch that should have filled a cache, `await settle()` (the
async block already defines `const settle = () => new Promise(r => setImmediate(r));`)
a few times before asserting on the store or going offline.

**Versions**: use `v900`, `v901` … in these tests, never `v1`/`v2` —
`VENDOR_VERSION` is `'v1'`, so a shell version `v1` would give caches
whose names are easy to confuse with `heavy-iron-vendor-v1`.

**Verify**: `node --check test/harness.js`; `node test/unit.js` →
`0 failed` (nothing uses it yet).

### Step 2: The tests

A new section inside the async block of `test/unit.js`:
`console.log('\n== sw.js runs: install, activate, fetch, the swap (plans/066) ==');`.
One `ok` per case, each case with its own `loadWorker` (fresh store)
unless it says "shared":

1. **Install precaches everything.** `install()` → `dump()` has every
   `SHELL` URL in `heavy-iron-shell-<v>` and every `VENDOR` URL in the
   vendor cache.
2. **A 404 during install does not fail it, and leaves a hole.** Remove
   `js/chart.js` from `network.files`; `install()` resolves; the shell
   cache lacks `js/chart.js`.
3. **`checkShell` repairs the hole once the file is back.** Continue 2:
   put the file back, `message('checkShell')`, await a tick
   (`await new Promise(r => setImmediate(r))`, repeated until the fake
   store stops changing or 10 times), → the shell cache has it.
4. **Activate deletes old caches and claims.** Shared store: put caches
   `heavy-iron-shell-v900` and `heavy-iron-runtime-v900` in it; a worker
   at `v901` installs and activates → neither `-v900` cache exists; the
   vendor cache (`heavy-iron-vendor-` + the file's `VENDOR_VERSION`) is
   still there with its entries; `clients.claimed === true`. Name the runtime part
   `…and (as decided so far — ninth audit #7) the old runtime cache goes too`.
5. **Activate offline still claims, and does not throw.** `network.online = false`
   after install; `activate()` resolves; `claimed === true`.
6. **Navigate serves the shell's own page.** After install, go offline;
   `fetch(origin, { mode: 'navigate' })` → body is the cached
   `index.html`'s.
7. **Two releases side by side: each reads only its own cache.** Shared
   store and shared network. Old worker `v900` installs with
   `js/chart.js` removed from the network (a hole in its cache). Then put
   `js/chart.js` **back** and change every body to `…@v901`, and a new
   worker `v901` installs (its cache complete, `js/chart.js` included).
   Now go offline and have the *old* worker handle
   `fetch(new URL('js/chart.js', scope).href)` → it must **not** return the
   `@v901` body from the new worker's cache (it may reject or return a
   failed response — assert only "not the v901 body"; catch a rejection
   and count it as a pass). This is plan 058 B's property, pinned by
   execution.
8. **`cacheFirst` does not keep a non-ok response.** Request a same-origin
   URL not in `SHELL` whose network answer is `500`; then again with the
   network offline → no cached copy is served.
9. **Blocks are network-first with an offline fallback.** Serve
   `blocks/index.json` online (it lands in the runtime cache), go offline,
   fetch again → the cached body.
10. **The swap.** Continue 7: `message('skipWaiting')` on the new worker →
    `self.skipped === true`; `activate()` → the `v900` shell cache is
    gone, the `v901` one is complete.
11. **`version` answers with the worker's own version.** A fake port
    `{ postMessage(v) { this.got = v; } }` → `got === 'v<n>'` for a worker
    loaded with that version.

Mutation checks (through `loadWorker`'s `transform`, never by editing
`sw.js` on disk): (a) inside `cacheFirst` only, replace
`return fromCache(cacheName, request).then(hit => {` with
`return caches.match(request).then(hit => {` — a plain first-occurrence
`replace('fromCache(cacheName, request)', …)` would hit `networkFirst`
instead, which comes first in the file. For this mutation give the fake
store a **global** `match(key)` that searches every cache in creation
order (the real `caches.match` behaviour), enabled only by a
`globalMatch: true` option — then case 7 must FAIL by returning the
`@v901` body. (b) remove `.catch(() => null)` from `precache` → case 2
FAILs. Run each mutated worker through the same case function and assert
the case's result is false; record both in the PR.

**Verify**: `node test/unit.js` → the 11 new cases PASS, `0 failed`,
total run time still ~2 s.

### Step 3: Say it exists

In `AGENTS.md` § "How to verify a change", the paragraph describing
`test/harness.js` says it "loads the shell two ways" and lists
`loadApp()` and `bootApp()`. Add a third bullet — **`loadWorker()`, for
`sw.js`**: the real worker over a fake cache store and network; two calls
sharing a store are two releases side by side — and change "two ways" so
the sentence stays true (e.g. "loads the shell two ways, and the worker
a third").

**Verify**: `node test/unit.js` → `0 failed`.

## Test plan

Eleven cases and two mutation checks, all in `test/unit.js`.

## Done criteria

- [ ] `grep -n "loadWorker" test/harness.js` → definition and export
- [ ] `node test/unit.js` → `0 failed`, 11 new `(plans/066)`-section cases
- [ ] `git diff --stat origin/main...HEAD` shows only `test/harness.js`,
      `test/unit.js`, `AGENTS.md`
- [ ] `sw.js` byte-identical to `origin/main`'s

## STOP conditions

- `sw.js` uses an API the fakes cannot reasonably provide (e.g.
  `navigationPreload`, `BroadcastChannel`) by the time you run this.
- A case fails against the **unmodified** `sw.js` in a way that looks like
  a real bug, not a fake's shortcoming: stop, report the case and what it
  shows. Do not change `sw.js`.
- The suite's runtime grows past ~5 s.

## Maintenance notes

- Any change to `sw.js`'s caching rules now shows up as a failing case
  here; update the case in the same PR and say why in its name.
- If the maintainer decides ninth-audit #7 (runtime cache lifetime,
  delete-before-repair), cases 4 and 10 are where the decision is pinned.
- *(Executor: record deviations here.)*
