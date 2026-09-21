# Plan 039: The legacy RIR map folds onto a session once and never onto a set that had none; the rule's fallback reserve comes from the map, never from an un-ticked set

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3913b8f..HEAD -- js/app.js test/unit.js`
> If either file changed since this plan was written, compare every
> "Current state" excerpt below against the live code before proceeding; on
> a mismatch, treat it as a STOP condition. Plan 038 is being executed in
> parallel and edits both files — see the first two STOP conditions.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED — the change is confined to ~40 lines of `js/app.js`,
  but those lines feed the objetivo (the weight the app asks for next
  week), and the unit suite pins fifteen objetivo cases plus a plan-038
  equivalence test that compares the two readers this plan edits.
- **Depends on**: none. **Coordinates with plan 038** (in progress): land
  this before 038's PR 3 (which moves the objetivo onto `sessionsOf`), or
  after it with the `readSession`-only variant described in Step C.
- **Category**: bug
- **Planned at**: commit `3913b8f`, 2026-09-21

## Why this matters

Since plan 035 every set carries its own RIR (`r.rir`, one digit on the
log row) and the old one-value-per-session map (`profile.rir`) is legacy:
folded onto the rows on load and on import, read as a fallback. Three edges
of that fold and fallback each put a reserve on a set nobody recorded, and
the objetivo then prices that set as a measurement instead of a floor:

1. **The block share round-trip stamps a RIR the sender never typed.** The
   sender's `blockShareRir` derives the legacy map from `getRir`, which
   picks the last *working* set that *carries a value*. The receiver's
   `foldRirMap` writes that map value onto `rirRowFor`'s row — the last
   working set, value or not — and its idempotence guard looks only at that
   one row. Sender rows `[RIR 3, –, –]` (all done) travel intact, the map
   says `'2+'`, and the receiver writes `2` onto set 3. Two phones now
   prescribe different weights for the same block, and re-sharing from the
   receiver is stable, so the divergence is permanent.
2. **The fold is idempotent per row, not per session.** A pre-035 session
   with chip `'1'` and three sets done folds onto set 3 on the first load.
   The map entry stays (by design — `dropLegacyRir` only fires from the RIR
   box). Tick a forgotten fourth set later, and on the next load
   `rirRowFor` returns set 4, which has no value, and the fold writes `1`
   onto it: a per-set measurement the lifter never made, months after the
   chip was tapped.
3. **A RIR left on an un-ticked set is read as the reserve of every working
   set.** `rirRowRead`'s second pass returns any row with a value, ticked or
   not; `exSession` (and plan 038's `readSession`) pass that exercise-level
   answer to `sessionRirs` as the fallback, which lands on the last working
   set and carries backwards. Tick set 4, type `0`, un-tick set 4: sets 1–3
   are priced at 0 RIR, their `cens` flag flips from true to false, and the
   level, confidence and slack of next week's target are built on evidence
   that does not exist. The block review reads the rows directly and
   ignores the orphan, so the review and the objetivo disagree about the
   same session.

Edges 1 and 2 share one fix (fold once per session, and only when no row
carries a value). Edge 3 is one line in each reader: the fallback is the
legacy map, never a non-working row.

Vocabulary (from `CONTEXT.md`): a **set** is one logged row; a **working
set** is a set ticked done with both a weight and a rep count; a
**session** is everything one lift was logged with in one slot.

## Current state

All excerpts at `3913b8f`.

- `js/app.js` — the RIR section (`:1660–1850`), the objetivo's session
  reader `exSession` (`:4314`), plan 038's `readSession` (`:2481`), the
  share builder `blockShareRir` (`:5439`) and the install path
  `installBlockData` (`:153`).
- `test/unit.js` — § "RIR por serie: el registro vive en la fila
  (plans/035)" starts at `:1884`; its `dropLegacyProbe` block (`:1922`) is
  the fixture style to copy. § "sessionsOf: the one reading of the log
  (plans/038)" starts at `:3735` and its assertion at `:3916` compares
  `readSession` against `exSession`.

The fold, guarded on the target row only:

```js
// js/app.js:1812-1826
function foldRirMap(profile, blockId) {
  if (!profile || !profile.rir || !profile.log) return;
  forEachSlot(profile.rir, blockId, (key, w, dayId, slotRir) => {
    if (!slotRir || typeof slotRir !== 'object' || Array.isArray(slotRir)) return;
    const slotLog = profile.log[blockId] && profile.log[blockId][key];
    if (!slotLog || typeof slotLog !== 'object' || Array.isArray(slotLog)) return;
    Object.keys(slotRir).forEach(exId => {
      const n = rirNumber(slotRir[exId]);
      if (n == null) return;
      const row = rirRowFor(slotLog[exId]);
      if (!row || typeof row !== 'object' || rowRir(row) != null) return;
      row.rir = String(n);
    });
  });
}
```

The two selectors that disagree:

```js
// js/app.js:1749-1758 — what getRir and blockShareRir read
function rirRowRead(rows) {
  if (!Array.isArray(rows)) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rowWorked(rows[i]) && rowRir(rows[i]) != null) return rows[i];
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rowRir(rows[i]) != null) return rows[i];
  }
  return null;
}

// js/app.js:1795-1800 — where the fold writes
function rirRowFor(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let at = -1;
  rows.forEach((r, i) => { if (rowWorked(r)) at = i; });
  return rows[at >= 0 ? at : rows.length - 1] || null;
}
```

The exercise-level reader, and the two rule readers that use it as their
fallback:

```js
// js/app.js:1765-1771
function getRir(profile, blockId, w, dayId, exId) {
  const bucket = profile.log && profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
  const row = rirRowRead(bucket && bucket[exId]);
  if (row) return String(rowRir(row));
  const slotRir = profile.rir && profile.rir[blockId] && profile.rir[blockId][slot(w, dayId)];
  return (slotRir && slotRir[exId]) || '';
}

// js/app.js:4326-4327 — inside exSession; `work` is the working sets only
  const raw = getRir(profile, blockId, week, dayId, exId) || null;
  const rirs = sessionRirs(work, rirNumber(raw));

// js/app.js:2486-2487 — inside readSession (plans/038)
  const legacy = rirNumber(getRir(profile, block.id, week, dayId, exId) || null);
  const rirs = sessionRirs(worked.map(t => t.r), legacy);
```

The inheritance rule (unchanged by this plan):

```js
// js/app.js:1731-1739
function sessionRirs(rows, legacy) {
  const out = (rows || []).map(rowRir);
  if (out.length && legacy != null && !out.some(v => v != null)) out[out.length - 1] = legacy;
  let carry = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] == null) out[i] = carry; else carry = out[i];
  }
  return out;
}
```

The share builder (unchanged by this plan — it must keep emitting the map
for receivers on an older shell) and the install path that folds it:

```js
// js/app.js:5450-5453 — inside blockShareRir
      liveEx.forEach(exId => {
        const v = rirNumber(getRir(profile, block.id, w, day.id, exId));
        if (v == null) return;
        kept[exId] = v >= 2 ? '2+' : String(v);
      });

// js/app.js:157-167 — inside installBlockData
  ['log', 'rir', 'order', 'notes', 'energy'].forEach(name => {
    if (!d[name]) return;
    if (!profile[name]) profile[name] = {};
    profile[name][id] = d[name];
  });
  foldRirMap(profile, id);
```

Conventions that apply: comments explain *why* in prose and name the bug
they prevent (see the comment above `foldRirMap`, `js/app.js:1802–1811`,
for the register); Spanish for user-visible strings, English for
comments; a unit test is a `call(...)` of a self-invoking function that
builds its own fixture and returns a string, asserted with
`ok(name, cond, extra)` — copy `dropLegacyProbe` at `test/unit.js:1922`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0, no output |
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed` — **read N before Step A and count in deltas**: it printed 760 at `3913b8f` with this plan's index row in place, and plan 038 is adding assertions concurrently |
| One smoke section (optional, needs Playwright + a server on :8765) | `node test/smoke.js --only "objetivo de peso"` | every line `PASS`, none `FAIL` |
| Bump the shell version | `bash tools/bump-cache-version.sh` | prints `vN -> vN+1` (`v88 -> v89` at `3913b8f`) |

`npm install --no-save --ignore-scripts playwright@1.56.1` and
`npx playwright install chromium` once, and
`python3 -m http.server 8765 &` (Git Bash) or
`Start-Process python3 -ArgumentList '-m','http.server','8765'` (PowerShell)
before any smoke run. The full smoke suite runs by itself when the pull
request is opened (a PreToolUse hook on `gh pr create`); do not run it by
hand.

## Scope

**In scope** (the only files you may modify):
- `js/app.js` — `foldRirMap`, a new `legacyRir` helper beside `getRir`,
  `getRir`, `exSession`, `readSession`, and the comments named in Step D.
- `test/unit.js` — new assertions in § "RIR por serie".
- `sw.js` — the `CACHE_VERSION` bump only.
- `plans/README.md` — your status row.

**Out of scope** (do NOT touch, even though they look related):
- `blockShareRir` and `normalizeImportedRir` — the map must still be
  emitted and accepted for phones on an older shell.
- `rirRowRead`, `rirRowFor`, `sessionRirs` — their contracts are pinned by
  existing tests; the fix is in their callers.
- `dropLegacyRir` and the RIR box's `oninput` — plan 035's "never write a
  value into the map" invariant is not what is broken.
- `js/diagnostics.js`, `js/review.js` — the Diagnóstico's session-level
  reading through `getRir` is a recorded direction item (plans/README.md,
  eighth audit), not this plan.
- `sessionsOf` itself, and anything else under plan 038.

## Git workflow

- Branch: `claude/039-rir-fold-once`
- One commit per step, message in the repo's style — a sentence in plain
  prose, e.g. `Plan 039 Step B: the legacy fold runs once per session`.
- Do NOT push or open a PR unless the operator instructed it. Opening one
  runs the smoke gate; rebase onto `main` first, because plan 038's PRs
  are landing in `js/app.js` and `sw.js` concurrently, and take the higher
  `CACHE_VERSION` on conflict.

## Steps

### Step A: Pin the three edges with assertions that fail today

In `test/unit.js`, directly after the `dropLegacyProbe` block's last `ok(`
call (grep `dropLegacyProbe`; the block ends around `:1940`), add:

```js
/* Three edges of the fold and its fallback, one root (plans/039): two
   selectors for "the row the session's RIR sits on", and a fallback that
   trusted a row that was not a working set. */
const foldSkipsTyped = call(`
  (function () {
    const rows = [{ w: '60', r: '10', done: true, rir: '3' },
                  { w: '60', r: '9', done: true },
                  { w: '60', r: '8', done: true }];
    const p = { log: { B: { 'w1-D': { E: rows } } },
                rir: { B: { 'w1-D': { E: '2+' } } } };
    foldRirMap(p, 'B');
    return rows.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
  })()
`);
ok('foldRirMap leaves a session alone when any of its sets already carries a value — the share round-trip stamps nothing (plans/039)',
   foldSkipsTyped === '3,x,x', foldSkipsTyped);

const foldOnce = call(`
  (function () {
    const rows = [{ w: '60', r: '10', done: true },
                  { w: '60', r: '9', done: true },
                  { w: '60', r: '8', done: true }];
    const p = { log: { B: { 'w1-D': { E: rows } } },
                rir: { B: { 'w1-D': { E: '1' } } } };
    foldRirMap(p, 'B');
    const first = rows.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
    rows.push({ w: '60', r: '7', done: true });
    foldRirMap(p, 'B');
    const second = rows.map(function (r) { return r.rir == null ? 'x' : r.rir; }).join(',');
    return first + ' | ' + second;
  })()
`);
ok('...and folds a legacy chip exactly once per session: a set ticked later does not inherit it from the map',
   foldOnce === 'x,x,1 | x,x,1,x', foldOnce);

const orphanRows = "[{ w: '60', r: '10', done: true }, { w: '60', r: '9', done: true }, " +
                   "{ w: '60', r: '8', done: true }, { w: '60', r: '8', done: false, rir: '0' }]";
const orphanRule = call(`
  (function () {
    const rows = ${orphanRows};
    const p = { log: { B: { 'w1-D': { E: rows } } }, rir: {} };
    const s = exSession(p, 'B', 1, 'D', 'E', 8, 12);
    return s.sets.map(function (x) { return x.rir == null ? 'x' : x.rir; }).join(',') +
      ' cens=' + s.sets.map(function (x) { return x.cens ? 1 : 0; }).join('');
  })()
`);
ok('exSession never reads a reserve off a set that is not a working set: a RIR typed then un-ticked prices nothing',
   orphanRule === 'x,x,x cens=111', orphanRule);

const orphanReader = call(`
  (function () {
    const rows = ${orphanRows};
    const p = { log: { B: { 'w1-D': { E: rows } } }, rir: {} };
    const s = readSession(p, { id: 'B' }, 1, 'D', 'E', rows, undefined);
    return s.sets.map(function (x) { return x.rir == null ? 'x' : x.rir; }).join(',');
  })()
`);
ok('...and readSession (plans/038) reads the same session the same way',
   orphanReader === 'x,x,x', orphanReader);
```

**Verify**: `node test/unit.js` → the last line reads `N passed, 4 failed`
with N unchanged from your first run (the four new assertions, and only
those, print `FAIL`; the first shows `3,x,2`, the second `x,x,1 | x,x,1,1`,
the third `0,0,0 cens=000`). If a *different*
assertion fails, or `readSession` is not defined, see STOP conditions.

### Step B: Fold once per session, and only when no set carries a value

In `js/app.js`, replace the three lines inside `foldRirMap`'s inner
`forEach` that read `const row = rirRowFor(slotLog[exId]); if (!row ||
typeof row !== 'object' || rowRir(row) != null) return; row.rir =
String(n);` with:

```js
      const rows = slotLog[exId];
      /* Once per session, never again: a session any set of which already
         carries a value has either been folded already or been typed on
         since, and in both cases the rows are the record and the map is
         not. Guarding the target row alone was the bug twice over — the
         row rirRowFor picks MOVES when a later set is ticked, so a chip
         folded onto set 3 was folded again onto set 4 on the next load;
         and a block shared from a phone whose rows carried values arrived
         with the map blockShareRir still emits for older receivers, and
         that map was written onto the one working set that had no value
         of its own (plans/039). */
      if (!Array.isArray(rows) || rows.some(r => rowRir(r) != null)) return;
      const row = rirRowFor(rows);
      if (!row || typeof row !== 'object') return;
      row.rir = String(n);
```

Also amend the sentence in the comment above `foldRirMap` that reads
"Idempotent by construction — a row that already carries a value is never
overwritten" to say "a session any row of which already carries a value is
never touched".

**Verify**: `node --check js/app.js` → exit 0. `node test/unit.js` → `N+2
passed, 2 failed` (only the two `exSession`/`readSession` assertions still
fail). Every pre-existing assertion still passes — in particular
`...the legacy chip fills a session whose rows carry nothing` and the
`dropLegacyProbe` cases.

### Step C: The rule's fallback is the map, never a non-working row

In `js/app.js`, split the map read out of `getRir` and make both rule
readers use it directly. Replace `getRir` (`:1765-1771`) with:

```js
/* The legacy map's own value for one exercise-session, or ''. Its own
   function because the rule's readers — exSession, and readSession since
   plans/038 — want THIS and nothing else as their fallback: getRir's
   second pass, below, returns any row carrying a value, ticked or not,
   which is right for a screen printing "the session's RIR" on a day
   nobody has ticked yet, and wrong as evidence about the sets that were
   done — a 0 typed on a set that was then un-ticked used to price every
   working set of the session at failure (plans/039). */
function legacyRir(profile, blockId, w, dayId, exId) {
  const slotRir = profile.rir && profile.rir[blockId] && profile.rir[blockId][slot(w, dayId)];
  return (slotRir && slotRir[exId]) || '';
}

function getRir(profile, blockId, w, dayId, exId) {
  const bucket = profile.log && profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
  const row = rirRowRead(bucket && bucket[exId]);
  if (row) return String(rowRir(row));
  return legacyRir(profile, blockId, w, dayId, exId);
}
```

In `exSession`, replace the two lines at `:4326-4327` (and the comment
above them, `:4320-4325`) with:

```js
  /* One reserve per set since plans/035, inherited backwards by
     sessionRirs. The fallback for a session whose working sets carry no
     value is the legacy map and only the map: a value on a set that is not
     a working set — un-ticked, or typed ahead of a tick that never came —
     is not this session's evidence (plans/039). */
  const rirs = sessionRirs(work, rirNumber(legacyRir(profile, blockId, week, dayId, exId)));
```

In `readSession`, replace the line at `:2486` with:

```js
  const legacy = rirNumber(legacyRir(profile, block.id, week, dayId, exId));
```

and adjust the sentence in the comment above `readSession` that says "with
the old one-chip value (getRir) as the fallback" to say "(legacyRir)".

**If plan 038's PR 3 has already landed** and `exSession` no longer exists:
apply only the `readSession` half, delete the `orphanRule` assertion from
Step A, and say so in your report.

**Verify**: `node --check js/app.js` → exit 0. `node test/unit.js` → `N+4
passed, 0 failed`. The plan-038 assertion `a working set's rir is exactly
what exSession reads — per set, inherited, the legacy chip as fallback —
and a non-working set keeps its own` (`test/unit.js:3916`) must still pass
— it does when both readers changed identically.

### Step D: Say what changed where the old contract was written down

In `js/app.js`:

- The RIR section comment (`:1681-1687`): the sentence "read as a fallback
  by getRir and by exSession" → "read as a fallback by getRir, and by the
  rule's readers through legacyRir".
- The comment above `rirRowRead` (`:1740-1748`): replace its last sentence
  ("The first pass is why that padding row cannot then shadow a set ticked
  afterwards.") with: "The first pass is why that padding row cannot shadow
  a set ticked afterwards on the screens that read this; the rule never
  takes the second pass at all — see legacyRir."

No user-facing text changes; `docs/guide.md` § "The weekly objetivo"
describes the inheritance rule, which is unchanged.

**Verify**: `node --check js/app.js` → exit 0; `node test/unit.js` → `N+4
passed, 0 failed`.

### Step E: Bump the shell version

`bash tools/bump-cache-version.sh` → prints `vN -> vN+1`. Confirm with
`grep -n "CACHE_VERSION = " sw.js` that the line moved by one.

**Verify**: `node test/unit.js` → `N+4 passed, 0 failed` (it asserts
`sw.js`'s shape). Optionally, with a server on :8765 and Playwright
installed, `node test/smoke.js --only "objetivo de peso"` → all `PASS`.

## Test plan

- The four assertions in Step A are the regression tests: share
  round-trip (fold skips a session carrying a value), fold-once (a set
  ticked later is not stamped), orphan RIR in `exSession`, and the same in
  `readSession`. Model: `dropLegacyProbe`, `test/unit.js:1922-1935`.
- Existing coverage that must stay green and that a wrong fix would break:
  the fifteen objetivo cases (§ "peso objetivo" and § "plans/026"), the
  `sessionRirs` cases at `test/unit.js:1902-1915`, and the plan-038
  equivalence assertion at `:3916`.
- Verification: `node test/unit.js` → `0 failed`, four more passed than
  before Step A.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --check js/app.js` exits 0
- [ ] `node test/unit.js` ends `0 failed`, with four more `passed` than on
      `main` (three if the `exSession` half was dropped because 038 PR 3
      had landed)
- [ ] `grep -c "^function legacyRir" js/app.js` → `1`
- [ ] `awk '/^function exSession/,/^}/' js/app.js | grep -c "getRir("` → `0`
      (skip if `exSession` no longer exists)
- [ ] `awk '/^function readSession/,/^}/' js/app.js | grep -c "getRir("` → `0`
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a version one higher than
      the one on `main`
- [ ] `git status --short` lists only `js/app.js`, `test/unit.js`, `sw.js`
      and `plans/README.md`
- [ ] `plans/README.md` status row for 039 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `readSession` is not defined in `js/app.js` (plan 038's PR 2 was
  reverted): do the `exSession` half only and report.
- `exSession` is not defined, or `targetFor`/`exHistory` no longer call it
  (plan 038's PR 3 landed): do the `readSession` half only, per Step C,
  and report.
- After Step C, the plan-038 equivalence assertion at `test/unit.js:3916`
  fails: the two readers were not changed identically. Re-read Step C; if
  it still fails, stop.
- After Step C, any objetivo case under § "peso objetivo" or § "plans/026"
  fails: a fixture relies on the orphan reading. Report which one; do not
  edit the fixture.
- The code at any "Current state" location does not match its excerpt.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Plan 038's PR 3 moves the objetivo onto `sessionsOf`; from then on the
  only rule reader is `readSession`, and `legacyRir` is what it must keep
  using. A reviewer of that PR should check the fallback line was not
  "simplified" back to `getRir`.
- `blockShareRir` still emits the legacy map through `getRir` — that is
  the display-level reading and it is what receivers on an older shell
  expect. With Step B a current receiver ignores it whenever the rows
  already say something, so the map is only ever read into a session that
  has nothing.
- The Diagnóstico still reads `getRir` — including its second pass — for
  the `easy`/`failure` signals (`js/diagnostics.js:131, 706-707`). That is
  the "one number per session" reading the eighth audit's direction table
  records as a separate decision; it is not a bug this plan left behind.
- Deferred on purpose: whether un-ticking a set should clear the RIR typed
  on it. The tick handler keeps the typed weight and reps on un-tick, and
  the RIR follows the same rule; the fix here makes the un-ticked value
  inert rather than deleting it.
