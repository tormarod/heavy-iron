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
- **No modules.** Eight `<script>` tags share one global scope, in a fixed
  order (`index.html`, the `<script>` block at the foot of `<body>`):

  ```html
  <script src="js/data.js"></script>
  <script src="js/block-editor.js"></script>
  <script src="js/diagnostics.js"></script>
  <script src="js/review.js"></script>
  <script src="js/profile-transfer.js"></script>
  <script src="js/calculator.js"></script>
  <script src="js/rest-timer.js"></script>
  <script src="js/app.js"></script>
  ```

  `js/app.js` loads last because it wires the others together and then calls
  `load()`.
- **A file other than `app.js` must keep all its DOM wiring inside its own
  `wire*()` function**, called from `app.js`'s tail (`js/app.js:5437`):

  ```js
  wireBlockEditor();
  /* Guarded, unlike wireBlockEditor/wireProfileTransfer, because these
     four files are newer than some already-deployed shells: … */
  if (typeof wireDiagnostics === 'function') wireDiagnostics();
  if (typeof wireReview === 'function') wireReview();
  if (typeof wireCalculator === 'function') wireCalculator();
  if (typeof wireRestTimer === 'function') wireRestTimer();
  wireProfileTransfer();
  ```

  Any new file that can be added to an already-deployed shell needs the same
  `typeof ... === 'function'` guard, not a bare call. `js/app.js` is being
  split along its own section seams, one per pull request (plans/008 item
  13), so expect this list to keep growing: each new file needs the script
  tag *before* `js/app.js`, a `SHELL` entry in `sw.js`, a guarded
  `wire*()` call here, its place in `loadApp()` in `test/unit.js`, and a
  line in this list and in the README's layout table. A symbol `app.js`
  itself reads either stays in `app.js` or is stubbed to a no-op there when
  the file is missing (`js/rest-timer.js` does the latter for its five):
  the split file may be missing from an old cached shell, and `app.js`
  reaching for something that never loaded is the stuck-loading screen
  above.
- **Spanish for everything a user sees; English for code comments.**

## The release rule

**Bump `CACHE_VERSION` in `sw.js` whenever `index.html`, `css/` or `js/`
change**, and add any new shell file to the `SHELL` array in `sw.js`. The
shell is served cache-first, so a new `app.js` beside an untouched `sw.js`
leaves returning users on the old script indefinitely. CI enforces the
version bump (the `cache-version` job in `.github/workflows/test.yml`) but
**not** the `SHELL` array update — that half is on you.

## How to verify a change

There are three rungs. Use the cheapest one that can see your change, and
stop there — the full browser suite runs once, by itself, when the pull
request is opened.

```
node --check js/<file>.js                # 1. syntax, instant
node test/unit.js                        # 2. all pure logic, under a second
node test/smoke.js --only "<section>"    # 3. one browser section, ~5-10 s
```

**While working: rungs 1 and 2 after every edit. Do not run the full
`test/smoke.js` or `tools/smoke-gate.sh` yourself.** The full suite takes
about two and a half minutes and is wired as a PreToolUse hook in
`.claude/settings.json` on both `mcp__github__create_pull_request` and
`gh pr create`, so every path that opens a PR runs it exactly once and a
failure blocks the PR. Running it by hand before that point only repeats
what the hook is about to do. It skips itself on a branch that changes
nothing the suites load (the shell, `sw.js`, `blocks/`, `test/`).

Rung 3 is for the things `test/unit.js` cannot see — a sheet opening, a
value surviving a reload, `sw.js`, the layout — and it is targeted:
`node test/smoke.js --list` prints the section names,
`--only <substring>` (repeatable, case-insensitive) runs just those, and
needs a static server on `:8765` (or `BASE=`) plus Playwright:

```
npm install --no-save playwright@1.56.1  # once — the README omits this
npx playwright install chromium          # once
python3 -m http.server 8765 &
```

The whole suite by hand is warranted in three cases only: you edited
`test/smoke.js` itself, you changed the script load order or `sw.js`, or
the hook failed and you are checking the fix — and even then, iterate
with `--only` on the failing section and let the hook do the final full
pass. Only `test/unit.js` runs on GitHub. It loads the six source files into
one shared Node context — the same global scope the `<script>` tags create,
in the same order — and is the fastest full check. A new file under `js/`
goes into that list too, in the position its `<script>` tag has.

**Testing policy** (`test/smoke.js:9-10`): *"Add a case here whenever a bug
turns out to have been invisible from the outside."* Arithmetic and data
repair go in `test/unit.js` instead — and prefer that side of the line when
a case fits either: a unit assertion costs nothing on every later run, a
smoke assertion costs Chromium time forever.

## Untrusted input

Anything arriving from a file, a paste, `blocks/`, or a QR scan is
untrusted. It goes through a `normalizeImported*` function
(`js/block-editor.js:207` is the reference implementation) and is escaped
with `esc` (`js/app.js:32`) on the way out. Limits are enforced in
`IMPORT_LIMITS` (`js/app.js:2284`) — not just clamped, some values (like
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

See `README.md`'s "Project layout" table (~line 1599) for the full map. It
is the reference; this file is the briefing.
