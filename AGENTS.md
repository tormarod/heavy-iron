# AGENTS.md

A Spanish-language gym training log for two people, shipped as a static PWA
to GitHub Pages. All data lives in `localStorage`; there is no server and
nothing is synced.

Every recent merge to this repo has come from an agent. This file exists so
each session stops re-deriving the same handful of invariants from scratch —
getting one wrong has already shipped a user-visible crash (commit
`5ed2906`). It transcribes what is already true elsewhere in the repo; it
does not invent policy.

## Constraints that are decisions, not gaps

Several things this repo is missing are missing on purpose. An absence looks
identical to an oversight unless someone writes down which it is:

- **No build step, no bundler, no `package.json`, no TypeScript.** Plain
  HTML/CSS/JS, served by any static server. Do not add a build step.
- **No modules.** Six `<script>` tags share one global scope, in a fixed
  order (`index.html:479-484`):

  ```html
  <script src="js/data.js"></script>
  <script src="js/block-editor.js"></script>
  <script src="js/diagnostics.js"></script>
  <script src="js/review.js"></script>
  <script src="js/profile-transfer.js"></script>
  <script src="js/app.js"></script>
  ```

  `js/app.js` loads last because it wires the others together and then calls
  `load()`.
- **A file other than `app.js` must keep all its DOM wiring inside its own
  `wire*()` function**, called from `app.js`'s tail (`js/app.js:4783-4798`):

  ```js
  wireBlockEditor();
  /* Guarded, unlike wireBlockEditor/wireProfileTransfer, because these two
     files are newer than some already-deployed shells: a returning user
     whose service worker still holds the previous index.html can be served
     this app.js against markup that has no script tag for them yet. An
     unguarded call would throw here, load() below would never run, and the
     app would sit on "Cargando tu registro…" — the same stuck screen the
     first script split caused. Losing a button until the worker updates is
     the right failure. */
  if (typeof wireDiagnostics === 'function') wireDiagnostics();
  if (typeof wireReview === 'function') wireReview();
  wireProfileTransfer();
  ```

  Any new file that can be added to an already-deployed shell needs the same
  `typeof ... === 'function'` guard, not a bare call.
- **Spanish for everything a user sees; English for code comments.**

## The release rule

**Bump `CACHE_VERSION` in `sw.js` whenever `index.html`, `css/` or `js/`
change**, and add any new shell file to the `SHELL` array in `sw.js`. The
shell is served cache-first, so a new `app.js` beside an untouched `sw.js`
leaves returning users on the old script indefinitely. CI enforces the
version bump (the `cache-version` job in `.github/workflows/test.yml`) but
**not** the `SHELL` array update — that half is on you.

## How to verify a change

```
node --check js/<file>.js                # fast syntax gate
node test/unit.js                        # pure logic, no server, no browser
npm install --no-save playwright@1.56.1  # once — the README omits this
npx playwright install chromium          # once
python3 -m http.server 8765 &
node test/smoke.js                       # drives the real app in a browser
```

Both suites run on every pull request. `test/unit.js` loads the six source
files into one shared Node context — the same global scope the `<script>`
tags create — and is the fastest full check.

**Testing policy** (`test/smoke.js:9-10`): *"Add a case here whenever a bug
turns out to have been invisible from the outside."* Arithmetic and data
repair go in `test/unit.js` instead.

## Untrusted input

Anything arriving from a file, a paste, `blocks/`, or a QR scan is
untrusted. It goes through a `normalizeImported*` function
(`js/block-editor.js:207` is the reference implementation) and is escaped
with `esc` (`js/app.js:23`) on the way out. Limits are enforced in
`IMPORT_LIMITS` (`js/app.js:2073`) — not just clamped, some values (like
`ex.add`) reject the import outright rather than silently coercing it.

## The CSP

Strict, in a `<meta>` tag at `index.html:9`. No inline scripts or styles may
be added. This is why the webfont flip lives in a real script rather than an
inline `onload`.

## Comment style

The repo's most distinctive convention, and the easiest for an agent to
violate. Comments explain *why*, in prose, often naming the bug they
prevent — not what the code does. Two examples from the source:

```js
/* ---------- recovery ----------
   The app draws straight from whatever is in localStorage, so data it cannot
   read used to mean a white screen and no way back. Instead: stop writing
   (so the broken copy is not overwritten with something worse), and offer to
   hand the raw bytes over as a file before anything is thrown away. */
function showRecovery(err, raw) {
```

```js
/* Nothing here ever touches localStorage: your training log lives there and
   the cache is disposable. Bump CACHE_VERSION on release — the old caches
   are deleted on activate, and the app shows an "Actualizar" prompt rather
   than swapping the code under a session in progress. */
```

## Documented limits — settled decisions, not bugs

- **Spanish only.** Translating is a real project, not a patch.
- **No sync.** By design — there is no server.
- **QR transfer is one-way and manual.** It does not merge.
- **Undo is one level deep** and doesn't survive a reload.
- **Two profiles, no more.**

Proposing to "fix" any of these is re-litigating a settled choice, not
finding a gap. If one needs to change, that is a bigger conversation than
this file.

## Where things live

See `README.md`'s "Project layout" table (~line 1477) for the full map. It
is the reference; this file is the briefing.
