# Plan 058: Three fixes from the ninth audit — an id newer than its reader is guarded and checked, the worker reads one cache, and a phase label's number counts only next to "RIR"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" for your step; the orchestrator maintains
> `plans/README.md`.
>
> **This plan is three independent pull requests**, one per step (A, B,
> C), each by its own executor on its own branch `claude/058-<letter>`.
> Read the whole plan, then execute only your step. Every step changes a
> shell file, so every PR bumps `CACHE_VERSION`: run
> `tools/bump-cache-version.sh` as your last commit before opening the PR,
> and when the orchestrator tells you another 058 PR has merged, rebase on
> `origin/main`, take the highest version on conflict, and bump again if
> you are no longer above it.
>
> **Drift check (run first)**:
> `git diff --stat 7791eb9..origin/main -- js/block-editor.js js/review.js js/profile-transfer.js js/diagnostics.js sw.js js/app.js test/unit.js test/harness.js .github/workflows/test.yml`
> Other sessions land PRs mid-task. Re-locate every anchor below by grep,
> not by line number.

## Status

- **Priority**: P1 (A, C), P2 (B)
- **Effort**: S each
- **Risk**: LOW (A, B), LOW–MED (C: one intended number change, in a
  case no seed block reaches)
- **Category**: correctness — findings 1, 2 and 3 of the ninth audit of
  2026-09-22 (`plans/README.md`, "Ninth audit")
- **Planned at**: commit `7791eb9`, 2026-09-22

## Why this matters

All three are the repo's own rules, already written down, with one
instance each that slipped past review during the 200 commits of
2026-09-21/22:

- **A.** AGENTS.md, "Both rules read the same on ids": an id new to
  `index.html` that a file other than `app.js` looks up needs a null
  guard, because a precache hole serves the new copy of that file against
  a page that has never heard of the id. `sw.js`'s `repairCache` makes the
  hole a steady state rather than a moment: it re-`add`s the missing URL
  from the server, which is the *current* release of that one file, into
  the *old* shell cache. Three readers break this rule today, and the
  unit suite cannot see any of them because `test/harness.js`'s fake
  document manufactures an element for every id.
- **B.** `sw.js` serves every same-origin request through the global
  `caches.match(request)`, which searches every cache in creation order.
  While a new worker is installed and waiting (from install until the
  "Actualizar" swap, which can be days), `heavy-iron-shell-vN` and `-vN+1`
  both exist, so a file the old cache lacks is served from the new one —
  the mixed shell of commit `5ed2906`, by a route the navigate branch's
  comment does not list. `repairCache` already scopes to one cache with
  `cache.match`; the serving path should too.
- **C.** `phaseRir` reads the plan's RIR out of the free text in
  `phase[w].r`. It prefers digits next to "RIR", and otherwise falls back
  to the *lowest number anywhere in the label*. Nothing downstream clamps
  the result to `RIR_MAX` (5). "Descarga 60%" reads as 60 and
  "Semana 6 · 10 reps" as 6; `weekRir` hands it to `repsAt` and to the
  rung walk, and every card that week prescribes a lower weight with the
  `moreRir`/`floor` notes — silently, for every exercise. `recordTarget`
  then stores that number as `obj.rir`, which the record's own `accept`
  discards on restore (`rec.rir <= RIR_MAX`), so the app writes a value
  its own backup cannot carry — the plans/010 promise, broken. The
  function's own comment says a phase "somebody wrote in their own words"
  should return `null`; the fallback contradicts it. Every seed phase
  label in `js/data.js` and `blocks/*.json` either carries "RIR" or has
  no digit at all, so dropping the fallback moves no seed number.

## The decisions (settled 2026-09-22 — do not re-open)

1. **A guards, and adds a check that dates ids against their readers.**
   The guard shape is the one `js/review.js` already uses for
   `#reviewBtn`: `const b = $('id'); if (b) …`. A read whose whole
   function is pointless without the element may return early instead.
   The check is a unit test: for every `$('<literal>')` in every
   `js/*.js` file other than `js/app.js`, the read is either guarded or
   the id is at least as old in `index.html` as the file that reads it
   (both dates from `git log`). `js/app.js` is out of scope: it is
   precached in every shell and reads hundreds of ids; a hole in it is
   what `js/boot-guard.js` exists for.
2. **B scopes every read to the cache the branch names**, via
   `caches.open(name).then(c => c.match(request))`. No behaviour changes
   in a whole shell. The navigate fallback (`caches.match('index.html')`
   then `'./'`) scopes to `SHELL_CACHE`. A unit assertion pins that
   `sw.js` contains no bare `caches.match(`.
3. **C: a number counts only next to "RIR", and only within `RIR_MAX`.**
   `phaseRir` returns `null` for a label with no "RIR" in it, whatever
   digits it holds, and `null` for a value above `RIR_MAX`. `weekRir`'s
   existing `null` path (the reserve the last session was left at, else
   0) is the fallback, unchanged. The `ex.minRir` floor is already
   capped at 5 by `EX_FIELDS`, so `weekRir` can no longer exceed
   `RIR_MAX` by any route, and `recordTarget`'s `rir` is always a value
   the `obj` part's `accept` keeps.
4. **Accepted behaviour change (C only):** a block whose phase label
   names a week or a percentage with no "RIR" beside it stops being read
   as a RIR prescription. The one unit case that pinned the old reading
   (`"Semana 3 de 5"` → 3) flips to `null`.

## Steps

### A. Guard the ids newer than their readers; the suite dates ids against files (P1, own PR)

**A.1** Guard these reads. Each id entered `index.html` after the file
that reads it was first committed (verify each date with
`git log --format='%h %ad' --date=short -S'id="<id>"' -- index.html | tail -1`
against `git log --diff-filter=A --format='%h %ad' --date=short -- js/<file>`):

- `js/block-editor.js`, `renderBlockBar`, `const chip = $('blockBtn')`
  (id from `d57879f`, 2026-09-20; file from 2026-08-26). Unguarded,
  called from every draw: on a holed shell it throws inside `drawApp`,
  `render` catches it, and a user with intact data lands on the
  recovery screen — which `js/boot-guard.js` deliberately does not rescue.
  Guard the whole chip block; the picker itself still renders.
- `js/review.js`, `wireReview`: `$('reviewImport').onclick`, and the
  `$('reviewBlob')` / `$('reviewStatus')` reads inside that handler and
  in `openReview` (ids from `efb1185`, 2026-09-18; file from 2026-08-26).
  `wireReview` runs from `app.js`'s tail ahead of `load()`, so a throw
  here is the stuck loading screen. Guard the wiring; inside handlers
  that only run when the element was found, no further guard is needed.
- `js/profile-transfer.js`, `wireProfileTransfer`:
  `$('storageProtect').onclick`, and `renderStorageState`'s
  `$('storageState')` / `$('storageActs')` (ids from `d60c5e9`,
  2026-08-27; file from `126247a`, 2026-08-26). `wireProfileTransfer` is
  one of the two *unguarded* calls in the tail, so this one takes
  `load()` with it.
- `js/diagnostics.js`, `$('diagView').querySelectorAll(…)` (id from
  `5d40016`, after the file). Sheet-only; guard for the check's sake.
- `js/block-editor.js`, `renderPriorityChips`: `$('pePriority')`,
  `$('pePriorityHint')` (ids ~4 h after the file, `3e10ace`). Editor-only;
  same.

If the dating shows one of these ids is in fact as old as its reader,
say so in the notes and leave that read alone — the check in A.2 is the
arbiter.

**A.2** Add the check to `test/unit.js`, as its own section near the
shell-list assertions at the top (plans/014's `index.html` ↔ `SHELL` ↔
`SHELL_SCRIPTS` section):

- Collect every `$('<literal>')` read per file in `SHELL_SCRIPTS` minus
  `js/app.js`, with its line. Treat a read as guarded when the statement
  assigns it to a name that is tested before use on the same or next
  statement (`const x = $('id'); if (x) …`, `if (!x) return;`), or when
  the read is inside an `if (…)`/`&&`/`||`/`?.` guard, or when the call
  is `$('id')` used only as a truth test. Keep the parser simple and
  line-based; a read the parser cannot classify counts as unguarded, and
  the fix for a false positive is the guard, not a smarter parser.
- For each unguarded read, compare two dates from `git`: the author date
  of the first commit that put `id="<id>"` in `index.html`
  (`git log --reverse --format=%at -S'id="<id>"' -- index.html`, first
  line) and the author date of the commit that added the reading file
  (`git log --diff-filter=A --format=%at -- <file>`). The read passes
  when the id's date is `<=` the file's. Cache the two `git log` outputs
  per id/file so the section runs in well under a second.
- When `git` is unavailable or the history is shallow (`git rev-parse
  --is-shallow-repository` prints `true`), print one line saying the
  section is skipped and why, and assert nothing. Then make CI's
  checkout deep: in `.github/workflows/test.yml`, the `unit` job's
  `actions/checkout` gets `fetch-depth: 0` so the section runs there.
- Print the count of reads checked; assert it is above a floor (the
  count you observe minus a margin), so the section cannot pass empty.

**A.3** In AGENTS.md, in the paragraph that begins "Both rules are about
symbols, and **both read the same on ids**", add one sentence saying
`test/unit.js` now holds the id rule to the source the way it holds the
symbol rules: an unguarded `$('id')` in a file other than `app.js` fails
when the id is younger than the file. Keep the paragraph's existing
example.

**A.4 Verify.**
- `node --check` on the four edited files; `node test/unit.js` green,
  and the new section reports every read it checked.
- Revert A.1 in the working tree (`git stash` the three files) and run
  the unit suite: the new section must fail naming each of the three
  boot-path reads. Restore.
- `node test/smoke.js --only "main session"` and `--only "revisión"` (use
  `--list` for the exact names): the block chip, the review sheet and
  the storage line render as before.

### B. The worker reads the cache the branch names (P2, own PR)

**B.1** In `sw.js`, replace every `caches.match(x)` with a read scoped to
the cache that branch names:
- `networkFirst`'s `catch` → the `cacheName` it was given;
- `cacheFirst`'s first read → its `cacheName`;
- the navigate branch's `caches.match('index.html')` and the fallback
  `caches.match('index.html').then(hit => hit || caches.match('./'))` →
  `SHELL_CACHE`.
A three-line helper (`const fromCache = (name, key) =>
caches.open(name).then(c => c.match(key));`) keeps the call sites
readable. Add one sentence to the navigate branch's comment naming the
route this closes: with a newer worker installed and waiting, a hole in
the old shell used to be answered by the new release's copy.

**B.2** In `test/unit.js`, next to the existing `sw.js` assertions (grep
for `CACHE_VERSION` in the suite), assert the file's source contains no
`caches.match(` — the scoped form is the only one.

**B.3 Verify.**
- `node --check sw.js`; `node test/unit.js`.
- `node test/smoke.js --only "aviso de versión"`, `--only offline` and
  `--only "precache"` (`--list` for exact names): the update offer, the
  offline second visit and the hole repair behave as before.

### C. A phase label's number counts only next to "RIR", within `RIR_MAX` (P1, own PR)

**C.1** In `js/app.js`, `phaseRir`: delete the digits-anywhere fallback.
The function returns the `RIR`-adjacent number as today, and `null`
otherwise. Then clamp: if the value is above `RIR_MAX`, return `null`
(a label like "60 RIR" is not a prescription). Rewrite the comment
above it: the number next to "RIR" is the prescription; any other digit
in the label is a week number, a percentage or a rep scheme, and the
week says nothing about reserve — `weekRir` then uses the reserve the
last session was left at.

**C.2** Confirm by reading (and say so in the notes) that `weekRir`'s
other inputs cannot exceed `RIR_MAX`: `ex.minRir` through `EX_FIELDS`
(`hi: 5`), and `lastRho` (a measured reserve). If one can, clamp in
`weekRir` and note it — do not let `recordTarget` write a `rir` its
`accept` drops.

**C.3** Tests, `test/unit.js`:
- The `phaseRir` section ("the number next to "RIR" wins"): the
  `"Semana 3 de 5"` case now expects `null` (decision 4); add
  `"Descarga 60%"` → `null`, `"Semana 6 · 10 reps"` → `null`,
  `"60 RIR"` → `null`, `"0 RIR"` → 0, and `"5 RIR"` → 5.
- Fix the comment in the `target(...)` helper's phase note (grep for
  "falls back to the lowest digit ANYWHERE") — it describes the fallback
  this step removes.
- One end-to-end case through `targetFor` (use the suite's existing
  `target(...)` builder with `opts.phase`): a block whose current week's
  label is `"Descarga 60%"` prescribes the same sets as one whose label
  is prose with no digits, and never a lower weight than the same
  history under `"2 RIR"` would justify — pick the assertion shape the
  existing v3 cases use.
- A fuzz over 2,000 random labels built from digits, dashes, "RIR",
  "Semana", "%", and words: `phaseRir` is always `null` or an integer in
  `[0, RIR_MAX]`, and `weekRir` with `minRir` in `[0, 5]` and `lastRho`
  in `[0, 5]` never exceeds `RIR_MAX`.

**C.4** `docs/guide.md`: find the sentence that explains how the plan's
RIR is read from the phase text (grep `RIR` near "fase" / "semana"); if
it says the lowest number in the text is used, reword it to say the
number beside "RIR" is, and a phase with none leaves the reserve as the
last session left it. If the guide does not describe it, add nothing.

**C.5 Verify.**
- `node --check js/app.js`; `node test/unit.js` green — the v3 rule
  sections must not change outcome except the one flipped case.
- `node test/smoke.js --only "objetivo"` (`--list` for the exact
  section names touching peso objetivo): unchanged.

## STOP conditions

- **A:** the dating check flags an unguarded read in a file this step
  does not list, on the boot path (inside a `wire*()` or a draw): report
  it and guard it too, in the same PR, naming it in the notes. Off the
  boot path, guard it too — the rule is the same — but if the count of
  extra reads is above ten, stop and report instead: the check's parser
  is probably too strict.
- **A:** the check cannot be made to run in CI without changing more
  than `fetch-depth` — stop and report; the guards still land.
- **B:** any smoke section in B.3 changes outcome.
- **C:** any v3 rule assertion other than the `"Semana 3 de 5"` case
  changes outcome — the fallback was reachable from a case the plan did
  not see; report which.
- **C:** `lastRho` or `minRir` can exceed `RIR_MAX` by a route C.2 finds
  and a one-line clamp in `weekRir` does not settle — report.

## Maintenance notes

_(one subsection per step, filled by its executor)_
