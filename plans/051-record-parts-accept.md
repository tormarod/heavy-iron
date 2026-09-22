# Plan 051: The profile's record says how each part is accepted — one import loop over `RECORD_PARTS`, and unknown keys stay out

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 2805d9c..HEAD -- js/app.js js/profile-transfer.js js/qr-transfer.js js/block-editor.js test/unit.js test/smoke.js AGENTS.md`
> A restore-limits fix (another session: "Let a backup restore every block
> the app can write") may land first. It changes `normalizeImportedBlock`'s
> limits, not the per-part code this plan moves. Plan 050 renames the set
> counters. Compare `normalizeImportedProfile`, `reKeyImportedSlots`,
> `RECORD_PARTS` and `migrate`'s repairs against "Current state"; an
> unexpected change is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED. This is the untrusted-input seam, so the proof (Step E) is
  mandatory. There is one intended behaviour change, stripping unknown
  profile keys (decision 4).
- **Depends on**: plan 046 (`RECORD_PARTS`, merged as #141).
- **Category**: architecture — parts (b) and Q5 of candidate 5 of the
  architecture review of 2026-09-21, settled with the maintainer on
  2026-09-22.
- **Planned at**: commit `2805d9c`, 2026-09-22

## Why this matters

`RECORD_PARTS` (plan 046) is the one list of the profile's record for
purge, move, install and repair. Import still names every part by hand.
`normalizeImportedProfile` (js/profile-transfer.js ~149–193 at `e9e8e7a`)
runs a hand-written sequence: log (with a block-named error), rir, order,
obj, notes, energy, and variants separately (~241–255).

This code has failed three times the same way, by a part being handled
differently or not at all:
- order was not re-keyed before plan 010;
- notes and energy were not re-keyed until #138;
- lists of maps in comments went stale.

Two rules are also duplicated:
- **Variants cleanup** at profile-transfer ~247–249 is character for
  character `migrate`'s (app ~397–401), and `migrate` always runs right
  after restore and profile load.
- **The order rule** exists in three copies that differ slightly:
  - the import drops orders of fewer than two ids and caps before
    filtering;
  - `migrate`'s repair keeps one-id orders and caps after filtering;
  - `setOrder` only caps.

Extra keys on an imported profile, or at the top level of a backup, reach
storage untouched, because nothing whitelists them. Plan 046's guard test
list (record parts plus `label`, `theme`, `blocks`, `blockOrder`,
`activeBlock`, `week`, `day`) is exactly that whitelist.

## The decisions (settled 2026-09-22 — do not re-open)

1. **Each part gains `accept`:** how an untrusted value of that part is
   validated and re-keyed.
   - The slot-keyed parts plug their value check into the existing
     `reKeyImportedSlots` skeleton, which #138 made shared. Variants keep
     their exercise-id re-keying.
   - `normalizeImportedProfile`'s per-part code becomes one loop over
     `RECORD_PARTS`.
   - The log keeps its block-named error message ("el registro del bloque
     …") and its hard cap that throws.
2. **The duplicated rules fold into the parts:**
   - variants cleanup lives once, in the variants part, and both `migrate`
     and import use it;
   - the order rule lives once, in the order part. It is the stricter of
     today's rules where they differ, unless that would drop data the app
     itself wrote (then keep the lenient one and say why). Name each
     difference and decide it in the plan's notes.
3. **The named wrappers stay:** `normalizeImportedLog`, `Rir`, `Order`
   (and `Obj`, if called). The QR path (qr-transfer.js ~549–551) and about
   30 tests call them. They become thin calls to their part's `accept`.
4. **Unknown keys are stripped on import (intended behaviour change).**
   - A restored or loaded profile keeps only the record parts plus the
     named non-record fields. Share one list with plan 046's guard test,
     so the two cannot drift.
   - A backup's top level keeps only what `migrate` reads (`profiles`,
     `activeProfile`, `mode`, `prefs`, `v`, and whatever else the audit
     finds `migrate` or `load` using). Anything else is dropped.
5. **No `send` hooks.** Instead, a guard test checks that the QR "blocklog"
   payload's keys (qr-transfer.js ~427–438) equal the parts with
   `travelsWithBlock`. The wire keys are a contract with older phones, and
   `blockShareRir` reads the log, not its own part.

## Steps

**A. `accept` on each part**, in `RECORD_PARTS` (js/app.js), using
`reKeyImportedSlots` for slot-keyed parts. Keep each value check exactly as
today. Obj keeps leaving `kind`/`rir` absent, and order keeps dropping
fewer than two ids, subject to decision 2.

**B. `normalizeImportedProfile`** loops over the parts. The named wrappers
call `accept`. `migrate`'s variants cleanup and order repair call the same
code.

**C. Unknown keys** (decision 4), as its own commit. Add unit tests: a
hostile profile with extra keys (`__proto__`-style names included, parsed
through `JSON.parse`) restores without them, and a backup's extra
top-level keys are dropped. The app's own backup still round-trips exactly
(plan 010).

**D. Guard tests:**
- every part has `accept`;
- a table-driven round trip: for each part, an own-data value survives
  `normalizeImportedProfile` unchanged;
- the blocklog payload's keys equal the `travelsWithBlock` parts.

Update `AGENTS.md`'s untrusted-input section (~205–218) to point at the
parts' `accept`.

**E. Equivalence (mandatory, throwaway).** Run `normalizeImportedProfile`
and the named wrappers from `origin/main` and from the branch in two vm
contexts, the way `test/unit.js`'s `loadApp` builds one. Compare the
outputs and the thrown messages over:
- own-data profiles built by the app's writers;
- hostile profiles, reusing unit.js's `H = {toString:null}`,
  `__proto__`-key and renamed-day fixtures, plus random junk in every part;
- limits at, just under and just over each cap.

The only allowed differences are decision 2's named order and variants
changes and decision 4's stripped keys. Record the counts, and show that
at least three deliberate breaks are caught.

**F. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for "profile import hardening", the QR
  sections and "Guardar cambios".

## STOP conditions

- Step E finds a difference that decisions 2 and 4 do not name.
- The app's own backup no longer round-trips exactly.
- Stripping keys would drop a field the app itself writes onto a profile
  or a backup. Report it, and add it to the list only if it is a real
  field.

## Maintenance notes

(Filled in when the PR lands.)
