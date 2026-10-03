# Plan 081: The weekly objetivo is double progression, read straight off the log

## Status

- **Priority**: P1 (the household's own complaint: the objetivo "harms more than it helps")
- **Effort**: M
- **Risk**: MED — replaces `targetFor`, which the card, every weight box's placeholder, "Rellenar con el objetivo" and the `obj` record all read
- **Depends on**: none
- **Category**: direction
- **Status**: DONE

## Why this matters

The v3 rule priced every set on its own: a level (an Epley capacity of the
first set, best of three sessions), a between-set decay, a Theil–Sen
trend, a confidence chip, a hold, a three-exercise brake and a ten-day
layoff mode. Replayed through the real `targetFor` over the household's
own backup (one block, five weeks, 62 objetivos), it:

- asked for fewer reps than had just been done at the same weight in 26 %
  of its answers, for a lighter weight in 27 %, for nothing more than the
  last session in 42 %, and split one exercise across several weights in
  34 %;
- was beaten on 76 % of sets — the lifter had to ignore it;
- showed "Vuelta de parón: repite la última sesión" for every objetivo the
  app recorded, and would have on 19 of the next 22 exercises.

Three causes, each in the model rather than the lifter:

1. **An empty RIR box read as failure.** `rhoOf(null)` is 0, then
   `repsAt` subtracts the week's RIR: `60 × 9·8·8·7` in a 3-RIR week asked
   `60×8 · 60×6 · 60×6 · 57,5×7` for the 2-RIR week after, with the
   "pide más RIR" note — the opposite of the plan. Logging the RIR on the
   last set only (the old chip habit) made every earlier set read at that
   value too.
2. **`GAP_DAYS = 10` against a real schedule.** Deload sessions are left
   out of the history, so the first session of every block is fourteen
   days after the last one the rule sees; so is an ordinary fortnight
   between two sessions of the same day.
3. **Epley does not describe these machines.** On the log's 23 load
   increases, Epley at equal effort under-read the reps at the new weight
   by a median of 6 (mean 7,2); 2 of 23 landed within ±2. A step cost the
   first set 1–2 reps whatever its size (+9 % to +56 %).

A week-by-week simulator (`tools/objetivo-sim/`, 480 simulated lifters per
rule on the shipped plan's RIR wave, with the between-set decay measured on
the real chest press) agreed: following the v3 numbers exactly with the RIR
box empty left 66 % of sets five or more reps short of failure, and the load
rose 0,8 % over 24 weeks against 17,8 % of strength.

## Decisions

1. **Double progression, as the plans write it.** One working weight (the
   one most of last session's sets used, the heavier on a tie); each set
   asked for one rep more than its best at that weight, never over the top
   of the range, never under its bottom, never under what it already did;
   every set at the top → the next rung of the ladder.
2. **After a step, the bottom of the range** for every set (the household's
   choice over "two under the old reps"). On the real steps it was met by
   every first set and 97 % of all sets; two under, 70 %.
3. **No model, no clock, no RIR.** `targetFor(profile, block, day, ex, week)`
   reads the log and the plan only. The level, censoring and inheritance
   stay — the Diagnóstico's trend is fitted on them — but nothing in the
   objetivo reads them.
4. **"Every set" is every set that was asked for**: a set `ex.add` brings in
   this week does not hold back a step; a set skipped last time does.
5. **Gone**: the brake (`brakeOn`, `brakeCached`, `#brakeNote`), the
   confidence chip, the `vuelta`, `hold`, `confirmed`, `step`, `floor` and
   `moreRir` notes, `repsAt`, `theilSen` and their constants, and the two
   Diagnóstico rows that read the rule's own answers ("Peso mal elegido",
   "Sube, pero hoy no toca") — the rule no longer lowers or holds anything.
6. **The `obj` record says which rule wrote it**: `v: 4` with `kind` and
   `sets` only. The validator keeps `v` 4 (anything else reads as 3) and
   keeps a v3 record's `conf`, `hold`, `brake` and `rir` as they were, but
   no longer fills a missing `conf` in as "baja".

## Verification

- `node test/unit.js`: the v3 cases replaced by "objetivo: doble
  progresión (plans/081)", plus a v4 round trip through
  `normalizeImportedObj`.
- `node test/smoke.js --only "objetivo de peso" --only "weight drops"
  --only "primera semana de un bloque nuevo" --only "main session"`.
- The household's backup replayed through the new `targetFor`: 0 % fewer
  reps, 0 % repeats, 0 % split weights; the only lighter asks are the
  calibration week's single heavy first sets, now asked at the weight the
  rest were done at.

## Maintenance notes

- The simulator's `actual` rule is whatever `targetFor` is, so after this
  plan it compares the new rule; the v3 numbers above are reproducible from
  the commit before it.
- One smoke case in "objetivo de peso y diagnóstico" depended on the brake
  case before it waiting out the app's debounced save; that wait moved to
  the case that needs it.
