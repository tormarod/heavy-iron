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
> `git diff --stat 3cc15c3..HEAD -- js/app.js js/diagnostics.js js/review.js js/chart.js js/volume-sheet.js test/unit.js test/smoke.js docs/guide.md`
> Expect 054's and 056's changes. Re-locate every function below by grep.
> A walk that 054 or 056 already moved is skipped, and the skip recorded.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW. There are two small intended visible fixes (decision 3).
- **Category**: architecture — candidate 6 of the second architecture
  review (2026-09-22), settled with the maintainer the same day.
- **Planned at**: commit `3cc15c3` (main at the time; the functions below
  are unchanged since `8142e33`), 2026-09-22
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

(Filled in when the PR lands.)
