# Plan 048: One way to write a set — `writeRows` — and the card's hint and record decisions as pure functions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Depends on: the unit-stamp fix** (a separate session, "Stop unit stamps
> relabelling weights across a switch"). It changes the drop-weight and
> tick-adoption stamping this plan moves. **Do not start until it has
> merged**, then encode its rule rather than today's.
>
> **Drift check (run first)**:
> `git diff --stat e9e8e7a..HEAD -- js/app.js test/unit.js test/smoke.js`
> Expected: the stamp fix, plan 046 (`RECORD_PARTS`) and plan 047 (the
> render-memo keys). Compare `buildExCard`, `copyPrev`,
> `recordTargetOnStart`, `stampRowUnit` and the claims pin (unit.js
> ~4524–4554) against "Current state" below; an unexpected change is a
> STOP condition.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW–MED. It touches the most-used screen's handlers. There is
  no visible change, and the smoke suite's session, drops, objetivo and
  first-week sections cover every path.
- **Category**: architecture — candidate 4 of the architecture review of
  2026-09-21, narrowed and settled with the maintainer on 2026-09-22.
- **Planned at**: commit `e9e8e7a`, 2026-09-22
- **Glossary**: `CONTEXT.md` — **session start** (new with this plan),
  **set**, **working set**, **extra set**, **objetivo record**.

## Why this matters

Every write to a set follows one protocol:
1. Read `wasSession = rows.some(rowUsed)` **before** mutating.
2. Mutate.
3. Stamp the unit if a weight was written.
4. `save(here)`.
5. `recordTargetOnStart(...)`, which keeps the objetivo on a **session
   start**.

Reading `wasSession` late has shipped twice (plans/021, plans/035). The
protocol is copied into seven handlers in `buildExCard` (at `e9e8e7a`):
- the weight box, ~3850
- the reps box, ~3855
- the RIR box, ~3873
- the tick, ~3885
- the drop weight, ~3965
- the drop reps, ~3970
- plus "Rellenar" (`copyPrev`, ~4336)

The tick and "Rellenar" record **before** their save, which contradicts
`recordTargetOnStart`'s comment (~4772). That's harmless today but untrue.

The unit suite cannot reach any of this. Its inert document builds no
card, so:
- the RIR-box test copies the handler's order by hand (unit.js ~2253,
  ~2197);
- the tick's "adopts the weight, never the RIR" contract lives only in the
  smoke suite (smoke.js ~1860–1870);
- the claims pin counts `save(here)` literally
  (`9 × buildExCard:scoped`), so a scope under any other name would slip
  past it.

The card's remaining decisions also live in closures:
- `rowHint` (~3772), which hint wins: the objetivo, your own last week, or
  the previous block;
- `nextLine` (~3794), the rest timer's "Siguiente";
- `nextAt` (~3765);
- `isPr` / `isPrE` (~3537–3547).

These are the untested combining logic that plan 038 left behind. Their
inputs already come from tested helpers.

## The decisions (settled 2026-09-22 — do not re-open)

1. **A top-level `writeRows(card, mutate)`**, not a closure and not a
   generic `patch`.
   - `card` is a small context the card builds once: `{ profile, block,
     day, ex, rows, here, est }`.
   - `writeRows` reads `wasSession`, runs `mutate()`, calls
     `save(card.here)`, then `recordTargetOnStart`, and returns whether a
     session just started.
   - Redraws, the rest timer, the backup nag and messages stay in each
     handler.
   - `mutate` writes fields literally (`r.w = …`), so the codec's guard
     test still sees every row field.
2. **The tick and "Rellenar" record after their save**, like the rest.
   - The tick goes through `writeRows`.
   - "Rellenar" keeps its loop over exercises and its broad `commit()`,
     but records after it.
   - `recordTargetOnStart`'s comment becomes true.
3. **Only the combining logic leaves the card**, as pure functions:
   - `setHints(...)`: which hint each set gets and where it came from, the
     next set to do, and the "Siguiente" line;
   - `recordFlags(bar, rows)`: the two record flags per set;
   - `tickRow(r, hint, now)`: the tick's weight adoption (never the RIR),
     timestamp and done flip, with the stamp fix's rule.

   **No full `cardModel`**, and `dayCards`/`drawSessionFoot` are left
   alone: the rest is painting, which the smoke suite covers.
4. **The claims pin** counts every scoped `save(...)`, not only the literal
   `save(here)`, and expects the scoped writes inside `writeRows`. A new
   narrow claim must stay a deliberate edit to the test.
5. **The stamp fix lands first**, and this plan encodes its rule.

## Steps

**A. `writeRows`.** Add it next to `recordTargetOnStart`, with the five
steps and why their order matters in its comment. The comments now at the
handlers (the RIR box ~3867–3872, the tick, the drops ~3962) move there.
Build `card` once in `buildExCard`. Point the weight, reps, RIR, drop
weight and drop reps boxes and the tick at it. The RIR box's
`dropLegacyRir` goes inside its `mutate`. Handlers that write without
being able to start a session (drop add, drop delete, drop kind) keep a
plain `save(here)` and a comment saying why.

**B. "Rellenar"** records after its `commit()`. Keep its per-exercise
`wasSession` capture before writing.

**C. `tickRow`, `setHints`, `recordFlags`** as pure top-level functions.
The card calls them. Outputs must be identical, including the "from" text
and the placeholders.

**D. Tests**:
- `writeRows` with fixture rows: a first value starts a session and keeps
  the objetivo record; a second does not; browsing writes nothing; an RIR
  typed first starts it too.
- `tickRow`: it adopts the weight, not the RIR, and stamps per the fix.
- `setHints`: each source of the hint wins in its case, and the
  "Siguiente" line.
- `recordFlags`: each flag, and ties with the bar.

Re-point the hand-copied RIR-box tests (~2197, ~2253) at `writeRows`.
Update and tighten the claims pin (decision 4). The `recordTarget(` count
test stays. Keep the smoke assertions; this plan adds none.

**E. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for "main session", "weight drops",
  "objetivo", "primera semana" and "accesibilidad" (focus kept across a
  tick).
- A throwaway check comparing `setHints` / `recordFlags` / `tickRow`
  against the old closures' outputs, on random rows and hints, recording
  the count. Show that it catches at least two deliberate breaks.

## STOP conditions

- Any existing unit or smoke assertion changes outcome.
- The throwaway check finds any difference.
- A handler's sequence cannot be expressed as `writeRows` plus handler-side
  effects without changing what it saves or records.

## Maintenance notes

**Implemented 2026-09-22** on `claude/048-impl`: written on `5e1f246`
(the unit-stamp fix, #139), then rebased onto `f4d392c` once plans 047
(#140), 046 (#141) and 049 (#142) had merged. There is no "Current state"
section for the drift check to compare against, so `buildExCard`,
`copyPrev`, `recordTargetOnStart`, `stampRowUnit` and the claims pin were
compared with `e9e8e7a`: #139's diff was the only change at first, and
function by function none of the three later merges touches any of them
(nor `stampForWrite`, `weightText`, `priorWeight`, `priorBlockSets`,
`dropLegacyRir` or `rowUsed`; 047 only rewrote the comment after
`priorBlockSets`). 049 is not in the drift check's list, and it changes
nothing this plan compares. The rebase's one conflict was the index row
in `plans/README.md`, resolved by keeping both sides in plan order;
`CONTEXT.md` merged on its own. `CACHE_VERSION` is not bumped here —
`js/app.js` changed, so the PR needs it.

**Choices the plan left open, and one name it could not keep:**
- The context is `cardCtx` inside `buildExCard`, not `card`: `card` is
  already the card's element there, and a second `const card` in one
  scope is the parse failure AGENTS.md warns about. `writeRows` still
  calls its parameter `card`.
- Each `mutate` holds everything the old handler did between reading
  `wasSession` and saving, the box's own echo (`e.target.value = r.w`)
  and `refreshWeights` included, so no handler's sequence moved except
  where decision 2 moves it.
- `writeRows` answers `!wasSession && rows.some(rowUsed)` — whether the
  write started the session — rather than `recordTargetOnStart`'s answer,
  which is false without an objetivo. No handler reads it yet.
- `setHints(rows, est, own, prior, reps)` takes `own` as priorWeight's
  answer per set, computed by the card, so it is a function of its inputs;
  it returns the two placeholders too, so the card no longer needs `tgt`.
- The "Siguiente" lines are worked out at draw time, not at tick time.
  Same answer: everything they read changes only through a redraw (a
  unit switch renders; a card writes only to the week on screen).
- Handlers are block-bodied (`e => { writeRows(…); }`): an `on…` handler
  that returns `false` cancels its event, and `writeRows` returns a
  boolean.
- The claims pin counts every `save(`/`commit(` call handed anything but
  `'view'` or nothing, definitions excluded. `commit`'s own `save(scope)`
  is therefore on the list (`js/app.js:commit:scoped`), with a comment.
  Expected now: `buildExCard:scoped` ×3 (drop add, delete, kind),
  `writeRows:scoped` ×1, `commit:scoped` ×1 — was `buildExCard:scoped` ×9.
- On a tick, `save(here)` now comes before the rest timer and the backup
  nag as well as before the record. The nag's `sessionsSinceBackup++`
  still reaches storage in the same debounced write.
- `test/smoke.js`: one comment, which said the tick's contract could only
  be tested in a browser. No assertion changed.

**Verification** — on `f4d392c` plus this branch, unless it says
otherwise. The equivalence and mutation counts are identical before and
after the rebase.
- `node test/unit.js`: 877 on `f4d392c` → 898. 20 are Step D's cases, and
  one is the docs check on the new `plans/README.md` row; every one of the
  877 passes under the same name. (On `5e1f246`: 851 → 871, likewise.)
- `node test/smoke.js --only` "main session", "weight drops", "objetivo",
  "primera semana", "accesibilidad" (six sections): 310 passed, 0 failed —
  the same 310 assertions, in the same order, as `f4d392c` served the same
  way. The full suite ran once, because `test/smoke.js` changed, before the
  rebase: 583 passed, 0 failed. It was not run again after the rebase.
- Equivalence, Step E (scratchpad, not committed): two vm contexts built
  like `loadApp`, one from `git show f4d392c:…`, one from the tree.
  The old closures (`isPr`, `isPrE`, `nextAt`, `rowHint`, `nextLine`, the
  placeholder lines, the tick's adoption lines) sliced verbatim out of
  main's `buildExCard`; the new side the lines the new card calls
  `recordFlags`/`setHints` with, and `tickRow`. 170 000 random fixtures
  (592 922 sets, 1 778 766 tick-and-untick pairs; units, drops, ties with
  the bar, short objetivos, a prior block in the other unit): 0
  differences. Breaks, each caught on one seed's 20 000 fixtures: `>=` on
  the weight bar (4 810 differences), `>=` on the 1RM bar (872), the
  prior-block hint as typed (4 259), `stampRowUnit` in `tickRow` — the
  rule before #139 (1 948), the "Siguiente" text (9 846), `nextAt` without
  an objetivo (7 609), your own week over the objetivo (17 226). A mutant
  that only computes `prv` when it is never read reported 0, as it should.
- Beyond Step E: whole cards built by the old and new `buildExCard`
  against a recording fake DOM and compared property by property; then
  random events at both — every box, the tick, drop add, delete and kind
  — comparing the slot's rows, `obj`, the legacy `rir` map, the backup
  counter, the boxes' values and every effect (save scopes as a set, the
  rest in order), the redrawn card, and "Rellenar": 6 000 fixtures, 62 318
  cards, 42 816 events, 18 320 redraws, 6 000 "Rellenar" runs, 0
  differences, and no write on the new side records before its save.
  Breaks, each caught on 600 fixtures: `wasSession` read after the write
  (1 187), the record before the save (198 order violations; the state is
  the same), the wrong "Siguiente" index (614), the RIR box without
  `dropLegacyRir` (51), "Rellenar" not recording (473), a drop box saving
  twice (116).
- Unit mutations of `js/app.js`, each caught, with how many cases fail:
  record before save (2), `wasSession` late (3), the old stamp (1), a tick
  taking the RIR (2), the two ties (3, 1), own week over the objetivo (1),
  the prior hint as typed (2), `nextAt` always (1), and a new narrow claim
  under another name (the pin, 1) — which the old `save(here)` match would
  have missed.

**For whoever adds a box.** A new write into a set goes through
`writeRows`; one that cannot start a session saves its slot directly and
says why beside it, as drop add, delete and kind do. Either way the
claims pin fails until the list in `test/unit.js` is updated.
