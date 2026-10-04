# Plan 082: The objetivo reads each set by its own place, week 1 counts what the old block asked, and "Siguiente" says the box's reps

Picked by the maintainer from the twelfth pass (`plans/README.md`, "Twelfth
pass", shortlist #1: defects D1, D3 and D4) and built directly, without a
separate executor. This file records what was decided and why.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED (the rule's arithmetic; every existing case still passes)
- **Depends on**: none
- **Planned and built at**: `3b7eddb` (v150), 2026-10-04; bumps to v151

## Why this matters

- **D1.** `ruleSession` keeps only the sets that were ticked with reps, and
  `targetFor` read set k as the k-th of those. A set skipped in the middle,
  or ticked with a weight and no reps (the documented tick before a311fa4,
  so older logs are full of them), handed its place to the set after it.
  Last week `50×10 · 50×9 · — · 50×11` came back as `50 × 11 · 10 · 12 ·
  8`; on the default chest press the booted card asked `10 · 10 · 11 · 6`,
  and one tap on set 4 logged 6 after it had done 11. That number then
  became set 4's history.
- **D3.** On week 1 of a new block "every set that was asked for" was this
  block's count. A block that added a set therefore never stepped on its
  first week, where the same history inside one block, with the set from
  `ex.add`, stepped.
- **D4.** The rest timer's "Siguiente" printed the plan's range ("× 6–10")
  over a box that shows, and a tick logs, the objetivo's count ("6"). Its
  own comment promises it "says what the box is about to say".

## What changed

- `readSession` puts each set's row index on it (`i`), and `ruleSession`
  carries it. Additive: nothing else reads it yet.
- `targetFor` reads set k through `setAt(session, k)`, for the per-set best
  and for the step alike. The step now asks, for every k under `asked`,
  that the set logged on row k was at the weight and at the top; a fifth
  ticked row past the plan can no longer stand in for a skipped third.
- `asked` is `min(n, setsAskedOf(profile, last, ex.id, n))` across a block
  boundary: the count the last session's own block, day and week asked.
  Inside the block being trained it is unchanged (`setsFor(ex, last.week,
  block)`).
- `setHints`' `next` line prints the next set's rep placeholder, the box's
  own grey number, and nothing when that is "—".
- `docs/guide.md` § "The rule" gains two bullets: each set is read by its
  own place, and week 1 counts what the old block asked.

## Decisions

1. **The `min(n, …)` stays.** The twelfth pass's correctness sweep also
   called the reverse case wrong: the old block asked 4, one was skipped,
   the new block asks 3, and the step is taken. Kept as it is: plans/081
   decision 4 is about the sets *this* week asks ("a set skipped last time
   does [hold the step back]"), and a set the new block no longer asks
   cannot be a reason to hold back the three it does. A unit case pins it,
   named for that reason.
2. **The Diagnóstico's level is not touched.** `capSeq` still reads
   `s.sets[0]`, the first worked set, which after a skipped first set is
   the second. It is a different question (which set was done fresh) and
   out of this plan's scope.

## Tests

`test/unit.js`, "objetivo: doble progresión (plans/081)": eight cases.

- Four for D1, through the real `targetFor`: a skipped middle set; a set
  ticked with no reps; the skipped set's best read from the session
  before; a fifth row that cannot stand in for a skipped third.
- Three for D3: a new block that adds a set steps; a skipped set in the
  old block still holds the step back; a set the new block drops cannot.
- One for D4, in the `setHints` probe: "× 9" when the objetivo asks 9.
- `targetProbe` passes non-array entries through as stored rows, which is
  how the cases write a skipped set.

Mutation check: run against the `js/app.js` before this plan, seven of the
eight fail. The eighth is decision 1, which the old code already did.

Smoke sections run: "objetivo de peso y diagnóstico", "primera semana de un
bloque nuevo", "Main session" — 271 passed.

## Maintenance notes

- No deviations from the twelfth pass's description of D1, D3 and D4.
- The fix reads positions only for the objetivo. Other readers of
  `ruleSession(...).sets` (the Diagnóstico's level) keep their compacted
  reading; see decision 2.
