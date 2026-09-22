# Plan 057: What was ticked in a block, read one way — the last five raw walks onto `sessionsOf`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Starts after plans 054 and 056 have merged.** 054 changes
> `volumeWeeksInPlay` and the deload reading, and 056 rewrites
> `js/diagnostics.js`'s rows, next to `trainedDays`.
>
> **Drift check (run first)**:
> `git diff --stat 8142e33..HEAD -- js/app.js js/diagnostics.js js/review.js js/chart.js js/volume-sheet.js test/unit.js test/smoke.js docs/guide.md`
> Expect 054's and 056's changes. Re-locate every function below by grep.
> A walk that 054 or 056 already moved is skipped, and the skip recorded.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW. There are two small intended visible fixes (decision 3).
- **Category**: architecture — candidate 6 of the second architecture
  review (2026-09-22), settled with the maintainer the same day.
- **Planned at**: commit `8142e33`, 2026-09-22
- **Glossary**: `CONTEXT.md` — **stranded week**, **session**, **working
  set**, **extra set**.

## Why this matters

Plan 038 moved every reader of a lift's sessions onto `sessionsOf`. Five
walks of "what was ticked in this block" still read raw rows:

| Walk | Where, at `8142e33` |
|---|---|
| `blockTonnageByWeek` | js/app.js ~5932 |
| `volumeTotals('log', …)` | js/app.js ~5890 |
| the block review's energy comparison | js/review.js ~53 (`forEachSlot`) and ~102 |
| `trainedDays`, the heatmap next to Frecuencia | js/diagnostics.js ~256 |
| `landingNote` | js/app.js ~6218 |

They count ticked sets with the same rule, and only the walk differs. Two
of them break the stranded-week rule (CONTEXT.md: screens about a block
hide stranded weeks):
- the review's energy comparison;
- the heatmap, which sits next to `freqRows`, which reads `'plan'`.

Two parameters exist only for tests:
- `blockTonnageByWeek`'s optional raw-`setVolume` mode, which only
  test/unit.js uses;
- `collectHistory`'s `weeks` cap (js/chart.js ~68), which only test
  callers set to something other than the block's length.

Plan 038 PR 7 left the energy walk raw because its volume sums stored rows
through `convertedSetVolume`. That reason is gone: sessions carry
converted weights and drops, and plan 038 PR 4 proved that a volume summed
from session sets equals `convertedSetVolume` term for term.

## The decisions (settled 2026-09-22 — do not re-open)

1. **Full scope.** One `sessionVolume(sets)` helper, beside `readSession`
   in js/app.js (split rule 2), sums a session's volume with drops, equal
   term for term to `convertedSetVolume` over the same rows. All five walks
   read `sessionsOf`. **`weekHasLog` stays raw**, because it runs after
   every tick and a whole-block question would be re-read each time.
2. **`weeks: 'plan'`** for all five: they are screens about the block.
3. **Intended visible fixes:** the review's energy comparison and the
   heatmap stop counting stranded weeks. Each gets a unit test. Nothing
   else visible changes.
4. **The test-only parameters go**, and their tests ask what the app asks:
   - `blockTonnageByWeek`'s raw mode;
   - `collectHistory`'s `weeks` cap. Its app callers pass the block's
     length; check every caller.

## Steps

**A. `sessionVolume(sets)`**, with a unit test comparing it against
`convertedSetVolume` over random rows (with drops, lb rows, empty and NaN
values) for equality.

**B.** Move the five walks (decision 1), one commit each. Include a test
wherever a walk had none.

**C.** Remove the two parameters and adapt their tests (decision 4).

**D. Equivalence (mandatory, throwaway).** In two vm contexts (the way
`test/unit.js`'s `loadApp` builds one), compare each moved function's
output, `origin/main` against the branch, over random profiles. **On
blocks with no stranded weeks, outputs must be identical.** Differences
are allowed only where decision 3 says. Record the counts and show at
least two deliberate breaks are caught.

**E. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for the volume, Frecuencia, review and
  landing sections (`--list`).
- The guide: if it describes the heatmap's or the energy comparison's
  weeks, keep it true.

## STOP conditions

- A block with no stranded weeks produces any different output.
- Removing a parameter changes an app caller's result.

## Maintenance notes

DONE, in the form the plan describes — no walk had already been moved by
054 or 056 (the drift check's diff was their deload-span/RIR-per-day and
Diagnóstico-rows-in-app.js changes, none of it touching these five), so
all five moved and both parameters went.

`sessionVolume(sets)` sits beside `readSession`; its unit test builds
random sessions through `readSession` itself (not hand-built `sets`
arrays) so the comparison exercises the real integration, not a second
copy of the arithmetic — 200 trials, 1-4 rows each, drops/lb/empty/NaN,
max diff under 1e-6.

Step B's five commits: `blockTonnageByWeek` (with decision 4's raw-mode
removal, since a function that always converts and a function you can
still ask to convert are one edit, not two); `volumeTotals('log', …)`,
one sessionsOf query per exercise `dayList`/`exList` still shows, unlike
`blockTonnageByWeek` which asks unfiltered (a retired exercise's sets
count for tonnage, not for this week's adherence); the block review's
`doneSets` and energy comparison together, since both are raw walks
inside `buildBlockReview` and the table's own "Where" column names both
locations under the one row — `doneSets` was already correctly bounded
by hand, so only the energy walk's output changes (decision 3's first
visible fix); `trainedDays`, which had no bound at all, not even the one
`doneSets` had (decision 3's second fix); `landingNote`, scoped like
`volumeTotals`. `collectHistory`'s cap came out in its own commit, since
it was already on sessionsOf and only lost a parameter. Every walk with
no prior test (`volumeTotals`, `trainedDays`, `landingNote`) got one; the
two decision-3 fixes got a unit test each, extending the plans/050
stranded-week fixture for the review's case rather than a new one.

**Step D equivalence.** Two vm contexts (origin/main and the branch),
300 random profiles (100 with a stranded week, 200 without), comparing
`blockTonnageByWeek`, `volumeTotals('log', …)` over every in-range week,
`buildBlockReview`, `trainedDays` and `landingNote`. Compared with a
relative-epsilon deep-equal, not JSON string equality — summing the same
kilos through `sessionVolume`'s reduce instead of a raw-row reduce is not
associative at double precision, and the first run's "differences" were
all noise in the 13th significant digit before that fix.

Counts: `blockTonnageByWeek`, `volumeTotals`, `landingNote` and
`buildBlockReview` minus its `.energy` field — identical on all 300
trials, stranded or not. `.energy` — identical on 243, differs on the
other 57, every one of them a stranded trial. `trainedDays` — identical
on 200, differs on all 100 stranded ones. Zero differences fell outside
what decision 3 allows, and zero appeared on a plain block. `weeks`
in `volumeTotals`'s probe was bounded to the block's own length, not the
stranded fixture's longer `maxLogWeek` — the same reasoning collectHistory's
own removed parameter rests on: `profile.week` is clamped to
`blockWeeks(block)` by `drawApp` before any sheet can read it, so a week
beyond that is not a question the app ever asks this function, and
probing it anyway produced a difference that told me nothing about a
real caller.

Two deliberate breaks, patched into a third context built from the
working tree, to show the harness would have caught a real regression
and "zero unexpected differences" is not a vacuous result: reverting
`blockTonnageByWeek` to `weeks: 'logged'` (folding a stranded week into
week 1 instead of dropping it) was flagged on 18/60 mutant trials;
flipping `sessionVolume`'s drop sign (`- drops` instead of `+ drops`) was
flagged on 57/60, starting at trial 0 on a plain block. Both caught.

**Two smoke fixtures needed more than the signature change.** Both
`blockTonnageByWeek` unit-style cases construct a bare `{ log: {...} }`
profile with no `.blocks` — harmless for the old raw walk, but
`sessionsOf` resolves the block from `profile.blocks[id]` regardless of
what the caller already has in hand, so both needed `blocks: { tb: block
}` added. The same two cases run inside "main session," which picks lb
at first-run setup and never switches back — `blockTonnageByWeek` always
converts now (the raw mode these two never asked for is exactly what
went), so their kg fixture read back at 220.46/440.92 lb instead of the
100/200 the assertions name; pinned `state.prefs.units = 'kg'` for the
call and restored it after, since the point of both is the week bound
and the retired exercise, not the unit. Separately, "once an earlier
week carries kilos the strip splits into block and week" writes straight
into `profile.log` the way most of this file's fixtures do — harmless
against the old raw walk, but this profile had already been asked its
history earlier in the same session, so the write left `blockTonnageByWeek`
reading sessionsOf's cache stale without `logChanged()`.

**Verification.** `node test/unit.js`: 1140 passed (was 1136 before this
plan's four new tests plus one adapted). `node test/smoke.js` (full —
`test/smoke.js` itself changed): 584 passed, 0 failed, on a static server
at :8805. Both STOP conditions checked and clear: no non-stranded trial
differed, and both removed parameters left their one real caller's
result unchanged.

No deviations from decisions 1-4.

See PR (number filled in by the orchestrator once opened).
