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
  `wire*()` function**, called from `app.js`'s tail (at the foot of that file):

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
     five and `js/chart.js` for one. `js/qr-transfer.js` needed one until
     sheets registered their own teardown (plans/009 item 1): structure can
     retire a stub, by removing the read rather than answering it.
  2. **A symbol another split file reads stays in `app.js` outright** — a
     stub cannot help there, because a plausible-looking empty answer is
     worse than a dead button. That is why the volume arithmetic, the
     `blockShare*` builders and the `normalizeImported*` validators
     stayed behind while their screens left.

  Both rules are about symbols, and **both read the same on ids**: an id
  that is new to `index.html` and looked up by a split file needs a null
  guard (`const b = $('reviewBtn'); if (b) b.onclick = …`), because a
  precache hole can serve the new copy of that file against a shell whose
  `index.html` has never heard of the id. An id that merely *moved* needs
  nothing — every shell that has the file has the id. plans/037 added four
  new ones (`#reviewBtn`, `#newBlockBtn`, `#importBtn`, `#manageBtn`, plus
  `#tnext` and `#navBar` in `js/rest-timer.js`) and guarded every read;
  `wireBlockEditor()` is one of the two unguarded calls in the tail above,
  so a throw inside it takes `load()` with it and the app never draws.

  Both rules have one exception, and it is older than the rules: `js/data.js`,
  `js/block-editor.js` and `js/profile-transfer.js` predate the split and are
  precached in every deployed shell, so a symbol defined in them is treated as
  if it were in `app.js`. That is why `wireBlockEditor()` and
  `wireProfileTransfer()` are the two unguarded calls in the list above
  (`js/data.js` has no wiring of its own), why `app.js` may read
  `normalizeImportedBlock` from `js/block-editor.js` with no stub, and why
  `js/review.js` may read `buildAiPrompt` from it. A file split out *since*
  then gets no such licence.

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
leaves returning users on the old script indefinitely. CI enforces both
halves: the `cache-version` job in `.github/workflows/test.yml` fails a pull
request whose shell changed without a bump, and its second step fails one
whose `js/*.js` or `css/*.css` file is missing from `SHELL`. `test/unit.js`
closes the rest of that circle — it asserts `index.html`, `SHELL` and
`loadApp()` name the same files in the same order (plans/014).

`tools/bump-cache-version.sh` does the bump, so a red `cache-version` run
costs one command rather than a round-trip: `--dry-run` prints the current
and next version without writing.

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
npm install --no-save --ignore-scripts playwright@1.56.1  # once
npx playwright install chromium          # once
python3 -m http.server 8765 &                                 # Git Bash
Start-Process python3 -ArgumentList '-m','http.server','8765' # PowerShell
```

`--ignore-scripts` on purpose: it is the one place this repo would run
third-party code at install time, and `tools/smoke-gate.sh` installs the
same way (its comment says why).

`tools/*.sh` are bash scripts. On Windows run them from Git Bash, or as
`bash tools/smoke-gate.sh` from PowerShell; the hook in
`.claude/settings.json` resolves the shebang itself.

The whole suite by hand is warranted in three cases only: you edited
`test/smoke.js` itself, you changed the script load order or `sw.js`, or
the hook failed and you are checking the fix — and even then, iterate
with `--only` on the failing section and let the hook do the final full
pass. Only `test/unit.js` runs on GitHub. It loads every shell script into
one shared Node context — the same global scope the `<script>` tags create,
in the same order — and is the fastest full check. A new file under `js/`
goes into that list too, in the position its `<script>` tag has.

**Testing policy** (`test/smoke.js:10-11`): *"Add a case here whenever a bug
turns out to have been invisible from the outside."* Arithmetic and data
repair go in `test/unit.js` instead — and prefer that side of the line when
a case fits either: a unit assertion costs nothing on every later run, a
smoke assertion costs Chromium time forever.

## Untrusted input

Anything arriving from a file, a paste, `blocks/`, or a QR scan is
untrusted. It goes through a `normalizeImported*` function
(`normalizeImportedBlock` in `js/block-editor.js` is the reference
implementation) and is escaped with `esc` (top of `js/app.js`) on the way
out. Limits are enforced in `IMPORT_LIMITS` (grep for it in `js/app.js`)
— not just clamped, some values (like `ex.add`) reject the import outright
rather than silently coercing it. A key that will be used to *index*
`state.profiles` — a backup's `activeProfile`, a profile file's `key` — is
checked as an own property first (`migrate()`, `profileSlotFor` in
`js/profile-transfer.js`), because a plain object answers
`obj['constructor']` truthily and `obj['__proto__'] = x` re-points its
prototype (plans/040).

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
real script rather than an inline `onload`. Colour tokens follow a similar
one-place rule: control borders use `--edge`, dividers `--line`, amber text
`--amber-ink` (fills stay `--amber`), and the unit suite computes the
contrast of every token pair straight from `css/style.css`, so a new pair
below 4.5:1 (text) or 3:1 (borders) fails `node test/unit.js` (plans/032).

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

See `README.md`'s table under the `## Project layout` heading for the full
map. It is the reference; this file is the briefing.

Documentation is split in two. `README.md` is the technical file: what the
repo does, running it, the tests, the layout, the block JSON shape and
hosting. Every user-facing behaviour — what a screen does and why it does
it that way — is written up in `docs/guide.md`, and a change that adds or
alters one documents it there, not in the README. The README's "What it
does" list only names features and links into the guide.

One shape is worth naming here because it is read in four files: a log key
is `slot(week, dayId)` and is read back by `parseSlot`, both in `js/app.js`,
and nothing else runs the regex — `test/unit.js` fails if anything does.
To walk one block of `log`/`rir`/`notes`/`energy`/`order`/`obj`, use
`forEachSlot` rather than rebuilding keys week by week: it visits the slots
that exist, which is the only way a purge reaches a week filed above
`MAX_WEEKS`.

To *read* what was lifted, use `sessionsOf` (`js/app.js`, "sessions: the
one reading of the log") instead of filtering raw log rows: it owns which
sets are ticked and worked, the deload week, stranded weeks, lift
matching, unit conversion and the legacy RIR fallback, and the query says
which of those a screen wants. Its `weeks` option has no default on
purpose. The existing readers are moving onto it one PR at a time
(`plans/038-session-reader.md`); a new reader starts there. The words
(session, working set, extra set, stranded week, …) are in `CONTEXT.md`.

`variants` is the one per-profile map keyed by exercise id rather than by
block and slot (`exId → [{ n, since }]`, read only by `variantSince`), so it
is never walked by slot and is not in any purge or move helper's list; and
the objetivo rule that reads both lives in `js/app.js` under "peso
objetivo" (`targetFor`) and is documented in `docs/guide.md` § "The weekly
objetivo" — both maps are absent from every backup written before v3, so
every reader copes with them missing.

`rir` is legacy since plans/035: read as a fallback, and never written a
value again — `dropLegacyRir` only ever DELETES from it, dropping the entry
for the exercise-session a box is recording, because without that a value
cleared on anything logged before that plan comes straight back off the map
through `foldRirMap` on the next load. The record is `row.rir` on the log row
— one digit per set, typed into the third box of the set row since plans/036
— so it travels with every purge, move and share the row does, and
`foldRirMap` moves the old map onto the rows on load and on import.
