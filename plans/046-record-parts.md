# Plan 046: One table for the profile's record — `RECORD_PARTS`, and three functions in place of a dozen helpers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, add what deviated to "Maintenance
> notes"; the orchestrator maintains the index row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 641ab17..HEAD -- js/app.js js/block-editor.js js/profile-transfer.js js/data.js test/unit.js test/smoke.js AGENTS.md`
> Two sessions were open when this plan was written and may land first:
> notes/energy re-keyed on profile import (js/profile-transfer.js) and
> `loggedSets` counting past week 16 (js/app.js). Neither touches the
> operations below. Rebase over them; any OTHER change to a function named
> under "Current state" means comparing it against the live code first, and
> a mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED. This is a behaviour-preserving refactor of every
  operation that clears, moves or creates the profile's record. The proof
  is an equivalence check against the old helpers (Step 4). A purge that
  misses a part is data left behind; one that reaches too far is data lost.
- **Depends on**: nothing. Plan 045's cache is unaffected: every call site
  below already ends in `commit()` or `save()` with no claim.
- **Category**: architecture — candidate 2 of the architecture review of
  2026-09-21, with the design settled with the maintainer on 2026-09-22.
- **Planned at**: commit `641ab17`, 2026-09-22
- **Glossary**: `CONTEXT.md` — **the profile's record**, **session note**,
  **energy**, **session order**, **objetivo record**, **variant**, **slot**.
  Use those words in comments.

## Why this matters

Seven maps make up the profile's record: `log`, `rir` (legacy), `notes`,
`energy`, `order`, `obj` and `variants`. No single place says so. The
inventory taken for this plan (at `37aaee5`) found the list written out by
hand in about 18 places, and in 10 tests. Each copy carries its own silent
omissions:

- `purgeExLog` clears log, rir and obj but not order, with no comment
  saying why.
- `purgeSessionMeta`'s comment says its four maps are "keyed by slot
  alone", which is false for `obj`.
- `wipe` and `deleteBlocks` skip `variants` with no comment at either site.
- `installBlockData` lists `notes` and `energy`, but no caller passes them.
- There are three different ways to clear a slot: `purgeExLog` via
  `purgeRir` + `purgeObj`, `purgeDayLog` via `purgeRir` +
  `purgeSessionMeta`, and `clearDay` deleting log and rir by hand.
- `purgeRir`/`purgeObj` have identical bodies, and
  `moveExLog`/`moveExRir`/`moveExObj` are pass-throughs.
- Comments are stale: `forEachSlot`'s "four parallel maps", the lists at
  `js/profile-transfer.js` :103 and :135, and `js/block-editor.js` :1134.
- Five tests that list maps by hand leave out `obj`.

Adding an eighth part today means about eleven edits, and forgetting one
is silent.

## The decisions (settled 2026-09-22 — do not re-open)

1. **Scope: lifecycle only.** That means migrate's creation and repair,
   installing a received block's record, every purge (one exercise, one
   day, one week of one day, a whole block, the whole profile) and moving
   an exercise to another day. **Import, share and restore are out**
   (candidate 5 may later add `accept`/`send` hooks to the table). **No
   behaviour changes.**
2. **`variants` is in the table**, with `keyedBy: 'exercise'`. The table is
   *the* complete list, and each operation says which keyings it touches.
3. **A guard test**: a migrated profile's own keys must be the table's
   names plus an explicit list of non-record fields (`label`, `theme`,
   `blocks`, `blockOrder`, `activeBlock`, `week`, `day`, and whatever else
   the audit finds). Check a real object, not the source text.
4. **Domain words** are in `CONTEXT.md` (added with this plan).
5. **The table's shape** is declarative where the keying decides, with a
   hook only where a part is special:
   - `keyedBy`: `'slot+exercise'` (log, rir, obj), `'slot'` (notes,
     energy, order) or `'exercise'` (variants).
   - `merge` on a move: `'concat'` (log) or `'keep-destination'` (rir,
     obj), which is today's `moveExKeyed` rule.
   - `travelsWithBlock`: log, rir and order, which is what
     `installBlockData` actually receives. notes and energy drop out,
     because no caller ever passes them.
   - Hooks: `order`'s own `move` (today's `moveExOrder`) and exercise
     purge (a no-op, see 6), `rir`'s fold on install (`foldRirMap`),
     `repair` for order and variants (migrate's content checks), and the
     variants seed (`seedLateralVariants`).
6. **Clearing one exercise's log leaves its id in the session order.** This
   is kept, and the reason goes on the `order` entry: the session order
   describes the session, not the sets, and clearing a lift's sets doesn't
   un-reorder the day.
7. **Variants survive wipe and block deletion.** This is kept, and the
   reason goes on the `variants` entry: they're the plan's naming history,
   keyed by exercise, not what was lifted.
8. **The interface** (in `js/app.js`, under split rule 2, since
   `js/block-editor.js` calls it):

   ```js
   RECORD_PARTS                                     // the table
   purgeRecord(profile, blockId?, { day?, week?, exercise? })
     // no scope  → the block's record is dropped (deleteBlocks)
     // no block  → the whole profile's record is wiped (wipe)
     // day       → purgeDayLog; day + week → clearDay; day + exercise → purgeExLog
   moveExerciseRecord(profile, blockId, fromDay, toDay, exId)
   ensureRecord(profile)                            // migrate: create each part, run each repair
   ```
   `installBlockData` keeps its signature and loops over the
   `travelsWithBlock` parts.
9. **One PR**, behaviour-preserving, proven against the old helpers.

## Current state (at `641ab17`)

| Operation | Today | Becomes |
|---|---|---|
| create/repair | `migrate` app:345, the maps one by one (~362–413), `seedLateralVariants` app:4696 | `ensureRecord` |
| install a block's record | `installBlockData` app:166, list `['log','rir','order','notes','energy']` | loop over `travelsWithBlock` + rir's fold hook |
| clear one exercise | `purgeExLog` app:2227 → `purgeRir` :2257, `purgeObj` :2271 | `purgeRecord(p, b, { day, exercise })` |
| clear one day | `purgeDayLog` app:2233 → `purgeRir`, `purgeSessionMeta` :2245 | `purgeRecord(p, b, { day })` |
| clear one week of one day | `clearDay` (~app:4376–4387): deletes log and rir by hand, then `purgeSessionMeta(…, week)` | `purgeRecord(p, b, { day, week })` |
| drop a block | `deleteBlocks` be:65 (list at ~be:80) | `purgeRecord(p, b)` |
| wipe | the wipe handler (~app:4404–4409), six assignments | `purgeRecord(p)` |
| move an exercise | `moveExKeyed` :2300, `moveExLog/Rir/Obj` :2318–2328, `moveExOrder` :2336; four calls at be:1144–1147 | `moveExerciseRecord` |

Callers to find and switch: grep `purgeExLog|purgeDayLog|purgeSessionMeta|purgeRir|purgeObj|moveEx|installBlockData|deleteBlocks` across `js/` and `test/`.

## Steps

**A. The table and the three functions.** Add `RECORD_PARTS` and
`purgeRecord` / `moveExerciseRecord` / `ensureRecord` in a new section of
`js/app.js`, beside `forEachSlot` (the walk every slot-keyed operation
uses). Each entry's comment says what the part is (in `CONTEXT.md`'s
words) and why its row reads the way it does, including decisions 6 and 7
and `obj` never travelling with a block (plans/025).

**B. Switch every call site**, then delete `purgeExLog`, `purgeDayLog`,
`purgeSessionMeta`, `purgeRir`, `purgeObj`, `moveExKeyed`, `moveExLog`,
`moveExRir`, `moveExObj` and `moveExOrder` (the last becomes `order`'s
hook). Delete the hand-written map lists in `migrate`, `clearDay`, the
wipe handler and `deleteBlocks`. Fix the stale comments listed under "Why
this matters".

**C. Tests.** Add a guard test (decision 3) and one interface test per
operation, looping over `RECORD_PARTS` rather than naming maps, so a new
part is covered without editing the tests. Re-point the unit and smoke
tests that list maps by hand at the table: unit.js ~411, ~539, ~668,
~3972; smoke.js ~1711, ~2966. Existing behaviour tests of the old helpers
are re-pointed at the new functions, not deleted, unless one only
re-checked a private detail. Say which.

**D. `AGENTS.md`.** Its paragraph on the maps (~:285–:316) names
`RECORD_PARTS` as where a new part is declared, and stops listing the maps
by hand.

**E. Equivalence (throwaway, not committed).** Load `origin/main`'s code
and the branch into two vm contexts, the way `test/unit.js`'s `loadApp`
does. On random profiles, apply each old operation and its replacement to
deep copies and compare the whole profile after each. The profiles should
cover:
- several blocks and days, and a lift on two days;
- weeks above 16 and stranded weeks;
- every part present, and every part missing;
- order arrays that include and exclude the exercise;
- obj and rir both on the source and destination day of a move;
- empty slots left behind.

Report the count. **Any difference is a STOP.** Include at least three
deliberate breaks to show the check can fail.

**F. Verify.** Run `node --check` on each touched file and `node test/unit.js`.
Run targeted smoke sections for delete block, wipe, clearDay and the plan
editor's move/purge (`node test/smoke.js --list`). Bumping `CACHE_VERSION`,
pushing and the PR are the orchestrator's job.

## STOP conditions

- The equivalence check finds any difference.
- A call site depends on an old helper's exact partial behaviour that the
  table cannot express without a hook the plan does not name. Report it
  rather than inventing a flag.
- The guard test finds a profile key that is neither a record part nor an
  obvious non-record field.

## Done criteria

- Two greps each return nothing outside `RECORD_PARTS` and its own
  comments:
  - `grep -nE "\['(log|rir|notes|energy|order|obj)'" js/`
  - the old helper names
- `node test/unit.js` passes, with the guard test and the per-operation
  table tests. The targeted smoke sections pass.
- The equivalence count is recorded below.

## Maintenance notes

**Drift.** Clean at the start. Both sessions named in the drift check
landed while this was in progress (#137 `loggedSets`, #138 notes/energy
re-keyed on restore). The branch was rebased over them. Neither touched a
function under "Current state". Two conflicts were resolved by hand: the
orphan-pass comment in `normalizeImportedProfile` (main's sentence on
falsy entries was kept) and a new unit test next to the move header. #137's
new `loggedSets` comment named `purgeExLog`/`purgeDayLog`, so it now names
`purgeRecord`.

**Equivalence (Step E).** This was run against `origin/main` at `e9e8e7a`,
after the rebase, in two vm contexts built the way `loadApp` builds one.
There were **10,000 comparisons: 1,000 random profiles for each of ten
operations, with 0 differences.** The ten operations were: purge one lift,
purge one day, clearDay (main's handler body verbatim), wipe, the real
`deleteBlocks` in each tree, a move, peSave's moves-then-purges sequence,
`installBlockData` with what its callers pass, `migrate` on damaged
profiles, and `normalizeImportedProfile`. The profiles covered everything
the plan asked for: three blocks, three days, e1 on two days, weeks 1, 2,
3, 8, 16, 17 and 20, every part present or every part missing, parts
missing per block, orders with and without the id, obj and rir on both
days, and empty slots.

Ten deliberate breaks were then made to the branch. Seven were caught:

| Break | Differences |
|---|---|
| order skipped by a day purge | 537 |
| wipe reaches variants | 328 |
| week ignored by clearDay | 351 |
| no lateral seed | 400 |
| order's move walks only the source day | 124 |
| order does not travel with a block | 99 |
| log merged keep-destination | 88 |

Three found no difference, and each is inert on every input a caller
produces:

- **obj travelling with a block.** No caller passes obj.
- **rir merge set to 'concat'.** rir values are never arrays.
- **Deleting order's no-op `purgeExercise` hook.** The general rule already
  leaves slot-keyed parts alone, so the hook documents decision 6 rather
  than enforcing it.

**Outside that domain** (shapes no write path and no import normaliser
produces), three differences exist, and they were probed deliberately:

1. A day purge now deletes a rir slot whose value is falsy (`null`).
   purgeRir used to skip it.
2. clearDay now deletes a non-canonical log/rir key such as `w01-d1`.
   It used to delete only `slot(week, day)` directly. For notes, energy,
   order and obj it always walked with forEachSlot.
3. The new functions tolerate a missing top-level map. moveEx*,
   purgeDayLog and clearDay used to throw a TypeError on one. migrate
   always creates these maps.

`installBlockData` no longer files notes/energy if handed them (decision
5; no caller does).

**Deviations.**

- `ensureRecord` runs at the end of migrate's per-profile repair, not
  where the maps used to be created. The variants seed needs the repaired
  blocks, and nothing between the two reads the record.
- rir has a `repair` hook as well as `install`: the fold on every load.
- `normalizeImportedProfile`'s orphan pass reads its list from the table.
  Import is otherwise untouched, but the done-criteria grep covers `js/`.

**Tests.**

- **Added:** eleven tests under "RECORD_PARTS: one table for the
  profile's record": the guard, the table's shape, and one test for each
  of wipe, block, day, day+week, lift, move, install and ensureRecord.
- **Re-pointed (none deleted):**
  - the old helpers' behaviour tests, now calling
    `purgeRecord`/`moveExerciseRecord`;
  - the created-when-absent checks, the restore round trip, the empty-plan
    restore and the w17 day purge, which now loop over the table;
  - the smoke checks for deleting a block and for the wipe, which gain an
    obj fixture. The wipe check reads `log` for sets rather than keys,
    because the redrawn session files its empty rows back.
- **Left alone:** the unit.js fixtures at ~981 and ~4461 that set
  notes/energy/order as filler. They do not test the record.
