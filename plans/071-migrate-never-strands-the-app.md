# Plan 071: A lift's rows that are not a list are repaired, and a throw inside `migrate()` lands on the recovery screen or leaves this tab's data alone — never the boot guard's dead end

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If a STOP condition occurs, stop and report — do not
> improvise. Fill in "Maintenance notes" when done; the orchestrator
> maintains `plans/README.md` — do not edit it.
>
> **Two PRs, run in parallel by two executors**: Step A
> (`claude/071-a`) and Step B (`claude/071-b`). Each bumps
> `CACHE_VERSION` once, as its last commit. Execute ONLY the step your
> task names.
>
> **Drift check (run first)**: `git diff --stat 8ff9355..origin/main -- js/app.js js/profile-transfer.js test/unit.js`
> — other PRs land while you work (plans 072 and 073 edit `test/unit.js`,
> and the other step of this plan edits all three). If an excerpt below
> no longer matches, re-find it by the quoted text; a changed *meaning* is
> a STOP.

## Status

- **Priority**: P2
- **Effort**: S each (A, B)
- **Risk**: LOW (A: a repair of shapes no writer produces) / LOW–MED (B:
  the load path and two import paths)
- **Depends on**: none. A and B are independent PRs.
- **Category**: bug
- **Planned at**: commit `8ff9355`, 2026-09-23 — the follow-ups recorded
  when plans 067–070 were executed (`plans/README.md`, "Follow-ups found
  while executing 067–070")

## Why this matters

The app keeps every set in `localStorage`, and `migrate()` (`js/app.js`)
repairs whatever it finds there on every load, so data the app cannot draw
never costs the log. Plan 067 made every *container* of the profile's
record repairable. Two holes are left, both found by booting the real
shell on damaged storage (`bootApp` in `test/harness.js`, at `8ff9355`):

1. **The log's leaf.** When the day on screen has a lift's rows stored as
   anything but a list (`'x'`, `5`, `{}`, `{"0": row}`), or a row stored
   as `null`, the app opens on the **recovery screen** ("La app ha fallado
   al dibujar … probablemente un fallo de la app, no de tus datos"): the
   card's `entry()` throws inside the draw. The data was repairable. A row
   stored as a number, a string or a list (`[5]`, `['s']`, `[[]]`)
   draws, but a tick on it is silently lost.
2. **A throw inside `migrate()` itself.** `load()` calls `migrate()` with
   no guard, so a throw stops `load()` before anything draws, and
   `js/boot-guard.js` then says "La app no ha podido arrancar. Ciérrala del
   todo y vuelve a abrirla." for good: reopening reads the same bytes and
   throws again. The recovery screen, which offers the raw bytes as a
   file, never comes up, though `docs/guide.md` § "When the data goes
   wrong" promises it for "data broken past repairing". One such throw is
   known: `migrate()` folds the legacy RIR map (inside the profile loop)
   before it gives `state.prefs` its defaults (after the loop), and the
   fold reaches `state.prefs.units`, so a state or a backup with no
   `prefs` and a foldable map throws `TypeError`. And the two import
   paths that replace data wholesale, "Cargar copia" (`restoreFromText`)
   and loading a profile file (`loadProfileFromText`), assign the new data
   before `migrate()` with no guard. A throw leaves this tab's state
   half-migrated with a "Deshacer" toast offered, and the next save writes
   it. `adoptStored`, the other-tab path, was fixed exactly this way in
   plan 067 B.

Every app-written backup carries `prefs`, and no writer produces any of
these shapes, so this is robustness, not a live bug report. But "the app
opens on your data or on a screen that hands you your data" is a promise
the guide makes, and each hole breaks it.

## The decisions (settled — do not re-open)

1. **The leaf repair is the log part's own `repair`** in `RECORD_PARTS`
   (`js/app.js`), which `ensureRecord` already runs after the container
   repair of plan 067. For every block key of `profile.log`, for every
   slot `forEachSlot` visits, and for every lift key in that slot:
   - rows that are **not a list** → that lift key is deleted. Nothing
     reads a non-list: `sessionsOf`, the CSV and `pruneLog` all skip it,
     so no set anyone could see is lost;
   - a row that is **not a plain object** (`null`, a number, a string, a
     list) → replaced by an empty row, `{ w: '', r: '', done: false }`,
     **in the same place**. A row's index is its set number, so a real
     row after it keeps its own. `pruneLog` drops trailing empty rows on
     the next save, as it always has. The empty row is the same one
     `entry()` pads with and `rowFromImport` answers a non-object with;
   - nothing else about a row changes. The fields inside a row are the
     row codec's business (`ROW_FIELDS`), every reader copes with odd
     field values (checked: a `w` that is an object, a `d` that is not a
     list), and normalising them would move shapes the app's writers
     produce.
2. **`state.prefs` gets its defaults before the profiles are repaired.**
   The whole block that defaults `state.prefs`, `state.mode` and
   `state.setupDone` moves from the end of `migrate()` to the top, right
   after `const fallback = defaultState();` and the `state.profiles`
   check. It reads nothing from the profiles. The `activeProfile` check
   stays after the loop, because it reads the repaired profiles. A comment
   says why the order matters: any repair may read a preference.
3. **`load()` sends a throw from `migrate()` to the recovery screen**:
   `try { migrate(); } catch (err) { showRecovery(err, raw); return; }`.
   The default mode's copy ("No se ha podido abrir tu registro … no tienen
   la forma que la app espera") is right for data the repair could not
   take. `showRecovery` already stops writing. On a first run `raw` is
   `null` and the screen simply offers no download.
4. **"Cargar copia" and loading a profile file keep this tab's data when
   `migrate()` throws**, the way `adoptStored` does since plan 067 B:
   - `restoreFromText`: capture `const prev = state;` right before
     `state = data;`. On a throw: `state = prev; dropUndo();
     mark('Esa copia no se puede usar: ' + err.message, true); return;`,
     before `applyTheme()`/`commit()`/`closeSheet`.
   - `loadProfileFromText`: the local profile is already held in `local`.
     On a throw: `state.profiles[target] = local; dropUndo(); mark('Ese
     perfil no se puede usar: ' + err.message, true); return;`. The other
     profiles went through the same `migrate()`, but they are the app's
     own data and its repairs change nothing on them.
   - These are the prefixes each function already uses for its other
     refusals. `dropUndo()` takes back the "Deshacer" toast
     `snapshotForUndo` put up for a change that did not happen.
5. **The two "AGENTS.md rule (a)" comments in `js/app.js` are corrected**
   here, since this plan bumps anyway. AGENTS.md has always numbered the
   split rules 1 and 2. Both say "rule 1". The two in `test/unit.js`
   belong to plan 072.

## Current state

Files:
- `js/app.js` — `RECORD_PARTS` (the log part has no `repair`),
  `ensureRecord`, `load()`, `migrate()`, `units()`/`rowWeight`, `entry()`,
  `adoptStored` (the exemplar for decision 4), `showRecovery`.
- `js/profile-transfer.js` — `restoreFromText`, `loadProfileFromText`.
- `test/unit.js`, `test/harness.js` (read only: `bootApp`, `loadApp`).
- `sw.js` — `CACHE_VERSION` (bump only through the tool).

`js/app.js:268-290` — the log part, no `repair` (the rir, order and
variants parts have one each; model yours on theirs):

```js
  {
    name: 'log', keyedBy: 'slot+exercise', merge: 'concat', travelsWithBlock: true,
    …
    rejects: true,
    accept(raw, rawBlock, normalized) {
      return reKeyImportedSlots(raw, rawBlock, normalized, eachExercise(rows => {
        if (!Array.isArray(rows)) return undefined;
        …
        const kept = rows.slice(0, LOG_LIMITS.rows).map(rowFromImport);
        return kept.length ? kept : undefined;
      }));
    },
  },
```

The order part's repair, the pattern (same file, "A slot that is not a list
of distinct, usable ids"):

```js
    repair(profile) {
      Object.keys(profile.order).forEach(bk => {
        const blk = profile.order[bk];
        if (!blk || typeof blk !== 'object' || Array.isArray(blk)) { delete profile.order[bk]; return; }
        Object.keys(blk).forEach(k => { … });
      });
    },
```

`ensureRecord` (`js/app.js:662`) replaces a part, a block's map or a slot's
map that is not a map with `{}` (plan 067), then runs every part's
`repair`: `RECORD_PARTS.forEach(part => { if (part.repair) part.repair(profile); });`.
So by the time the log's `repair` runs, `profile.log`, each
`profile.log[bk]` and each slot of it are plain objects.

`forEachSlot(map, blockId, fn, filter)` (`js/app.js:210`) calls
`fn(key, week, dayId, value)` for each slot key `parseSlot` accepts, and
`Object.keys()` is a snapshot, so `fn` may delete what it is handed.

`js/app.js:2373-2392` — where the leaf throws:

```js
function rowsFor(profile, blockId, w, dayId, exId) {
  if (!profile.log[blockId]) profile.log[blockId] = {};
  const k = slot(w, dayId);
  …
  if (!profile.log[blockId][k]) profile.log[blockId][k] = Object.create(null);
  if (!profile.log[blockId][k][exId]) profile.log[blockId][k][exId] = [];
  return profile.log[blockId][k][exId];
}

function entry(profile, blockId, w, dayId, exId, n) {
  const a = rowsFor(profile, blockId, w, dayId, exId);
  while (a.length < n) a.push({ w: '', r: '', done: false });
  return a.slice(0, n);
}
```

`js/app.js:746` — `load()` calls `migrate()` bare:

```js
    state = parsed;
  }
  migrate();
  ready = true;
  applyTheme();
  render();
```

`js/app.js:823-836` — the top of `migrate()`; the profile loop follows, and
ends with `ensureRecord(profile);` (line ~1035). Then, after the loop
(lines ~1038-1079):

```js
  /* Whatever happened above, the app cannot draw with no profile at all. */
  if (!Object.keys(state.profiles).length) state.profiles = fallback.profiles;
  /* An own key, not a truthy read: … (plans/040). */
  if (!Object.prototype.hasOwnProperty.call(state.profiles, state.activeProfile)) state.activeProfile = profileKeys()[0];
  if (!state.prefs || typeof state.prefs !== 'object') state.prefs = {};
  if (['auto', 'light', 'dark'].indexOf(state.prefs.theme) < 0) state.prefs.theme = 'auto';
  … lang, sound, bgAlarm, persistAsked, units, barWeight, inc, plates …
  if (['pair', 'solo'].indexOf(state.mode) < 0) state.mode = 'pair';
  if (typeof state.setupDone !== 'boolean') state.setupDone = true;
  … 
  state.prefs.sessionsSinceBackup = clampInt(state.prefs.sessionsSinceBackup, 0, 100000, 0);
}
```

The throw: the rir part's `repair` → `foldRirMap` → `rirRowFor(rows)` →
`rowWorked(r)` → `rowWeight(r)` → `units()` (`js/app.js:1101`:
`const units = () => state.prefs.units;`) → `TypeError` when `state.prefs`
is undefined. Only a legacy rir entry over a row with no RIR of its own
reaches the fold's `rirRowFor`.

`js/profile-transfer.js:353-360` (`restoreFromText`) and `:432-434`
(`loadProfileFromText`):

```js
  snapshotForUndo('Registro restaurado desde una copia.');
  state = data;
  /* No default for activeProfile here: … */
  migrate();
  applyTheme();
  commit();
  closeSheet('sheet');
```

```js
  snapshotForUndo('Perfil de ' + local.label + ' sustituido.');
  state.profiles[target] = incoming;
  migrate();
  applyTheme();
  commit();
```

The exemplar for decision 4, `adoptStored` (`js/app.js:1422`):

```js
  const prev = state;
  state = next;
  try {
    migrate();
  } catch (err) {
    /* migrate() throwing partway (bytes a newer release wrote, say) used to
       leave `state` pointed at a half-migrated object … Put it back, … */
    state = prev;
    return false;
  }
```

The two comments of decision 5: `js/app.js:1833` ("… covers the hole a
no-op stub used to (AGENTS.md rule (a)). */") and `js/app.js:5257` ("… a
guarded call, not a bare one (AGENTS.md\n     rule (a)).").

**Conventions.** Comments explain *why*, in full sentences, often naming
the bug (AGENTS.md "Comment style"); cite this plan as `(plans/071)`.
Spanish only on screen. Safari 15 floor (no lookbehind, `.at()`,
`Object.hasOwn`, `structuredClone`, `findLast` in `js/`; the unit suite
fails on them, even inside a comment).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check js/app.js` (and `js/profile-transfer.js` in B) | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| Bump (last commit) | `bash tools/bump-cache-version.sh` | `sw.js` one version up |
| CR check | `node -e "console.log((require('fs').readFileSync('js/app.js','utf8').match(/\r/g)\|\|[]).length)"` | `0` |

## Scope

**In scope**:
- A: `js/app.js` (the log part's `repair` only), `test/unit.js`, `sw.js`
  (bump), this plan's Maintenance notes.
- B: `js/app.js` (`migrate()`'s order, `load()`, the two comments of
  decision 5), `js/profile-transfer.js` (`restoreFromText`,
  `loadProfileFromText`), `test/unit.js`, `sw.js` (bump), this plan's
  Maintenance notes.

**Out of scope**: `AGENTS.md`, `README.md`, `docs/guide.md` (the guide
already promises the recovery screen; plans 072 and 073 edit AGENTS.md),
`js/boot-guard.js`, `test/harness.js`, any other part's repair, the row
codec (`ROW_FIELDS`), `pruneLog`, `rowsFor`/`entry()` (the repair is in
`migrate()`, the one place storage comes in), and `test/unit.js`'s own
"rule (a)" comments (plan 072).

## Git workflow

`git fetch origin && git checkout -B claude/071-a --no-track origin/main`
(or `claude/071-b`). Plain-sentence commit subjects, as in `git log
--oneline -15`. The bump is the last commit ("Bump the shell to vNNN").

## Steps

### Step A: the log's leaf repair (`claude/071-a`)

**A.1** Add `repair(profile)` to the log part in `RECORD_PARTS`, after
`accept`, with a comment saying what it repairs and why. Target shape:

```js
    repair(profile) {
      Object.keys(profile.log).forEach(bk => {
        forEachSlot(profile.log, bk, (key, w, dayId, sl) => {
          Object.keys(sl).forEach(exId => {
            const rows = sl[exId];
            if (!Array.isArray(rows)) { delete sl[exId]; return; }
            rows.forEach((r, i) => {
              if (!r || typeof r !== 'object' || Array.isArray(r)) rows[i] = { w: '', r: '', done: false };
            });
          });
        });
      });
    },
```

`sl` is a plain object here (ensureRecord's container repair ran first). A
lift key may be an own `__proto__` or `constructor` (plan 067 case 6):
`sl[exId]` reads the own property and `delete sl[exId]` deletes it, so no
special case is needed. Check that this holds in your test.

**A.2** Tests: a new section right after the plan 067 section in
`test/unit.js` (after the line `call('state = __before067; __before067 = null;');`),
headed `console.log('\n== the log\'s leaf: rows that are not a list, rows that are not rows (plans/071) ==');`.
Use the `fromStorage` pattern that section uses (the fixture is parsed
inside the sandbox with `JSON.parse`, the way `load()` parses storage):
1. For each of `'x'`, `5`, `{}`, `{ "0": { w: '50', r: '8', done: true } }`
   as one lift's rows, beside another lift with a real row in the same
   slot: after `migrate()` the damaged lift's key is gone, and the other
   lift's rows are byte-identical to what they were.
2. Rows `[null, R, 5, 's', [], R2]`, where `R` and `R2` are real ticked
   rows: afterwards `[E, R, E, E, E, R2]`, with `E` the empty row, `R2`
   still at index 5 (its set number), and `R`/`R2` deep-equal to what
   they were.
3. The same damage under an own `__proto__` lift key: repaired the same
   way, and `Object.prototype` gets no new key (check
   `Object.keys(Object.prototype).length` before and after, as plan 067
   case 6 does).
4. Through a real boot: a second part of the section inside the booted
   area, right after the section `== adoptStored migrates before it
   commits (plans/067 B) ==` and before the `"Enviar a…" never puts a
   second copy` section. With `settled(seeded({ week: 1, day: 0 }, edit))`
   (the helpers used there), put `'x'` as the rows of the first lift of
   the day on screen, and `[null]` as another lift's rows. The boot draws
   (`boot.call('ready && !frozen')` is `true`), a tick on each of the two
   cards lands (`boot.card(exId).set(0)` as the plan 060 and 067 B
   sections do), and after `boot.clock.advance(1000)` and a
   `reopen(boot)` both ticks are there.

**A.3** Mutation checks (make the edit, run, see FAIL, revert, see PASS;
report each in the PR body):
- the whole `repair` removed → cases 1, 2 and 4 fail (case 4 lands on
  recovery);
- `rows.filter(…)` dropping bad rows instead of replacing them in place →
  case 2 fails (`R2` moves to a lower index);
- `delete sl[exId]` replaced by `sl[exId] = []` → case 1's "the key is
  gone" fails. Keep the delete: an empty list is a lift with a session on
  record that has no rows.

**A.4** Cost: time `migrate()` on a large state before and after. Report
both numbers in the PR body; no test. Build the state with a small script
in your scratch area (not the repo) through `loadApp()`: two profiles,
each with 10 blocks × 16 weeks × 6 days × 8 lifts × 5 ticked rows
(≈ 77,000 rows a profile). Take the median of 5 runs of
`vm.runInContext('state = JSON.parse(TEXT); migrate();', ctx)`.

**Verify**: `node --check js/app.js` → exit 0; `node test/unit.js` →
`0 failed`, the new section's assertions among the passes; the CR check →
`0`. Then the bump, then push and open the PR (see "Opening the PR" in
your brief).

### Step B: no throw strands the app (`claude/071-b`)

**B.1** Decision 2: move the prefs/mode/setupDone block to the top of
`migrate()`. Move it whole, from `if (!state.prefs || typeof state.prefs
!== 'object') state.prefs = {};` down to the `sessionsSinceBackup` line,
together with its comments. Keep its internal order exactly. It goes after
the `state.profiles` fallback check at the top, before the comment "Repair
the profiles that are here". Add a comment saying why it comes first:
"a repair below may read a preference: the legacy RIR fold reaches
`units()`, and a state with no `prefs` threw there (plans/071)". The
`activeProfile` line and the "no profile at all" line stay after the loop.

**B.2** Decision 3: in `load()`, wrap `migrate()`:

```js
  try {
    migrate();
  } catch (err) {
    /* why: data migrate() cannot repair used to stop load() before
       anything drew, and js/boot-guard.js then said "La app no ha podido
       arrancar" for good — reopening reads the same bytes. The recovery
       screen stops writing and hands the bytes over (plans/071). */
    showRecovery(err, raw);
    return;
  }
```

`raw` is in scope in `load()` (it is `null` on a first run).

**B.3** Decision 4: `restoreFromText` and `loadProfileFromText` in
`js/profile-transfer.js`, as the decision gives them. Model the comment on
`adoptStored`'s, and point to it. Nothing after `migrate()` changes on the
success path.

**B.4** Decision 5: the two comments in `js/app.js`: "AGENTS.md rule (a)"
→ "AGENTS.md's split rule 1". Change nothing else in those comments.

**B.5** Tests: one new section in the booted area of `test/unit.js`, right
before the section `== sw.js runs: install, activate, fetch, the swap
(plans/066) ==`, headed
`console.log('\n== no throw inside migrate() strands the app (plans/071 B) ==');`.
Reuse the plan 067 B section's `stubMigrateThrows` idea: copy the helper
into your section, since it is local to theirs.
1. A stored state with **no `prefs` key** and a legacy rir map over one
   ticked row with no RIR of its own (`rir: { [b]: { [slot]: { [exId]: '1' } } }`,
   the row `{ w: '50', r: '8', done: true }`): `bootApp({ state })` draws
   (`ready && !frozen`); the row now has `rir === '1'` (the fold ran);
   `state.prefs.units === 'kg'`. The same with `prefs: null`.
2. `load()` over a `migrate()` that throws: boot a good state, put its
   saved bytes back into `boot.store[boot.call('STORAGE_KEY')]`, stub
   `migrate` to throw once, and call `boot.call('load()')`. Then
   `frozen === true` and `ready === false`, the recovery screen's download
   button exists (`boot.$('recDownload')` is not null), and the stored
   bytes are unchanged after `boot.clock.advance(1000)`. If calling
   `load()` a second time in a booted context turns out not to work in the
   harness, STOP and report what you saw rather than editing
   `test/harness.js`.
3. "Cargar copia" whose `migrate()` throws: with a booted app, put a
   valid backup's text in `boot.$('blob').value`, stub `migrate` to throw
   once, and press `boot.$('bRestore').onclick()`, answering the dialog
   with `askOk` (use the `pressAnswering` helper of the plan 053 section,
   or its shape). `boot.call('state')` is the same object as before the
   press, and its data is unchanged. No undo is left
   (`boot.call('undoSnapshot') === null`). The status line starts with
   "Esa copia no se puede usar". After `boot.clock.advance(1000)`,
   `boot.saved()` equals what it was before the press.
4. The same for `loadProfileFromText(text)` with a valid profile file
   (`{ kind: 'profile', key, profile, … }`, the shape the export writes;
   build it from the booted app's own profile export if there is a
   function for it, or copy the fixture of an existing
   `loadProfileFromText` test). Call it directly and answer the dialog.
   Afterwards the target profile is the same object as before, there is
   no undo, and the status line starts with "Ese perfil no se puede usar".
5. Both success paths still work, which the existing restore and profile
   tests already cover: they must stay green.

**B.6** Mutation checks (report each):
- the prefs block back after the loop → case 1 fails with a throw;
- `load()`'s try removed → case 2 fails (the throw escapes; the case must
  catch it and FAIL, not crash the suite);
- `restoreFromText`'s catch without `state = prev` → case 3 fails;
- `loadProfileFromText`'s catch without `dropUndo()` → case 4's "no undo"
  fails.

**Verify**: `node --check js/app.js js/profile-transfer.js` → exit 0;
`node test/unit.js` → `0 failed`; the CR check on both files → `0`. Then
the bump, then push and open the PR.

## Test plan

Covered in A.2 and B.5. Model the migrate-level cases on the plan 067
section (`== storage no writer produced (plans/067) ==`, its
`fromStorage` helper) and the booted cases on the plan 067 B section
(`== adoptStored migrates before it commits (plans/067 B) ==`). Every
booted case catches its own errors and reports a FAIL. A throw must never
end the suite (see how those sections wrap their bodies in `try`).

## Done criteria

- [ ] A: `grep -n "repair(profile)" js/app.js` shows one in the log part's
      entry; the new section passes; the three mutation checks fail as
      stated; the timing is in the PR body
- [ ] B: `migrate()`'s first statements after the profiles check are the
      prefs defaults; `load()` has the try; both import paths have the
      catch; `grep -n "rule (a)" js/app.js` → no match; the new section
      passes; the four mutation checks fail as stated
- [ ] `node test/unit.js` → `0 failed`; CR check `0`
- [ ] the PR bumps `CACHE_VERSION` exactly once, as the last commit
- [ ] only in-scope files changed (`git diff --stat origin/main`)

## STOP conditions

- The rows of the damaged cases do not send a real boot to recovery on
  `origin/main` (A case 4 passes *without* your repair): the premise is
  wrong. Report what the boot does.
- The repair changes any row of a state the app's own writers produced
  (a ticked set, a padded set, a drop set, an extra set). No writer
  produces a non-list or a non-object row, so if one of the existing
  tests fails, stop.
- A.4's timing adds more than 50 ms to `migrate()` on the large state:
  report the numbers before going on.
- Moving the prefs block changes the result of any existing test.
- B case 2 cannot be expressed without editing `test/harness.js`.
- A step's verification fails twice after a reasonable fix.

## Maintenance notes

- A future part whose values have a shape of their own (like the log's
  rows) gets its leaf repair as its own `repair`, not in `ensureRecord`,
  which only knows containers.
- `load()`'s recovery path now also catches bugs in `migrate()` itself. A
  recovery screen reporting a TypeError from inside `migrate()` is an app
  bug to fix, not damaged data.
- **Step B (`claude/071-b`), deviations and findings:**
  - **The moved block.** It is byte for byte main's 34 lines, and the unit
    suite gave the same 1441 passes with only the move made, so the STOP on
    existing tests did not fire. Nothing `migrate()`'s loop reaches writes
    `state.prefs`, `state.mode` or `state.setupDone`; every other write to
    them is in a handler.
  - **Case 2's download button.** `boot.$('recDownload')` is never null in
    the harness: `getElementById` makes an element for any id, and
    `showRecovery` finds its button on its own box
    (`box.querySelector('#recDownload')`), which the fake answers for any
    selector too. The case reads the box's markup for `id="recDownload"`
    instead, since the fake keeps `innerHTML` as a string. It then presses
    the handler `showRecovery` hung there, with `downloadFile` caught, and
    checks that it hands over exactly the bytes in storage. It also checks
    the default mode's heading ("No se ha podido abrir tu registro") and
    the stub's error in the box's `<pre>`.
  - **Case 2's bytes are put back indented** (`JSON.stringify(saved, null,
    1)`), a form `save()` never writes. The stub throws before `migrate()`
    touches anything, so a save of the unmigrated state would have written
    the same compact bytes back, and "unchanged" could not have seen it.
  - **Cases 3 and 4 check a little more than the plan lists.** Case 3's
    copy is this tab's own backup with `barWeight` 22, and case 4's file is
    `profileExportPayload()` with the label changed, so a tab left holding
    the file shows. Beside what the plan asks, each checks the whole state
    unchanged as JSON, no "Deshacer" toast (`toastKind !== 'undo'`) as well
    as `undoSnapshot === null`, and storage unchanged after
    `advance(1000)`. Each also checks the whole status line, the stub's
    message included, so the refusal is the new catch's and not an
    earlier check's.
  - **Mutation 1** (the prefs block back after the loop) fails case 1's
    four assertions, but not with a throw out of the boot. `load()`'s new
    `try` catches the `TypeError` and the boot lands on the recovery
    screen, and each FAIL carries its message ("Cannot read properties of
    undefined (reading 'units')", and "of null" for `prefs: null`).
    Mutations 2 to 4 fail as the plan says. Mutation 2 fails case 2's three
    assertions, each carrying the stub's message, and the suite still runs
    to its summary. Mutation 3 fails case 3's "same object, unchanged", and
    mutation 4 fails case 4's "Deshacer". With both shipped files as they
    are on `origin/main`, all fifteen new assertions fail, and the suite
    still reaches its summary.
  - **B.4 is a commit of its own**, before the bump.
  - **Out of scope, noticed:** `undoLast()` (`js/app.js`) is now the one
    caller of `migrate()` with no guard. Its input is this tab's own
    snapshot of a state that was already migrated, so a throw there would
    be an app bug, not damaged data.
- **Step A (`claude/071-a`), deviations and findings:**
  - **No deviations from A.1/A.2's target shapes.** The repair is the
    plan's own target shape verbatim; the tests are the four cases as
    described, in the two locations named.
  - **Case 4's "second part of the section" gets no console.log of its
    own.** The plan quotes one heading, for the top of the section; case 4
    sits in the booted area under whatever heading precedes it there
    ("adoptStored migrates before it commits (plans/067 B)"), marked
    instead by a comment naming it as this section's case 4. Its own two
    `ok()` names still say "(plans/071)".
  - **The `__proto__` fixture (case 3) is built differently from plan
    067 case 6's.** `{ __proto__: x }` as an object literal sets the
    prototype rather than creating an own key, so case 6 writes its JSON
    fixture by hand, brace by brace. `{ ['__proto__']: x }` — a *computed*
    property name — does create a genuine own key (checked directly: it
    round-trips through JSON.stringify/JSON.parse as an ordinary
    `"__proto__"` key, same as case 6's hand-written text), so case 3
    builds the fixture as a normal object with a placeholder key and a
    one-line text swap after `JSON.stringify`. No hand-counted braces, same
    fixture shape.
  - **Case 4 does not need to guard the boot itself.** `render()` already
    wraps `drawApp()` in its own try/catch (`js/app.js`, unrelated to this
    plan) and calls `showRecovery` on a throw, so a draw that throws over
    damaged log rows lands the boot on the recovery screen — `ready` false,
    `frozen` true — rather than throwing out of `bootApp()`. Confirmed by
    mutation: with the repair removed, `settled(seeded(...))` returns
    normally and only the *following* `ready && !frozen` read (and the
    card lookups after it) fail as assertions, never as an uncaught throw.
  - **`origin/main` moved twice while this step was in progress**: plan
    072 (doc checks) merged, then this same plan's Step B merged and
    bumped `CACHE_VERSION` to v140. Rebased onto both with no conflicts
    (Step B touches `migrate()`'s prefs block, `load()`, and the two split
    rule (a) comments; this step touches only the log part's `repair`) and
    re-bumped to v141 as this PR's own last commit.
  - **Timing (A.4), for the record beyond the PR body:** median of 5 runs
    on two profiles × 10 blocks × 16 weeks × 6 days × 8 lifts × 5 ticked
    rows (76,800 rows total, matching the plan's "~77,000"): 17.55 ms
    without this repair, 26.38 ms with it, +8.83 ms — under the 50 ms
    ceiling.
- *(Executor: record deviations here.)*
