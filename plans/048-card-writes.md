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

(Filled in when the PR lands.)
