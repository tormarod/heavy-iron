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
- **No modules.** Thirteen `<script>` tags share one global scope — twelve
  of them in a fixed order at the foot of `<body>` (`index.html`):

  ```html
  <script src="js/data.js"></script>
  <script src="js/block-editor.js"></script>
  <script src="js/diagnostics.js"></script>
  <script src="js/review.js"></script>
  <script src="js/profile-transfer.js"></script>
  <script src="js/calculator.js"></script>
  <script src="js/rest-timer.js"></script>
  <script src="js/chart.js"></script>
  <script src="js/volume-sheet.js"></script>
  <script src="js/qr-transfer.js"></script>
  <script src="js/app.js"></script>
  <script src="js/boot-guard.js"></script>
  ```

  `js/app.js` loads after the ten it wires together and then calls
  `load()`. `js/boot-guard.js` is the one tag after it, on purpose: it has
  to run even when `app.js` could not, so it may depend on nothing else
  (see the mixed-shell note below).

  One more script, `js/theme-init.js`, loads earlier still — in `<head>`,
  before `css/style.css` — so `data-theme` is set before the stylesheet is
  applied at all and "auto" never flashes light for a moment on a dark
  system (plans/008 item 20). It has no `wire*()` — it is a self-invoking
  read of the theme preference, not DOM wiring — but it is still in `SHELL`
  and still loaded by `test/unit.js`'s `loadApp()`, first, ahead of this list.
- **A file other than `app.js` must keep all its DOM wiring inside its own
  `wire*()` function**, called from `app.js`'s tail (at the foot of that
  file — no line number here, it moves):

  ```js
  wireBlockEditor();
  /* Guarded, unlike wireBlockEditor/wireProfileTransfer, because the files
     below are newer than some already-deployed shells: … */
  if (typeof wireDiagnostics === 'function') wireDiagnostics();
  if (typeof wireReview === 'function') wireReview();
  if (typeof wireCalculator === 'function') wireCalculator();
  if (typeof wireRestTimer === 'function') wireRestTimer();
  if (typeof wireChart === 'function') wireChart();
  if (typeof wireVolumeSheet === 'function') wireVolumeSheet();
  if (typeof wireQrTransfer === 'function') wireQrTransfer();
  wireProfileTransfer();
  ```

  Any new file that can be added to an already-deployed shell needs the same
  `typeof ... === 'function'` guard, not a bare call. `js/app.js` was split
  along its own five section seams, one per pull request (plans/008 item 13,
  now done); a further split follows the same recipe. Each new file needs
  the script tag *before* `js/app.js`, a `SHELL` entry in `sw.js`, a
  guarded `wire*()` call here, its place in `loadApp()` in
  `test/unit.js`, and a line in this list and in the README's layout
  table.

  Two rules the five seams settled, and they are what keeps a split safe:

  1. **A symbol `app.js` itself reads either stays in `app.js` or is
     stubbed to a no-op there.** The split file may be missing from an old
     cached shell (a precache hole), and `app.js` reaching for something
     that never loaded is the stuck-loading screen above. `js/rest-timer.js` is stubbed for
     five, `js/chart.js` and `js/qr-transfer.js` for one each.
  2. **A symbol another split file reads stays in `app.js` outright** — a
     stub cannot help there, because a plausible-looking empty answer is
     worse than a dead button. That is why the volume arithmetic, the
     `blockShare*` builders and the `normalizeImported*` validators
     stayed behind while their screens left.

  The mix the other way round — a *new* split file loading beside the
  *old* cached `app.js`, both declaring the same top-level `const`/`let`,
  so `app.js` fails to parse and nothing runs — shipped twice (commit
  `5ed2906`, then the `js/chart.js` split). It came from `sw.js` serving
  navigations network-first: a returning user got the new `index.html`
  over old cached scripts, and the script tags the old cache had never
  seen were fetched fresh. Since `sw.js` v55 the page comes from the same
  precache as its scripts, so a normal deploy cannot produce that shell
  any more; a release lands only through the "Actualizar" swap. What is
  still possible is a precache hole, which the `typeof` guards cover, and
  `js/boot-guard.js` is the last line either way: if nothing has drawn by
  the time it runs, it hands over to the worker already waiting with a
  complete shell and reloads.
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

When it blocks, read what it tells you rather than re-running the suite to
find out: it prints the failing assertions — with the diagnostic each one
carries after the arrow — on stderr, which is the part of a blocked hook you
are shown, and writes the whole run to `.smoke-gate.log` (gitignored,
truncated per run, `SMOKE_GATE_LOG` to move it).

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
pass. Only `test/unit.js` runs on GitHub. It loads every shell script into
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

Strict, in a `<meta>` tag at `index.html`. No inline scripts or styles may
be added — `style-src` has no `'unsafe-inline'` any more (plans/008 item
22), so a literal `style="..."` attribute anywhere, including one stamped
into an `innerHTML` string, is a silent, console-only failure to apply that
style. Use a class in `css/style.css` instead — the `/* ---- utility classes
---- */` section there is the pattern for a value that would otherwise be a
one-off inline style. Most are named `.u-*`, but a few (`.sheet-lead`,
`.calc-row`) are named for what they hold instead, per that section's own
comment — the section is identified by location, not by prefix. A value
computed at runtime (a chart's max-width) goes
through a real CSSOM property assignment (`el.style.maxWidth = ...`), which
the CSP does not restrict, never `setAttribute('style', ...)` or
`.style.cssText`, which it does. This is why the webfont flip lives in a
real script rather than an inline `onload`.

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
function showRecovery(err, raw, mode) {
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
