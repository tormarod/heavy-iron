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

**Drift.** Clean at the start: nothing in the drift check's files had
changed since `2805d9c`. main then moved three times while this was in
progress, and the branch was rebased over each:
1. #142 (plan 049, the rest timer).
2. #143 (the restore-limits fix the drift check names: `OWN_LIMITS`,
   `LOG_LIMITS.slots` 224 → 448, `PROFILE_LIMITS.profiles`), #144 (plan
   048, `writeRows`) and #145 (plan 050, `countSets`, which also carried
   this plan's own commit, so the plans commit was dropped as already
   upstream).
3. #146 (its follow-up: the block cap at the head of
   `normalizeImportedProfile` became `OWN_LIMITS.blocks`, 40 → 80).

None of them touched the per-part code, `reKeyImportedSlots`,
`RECORD_PARTS`, `setOrder` or migrate's repairs. #143 and #146 changed
only limit values, which is what the drift check anticipated. Every
conflict was resolved by keeping both sides:
- the index rows in `plans/README.md`;
- the "sharing a block" section comment in `js/app.js`, which plan 050
  rewrote: its text is kept, with a sentence saying the checks are each
  part's `accept` now;
- the `countProfileSets` comment in `js/profile-transfer.js`;
- `AGENTS.md`'s untrusted-input paragraph, twice, where #143's and
  #146's limit sentences and this plan's now stand side by side;
- a `test/unit.js` section next to plan 050's new send-sheet test.

**Decision 2: every difference, and how it was decided.**

1. *One id is still an order; the import wanted two.* The stricter rule
   (two or more) would drop data the app writes, so the lenient one
   stands. "Enviar a otra sesión" (`order.move`) takes the moved lift out
   of the source day's order and keeps the rest, so a day can be left
   with a one-id order. The repair always kept it, but the import dropped
   it from every backup: 300 states built by main's own writers carried
   338 of them, and main's restore lost all 338. It still carries
   meaning: `orderedEx` draws that lift first, which differs from the
   plan's order once the plan has put another lift ahead of it. The
   behaviour change is that a backup, a profile file or a QR "blocklog"
   now keeps a one-id order. `blockShareOrder` still sends only two or
   more (decision 5: no send hooks).
2. *The cap comes before the ids are resolved; the repair capped after
   filtering.* The stricter rule is the import's, cap first, whose result
   is always a prefix of the other. Nothing the app writes changes: every
   writer keeps its ids distinct, usable and at most `ORDER_LIMIT` long.
   The one exception is the move's append, which can reach
   `ORDER_LIMIT + 1`, and both rules cut that to the same first 60. The
   rules only differ on a stored list with junk or repeats before
   position 60 and real ids after it (2 of the limit fixtures).
3. *`setOrder` writes through the rule; it applied the cap alone.* The
   stricter rule applies, so a non-list, a repeat, a blocked key or a
   non-string is refused at the write. Its callers (`moveSessionEx`, and
   the reset with `null`) hand it the day's own ids, which the rule
   passes unchanged. One unit fixture ("a restored session order keeps
   all three of its exercises") planted a `__proto__` id through
   `setOrder`; it now writes the map directly, and what it tests is
   unchanged.
4. *The variants' list rule* has no difference: the two copies were
   identical character for character. The import's key cap
   (`IMPORT_LIMITS.days × ex`) and its re-keying stay in `accept`, and
   migrate never had them.

**Decision 4: what is stripped.**
- A profile keeps only `RECORD_PARTS`' names and `NON_RECORD_FIELDS`
  (`label`, `theme`, `blocks`, `blockOrder`, `activeBlock`, `week`,
  `day`). That is the guard's list from plan 046, now defined in
  `js/app.js` and read by the guard.
- A backup's top level keeps only `BACKUP_FIELDS` (`profiles`,
  `activeProfile`, `mode`, `prefs`, `setupDone`, `v`).
- The audit covered every write to the state's top level and to a
  profile, in `js/` today and in the whole history of the scripts
  (`git log -p`, the old hand-written map lists included). The state has
  only ever had `profiles`, `activeProfile`, `prefs`, `mode` and
  `setupDone`, and a profile only the fields above plus the parts of its
  record.
- `setupDone` is the one field the audit added: `load()` writes it and
  `migrate()` reads it.
- `v` is listed only because this plan names it. It is the version on
  the backup's wrapper, `{ app, v, saved, data }`, and `restoreFromText`
  keeps only `data`, so nothing the app writes ever puts a `v` on the
  state. It is kept as named, and costs nothing; the orchestrator may
  prefer to drop it.
- Nothing the app writes is stripped: there is a unit test for it, and
  Step E found 0 lost paths.

**Equivalence (Step E).** This was run against `origin/main` at
`f1f1e34`, the base this lands on, and before that at `f4d392c` and
`2a87448`, with the same outcome each time. It used three vm contexts,
each built the way `loadApp` builds one:
- main;
- the branch;
- a reference: main with only the three changes above patched in (the
  import's `> 1` → `> 0`, the repair's slice before its filter,
  `setOrder` through the same filter), and decision 4 applied as a
  post-step with both lists written out in the harness rather than read
  from the code.

The branch had to equal the reference on every input. Outputs were
compared as JSON text, so key order was held to the same standard, and
thrown messages were compared too. Every main-vs-branch difference then
had to be one the reference explains, and each was attributed to the
single change that explains it.

There were **19,219 comparisons, with 0 unexplained differences**:
- `normalizeImportedProfile`, 6,716 runs:
  - 600 own-data profiles, from 300 states built by main's own writers:
    `entry`, `setNoteText`, `setEnergy`, `moveSessionEx`,
    `moveExerciseRecord` with peSave's plan edit, `recordTarget`,
    `recordVariant`, `stampRowUnit`, `purgeRecord`, `pruneLog`,
    `emptyBlock` and the published blocks;
  - 2,424 hostile ones: the unit suite's `H`, `__proto__`-key and
    renamed-day fixtures, a profile with `__proto__`/`constructor`/
    `toString` at every level, array- and string-shaped parts, and random
    junk in every part, block, slot, exercise and field;
  - 3,600 near misses: a plausible wrong value at a position that
    resolves, in every part;
  - 92 at, just under and just over every cap: blocks (at 40 and at the
    80 #146 allows), rows, the hard cap, slots, weeks, own-mode days and
    exercises, order length, variants and their keys, note, drop, text
    and obj bounds.
- The restore as `restoreFromText` runs it (normalize, strip,
  `migrate`), 695 runs: 300 own backups, 300 damaged ones with junk
  top-level keys, and 95 limit cases including 15, 16 and 17 profiles.
- `migrate()` on 692 states, own and damaged.
- The four named wrappers, and notes' and energy's `accept` against
  main's old wrappers: 10,416 runs over strict and own blocks.
- A QR "blocklog" built by `blockShareLog`/`Rir`/`Order` and read back:
  300 runs. `setOrder`: 400 runs.

main and the branch differed on **3,238** of them, every one attributed:

| Change | Differences |
|---|---|
| 2a: one-id order kept on import | 2,231 |
| 4: unknown keys stripped | 572 |
| 2a and 4 in the same input | 313 |
| 2c: `setOrder` through the rule | 120 |
| 2b: the repair caps first | 2 |

The array-shaped part with a block named `length`, where writing the
value back throws a `RangeError`, behaves the same on both sides: the log
names its block (`rejects`), and every other part throws bare, as main
did.

The own backup's round trip, over 300 backups, was measured path by path
against main. The branch loses nothing main kept, and it keeps the 338
one-id orders main dropped. Neither version restores a backup byte for
byte, and those differences are all main's own, unchanged:
- blocks are rebuilt: phase entries follow a changed length, and an
  empty `alt`, `cue`, `share` or `ss` goes;
- objetivo records leave a false `hold`/`brake` and a null `rir` absent,
  and write a missing move as `''`;
- half-typed drops and emptied slots are dropped.

Twelve deliberate breaks were then made to the branch, and **all twelve
were caught**. Each figure is the unexplained differences in 12,739
comparisons (60 seeds); "lost" is own-data paths the round-trip check
flagged.

| Break | Unexplained |
|---|---|
| rir accepts `'3'` | 15 |
| log hard cap off by one | 2 |
| notes cap one short | 960 (107 lost) |
| order wants two ids again | 708 |
| order caps after resolving | 33 |
| variants lose their key cap | 4 |
| log loses `rejects` | 7 |
| obj keeps `hold: false` | 1,835 |
| exercise ids not re-keyed | 158 |
| variants keep 13 | 21 |
| `NON_RECORD_FIELDS` loses `week` | 1,437 (114 lost) |
| `BACKUP_FIELDS` loses `setupDone` | 119 (20 lost) |

**Deviations.**
- `normalizeImportedBackup` (`js/profile-transfer.js`) is new. It is
  `restoreFromText`'s per-profile loop plus the top-level strip, split
  out so decision 4's backup half has a unit test without a dialog. The
  rejection message is the same string.
- The log part has a `rejects` flag. The loop wraps only a part that can
  refuse the file, which is what keeps every thrown message identical.
- `eachExercise(check)`, beside `reKeyImportedSlots`, is the
  per-exercise walk the log, rir and obj normalizers each had a copy of.
- `recordPart(name)` is new too: the named wrappers and `setOrder` use
  it.
- `normalizeImportedNotes`/`Energy` are deleted. After the loop nothing
  called them, and decision 3 keeps only the four the QR path and the
  tests call. `js/profile-transfer.js` is precached with `app.js`
  (`AGENTS.md`), so no older copy of it can call them.
- The QR payload guard compares what "blocklog" adds to the "block"
  payload, rather than a hand-written list of envelope keys.

**Tests.**
- **Added, 8** under "a restore keeps what the app reads, and nothing
  else": extra keys (`__proto__`, `constructor` and others, parsed from
  JSON) leave a profile and a backup's top level with both prototypes
  intact; nothing the app writes is dropped; and the state holds nothing
  `BACKUP_FIELDS` leaves out.
- **Added, 14** under "RECORD_PARTS: each part says how it is accepted":
  every part has `accept`; the fixture carries a one-id order; one test
  per part shows its own-data value survives; five pin the order rule.
- **Added, 1** in the async tail: the blocklog payload's keys equal the
  `travelsWithBlock` parts.
- **Changed:** plan 046's guard reads `NON_RECORD_FIELDS`, and one
  fixture was re-pointed (see decision 2, item 3).
- Each new guard was checked against a deliberate break: stripping
  disabled, the two-id rule back, `order` dropped from the payload.

**Verification.**
- `node --check` passes on every `js/*.js`, `sw.js` and `test/*.js`.
- `node test/unit.js`: 972 passed, 0 failed.
- `BASE=http://127.0.0.1:8799 node test/smoke.js --only "profile import
  hardening" --only "main session" --only "Guardar cambios" --only
  "weight drops"`: 266 passed, 0 failed on the final tree, and it passed
  after each earlier rebase too. The QR sections are sub-headings of
  "main session", and "weight drops" has a QR round trip of its own.
- The equivalence harness is throwaway and not committed.
- `CACHE_VERSION` is not bumped; that is the orchestrator's step.
