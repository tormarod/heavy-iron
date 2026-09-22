# Plan 056: One history per Diagnóstico row — the row reads exactly the sessions the objetivo reads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8142e33..HEAD -- js/diagnostics.js js/review.js js/app.js test/unit.js test/smoke.js docs/guide.md`
> Plan 054 (deload spans; it touches `deloadCheck`, which review.js
> reads) and plan 055 (exercise fields) may land first. Rebase over them.
> Re-locate `diagPoints`, `diagRows`, `diagLevelTrend`, `exHistory` and
> review.js's Diagnóstico use by grep.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED. It's a visible change on a screen that the block review's
  AI document copies verbatim.
- **Category**: architecture and correctness — candidate 3 of the second
  architecture review (2026-09-22), settled with the maintainer the same
  day.
- **Planned at**: commit `8142e33`, 2026-09-22
- **Glossary**: `CONTEXT.md` — **stranded week** (the Diagnóstico is now
  listed with the screens that count them), **session**, **lift**,
  **variant**.

## Why this matters

The guide promises that the Diagnóstico's trend reads *"the same `level`
[the weekly objetivo] is built on"*, and ends that section with *"Two
screens that disagree in public are two screens nobody trusts"*
(docs/guide.md ~915–921, ~1127+). The trend keeps that promise:
`diagLevelTrend` (js/diagnostics.js ~494) reads `exHistory`, the
objetivo's own history. `exHistory`:
- asks for `'logged'` weeks;
- uses only the lift's own day when the block plans it on two days;
- starts at the last rename;
- reads the blocks up to the current one.

**The rest of the row doesn't keep it.** `diagRows` (~648) builds the "N
sesiones" count, the minimum-sessions gate, the time gap, the
easy/failure/decay signals and the work axis from `diagPoints` (~85). That
function reads `'plan'` weeks and every block in `blockOrder`, merges both
days of a split lift, ignores the rename cutoff, and re-reads raw rows
(`last.rows` for `forcedDrop`, `repDecay` and the first set's own RIR,
~684–691). The second review verified the consequences:

- A lift split across two days, climbing on day 1 and falling on day 2
  every week, is judged "Funciona" with "6 sesiones". The trend was fitted
  on 4 day-1 sessions.
- A renamed lift shows "6 sesiones" over a 3-session trend.
- Both go verbatim into the AI review document (review.js ~131–159,
  ~224–237).
- `diagPoints`' raw re-read indexes the live log with a cached session's
  coordinates. That line crashed the smoke suite in plan 045.

## The decisions (settled 2026-09-22 — do not re-open)

1. **Every part of a row reads the objetivo's sessions**: the count, the
   minimum-sessions gate, the time gap, the three signals, the work axis
   and the trend. That means `exHistory`'s choice in both scopes, with
   `scopeBlockId` for "Este bloque" as `diagLevelTrend` already passes it.
   `diagPoints` either becomes a projection of those sessions or is
   deleted; choose whichever leaves fewer names.
2. **No raw re-read.** A forced drop, the rep-decay line and the first
   set's own RIR come from the session's sets (`dropKind`/`drops`, `r`,
   `rirOwn`). Plan 038's sessions carry all three.
3. **Split lifts get two rows**, one per day the block plans them on, each
   tagged with its day (`dayTag`), e.g. "Press banca · Empuje". Each has its
   own count, signals and trend (the objetivo's day-specific history). The
   block review's AI document lists both rows.
4. **Stranded weeks count**, as they do for the objetivo. CONTEXT.md now
   lists the Diagnóstico with the screens about the lifter over time.
5. **Visible changes, each with a unit test:**
   - a split lift gets two rows (the review's split-lift case, verbatim:
     climbing on one day and falling on the other must no longer read
     "Funciona" with a count the trend doesn't cover);
   - a renamed lift's count restarts at the rename (the review's
     renamed-lift case);
   - stranded weeks count;
   - the AI document follows the rows.

   The guide's Diagnóstico section gains a short paragraph: the row reads
   exactly the sessions the objetivo reads, with these three consequences.

## Steps

**A. Tests first:** the split-lift and renamed-lift cases (decision 5), a
stranded-week case, and a check that the count, signals and trend of every
row come from the same sessions. Record them failing.

**B. `diagRows`** reads one list of sessions per row (decision 1), with
split lifts expanded into one row per planned day (decision 3). The
signals read the sessions' sets (decision 2). `diagSessionRir`,
`forcedDrop`, `repDecay`/`decayRows` and `rowRir`'s callers here take what
the sets carry. Adapt their calls rather than their meaning. If one of
them only works on raw rows, add a sets-shaped twin next to it, and say
why.

**C. The block review** (review.js) follows the rows: labels, the AI
document text and any count it quotes. Keep the text's shape identical for
lifts that are neither split nor renamed.

**D. The guide paragraph** (decision 5).

**E. Equivalence (mandatory, throwaway).** In two vm contexts (the way
`test/unit.js`'s `loadApp` builds one), compare `diagRows` (both scopes)
and `buildBlockReview` plus the AI prompt text, `origin/main` against the
branch, over random profiles. **On lifts that are neither split across
days, nor renamed, nor with stranded weeks, outputs must be identical.**
Differences are allowed only in rows of those three kinds. Record the
counts and show at least three deliberate breaks are caught.

**F. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for the Diagnóstico, Fuerza, Frecuencia and
  Revisión sections (`--list`).

## STOP conditions

- The equivalence check finds a difference on a lift that is neither split,
  renamed nor stranded.
- A signal can't be computed from the session's sets without changing its
  meaning. Report which one and why.

## Maintenance notes

**STOP condition 1 is met by its wording, for the orchestrator to decide.**
Beyond split, renamed and stranded lifts, rows of two more kinds change.
Both follow from decision 1, and no implementation of that decision can
avoid them, because in each case the old count read sessions its trend did
not:

- **(a) A session whose working sets all ran past `EST_MAX_REPS`.** The old
  count dropped it, but the trend (the level) never did. The shipped plans
  have 15–20 and 12–20 lifts, so this happens on real logs. A lift trained
  at 16–20 reps went from "Aún no hay suficientes sesiones" to a verdict.
- **(b) "Todos los bloques" on a block that is not the last in
  `blockOrder`.** The old count read every block in the list, while the
  trend stops at the block on screen. `exHistory`'s "blocks up to the
  current one" is listed under "Why this matters", but Step E's three kinds
  leave it out.

Two unit tests pin both, and the guide names them. With only those two
readings changed to the objetivo's in the old code, Step E holds exactly
as written (below).

**Rebased twice.** Once over #152 (plan 052 PR 1, tests only) at the
start. Then over #153 after Steps A–D were written: #153 moved the
Diagnóstico's rows into `js/app.js`, so Steps B–D were re-applied to the
moved code. The names below are after #153.

**The interface.** `liftHistory(profile, block, ex, dayId, beforeWeek,
onlyBlockId)` is `exHistory`'s old body. It returns `{ sessions, rule }`,
one for one: the `sessionsOf` sessions the objetivo reads, and
`ruleSession`'s projection of each. The variant cut-off is still read off
the rule's date. `exHistory` is its `.rule`, memoized under the same key.
`diagRows` asks `liftHistory` once per row, with `MAX_WEEKS + 1` and the
scope's block id, as `diagLevelTrend` used to:
- `diagPoints(sessions)` is now a projection. It carries `vol`, `sets`,
  `ts` (the latest tick), `rirs` and `ticked` (every ticked set). The
  e1RM, weight, reps and label fields are gone; nothing on the row read
  them.
- `diagLevelTrend(rule)` takes the rule half.

A lift live on two live days is a row per day. The row carries `dayId` and
`label` (`Press banca · Empuje`, from `dayTag`; a lift on one live day
keeps its name). `drawDiag` shows `r.label || r.name`, because a precache
hole can pair it with a v115 `app.js`, and it sets `data-day`.

**The signals, read off the session's sets.** No signal changed meaning, so
STOP condition 2 was not met.
- The typical RIR for `easy` and `failure` is the working sets' `rir`, as
  before.
- `forcedDrop(sets)` checks a set with `dropKind === 'forced'` and a drop
  with something in it.
- `repDecay` and `decayRows` take the session's sets as they are. A set's
  `r` is `num()` of the row's, and `num()` returns a number unchanged, so
  the same sets pass. The first set's own reserve is `rirOwn`.
- The gap is the latest tick. The work axis is the working sets plus
  their drops.

**Deviation: `forcedDrop` changed in place, with no twin.** A twin was
written before #153, keeping the stored-rows version for a pre-056
`js/diagnostics.js`. After #153 its one caller, `diagRows`, lives in
`app.js`, and a twin would have left the stored-rows version with no
caller at all.

**The review.** It follows the rows. A split lift is two lines of the AI
document, each already named with its day. Each line's RIR tally counts
that row's day (`sessionsOf` with `day: x.dayId`) rather than every live
day. For a lift on one live day that is the same day.

**Equivalence (Step E, throwaway).** Two vm contexts built like `loadApp()`,
`origin/main` (`90140b3`) against the branch. Two seeds × 400 random
profiles. The profiles had:
- 1–3 blocks, with the block on screen anywhere in the list;
- split lifts, retired days and exercises, renames that cut and renames
  that do not, stranded weeks, both kinds of deload;
- 15–20 ranges, comma decimals, lb rows, drops of both kinds, extra sets,
  late and missing ticks, the legacy RIR map, unticked rows.

The kinds were read off the stored rows, not the new code. Compared:
`diagRows` in both scopes, `buildBlockReview`, `reviewText`, the AI
prompt's head, and every `exHistory` and `targetFor` for every block, day,
exercise and week (up to two weeks past the end).
- Against `origin/main` as it is:
  - Rows of no kind: 4,525 (2,828 "Este bloque", 1,697 "Todos"), all
    identical, including labels and order.
  - The review minus its exercises: 800 identical.
  - Review entries of ordinary rows: 2,828 identical.
  - The review text: 27,384 lines identical, with the lines of kinded rows
    left out.
  - The AI prompt's head: 800 identical.
  - `exHistory` and `targetFor`: 173,858 identical.
  - Kinded rows that differ: split 1,360 of 1,412, renamed 679 of 936,
    stranded 1,043 of 1,193, (a) 1,418 of 1,487, (b) 1,488 of 1,535
    (a row can be of several kinds).
  - Rows of (a) or (b) alone that differ: (a) on "Este bloque" 424 of 442;
    on "Todos", (a) 289 of 313, (b) 852 of 886, both 140 of 144.
- Against `origin/main` with (a) and (b) aligned (`diagPoints` keeping
  every working session and stopping at the block on screen): 6,310 rows
  neither split, renamed nor stranded, with 0 differences. Also 0 across
  3,270 review entries, 27,826 text lines, the AI heads and 173,858
  `exHistory`/`targetFor` comparisons. Differences appear only on split
  (1,355), renamed (641) and stranded (998) rows.
- Seven deliberate breaks, each caught:
  - a window of five: 136 rows;
  - decay reading the inherited `rir` for the first set: 4 rows;
  - the gap from the session date: 442 rows;
  - a planned drop read as forced: 9 rows;
  - the review tally reading `rir`: 132 lines;
  - a day tag on every row: 905 labels;
  - the own-day filter reaching earlier blocks: 2,076 `exHistory`/`targetFor`.

**Tests.** Step A added 14 assertions, all failing before Step B. The unit
and smoke tests of `diagPoints`' and `diagLevelTrend`'s old arguments now
ask `liftHistory` for the row's history: four unit tests and three smoke
call sites. #153's three new tests in this area pass unchanged.

**Verification.** `node --check` on every `js/` file. `node test/unit.js`:
1094 passed, 0 failed. `node test/smoke.js --only` on "objetivo de peso y
diagnóstico", "frecuencia por músculo", "índice de fuerza por músculo",
"nota, energía y control de descarga" and "revisión del bloque": 104
passed, 0 failed. `test/smoke.js` was edited, so one full run: 584 passed,
0 failed.

**Left for the PR.** No `CACHE_VERSION` bump: `js/app.js`,
`js/diagnostics.js` and `js/review.js` changed, so it needs
`tools/bump-cache-version.sh`. No `plans/README.md` status.

**Out of scope, noticed.** The guide's work-axis section and
`js/diagnostics.js`'s header still say the trend is fitted through each
session's best set. That was true of the e1RM line the level replaced.
