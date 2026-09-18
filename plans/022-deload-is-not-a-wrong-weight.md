# Plan 022: The Diagnóstico and the block review stop reading a deload target as a mis-chosen weight

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- js/diagnostics.js test/unit.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

The Diagnóstico sheet gives every exercise a verdict ("lectura") and a
suggested change ("cambio"). One of its signals, `estDown`, means "the
objetivo rule wants this exercise lighter than what is being loaded", and a
flat-trending exercise with that signal is told **"Peso mal elegido — el
objetivo de esta semana está por debajo de lo que estás cargando / Baja al
objetivo que marca la ficha"**.

`estDown` is computed as `est.dir === 'down'`. On a deload week the rule
returns a `descarga` target, which always has `dir === 'down'` because a
deload lowers the load by design. So on the deload week of every block,
every flat-trending exercise is told its weight was picked wrong and to
drop to the deload load — the opposite of what the week means. The block
review (`js/review.js`) builds its per-exercise lines from the same rows,
so the same wrong verdict is exported into the text the user pastes into
an AI to write the next block. Meanwhile the session card, right next to
the sheet, says "descarga".

After this plan, `estDown` is true only for an ordinary `objetivo` target,
and a unit assertion pins it.

## Current state

Files:

- `js/diagnostics.js` — the Diagnóstico screen. `diagRows` (starts near
  line 645) builds one row per exercise; the signal object `sig` is at
  lines 666–684; `diagVerdict` (line 542) maps `(trend, sig)` to the
  verdict text.
- `js/review.js:122` — `diagRows(profile, block, 'block')` feeds the block
  review; nothing to change there, it inherits the fix.
- `js/app.js:3834-3838` — the `descarga` branch of `targetFor` sets
  `t.kind = 'descarga'; t.dir = 'down';`. Out of scope; quoted so the
  executor sees why the fix belongs in the reader.
- `test/unit.js:799-810` — the existing `diagVerdict` assertions.
- `sw.js` — `CACHE_VERSION` at line 21 (`'v68'` at `4f7e037`).

The signal — `js/diagnostics.js:666-684`:

```js
      const est = targetNow(profile, block, day, ex, profile.week);
      const last = points[points.length - 1];
      const recent = points.slice(-3);
      const sig = {
        easy: recent.filter(p => p.rir === '2+').length >= 2,
        failure: !!last && (last.rir === '0' || forcedDrop(last.rows)),
        decay: !!last && repDecay(last.rows) >= 3,
        /* A stall reset is also `down`, but it is not "the weight was
           picked wrong" — it is the target rule's own answer to the
           stall this screen is about to name, so it reads as the stall,
           not as a mis-chosen weight. */
        estDown: !!est && est.dir === 'down',
        /* Not a fourth reading of the log: the target rule has already
           crossed the level with this week's sessions and come back with
           "hold today" or with the whole day braked. Reading its answer
           rather than re-deriving it is what keeps the two screens saying
           the same thing. */
        held: est && est.brake ? 'brake' : est && est.hold ? 'hold' : null,
        heldRir: est ? est.rirWeek : null,
        conf: est ? est.conf : null,
        gap: diagMedianGap(points),
      };
```

The verdict that consumes it — `js/diagnostics.js:551-555`:

```js
  if (trend === 'flat') {
    if (sig.estDown) {
      return { lectura: 'Peso mal elegido — el objetivo de esta semana está por debajo de lo que estás cargando',
               cambio: 'Baja al objetivo que marca la ficha y sube el rango de reps como es debido.' };
    }
```

The rule's own classification of what it returned — `js/app.js:3813`
(`kind: 'objetivo'` in the initial `t`), `js/app.js:3836-3837`
(`t.kind = 'descarga'; t.dir = 'down';`), `js/app.js:3850` (`t.kind =
'vuelta'`, `dir` stays `''`).

Existing assertions to extend — `test/unit.js:799-810`:

```js
console.log('\n== diagVerdict ==');
ok('a downward trend with a long gap reads as an attendance problem',
   call('diagVerdict("down", { gap: 30 }).lectura').indexOf('Asistencia') === 0);
ok('a downward trend with no gap reads as a real strength loss',
   call('diagVerdict("down", { gap: 1 }).lectura') === 'Pierde fuerza de verdad');
ok('a flat trend with no signals falls through to the generic stall',
   call('diagVerdict("flat", {}).lectura') === 'Estancado, sin una señal clara en el registro');
```

`diagVerdict` is pure and takes the signal object directly, so the fix is
testable at two levels: the verdict (unchanged input contract) and the
signal builder (through `diagRows`, which the 016 test at
`test/unit.js:2380-2435` already drives with a seeded profile).

Conventions (from `AGENTS.md`): Spanish user-visible text, English
why-comments; `js/diagnostics.js` is a split file whose wiring lives in
`wireDiagnostics()` — nothing here touches wiring. `CACHE_VERSION` must be
bumped because a `js/` file changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/diagnostics.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| Bump the cache | `bash tools/bump-cache-version.sh` | `sw.js` moves to the next version |

## Scope

**In scope**:
- `js/diagnostics.js` (one expression and its comment)
- `test/unit.js`
- `sw.js` (bump only)

**Out of scope**:
- `js/app.js` — `targetFor` is right to say `dir: 'down'` on a deload; the
  session card uses `dir` for the arrow glyph. Do not change the rule.
- `js/review.js` — inherits the fix through `diagRows`.
- The wording of any verdict.

## Git workflow

- Branch: `claude/022-deload-is-not-a-wrong-weight-<6 hex chars>`.
- One commit, subject like `Stop reading a deload target as a mis-chosen weight in the Diagnóstico`, with the trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Gate the signal on the kind of target

In `js/diagnostics.js:677` change

```js
        estDown: !!est && est.dir === 'down',
```

to

```js
        estDown: !!est && est.kind === 'objetivo' && est.dir === 'down',
```

and extend the comment above it with one more sentence, e.g.: *"A deload is
`down` too, and it is neither: the rule lowered the load because the week
asked it to, and reading that as a mis-chosen weight told every flat
exercise to drop to its deload load for good."*

**Verify**: `node --check js/diagnostics.js` → exit 0. `node test/unit.js`
→ `0 failed`.

### Step 2: Pin it at the signal-builder level

In `test/unit.js`, after the `diagVerdict` block (after line 810), add a
probe that drives `diagRows` on a seeded profile. Model the seeding on the
016 test at `test/unit.js:2380-2400` (four sessions of one exercise, `pr.week
= 5`, `resetRenderCache()`), but make the history flat and make week 5 the
deload:

```js
/* On a deload week the rule returns a `descarga` target, which is `down` by
   design; the Diagnóstico must not read that as "the weight was picked
   wrong". Four identical sessions make the trend flat, which is the branch
   that consults estDown. */
const deloadVerdict = call(`
  (function () {
    state = defaultState(); migrate(); state.setupDone = true;
    const pr = state.profiles.hombre;
    const blockId = pr.blockOrder[0];
    const block = pr.blocks[blockId];
    const day = block.days[0];
    const exId = day.ex[0].id;
    pr.log[blockId] = {};
    for (let w = 1; w <= 4; w++) {
      pr.log[blockId][slot(w, day.id)] = { [exId]: [
        { w: '60', r: '10', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
        { w: '60', r: '10', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
        { w: '60', r: '10', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 },
      ] };
    }
    block.weeks = 8; block.deload = 5;
    pr.week = 5;
    resetRenderCache();
    const rows = diagRows(pr, block, 'block');
    const row = rows.find(x => x.id === exId) || rows[0];
    const est = targetNow(pr, block, day, day.ex[0], 5);
    return { kind: est && est.kind, dir: est && est.dir, lectura: row && row.lectura };
  })()
`);
ok('on the deload week the rule returns a descarga target that is down',
   deloadVerdict.kind === 'descarga' && deloadVerdict.dir === 'down', JSON.stringify(deloadVerdict));
ok('and the Diagnóstico does not read it as a mis-chosen weight',
   deloadVerdict.lectura && deloadVerdict.lectura.indexOf('Peso mal elegido') < 0, JSON.stringify(deloadVerdict));
```

Check what `diagRows` returns for the exercise id field before writing
`rows.find(x => x.id === exId)` — `grep -n "out.push({" js/diagnostics.js`
near line 700 shows the row shape; use whichever key holds the exercise id
(it may be `exId` or `ex`). If the row has none, match on the name
(`day.ex[0].n`).

Then one positive case so the signal is not simply dead: an ordinary
`objetivo` that comes down must still say "Peso mal elegido". Reuse the
same shape with `block.deload = 0`, `pr.week = 3`, and two sessions of
`100 × 4 / 3 / 3` and `100 × 4 / 3 / 2` on an exercise whose `reps` is
`'10–15'` (set `day.ex[0].reps = '10–15'`) — that history makes the rule
walk down (`dir === 'down'`, `kind === 'objetivo'`) — and assert the
lectura *does* start with `'Peso mal elegido'`. If the trend for two
sessions is `'none'` rather than `'flat'` (too few points), use four
sessions of the same shape so `diagRows` reaches the flat branch.

**Verify**: `node test/unit.js` → `0 failed`, at least 3 assertions more
than before; run it once with Step 1 reverted (`git stash` the
`js/diagnostics.js` change) and confirm the second new assertion FAILS,
then restore.

### Step 3: Bump the cache version

`bash tools/bump-cache-version.sh`.

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → higher than v68.

## Test plan

- New unit assertions (Step 2): deload week → `descarga`/`down` and no
  "Peso mal elegido"; ordinary down `objetivo` → still "Peso mal elegido".
- Existing: the five `diagVerdict` assertions at 799–810; the 016
  round-trip test (2359–2435) which drives `diagRows`.
- Pattern: the 016 seeding block at `test/unit.js:2380-2400`.

## Done criteria

- [ ] `node --check js/diagnostics.js` exits 0
- [ ] `grep -n "est.kind === 'objetivo' && est.dir === 'down'" js/diagnostics.js` prints one line
- [ ] `node test/unit.js` exits 0 with `0 failed`, and the deload assertion fails when Step 1 is reverted
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a version above v68
- [ ] `git status --short` lists only `js/diagnostics.js`, `test/unit.js`, `sw.js`
- [ ] `plans/README.md` status row for 022 updated

## STOP conditions

- `js/diagnostics.js:677` is not `estDown: !!est && est.dir === 'down'`.
- `targetFor`'s `descarga` branch no longer sets `kind: 'descarga'` (grep
  `t.kind = 'descarga'` in `js/app.js` — if absent, the premise changed).
- `diagRows` cannot be driven from the unit harness the way the 016 test
  does it (that test is at `test/unit.js:2380-2435`; if it has moved or is
  gone, stop).
- The positive case cannot be made to produce `trend === 'flat'` with a
  down `objetivo` after two honest attempts — report the shapes tried.

## Maintenance notes

- Any new `kind` the rule learns to return (`targetFor` at `js/app.js:3804`)
  must be considered here: `estDown` now means "an ordinary objetivo that
  comes down", and a new kind that is also "down" should be excluded the
  same way `descarga` is.
- `held` (two lines below) reads `est.brake`/`est.hold` and is correct for
  every kind; `vuelta` has `dir === ''` and is safe by accident — the
  `kind` guard now makes it safe by design.
- Reviewer: confirm the review export (`reviewText`) on a deload week no
  longer contains "Peso mal elegido" for a flat exercise — the unit test
  covers `diagRows`, and `reviewText` maps over its output without
  re-deriving the verdict.
