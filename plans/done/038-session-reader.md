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
//      sets: [{ w, wLogged, unit, r, rLogged, rir, rirOwn, drops: [{ w, wLogged, r }],
//               dropKind, ts, worked, extra }] }]
```

A session with no ticked set is not returned. `r` is a number (`NaN`
when empty); `rir` is a number or `null`. A working set's `rir` is exactly
what `exSession` reads today (`sessionRirs` over the working sets, the
legacy chip as the fallback); any other ticked set carries its own
`rowRir` or `null`. `extra` compares the set's index with `setsFor` for
that lift's planned row on that day; a lift no longer in the plan has no
extra sets. `rLogged` carries reps the way `wLogged` already carries
weight — the exact string the row had — because a reader that prints reps
back (the chart) needs the typed text, not the parsed number, byte for
byte (PR 5).

## The seven pull requests

| # | PR | Visible change | Status |
|---|---|---|---|
| 1 | **Row codec** — one field list; `blockShareLog`, `normalizeImportedLog` and `buildCsv`'s row columns built from it; the round-trip test | none | DONE (#121) |
| 2 | **`sessionsOf`**, the fixture builder, interface tests; the cost measurement recorded below | none | DONE (#120) |
| 3 | **Objetivo**: `exHistory`/`exSession` become `sessionsOf` + `ruleSession` | none | DONE (#123) |
| 4 | **Diagnóstico**: `diagPoints`, `strengthByExercise`; the deload becomes `deloadAt` | a deload written into the phase text is skipped — guide, Diagnóstico section; a week's two sessions of a split lift in plan day order | DONE (#125) |
| 5 | **Charts**: `collectHistory`, `collectHistoryDays`, `collectHistoryAll` | a week's two points of a split lift in plan day order (as PR 4) | DONE (#126) |
| 6 | **Card bands**: `lastTime`, `lastTimeOtherDay`, `priorBlockSets`, `bestByExercise`, `bestForExercise` | the RECORD badge no longer counts logs left behind by blocks deleted before plans/002 | DONE (#135) |
| 7 | **Review tally and CSV**; the CSV on `'logged'`, removed exercises included | the CSV exports stranded weeks and sets of removed exercises — guide, export section and the "hidden everywhere" line at :1097 | DONE (#127) |

Every PR bumps `CACHE_VERSION` (`tools/bump-cache-version.sh`) and runs
`node --check` and `node test/unit.js` after every edit.

### PR 7's open point — settled 2026-09-21 by the orchestrator

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
PRs 3–5 are unaffected: the rule already pays the full walk, and the
Diagnóstico and the charts run on a tap, not on every draw.

**Decided 2026-09-21: cache first.** PR 6 waits for candidate 3's history
cache, where one full read per draw serves every card and the cache is
invalidated by the log itself, not by whoever remembers to reset it.
Decision 10 stands: there is no early exit and no newest-first variant.
The cache is its own plan, written after PR 3, when the rule's history
already comes from `sessionsOf`. PR 6 re-runs this measurement on top of
it and must come in under STOP condition 3.

**PR 1 (the row codec)**. `ROW_FIELDS` sits next to `LOG_LIMITS` in
`js/app.js`, with `rowToShare`, `rowFromImport`, `rowCsvCells` and
`ROW_CSV_COLUMNS` as its interface. `blockShareLog`, `normalizeImportedLog`
and `buildCsv`'s set columns are built from it, and their per-field
comments moved onto the fields. One deviation from decision 12's wording:
"a field added without an entry fails" is enforced by scanning the source
for `r.<field> =` and `delete r.<field>` (comments stripped) against the
codec's keys. A fixture could not know about a field nobody told it about.
The shared row's keys now come in CSV order (`w, u, r, done, …` instead of
`w, r, done, ts, rir, u, …`): same bytes, same meaning, and no reader
depends on key order. Mutation-checked: dropping `u` from the list,
accepting a '2+' chip as a row RIR, and writing an unknown `r.zz` each
fail. Found on the way, and out of scope: `txt()` throws on a JSON value
like `{"toString": null}`, which predates the codec (spun off as its own
task).

**PR 3 (the objetivo)**. `exSession` is gone. `ruleSession(session, lo, hi)`
projects a session for the rule. It keeps the rule's own date, the median
over the WORKING sets' times: `session.ts` covers every ticked set, and
using it moved targets in the equivalence check. `exHistory` is a
`sessionsOf` query (`'logged'`, by id, `before`, `skipDeload`) plus the
rule's own split-day filter and variant cutoff. The `ord` field it used to
leave on sessions is gone, since nothing read it. Equivalence: 400 random
profiles, 41,859 `exHistory` calls and every `targetFor` compared against
`origin/main` in two vm contexts, with 0 differences. Swapping in
`session.ts` as a mutation was caught. The three tests that called
`exSession` now call `ruleSession(sessionsOf(…))`. The sessionsOf RIR
equivalence test now compares against the old reading written out from
raw rows, so it does not compare the new code with itself.

**PR 4 (the Diagnóstico)**. `diagPoints` (with `skipDeload`),
`strengthByExercise` and `muscleSessions` (deload kept, since they measure
attendance and `deloadCheck` reads the weeks either side of it) read
through `sessionsOf` on `'plan'` weeks. `strengthRows` uses `deloadAt` for
the ends of its index. `trainedDays` stays a row counter. Deviations: each
point's `rir` still comes from `getRir` (it can be a legacy '2+' string,
read through `rirNumber`), and `rows` are still the raw ticked rows that
`forcedDrop`, `repDecay` and `rowRir(rows[0])` read. Moving those waits for
the review's `rirOwn` (PR 7) and a raw-row question of its own.
**Accepted difference beyond the deload (orchestrator's call, under
decision 10):** within a week, two sessions of a lift planned on two days
now come in the plan's day order, the order the objetivo already reads
them in, instead of whichever day's log key was created first. In the
equivalence check this moved `diagRows`' verdict in ~14 of 200 random
profiles, and only when a lift is planned on two days and those days were
opened out of plan order. Floating-point sums in `strengthRows` move by
≤5e-16 relative. Everything else was identical across 16,688 outputs, and
a hand-written deload equals the same deload set as the block's deload
week (13,029 identical).

**PR 5 (the charts)**. The three collectors read `sessionsOf` and no
longer touch `profile.log`. `collectHistory` and `collectHistoryDays` ask
for `'logged'` weeks and apply their callers' own week cap, which is not
always the block's length, so `'plan'` would have hidden a stranded week
inside a larger cap. `collectHistoryAll` asks for `'logged'` weeks, as
plans/008 item 20 decided. Deloads stay on the chart. **Interface
addition:** a set carries `rLogged` (reps as typed) next to `r`, the same
pair weight has in `w`/`wLogged`. Rebuilding the text from the number
turned an imported '8,5' into '8.5' and '08' into '8'. Equivalence: 36 of
37 cases identical. The one accepted difference is PR 4's: two points of a
split lift in the same week, logged out of plan-day order, now come in
plan order.

**PR 7 (the review tally and the CSV)**. The open point is settled: the
CSV is a dump of stored rows, ticked or not, like the row counters decision
1 left out. So it stays a walk of the log, through the codec's cells, and
does not go through `sessionsOf`. What changed is the walk:
`forEachSlot` over every logged week, then every exercise id in the slot,
in this order: the plan's days and exercises, weeks ascending (stranded
weeks after the block's own), then ids the day's plan no longer lists,
then days no longer in the plan. A removed exercise is named from the
block's plan on any day if it can be, otherwise by its id, with an empty
`orden`. A profile with nothing hidden exports byte for byte what it did
before (800 random profiles). The review's RIR tally reads `sessionsOf`
(`'plan'`, by id, the days where the plan still has the lift live, working
sets). **Interface addition:** a set carries `rirOwn`, the value typed on
that set. The tally counts what was typed, not the inherited reading, so
it cannot use `rir`. Equivalence: 0 differences across 10,122 review
outputs, AI prompt text included. Mutations (reading `rir`, dropping the
live-day filter) were caught. The review's energy walk stays a row walk,
since its volume arithmetic is `convertedSetVolume` over stored rows.

**The history cache landed as plan 045**, not 039: 039–044 were taken by
the time it was written. `sessionsOf` now answers from a cache emptied by
`save()` (by default everything; `'view'` empties nothing; a card's own
`save(here)` empties only what could see that slot). Its answers are frozen,
so a reader must copy before changing one. Measured on the 13,824-row
profile: a warm draw with the PR 6 bands takes 0.6 ms, against 102 ms on
main, and a tick takes 0.26 ms. A cold draw is ~11–12 % slower than main,
which is inside STOP condition 3. PR 6 re-measures on top of it, and moves
`lastTime`/`priorBlock` out of the per-draw cache where they still live.

**PR 6 (the card bands and the record bar)**. Built on plan 045's branch
(`1d0fdac`). The three bands and the record bar read `sessionsOf`. Each
band keeps the ticked sets that have a weight, and the card prints them
from `wLogged`/`rLogged` (`setSummary` now takes a session set).
**Interface addition:** a drop carries `rLogged` next to `wLogged`, for
the same reason PR 5 added it to a set. A band prints a drop's reps back
as typed, so '5,5' or '06' must not become 5.5 or 6.

The queries:
- `lastTime`: `'logged'`, by id, `day`, `[block]`, cut before the week.
  It takes the last session. `'logged'` is exact for any week. The week on
  screen is clamped to the block, so no stranded week comes before it.
- `lastTimeOtherDay`: one id-and-day question per other planned slot
  (`liftSlots`), cut after the week. It does not ask one `like` question,
  because a `like` answer over the active block would be re-read after
  every tick (plan 045's note).
- `priorBlockSets`: `'plan'`, `like`, `skipDeload`, asked one earlier
  block at a time, newest first. The band nearly always stops at the block
  before, and asking every earlier block at once reads the lift's whole
  history to use one block of it.
- `bestForExercise`: `'logged'`, by id, over `blockOrder`. It is split at
  the drawn week: a `before` slice that a tick cannot reach, whose bar is
  kept with `historyDerived`, plus this block and later ones, re-read.
  `bestByExercise` is **deleted**. `drawApp` was its only caller, and each
  card now asks for its own bar. One question for every lift would read
  the whole log on a cold draw. `lastTime` and `priorBlock` left
  `renderCache`, as did `lastTimeCached` and `priorBlockSetsCached`.

Equivalence against `origin/main` (`9cc03ca`, the same js as `1d0fdac`),
in two vm contexts. Random profiles had 1–4 blocks, split days, lifts
matched by name under fresh ids, lb rows and an lb profile, comma
decimals, drops, extra sets, stranded weeks, both deload kinds, a legacy
RIR map, unticked rows and empty weights. Every block × day × lift × week
up to two past the end was compared:
- three seeds (300 + 300 + 100 profiles, the last with `'use strict'` on
  the new tree): 535,172 comparisons, 0 differences;
- 60 profiles × 8 random scoped or broad writes: 490,752 comparisons,
  0 differences.
Seven mutations were each caught: the other-day tie-break, prior
`'plan'`→`'logged'`, the drawn session kept in the bar, a drop's parsed
reps, a bar outliving writes, `lastTime` on `'plan'`, and prior taking the
last day of its week. The unit suite also passes with `'use strict'` on
every shell script.

**Two differences, outside the generator, need a decision.** Both involve
shapes that no import or app path writes today:
1. A log filed under a block id that has no plan any more. A block deleted
   before plans/002 left one behind on real devices (plans/002 kept them,
   calling them "invisible"). The old record bar walked
   `Object.keys(profile.log)` and counted those sets. `sessionsOf` reads
   only planned blocks, so they no longer count. With an orphan at 100 and
   the real history at 60, the bar was 100 and is now 60.
2. A ticked row with no `w` key at all, from hand-edited storage. The old
   bands' `x.w !== ''` let it through as a set with an empty weight, and
   `wLogged` reads it as `''`, so it is now left out.
No slot key other than `slot(w, dayId)` was generated. Such a key cannot
come in through `normalizeImportedLog`.

Cost, with `measure-pr6.js` (derived from `measure-sessions.js`). The
profile was 6 × 12 × 6 × 8 × 4, with the active block logged up to the
week drawn. The figure is the log work of one day's eight cards: the
objetivo, the three bands as `buildExCard` asks for them, and the record
bar. Runs were alternated three times each, `origin/claude/039-history-cache`
against this branch:

| | base | PR 6 |
|---|---|---|
| week 7, cold | 106.3 ms | 96.8 ms (−9 %) |
| week 7, warm | 23.1 ms | 0.83 ms |
| week 7, tick + its card | 0.78 ms | 0.42 ms |
| week 1 (prior band drawn), cold | 96.2 ms | 88.8 ms (−8 %) |
| week 1, warm | 21.1 ms | 0.81 ms |
| week 1, tick + its card | 0.77 ms | 0.31 ms |

The base's warm draw is 23 ms, not plan 045's 0.85, because this
measurement counts `bestByExercise`. It walked every row on every draw,
uncached, and plan 045's figure left it out.

Tests: the render-cache pair on `lastTimeCached` now pins that `lastTime`
reads the same cached sets across draws and reads afresh after a write.
The block-before case calls `logChanged()` after writing the log by hand.
"bestForExercise matches bestByExercise" is deleted, since it compared two
private walks and one is gone. Two new cases cover the split bar. Smoke
run: "main session", "weight drops", "objetivo de peso", "el mismo
ejercicio en dos sesiones", "nota, energía", "primera semana": 329
passed, 0 failed.

**PR 6 (the card bands)**. `lastTime`, `lastTimeOtherDay`,
`priorBlockSets` and `bestForExercise` read `sessionsOf`. `bestByExercise`
is gone: each card asks for its own lift's bar, split at the drawn week so
that a tick re-reads only the current block onward. Answers are asked
narrowly (one day per question, one earlier block at a time) so that a
card's own `save(here)` leaves them cached. `lastTime`/`priorBlock` left
the per-draw render cache. A drop now carries `rLogged` too. `priorWeight`
is not moved: it reads the unticked placeholder rows a session does not
carry. Equivalence: 1,025,924 comparisons against main, 0 differences,
with seven deliberate breaks each caught. Cost: a cold draw is 8–9 %
*faster* than main (the old record bar walked every row, uncached, on
every draw), a warm draw takes 0.83 ms against 23 ms, and a tick 0.42 ms.
**Two old-data differences, accepted by the orchestrator:** the RECORD
badge no longer counts logs left behind by blocks deleted before
plans/002, since nothing in the app can show those sets and the badge now
agrees with the all-blocks chart. A ticked row with no `w` key at all
(hand-edited storage only) is no longer shown in the bands.

**Plan 038 is done** (all seven PRs, 2026-09-22).
