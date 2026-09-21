# Plan 038: One session reader — every read of a logged set goes through `sessionsOf`, and one codec owns the row's fields

> **Executor instructions**: Follow this plan one PR at a time, in the
> order below. Run every verification command and confirm the expected
> result before moving on. If a STOP condition occurs, stop and report —
> do not improvise. When a PR lands, tick it in the table under "The seven
> pull requests" and add anything that deviated to "Maintenance notes".
>
> **Drift check (run first, every PR)**:
> `git diff --stat 2454150..HEAD -- js/app.js js/diagnostics.js js/chart.js js/review.js js/profile-transfer.js test/unit.js docs/guide.md`
> On any in-scope change, compare the "Current state" section against the
> live code before proceeding; a reader that has already moved, or a new
> reader of raw log rows, is a STOP condition until this plan is updated.

## Status

- **Priority**: P2
- **Effort**: L, in seven PRs of S–M each
- **Risk**: MED — every screen that reads the log moves onto a new
  reader. Mitigated by the order (the reader lands with its own tests and
  no callers first; the objetivo, the best-covered reader, moves next) and
  by a hard rule: **a PR that moves a reader changes nothing that reader
  returns**, except in the two PRs named as visible changes (4 and 7).
- **Depends on**: the lb stamp fix (PR #119, merged). Independent of
  030/031's open menus.
- **Category**: architecture — candidate 1 of the architecture review of
  2026-09-21 (a deep module in place of thirteen shallow readers), with
  the design settled with the maintainer in the same session.
- **Planned at**: commit `2454150`, 2026-09-21
- **Glossary**: `CONTEXT.md` (new with this plan) — **set**, **working
  set**, **session**, **session date**, **extra set**, **lift**,
  **deload week**, **stranded week**. Use those words in comments and
  prose.

## Why this matters

About thirteen readers turn a slot's raw row array into "the sets that
count", each by hand, and they disagree along four axes:

| Axis | Today |
|---|---|
| which sets count | `rowWorked` (the rule), `done && w !== ''` (last time, prior block), `!isNaN(rowWeight)` (the charts), `hasReps && ≤ 15` (the Diagnóstico) — seven filters in all |
| the deload week | `deloadAt` (the rule, the prior-block band), `w === deloadWeek` (the Diagnóstico), not skipped (the charts, the CSV) |
| which weeks | every logged slot (the rule, the record badge, the all-blocks chart) vs `1..blockWeeks` (the CSV, the Diagnóstico, the prior-block band) |
| which lift | by id (the rule, the Diagnóstico, the all-blocks chart), id-then-name via `liftSlots` (the prior-block band, the per-day chart), same day only (`lastTime`) |

Plan 035 had to touch the objetivo, the Diagnóstico, the review, the
validators, the shares and the CSV because each owned a copy of this
reading, and the `u` stamp that PR #119 fixed was lost the same way: two
field lists "mirrored" by a comment, both missing the same field.

## The decisions (settled 2026-09-21 — do not re-open)

1. **Scope**: the row codec and the session reader. The render cache and
   a pure `targetFor` (review candidate 3) and the five used-row counters
   (`countShareLog`, `blockDoneSets`, `blockLoggedSets`,
   `countProfileSets`, `countBackupSets` — review candidate 5) are out.
2. **Sets**: a session carries every **ticked** set, already parsed, with
   one `worked` flag. Readers filter on the fields. The Diagnóstico's
   15-rep cap stays in `js/diagnostics.js` (it is about Epley, not rows).
3. **Deload**: one definition, `deloadAt`, behind `skipDeload: true`.
   The charts and the CSV keep deload weeks.
4. **Stranded weeks**: `weeks: 'plan' | 'logged'`, **no default** — every
   reader states which question it asks. Screens about the block use
   `'plan'` (docs/guide.md:223, :1097 promise they are hidden); screens
   about the lifter over time — the objetivo, the record badge, the
   all-blocks chart — and the CSV use `'logged'`.
5. **Lift identity** is an option, not unified: `lift: { id }` or
   `lift: { like: ex }` (the `liftSlots`/`sameLift` match), plus `day`.
   The variant cutoff (`variantSince`) stays with the rule.
6. **Weight**: each set carries `w` (converted to the profile's unit),
   `wLogged` (as typed) and `unit`. No reader calls `rowWeight` on a raw
   row again.
7. **RIR** is resolved inside, legacy fallback included — `getRir` and
   the `rir` map become internal to the module.
8. **Extra sets** are included, flagged `extra`.
9. **Session date** is the median of the ticked sets' `ts`; each set
   keeps its own `ts`.
10. **Order**: oldest first — block order, week, the day's position in
    the block, the lift's position in the day. One cut-off option,
    `before: { block, week }`. No newest-first variant; a reader that
    wants the latest takes the last.
11. **One entry point**: `sessionsOf(profile, query)`; leaving out `lift`
    means every lift.
12. **The row codec** is one list of fields, each saying how it is sent,
    how it is accepted and which CSV column it fills; a unit test
    round-trips a row with every field set, so a field added without an
    entry fails `node test/unit.js`. Per-session CSV columns (`nota`,
    `energia`, `orden`) are not row fields and stay out.
13. **The objetivo's maths** (`capOf`, `cens`, `rho`, `conv`) leaves the
    session: `ruleSession(session, lo, hi)` projects a session for the
    rule. The session module knows nothing about the rule.
14. **Cost**: measured with a synthetic large profile before the card
    bands (PR 6) move. An internal early exit only if a full draw gets
    noticeably slower; candidate 3's cache is the real answer if it does.
15. **Tests**: new tests at `sessionsOf`'s interface, through a fixture
    builder (sessions in, a profile out). Existing reader tests stay as the
    regression net; after a reader moves, delete only the tests that
    re-checked its private filter.
16. **Where it lives**: `js/app.js` — AGENTS.md split rule 2, since
    `js/diagnostics.js`, `js/chart.js` and `js/review.js` all read it.

## The interface

```js
sessionsOf(profile, {
  weeks: 'plan' | 'logged',          // required; throws without it
  lift: { id } | { like: ex },       // optional; omitted = every lift
  day: dayId,                        // optional
  blocks: [blockId, …],              // optional; default profile.blockOrder, in that order
  before: { block, week },           // optional; nothing at or after that point
  skipDeload: true,                  // optional; deloadAt
})
// → [{ block, week, day, lift, ts,
//      sets: [{ w, wLogged, unit, r, rir, drops: [{ w, wLogged, r }],
//               dropKind, ts, worked, extra }] }]
```

A session with no ticked set is not returned. `r` is a number (`NaN`
when empty); `rir` is a number or `null`. A working set's `rir` is exactly
what `exSession` reads today (`sessionRirs` over the working sets, the
legacy chip as the fallback); any other ticked set carries its own
`rowRir` or `null`. `extra` compares the set's index with `setsFor` for
that lift's planned row on that day; a lift no longer in the plan has no
extra sets.

## The seven pull requests

| # | PR | Visible change | Status |
|---|---|---|---|
| 1 | **Row codec** — one field list; `blockShareLog`, `normalizeImportedLog` and `buildCsv`'s row columns built from it; the round-trip test | none | TODO |
| 2 | **`sessionsOf`**, the fixture builder, interface tests; the cost measurement recorded below | none | IN PROGRESS |
| 3 | **Objetivo**: `exHistory`/`exSession` become `sessionsOf` + `ruleSession` | none | TODO |
| 4 | **Diagnóstico**: `diagPoints`, `strengthByExercise`; the deload becomes `deloadAt` | a deload written into the phase text is skipped — guide, Diagnóstico section | TODO |
| 5 | **Charts**: `collectHistory`, `collectHistoryDays`, `collectHistoryAll` | none | TODO |
| 6 | **Card bands**: `lastTime`, `lastTimeOtherDay`, `priorBlockSets`, `bestByExercise`, `bestForExercise` | none | TODO |
| 7 | **Review tally and CSV**; the CSV on `'logged'`, removed exercises included | the CSV exports stranded weeks and sets of removed exercises — guide, export section and the "hidden everywhere" line at :1097 | TODO |

Every PR bumps `CACHE_VERSION` (`tools/bump-cache-version.sh`) and runs
`node --check` and `node test/unit.js` after every edit.

### Known open point for PR 7

The CSV is "one row per logged set" and has a `hecha` column: it exports
**used** rows, ticked or not, which a session (ticked sets only) does not
carry. PR 7 decides with the maintainer between a `sets: 'ticked' | 'used'`
query option and leaving the CSV's row walk on the codec alone. Do not
settle it silently.

## STOP conditions

- A moved reader's existing unit or smoke assertions change outcome in a
  PR not listed as a visible change.
- `ruleSession(sessionsOf(…))` does not reproduce `exSession` for every
  case in the v3 sections of `test/unit.js` (PR 3).
- The cost measurement shows a full `drawApp` more than ~20 % slower on
  the synthetic profile once the card bands move (PR 6).

## Maintenance notes

**PR 2 (`sessionsOf`)**. Landed with no callers, as planned. Nineteen
interface tests in `test/unit.js` § "sessionsOf: the one reading of the
log", through `sessionFixture` (defined in the app's own scope by that
section). The RIR case compares every working set against `exSession`
across five row shapes × three legacy chips, so PR 3 starts from a proven
equivalence. Three mutations were each caught by exactly one test:
`deloadAt` → `w === deloadWeek`, the legacy chip dropped, and `'plan'`
ignoring stranded weeks.

**The cost measurement (decision 14) — read before PR 6.** A synthetic
profile of 6 blocks × 12 weeks × 6 days × 8 lifts × 4 sets (13,824 rows),
Node on a desktop, one day's eight cards:

| Reading | ms per day drawn |
|---|---|
| `lastTime` + `priorBlockSets` today (early exits) | 0.21 |
| the same two bands through `sessionsOf` | 14.8 |
| `exHistory`, the rule's own history, today | 8.4 |

The gap is structural: the old bands stop at the first hit, while
`sessionsOf` reads the lift's whole history (~20 µs per session). Lift
matching by likeness costs 0.8 ms and the legacy RIR lookup 2.2 ms. The
rest is reading every session. At a phone's ~4× that is ~60 ms more per
draw on a profile this size, which is well over STOP condition 3's 20 %.
**PR 6 does not move the bands until the maintainer picks between** an
early exit inside the module (which would reopen decision 10's "no
newest-first variant") and landing candidate 3's history cache first. PRs
3–5 are unaffected: the rule already pays the full walk, and the
Diagnóstico and the charts run on a tap, not on every draw.
