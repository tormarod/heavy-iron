# Plan 053: The plan draft is one object, and saving it erases exactly what the dialog promised

> **Executor instructions**: Follow this plan step by step. Write the
> failing tests first (Step A). Run every verification command and confirm
> the expected result before moving on. If a STOP condition occurs, stop
> and report — do not improvise. Fill in "Maintenance notes"; the
> orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8142e33..HEAD -- js/block-editor.js js/app.js test/unit.js test/smoke.js docs/guide.md`
> Plan 052 (the booted test harness) may land first. It changes `test/`
> only; rebase over it. Any change to `peDraftBlock`, `peDraftPurge`,
> `peDraftOriginalDay`, `#editPlan`, `#peSave`, `closePlanEditor`,
> `moveExToDay` or the "Retirados" erase handler since `8142e33` means
> comparing against "Why this matters" first.

## Status

- **Priority**: P1. Erasing is the one destructive path in the editor,
  and today it can miss.
- **Effort**: M
- **Risk**: LOW–MED. The equivalence check (Step E) confines differences
  to the two bug shapes.
- **Category**: architecture and correctness — candidate 1 of the second
  architecture review (2026-09-22), settled with the maintainer the same
  day.
- **Planned at**: commit `8142e33`, 2026-09-22
- **Glossary**: `CONTEXT.md` — **plan draft** and **retired** (new with
  this plan), **block**, **the profile's record**.

## Why this matters: the current state (js/block-editor.js at `8142e33`)

The plan draft lives in three module globals:
- `peDraftBlock`, ~630;
- `peDraftPurge`, ~631, the confirmed erasures;
- `peDraftOriginalDay`, ~646, a `Map` from each draft exercise object to
  the day it was on when the editor opened, keyed by identity because the
  same id can sit on two days on purpose.

They are reset by hand in `closePlanEditor` (~1136), `#editPlan`
(~1198–1199) and the end of `#peSave` (~1274).

`#peSave` (~1227–1280) runs, inline:
1. `syncDraftFromForm`
2. the undo snapshot
3. **moves**: for each exercise *still in the draft* whose starting day
   differs from its draft day, `moveExerciseRecord(from, to)`
4. **erasures**: `peDraftPurge.forEach(p => purgeRecord(profile, block,
   { day: p.dayId, exercise: p.exId }))`
5. variant records for renamed exercises
6. replacing the block
7. commit, close and the status line

"Retirados" → "Borrar registro" (~900–925) splices the item out of the
draft and pushes `{ dayId: it.day.id }` or `{ dayId, exId }`. **That's the
draft day, not where the item's sets actually sit.** The confirm dialog
counts through `draftExLogged` / `draftDayLogged` (~652–657), which
correctly read the starting day.

**Bug 1, move-then-erase** (the second review confirmed it with the real
handlers):
1. "Enviar a…" moves exercise X from day A to day B.
2. X is removed, then erased in "Retirados". The dialog promises its 2
   sets.
3. On save, X is no longer in the draft, so step 3 never moves its record.
   Step 4 purges day B, where nothing is.
4. The 2 sets stay under A.

**Bug 2, day-erase after a move**: erasing day B after exercise X was
moved into it from A leaves X's sets under A in the same way.

**Bug 3, stale draft**: while the sheet is open, another tab's write can be
adopted (app.js ~1146–1167, which replaces the profile objects). Saving
then writes a draft cut from the old state over the adopted one.

`peSaveProbe` (test/unit.js ~3409) copies the move loop by hand, which is
why no test could see bugs 1 and 2. The smoke suite never drives "Enviar
a…" together with "Borrar registro".

## The decisions (settled 2026-09-22 — do not re-open)

1. **One draft object.** `openPlanDraft(profile, block)` returns it. It
   holds:
   - the block copy;
   - where each exercise started (the identity map, kept);
   - the erasures confirmed;
   - the profile object it was cut from.

   `applyPlanDraft(profile, draft)` does the record catch-up, the
   erasures, the variant records and the block replacement, and returns
   what the status line needs (the renamed count). The `#peSave` handler
   keeps the form sync, the dialogs, the undo snapshot, `commit`, close
   and `mark`. The three globals become one `peDraft`, and the hand resets
   become `peDraft = null`.
2. **An erasure records what was confirmed.**
   - For an exercise: the exercise object.
   - For a day: the day object plus the exercise objects it held at that
     moment.

   At apply time each is **resolved to where the records sit**:
   - an erased exercise is purged at its starting day;
   - an erased day gets its own slots purged, plus each exercise it held
     that came from another day, purged at that exercise's starting day.

   This matches what the confirm dialog already counts.
3. **Order inside the apply** — the maintainer's decision of 2026-09-22,
   taken after the executor's STOP (Q-053a). It replaces "moves first,
   then the resolved erasures".
   1. Purge each erased exercise under the day it started on: every
      exercise erased on its own, plus every exercise an erased day held
      that came from another day.
   2. Apply the "Enviar a…" moves.
   3. Clear each erased day's own slots.
   4. Then the variant records and the block replacement, as before.

   Exercises before the moves, because with the same id on two days a
   move can land the other copy on the very day an erased copy is purged
   under, and once the move has merged them no purge by day and id can
   tell whose sets are whose. Moves first erased both. That was the STOP:
   A's copy sent onto B, B's copy erased; the dialog said 2 sets, the save
   erased 4, and the old save did the same. Days after the moves, for the
   reason the first version of this decision gave: an exercise that left
   a day before that day was erased takes its sets along before the day's
   slots are cleared.
4. **A stale draft is refused.** If the profile to save into is not the
   object the draft was cut from, the save changes nothing and shows "Los
   datos cambiaron en otra pestaña: vuelve a abrir el editor". The sheet
   stays open. There is no attempt to merge.
5. **Tests first, then proof.** Failing tests against `applyPlanDraft`:
   bug 1, bug 2, the same id on two days (decision 3's edge), and bug 3's
   refusal. Then an equivalence check (Step E). One `bootApp()` test
   through the real `#peSave` once plan 052 has merged.

## Steps

**A. Failing tests** in `test/unit.js` against the new interface (which
doesn't exist yet, so they fail):
- Move X from A to B, erase X, apply: no sets for X remain anywhere in the
  block's record. The dialog's count equals what was erased.
- Move X into B, erase day B, apply: X's sets and B's own slots are gone,
  and nothing else is touched.
- The same id on days A and B from the start: erasing B's copy leaves A's
  copy and its sets intact. This must hold whichever of today's catch-up
  paths runs.
- Apply against a different profile object than the draft was cut from:
  nothing changes, and it reports the refusal.
- Record the four failing, as their names in the run's output.

**B. `openPlanDraft` / `applyPlanDraft`** in `js/block-editor.js`, which
has the old-file licence under AGENTS.md's split rules. Move the
catch-up, erasure and rename code into `applyPlanDraft`, keeping its
comments. Replace the three globals and their hand resets. Every reader of
`peDraftBlock` (the editor's renderers, `syncDraftFromForm`,
`draftExLogged`, the export button, `moveExToDay`, …) reads
`peDraft.block`. Grep them all.

**C. The erase handler** records the confirmed object (decision 2), not a
day id.

**D. `#peSave`** calls `applyPlanDraft`. It shows the stale-draft message
through `tell(...)` and keeps the sheet open when refused. Keep the undo
snapshot where it is, but take it only when the apply will run (not on a
refusal).

**E. Equivalence (mandatory, throwaway).** Restated by the maintainer on
2026-09-22, after the STOP (Q-053b). In two vm contexts (the way
`test/unit.js`'s `loadApp` builds one), run the old `#peSave` path (the
handler body from `origin/main`, driven through its globals) and the new
`applyPlanDraft` over random sequences of editor actions:
- renames, set changes, "Enviar a…" moves, removals, "Restaurar",
  day adds and removes, and "Borrar registro" on exercises and days;
- on random profiles with logs, including the same id on two days.

On every session, assert directly that **the sets erased are exactly the
sets the dialog counted, and nothing else in the profile's record
changes**. "Identical to the old save" holds only for sessions with no
erasures. The first version allowed differences from the old save only
in the two bug shapes; it could not see the STOP's case, because there the
old save and the moves-first order lose the same sets. Record the counts,
and show at least three deliberate breaks are caught, including putting
the moves back before the per-exercise purges.

**F. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for "Guardar cambios" and any plan-editor
  sections (`--list`).
- If plan 052 has merged, add the `bootApp()` test through the real
  `#peSave` (move, erase, save, and assert the record).
- Bump `CACHE_VERSION` (the orchestrator does this at PR time).
- If the guide's editor table (docs/guide.md ~1413–1418) needs a word
  about the stale-draft refusal, add one line.

## STOP conditions

- A resolved erasure would touch sets of an exercise the user did not
  confirm. This includes the same-id-on-two-days case.
- The Step E check fails on any session (as restated in Q-053b).
- Any existing unit or smoke assertion changes outcome.

## Maintenance notes

Executed 2026-09-22 on `claude/053-impl`, rebased onto `74a657c` (plan
052 PR 1, #152, merged). `CACHE_VERSION` is left for the orchestrator to
bump at PR time.

**What landed.**
- `js/block-editor.js`: `openPlanDraft(profile, block)` returns
  `{ block, startDay, erased, profile }`, and `peDraft` holds it while
  the sheet is open.
  - `eraseFromDraft(draft, it)` is the "Retirados" erase. It records
    `{ ex }`, or `{ day, held }` for a day.
  - `planDraftStale(profile, draft)` checks that the draft was cut from
    this profile object.
  - `applyPlanDraft(profile, draft)` returns the renamed count, or
    `null` having changed nothing.
  - Every reader of the three old globals reads `peDraft`:
    `draftExLogged`, the deload options, the priority chips, the editor's
    render and its "+ Añadir día", the day box, "Retirados", "Enviar
    a…", `syncDraftFromForm`, `closePlanEditor`, `#editPlan`, the weeks
    and deload fields, `#peSave`, `#peExport` and `#peDeleteBlock`.
  - `#peSave` asks `planDraftStale` first, before the form is read and
    before the undo snapshot. On a refusal it shows
    `tell('No se ha guardado', 'Los datos cambiaron en otra pestaña:
    vuelve a abrir el editor.')` and keeps the sheet open.
- `js/app.js`: one word in `moveExerciseRecord`'s comment.
- `docs/guide.md`: one row in the editor table, for the refusal.
- `test/unit.js`:
  - The plan-053 section: bug 1, bug 2, an exercise that left a day
    later erased, the same id on two days five ways, and bug 3.
  - Plan 052's booted `peSaveProbe` now reads `peDraft`.
  - A booted section drives the editor's own controls: send, retire,
    erase, save and "Deshacer", plus the refusal through a real
    'storage' event.
  - 1079 passed on the branch; 1063 on main.

**The STOP.** Decision 3 as first written (moves first) still lost sets
nobody confirmed, when the same id sits on two days (see decision 3). The
maintainer replaced the order (Q-053a) and Step E's rule (Q-053b); both
are written in above.

**Step E.** A throwaway harness ran 20,000 random sessions per
configuration, on the same seeds. The old side is origin/main's
`#editPlan`, erase and `#peSave` bodies, cut from its source and driven
through its globals. The new side is the branch's same three places.
- **The new save** had 0 failures on every check:
  - 8,775 sessions had an erasure (4,052 of a day), 16,481 a move, 7,289
    both, and 9,804 had one id on two days.
  - The dialogs counted 62,614 sets, and the save erased exactly those
    rows.
  - The whole record matched a reference built another way: what was
    confirmed removed where it sat, then everything else moved.
  - Sessions with no erasure were identical to the old save, and the
    block and variants matched it in every session.
- **The old save differed** in 2,351 sessions, every one with both a
  move and an erasure. Measured the same way, the old save erased other
  than what its dialogs counted in 1,223 sessions. It kept counted sets
  in 1,186 and erased uncounted ones in 54.
- **Deliberate breaks**, each caught:

  | Break | Sessions | The unit suite fails on |
  |---|---|---|
  | Moves back before the per-exercise purges | 47 (62,770 erased for 62,614 counted) | the same id, A's copy sent onto B; a day erased while holding A's copy |
  | An erased day's slots cleared before the moves | 755 | the exercise that left a day later erased |
  | Held exercises not purged (bug 2) | 778 | bug 2 and one same-id assertion |
  | An erased day's slots never cleared | 4,037 | three assertions |

- **origin/main's editor** fails nine of the new assertions, each on the
  substance. Through its real controls, the dialog promised 4 sets and 4
  were still there after the save. The stale-draft refusal never came:
  the sheet closed, the other tab's data was overwritten, and an undo
  was taken.

**Smoke.** `--only` "Guardar cambios", "main session", "músculos
prioritarios" and "reduced motion", against a static server on :8801:
262 passed, 0 failed.

**Where the executor went beyond the plan:**
- `eraseFromDraft` and `planDraftStale` are two small functions the plan
  didn't name.
- The refusal dialog has a title, "No se ha guardado", and the plan's
  sentence gets a closing period.
- The stale check runs before the form is read.
- Plan 052 had already made `peSaveProbe` a booted test, so it kept that
  version.

**Follow-up, not done here.** "Enviar a…" onto a day that already holds
the same id leaves two copies of it on one day, sharing one merged
record. On the next load `migrate()` renames the second copy (to its
name's slug), and it starts with no history; the first copy keeps all
the sets. That predates this plan.
