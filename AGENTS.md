# AGENTS.md

A Spanish-language gym training log for two people, shipped as a static PWA
to GitHub Pages. All data lives in `localStorage`; there is no server and
nothing is synced.

Every recent merge to this repo has come from an agent. This file exists so
each session stops re-deriving the same handful of invariants from scratch —
getting one wrong has already shipped a user-visible crash (commit
`5ed2906`). It transcribes what is already true elsewhere in the repo; it
does not invent policy. Start with the checklist: for each kind of change it
names what has to change with it, and the section below that says why.

## Before you change anything

Find the change you are about to make. Each line says what has to move with
it, what fails if it does not, and where the reasons are. Quoted names are
test sections: the `== … ==` headings `node test/unit.js` prints (unit), or
the `test/smoke.js` sections `--only` takes (smoke). "Review" means no test
or CI job fails, and a reviewer is the only check. How to run the checks is
[How to verify a change](#how-to-verify-a-change).

- **Anything in `index.html`, `css/` or `js/`** — bump `CACHE_VERSION` in
  `sw.js` with `tools/bump-cache-version.sh`. Held by CI's `cache-version`
  job, and on `main` by the deploy guard in `pages.yml`.
  → [The release rule](#the-release-rule)
- **A new file in `js/`** — its `<script>` tag before `js/app.js`, a `SHELL`
  entry in `sw.js`, its place in `SHELL_SCRIPTS`, a guarded `wire*()` call,
  a line in this file's script list and a row in the README's layout table.
  Held by unit "the four script lists agree" and "the split rules hold in
  the source" (a bare `wire*()` call), and by CI's `cache-version` (a file
  missing from `SHELL`); the two lists are review.
  → [`wire*()` and the split recipe](#wire-and-the-split-recipe)
- **A symbol one script reads from another** — what `app.js` reads from a
  split file stays in `app.js` or is stubbed there (rule 1); what one split
  file reads from another stays in `app.js` outright (rule 2). Held by unit
  "the split rules hold in the source" and "a precache hole: the shell
  boots, ticks and draws without each guarded file".
  → [The two split rules](#the-two-split-rules-surviving-a-precache-hole)
- **An id new to `index.html`, read outside `app.js`** — a null guard on
  every read. Held by unit "an unguarded $(id) is at least as old as the
  file reading it". → [Ids read outside `app.js`](#ids-read-outside-appjs)
- **Any code in `js/` or `sw.js`** — nothing newer than Safari 15 supports.
  Held by unit "shipped scripts parse on Safari 15".
  → [Constraints](#constraints-that-are-decisions-not-gaps)
- **A style** — a class in `css/style.css`, never a `style` attribute; a
  value computed at runtime through a CSSOM property; `--edge` for control
  borders, `--line` for dividers, `--amber-ink` for amber text. Held by unit
  "css tokens keep WCAG contrast" for the pairs it names (a new pair only
  once it is added there), and by smoke "main session" and "accesibilidad:
  reduced motion y CSP sin unsafe-inline", which fail on a CSP violation on
  the screens they open. → [The CSP](#the-csp)
- **Anything read from a file, a paste, `blocks/` or a QR scan** — a
  `normalizeImported*` on the way in, `esc` on the way out, and the limits
  in `IMPORT_LIMITS`, `OWN_LIMITS` and `PROFILE_LIMITS`. Held by the unit
  sections named for each `normalizeImported*`, "hostile objects in string
  and number fields" and the plans/010 limit sections, and by smoke "main
  session" (a hostile imported block). → [Untrusted input](#untrusted-input)
- **A new key on a profile** — an entry in `RECORD_PARTS` with its
  `accept`, or in `NON_RECORD_FIELDS` if it is not part of the record. Held
  by unit "RECORD_PARTS: one table for the profile's record" and
  "RECORD_PARTS: each part says how it is accepted".
  → [The profile's record, in one table](#the-profiles-record-in-one-table)
- **A new field on a plan exercise** — one entry in `EX_FIELDS`. Held by
  unit "EX_FIELDS: what a plan exercise may hold, in one table".
  → [What a plan exercise may hold](#what-a-plan-exercise-may-hold)
- **A destructive action** — `ask` first; then `snapshotForUndo` before
  its first write, with no `await` between; its dialog never says "No se
  puede deshacer" (the promise it may make is `UNDO_PROMISE`); and a
  booted test presses its real button, then "Deshacer". Held by unit
  "\"Deshacer\" on every action that offers it, through its real button",
  which pins the list of actions.
  → [Destructive actions and Deshacer](#destructive-actions-and-deshacer)
- **Code that reads or writes logged sets** — read through `sessionsOf`,
  and copy an answer before changing it; after a write to `log`, `rir` or
  a block's plan, call `save()` or `commit()` before the next draw; a new
  `save('view')` or scoped `save()` goes on the list the unit suite pins.
  Held by unit "the history cache: one read per question, dropped by the
  write" (the pinned list, the frozen answers); reading through
  `sessionsOf` rather than raw rows is review.
  → [Reading logged sets](#reading-logged-sets),
  [the history cache](#the-history-cache-and-what-save-claims)
- **A log key, or a walk over a block's slots** — `slot(week, dayId)` and
  `parseSlot` build and read it, `forEachSlot` walks it; never the regex by
  hand, never keys rebuilt week by week. Held by unit "the log key has one
  reader as well as one builder", which scans every file in `js/`.
  → [Log keys and slot walks](#log-keys-and-slot-walks)
- **Anything a user sees** — Spanish; a new or changed behaviour is written
  up in `docs/guide.md`, not the README. Review.
  → [Spanish on screen](#spanish-on-screen-english-in-comments),
  [Where things live](#where-things-live)
- **A code comment** — English, saying why in prose. Review.
  → [Comment style](#comment-style)

## Constraints that are decisions, not gaps

Several things this repo is missing are missing on purpose. An absence looks
identical to an oversight unless someone writes down which it is:

- **No build step, no bundler, no `package.json`, no TypeScript.** Plain
  HTML/CSS/JS, served by any static server. Do not add a build step.
- **Safari 15 is the floor.** No regex lookbehind, `.at()`,
  `Object.hasOwn`, `structuredClone`, `findLast`, … in `js/*.js` or
  `sw.js`; the list and the check live in `test/unit.js` ("shipped
  scripts parse on Safari 15"). A regex literal the browser cannot parse
  is a SyntaxError for the whole file, which is the stuck loading screen
  (plans/059).
- **No modules.** Thirteen `<script>` tags share one global scope.

### The script list

Twelve of the tags are in a fixed order at the foot of `<body>`
(`index.html`):

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

`js/app.js` loads after the ten it wires together and then calls `load()`.
`js/boot-guard.js` is the one tag after it, on purpose: it has to run even
when `app.js` could not, so it may depend on nothing else (see
[Mixed shells, and the boot guard](#mixed-shells-and-the-boot-guard)).

One more script, `js/theme-init.js`, loads earlier still — in `<head>`,
before `css/style.css` — so `data-theme` is set before the stylesheet is
applied at all and "auto" never flashes light for a moment on a dark
system (plans/008 item 20). It has no `wire*()` — it is a self-invoking
read of the theme preference, not DOM wiring — but it is still in `SHELL`
and still first in `SHELL_SCRIPTS` (`test/harness.js`), the list the unit
suite loads, ahead of this list.

### `wire*()` and the split recipe

**A file other than `app.js` must keep all its DOM wiring inside its own
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
`typeof ... === 'function'` guard, not a bare call.

`js/app.js` was split along its own five section seams, one per pull
request (plans/008 item 13, now done); a further split follows the same
recipe. Each new file needs:

- its `<script>` tag *before* `js/app.js`;
- a `SHELL` entry in `sw.js` ([the release rule](#the-release-rule));
- its place in `SHELL_SCRIPTS` in `test/harness.js`, in the position its
  `<script>` tag has;
- a guarded `wire*()` call in the tail above;
- a line in [the script list](#the-script-list), and one in the README's
  [layout table](README.md#project-layout).

### The two split rules: surviving a precache hole

Two rules the five seams settled, and they are what keeps a split safe:

1. **A symbol `app.js` itself reads either stays in `app.js` or is
   stubbed to a no-op there.** The split file may be missing from an old
   cached shell (a precache hole), and `app.js` reaching for something
   that never loaded is the stuck-loading screen above. `js/rest-timer.js`
   is stubbed for five and `js/chart.js` for one. `js/qr-transfer.js` needed
   one until sheets registered their own teardown (plans/009 item 1):
   structure can retire a stub, by removing the read rather than
   answering it.
2. **A symbol another split file reads stays in `app.js` outright** — a
   stub cannot help there, because a plausible-looking empty answer is
   worse than a dead button. That is why the volume arithmetic, the
   `blockShare*` builders and the `normalizeImported*` validators
   stayed behind while their screens left, and why the Diagnóstico's
   rows (`diagRows`, `freqRows`, `strengthRows` and what they are built
   from, which the block review exports) are in `app.js` while its
   sheet is in `js/diagnostics.js`.

`test/unit.js` holds both rules to the source: it fails on a read that
breaks either one, naming the file and line. It also boots the shell
without each guarded file in turn, ticks a set on the real card and draws
every week of a block with a mid-block deload. That draw is where
`deloadCheck` used to reach `strengthByExercise` in `js/diagnostics.js`,
unstubbed, and fall into recovery; it lives in `app.js` now. And it boots
each hole to press "+ Nuevo bloque → Ver la revisión", and holds the review
each one shows to a whole shell's, word for word. Without
`js/diagnostics.js` that review threw and no block was made — the one
rule-2 breach that stood, until the Diagnóstico's rows moved into
`app.js`. None stands now.

### Ids read outside `app.js`

Both rules are about symbols, and **both read the same on ids**: an id
that is new to `index.html` and looked up by a split file needs a null
guard (`const b = $('reviewBtn'); if (b) b.onclick = …`), because a
precache hole can serve the new copy of that file against a shell whose
`index.html` has never heard of the id. An id that merely *moved* needs
nothing — every shell that has the file has the id. plans/037 added four
new ones (`#reviewBtn`, `#newBlockBtn`, `#importBtn`, `#manageBtn`, plus
`#tnext` and `#navBar` in `js/rest-timer.js`) and guarded every read;
`wireBlockEditor()` is one of the
[two unguarded calls](#the-pre-split-exception) in the tail above, so a
throw inside it takes `load()` with it and the app never draws.

`test/unit.js` holds this rule to the source the way it holds the two
symbol rules: an unguarded `$('id')` in a file other than `app.js` fails
when `git` dates that id in `index.html` after the commit that added the
reading file (plans/058 — nine ids in four files had slipped past review,
invisible here because the harness manufactures an element for every id).

### The pre-split exception

Both rules have one exception, and it is older than the rules:
`js/data.js`, `js/block-editor.js` and `js/profile-transfer.js` predate
the split and are precached in every deployed shell, so a symbol defined
in them is treated as if it were in `app.js`. That is why
`wireBlockEditor()` and `wireProfileTransfer()` are the two unguarded
calls in the list above (`js/data.js` has no wiring of its own), why `app.js`
may read `normalizeImportedBlock` from `js/block-editor.js` with no stub,
and why `js/review.js` may read `buildAiPrompt` from it. A file split out
*since* then gets no such licence.

### Mixed shells, and the boot guard

The mix the other way round — a *new* split file loading beside the
*old* cached `app.js`, both declaring the same top-level `const`/`let`, so
`app.js` fails to parse and nothing runs — shipped twice (commit
`5ed2906`, then the `js/chart.js` split). It came from `sw.js` serving
navigations network-first: a returning user got the new `index.html` over
old cached scripts, and the script tags the old cache had never seen were
fetched fresh. Since `sw.js` v55 the page comes from the same precache as
its scripts, so a normal deploy cannot produce that shell any more; a
release lands only through the "Actualizar" swap. What is still possible
is a precache hole, which the `typeof` guards cover, and
`js/boot-guard.js` is the last line either way: if nothing has drawn by
the time it runs, it hands over to the worker already waiting with a
complete shell and reloads.

### Spanish on screen, English in comments

**Spanish for everything a user sees; English for code comments.** How a
comment is written is a convention of its own:
[Comment style](#comment-style).

## The release rule

**Bump `CACHE_VERSION` in `sw.js` whenever `index.html`, `css/` or `js/`
change**, and add any new shell file to the `SHELL` array in `sw.js`. The
shell is served cache-first, so a new `app.js` beside an untouched `sw.js`
leaves returning users on the old script indefinitely.

CI enforces both halves: the `cache-version` job in
`.github/workflows/test.yml` fails a pull request whose shell changed
without a bump, and its second step fails one whose `js/*.js` or
`css/*.css` file is missing from `SHELL`. `test/unit.js` closes the rest
of that circle ("the four script lists agree", plans/014): it holds
`index.html` and `SHELL_SCRIPTS` in `test/harness.js` to the same files in
the same order, and `SHELL` to membership only — every `index.html` script
is in it, and every `js/` entry in it exists on disk. The deploy workflow
(`.github/workflows/pages.yml`, plans/061) guards the same change against
what is live, so if two PRs both bump `CACHE_VERSION` from the same base,
the second deploy fails and requires another bump on `main`.

`tools/bump-cache-version.sh` does the bump, so a red `cache-version` run
costs one command rather than a round-trip: `--dry-run` prints the current
and next version without writing.

## How to verify a change

There are three rungs. Use the cheapest one that can see your change, and
stop there — the full browser suite runs once, by itself, when the pull
request is opened.

```
node --check js/<file>.js                # 1. syntax, instant
node test/unit.js                        # 2. logic and handlers' data, ~1 s
node test/smoke.js --only "<section>"    # 3. one browser section, ~5-10 s
```

**While working: rungs 1 and 2 after every edit. Do not run the full
`test/smoke.js` or `tools/smoke-gate.sh` yourself.**

### The pull request hook

The full suite takes about two and a half minutes and is wired as a
PreToolUse hook in `.claude/settings.json` on both
`mcp__.*__create_pull_request` — any MCP server's create-PR tool,
`mcp__github__create_pull_request` among them, since plans/061 — and
`gh pr create`, so every path that opens a PR runs it exactly once and a
failure blocks the PR. Running it by hand before that point only repeats
what the hook is about to do. It skips itself on a branch that changes
nothing the suites load (the shell, `sw.js`, `manifest.webmanifest`,
`blocks/`, `test/`).

When it blocks, read what it tells you rather than re-running the suite to
find out: it prints the failing assertions — with the diagnostic each one
carries after the arrow — on stderr, which is the part of a blocked hook
you are shown, and writes the whole run to `.smoke-gate.log` (gitignored,
truncated per run, `SMOKE_GATE_LOG` to move it).

The whole suite by hand is warranted in three cases only: you edited
`test/smoke.js` itself, you changed the script load order or `sw.js`, or
the hook failed and you are checking the fix — and even then, iterate
with `--only` on the failing section and let the hook do the final full
pass.

### Rung 3: one browser section

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

### The unit suite and its three loaders

Only `test/unit.js` runs on GitHub. It loads every shell script into a
Node context — the same global scope the `<script>` tags create, in the
same order — and is the fastest full check.

`test/harness.js` loads the shell two ways, and the worker a third, and a
test picks by what it touches (plans/052, plans/066):

- **`loadApp()`, for pure logic** — `migrate()`, the validators, the
  statistics, called directly. It is the one context most of
  `test/unit.js` shares, and it never boots: its document keeps nothing,
  so `load()`'s first draw falls into recovery, `ready` is false, `frozen`
  is true and there is no handler to press.
- **`bootApp({ omit, state })`, for what a handler does to the data.** It
  boots for real — `state` seeds `localStorage`, `load()` draws — against
  a document that remembers (one element per id, one answer per selector,
  every handler kept) and on a fake clock. A test presses the app's own
  handler (`boot.$('copyPrev').onclick()`, or a card's tick through
  `boot.card(exId).set(i)`), steps over `save()`'s debounce with
  `boot.clock.advance(ms)`, and asserts the rows, the record and what
  `boot.saved()` holds. A test that would otherwise copy a handler's code,
  or swap out `render`/`save` to get at one, boots instead. It is still
  not a DOM — `innerHTML` is never parsed — so what a person sees stays in
  `test/smoke.js`.
- **`loadWorker({ version, caches, network })`, for `sw.js`.** The real
  worker over a fake cache store and a fake network, with `install()`,
  `activate()`, `message()` and `fetch()` to fire its events. `version`
  rewrites its `CACHE_VERSION`, and two calls sharing one store (pass the
  first one's `caches` and `network`) are two releases side by side on one
  phone — the upgrade path, where this repo's worst bugs were. The fake
  store has no global `caches.match`, so a read that strays outside a
  worker's own cache throws.

### Testing policy

`test/smoke.js:10-11`: *"Add a case here whenever a bug turns out to have
been invisible from the outside."* Arithmetic and data repair go in
`test/unit.js` instead, and so does what a handler writes, through
`bootApp()` — and prefer that side of the line when a case fits either: a
unit assertion costs nothing on every later run, a smoke assertion costs
Chromium time forever.

## Untrusted input

Anything arriving from a file, a paste, `blocks/`, or a QR scan is
untrusted.

- **In and out.** It goes through a `normalizeImported*` function
  (`normalizeImportedBlock` in `js/block-editor.js` is the reference
  implementation) and is escaped with `esc` (top of `js/app.js`) on the
  way out.
- **Limits reject.** Limits are enforced in `IMPORT_LIMITS` (grep for it
  in `js/app.js`) — not just clamped, some values (like `ex.add`) reject
  the import outright rather than silently coercing it.
- **The app's own files.** A backup or profile file is the app's own data
  coming back and has its own ceilings (`OWN_LIMITS`, `PROFILE_LIMITS`),
  and every limit that path enforces has to be one the app's own writers
  cannot exceed — which is why the plan editor stops at `IMPORT_LIMITS`,
  and "+ Nuevo bloque" and every import at `PROFILE_LIMITS.blocks` — or
  the app's own backup stops restoring (plans/010's promise, broken by a
  15th day and then by a 41st block).
- **Text.** Text keeps the same promise: every box in the plan editor
  stops at its `IMPORT_LIMITS` length, and a restore takes up to
  `OWN_TEXT_LIMIT` in the fields the editor did not always cap
  (plans/055).
- **The record's parts.** A part of the profile's record is accepted by
  its own `accept` in `RECORD_PARTS` (`js/app.js`): its value check,
  re-keyed to the ids its block landed with. `normalizeImportedProfile`
  (`js/profile-transfer.js`; `normalizeImportedBackup` runs it on every
  profile of a backup) loops over the table with it, and the
  `normalizeImportedLog`/`Rir`/`Order`/`Obj` the QR path calls are thin
  calls to it — a new check goes on the part, not beside one of those
  names.
- **A plan exercise's fields** are accepted through `EX_FIELDS`: see
  [What a plan exercise may hold](#what-a-plan-exercise-may-hold).
- **Unknown keys.** A restored or loaded profile keeps only the table's
  parts and `NON_RECORD_FIELDS`, and a backup's top level only
  `BACKUP_FIELDS`; any other key a file carries is dropped (plans/051).
- **Keys that index `state.profiles`.** A key that will be used to
  *index* `state.profiles` — a backup's `activeProfile`, a profile file's
  `key` — is checked as an own property first (`migrate()`,
  `profileSlotFor` in `js/profile-transfer.js`), because a plain object
  answers `obj['constructor']` truthily and `obj['__proto__'] = x`
  re-points its prototype (plans/040).
- **Block ids from storage.** Block ids read back from storage get the
  same test in `migrate()`, since localStorage never passes through an
  import: `activeBlock` and every `blockOrder` entry must be own keys of
  `profile.blocks`, a block filed under a name `safeKey` refuses moves to
  a fresh key with its record, and a block's `id` is always its key,
  because that id is what every write to the record is filed under.

## The data model's rules

### Log keys and slot walks

One shape is worth naming here because it is read outside `js/app.js`: a log
key is `slot(week, dayId)` and is read back by `parseSlot`, both in
`js/app.js`, and nothing else runs the regex. `test/unit.js` ("parseSlot()
is the only place that runs the slot regex") fails if any file in `js/`
runs it outside `parseSlot`.
To walk one block of any part of the profile's record keyed by slot, use
`forEachSlot` rather than rebuilding keys week by week: it visits the
slots that exist, which is the only way a purge reaches a week filed
above `MAX_WEEKS`.

### The profile's record, in one table

The maps that make up **the profile's record** (`CONTEXT.md`) are declared
in one place, `RECORD_PARTS` in `js/app.js`, beside `forEachSlot`: each
entry says how its part is keyed, how a move merges it, whether it travels
with a shared block, how a value from outside is accepted
([Untrusted input](#untrusted-input)), and why. Every purge
(`purgeRecord`), the move in the plan editor (`moveExerciseRecord`),
migrate's creation and repair (`ensureRecord`), `installBlockData`, and
the import and restore (each part's `accept`, plans/051) loop over that
table, and so do the tests, so a new part is one entry there rather than
an edit at each operation. `test/unit.js` fails if a migrated profile
carries a key that is neither in the table nor in `NON_RECORD_FIELDS`
beside it, the same list a restore keeps, and if a part has no `accept`.

Only the block share still builds its parts by hand
(`blockShareLog`/`Rir`/`Order`): its payload's keys are a contract with
phones on older shells, and `test/unit.js` fails if they stop being the
parts marked `travelsWithBlock`.

### Reading logged sets

To *read* what was lifted, use `sessionsOf` (`js/app.js`, "sessions: the
one reading of the log") instead of filtering raw log rows: it owns which
sets are ticked and worked, the deload week, stranded weeks, lift
matching, unit conversion and the legacy RIR fallback, and the query says
which of those a screen wants. Its `weeks` option has no default on
purpose. Every reader of logged sets was moved onto it by
`plans/done/038-session-reader.md`; a new reader starts there. The words
(session, working set, extra set, stranded week, …) are in `CONTEXT.md`.

### The history cache and what `save()` claims

The answers of `sessionsOf` are cached between draws
(`plans/done/045-history-cache.md`) and come back **frozen**: copy one
before changing it. The cache is emptied by `save()`, so a write to
`log`, `rir` or a block's plan that does not call `save()` (or
`commit()`) before the next draw leaves a stale objetivo on screen.
`save('view')` and a card's `save(here)` are narrower claims ("nothing a
session reads changed", "only this lift's rows in this slot");
`test/unit.js` pins the list of them, so a new one is added there on
purpose. A replaced `state` or profile, and a unit switch, need nothing.

### Legacy `rir`

`rir` is legacy since plans/035: read as a fallback, and never written a
value again — `dropLegacyRir` only ever DELETES from it, dropping the
entry for the exercise-session a box is recording, because without that a
value cleared on anything logged before that plan comes straight back off
the map through `foldRirMap` on the next load. The record is `row.rir` on
the log row — one digit per set, typed into the third box of the set row
since plans/036 — so it travels with every purge, move and share the row
does, and `foldRirMap` moves the old map onto the rows on load and on
import.

### Variants and the objetivo

`variants` is the one part of the record keyed by exercise id rather than
by block and slot (`exId → [{ n, since }]`, read only by `variantSince`),
so it is never walked by slot, and no purge or move reaches it — its
`RECORD_PARTS` entry says why. The objetivo rule that reads it and `obj`
lives in `js/app.js` under "peso objetivo" (`targetFor`) and is
documented in `docs/guide.md` §
["The weekly objetivo"](docs/guide.md#the-weekly-objetivo) — both maps
are absent from every backup written before v3, so every reader copes
with them missing.

### What a plan exercise may hold

What a plan exercise may hold is declared once, in `EX_FIELDS`
(`js/app.js`): each field's default, its `repair` for `migrate()`, its
`accept` on the strict and own paths, the editor's length and the AI
prompt's line. `migrate()`, the import's exercise map, the editor and the
prompt all read it, so a new field is one entry there, and `test/unit.js`
fails when the code writes an exercise field the table does not declare.

### Destructive actions and Deshacer

Every destructive action asks first — "Guardar cambios" in the plan
editor is the exception: it only `tell`s on an error, before the
snapshot, and snapshots on every save regardless, because what it
erases was already confirmed inside the editor, row by row — then takes
one snapshot of the whole state before its first write
(`snapshotForUndo`, `js/app.js`), and "Deshacer" on the toast it leaves
puts that snapshot back. The snapshot must come before the action's
writes with no `await` between them, or the action must arm it itself —
those writes land while it is still unarmed, and the first `save()`
after it is armed ends the undo (`undoArmed`, `js/app.js`, says why).
Undo ends there, at the next change of any kind or a write adopted from
another tab (plans/060); depth and reload limits are in [Documented
limits](#documented-limits--settled-decisions-not-bugs). A dialog in
front of a snapshot never says "No se puede deshacer". The promise it
may make instead is `UNDO_PROMISE`, and five do: each of the three ways
to delete a block, "Cargar copia" and loading a profile file. The one
dialog that still says "No se puede deshacer" is deleting a retired
exercise's log in the plan editor, which is right to, since nothing
snapshots that path until the editor's own save.

The six, each tested through its real button with "Deshacer" pressed
after: "Borrar este día" and "Guardar cambios" in the plan editor (unit
"bootApp(): the shell booted for real, and its own handlers" and
"\"Editar plan\" on a booted app: send, retire, erase, save", plans/052
and plans/053), and "Borrar todos los datos", deleting a block, "Cargar
copia" and loading a profile file (unit "\"Deshacer\" on every action
that offers it, through its real button", plans/073, which also pins the
list so a seventh call needs the same test first).

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
computed at runtime (a chart's max-width) goes through a real CSSOM
property assignment (`el.style.maxWidth = ...`), which the CSP does not
restrict, never `setAttribute('style', ...)` or `.style.cssText`, which it
does. This is why the webfont flip lives in a real script rather than an
inline `onload`.

Colour tokens follow a similar one-place rule: control borders use
`--edge`, dividers `--line`, amber text `--amber-ink` (fills stay
`--amber`). The unit suite ("css tokens keep WCAG contrast") computes,
straight from `css/style.css` and in both themes, the contrast of the
foreground/background pairs it names — `--soft`, `--ink`, `--amber-ink`,
`--edge`, `--signal`, `--on-signal`, `--on-share`, `--share-ink`,
`--danger`, the rest timer's tokens and the profile accents, each on the
surfaces it sits on — and a pair below 4.5:1 (text) or 3:1 (borders)
fails `node test/unit.js` (plans/032). A new pair is checked only once it
is added there.

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

- **Spanish only.** Translating is a real project, not a patch. A language
  preference is wired in already, with no control on screen yet, for the
  English version to come — the CSV export follows it today.
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
