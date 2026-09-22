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

(Filled in when the PR lands.)
