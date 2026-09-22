# Plan 064: An import that could not be saved says so, and the objetivo's rung list is built once per history

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` unless you were told otherwise.
>
> **Two independent steps, A and B — one PR each** (`claude/064-a`,
> `claude/064-b`); both bump `CACHE_VERSION`.
>
> **Drift check (run first)**:
> `git diff --stat b15ae87..origin/main -- js/app.js js/block-editor.js js/profile-transfer.js js/qr-transfer.js js/review.js test/unit.js sw.js`
> Re-locate every anchor by `grep`, never by line number alone.

## Status

- **Priority**: P3 (both)
- **Effort**: S each
- **Risk**: LOW
- **Depends on**: none. If plan 060 has landed, `writeState`'s first
  line reads `if (frozen || discarding) return;` — keep it, returning
  `false` like the other early returns (nothing was written).
- **Category**: bug (A), perf (B)
- **Planned at**: commit `b15ae87`, 2026-09-22 (tenth audit, findings 10, 11)

## Why this matters

**A.** `writeState` catches a failed `localStorage.setItem` (quota,
private mode), prints "No se ha podido guardar…" in the footer and shows a
toast **once per page load**, and returns nothing. Every import path then
calls `flushSave()` and immediately prints its success message over the
footer: "Registro restaurado — …", "Ana cargado — …", "Bloque … añadido".
So a restore or profile load that did not fit reports success, and the
next reload brings the old data back. If the quota toast was already shown
earlier in the session, the failure is completely silent. (A realistic
trigger: restoring a large Chrome backup on iOS Safari, whose quota is
tighter.)

**B.** `targetFor` — the objetivo for one card — calls `loadLadder`,
which rebuilds the list of distinct weights a lift has been done at, over
the lift's whole history across blocks, comparing each set with every
weight seen so far. It runs for every card on every full draw (week or
day change, reorder, any `commit()`), and its input — the frozen `rule`
list `liftHistory` hands back — is the *same array object* across draws
until the log changes. Measured on a desktop with `bootApp()`, two
profiles: average navigation draw 11.1 ms → 6.0 ms at 20 blocks × 8 weeks,
31.6 ms → 10.9 ms at 20 × 16 (roughly 4× those numbers on a phone);
`loadLadder` alone was 57–67 % of a draw. A tick is unaffected (it
redraws one card).

## Current state

### A

`js/app.js` (search `function writeState(`, ≈ line 1148):

```js
function writeState(force) {
  if (frozen) return;
  if (held && !force) return;
  held = false;
  try {
    pruneLog();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    mark('Guardado ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    mark('No se ha podido guardar — puede que no quede espacio en el navegador', true);
    if (!quotaToastShown) { quotaToastShown = true; toast(…, 'Copia de seguridad', () => $('backup').click()); }
  }
}

function flushSave() {
  if (!saveT && !held) return;
  clearTimeout(saveT);
  saveT = null;
  writeState(true);
}
```

The five import paths that do `flushSave(); mark(<success>)`:

| File | Search for | Success message starts |
|---|---|---|
| `js/profile-transfer.js` | `mark('Registro restaurado` | "Registro restaurado — " |
| `js/profile-transfer.js` | `cargado — ' + setsLabel(theirs)` | "<name> cargado — " |
| `js/qr-transfer.js` | `mark('Bloque "' + normalized.name + '" añadido'` | "Bloque … añadido" |
| `js/block-editor.js` | `'" importado' + (sourceLabel` | "Bloque … importado" |
| `js/review.js` | `importado desde la revisión` | "Bloque … importado desde la revisión" |

(`flushSave` is also called by the page-hide listeners and the
`controllerchange` reload in `js/app.js`; those ignore its result.)

**Precache-hole rule (AGENTS.md, rule 1):** the four satellite files may
be served beside an *older* cached `js/app.js` whose `flushSave` returns
`undefined`. So a caller must treat only an explicit `false` as failure —
`if (flushSave() !== false) mark(…)` — never `if (flushSave())`, which
would swallow every success message on an old shell.

### B

`js/app.js` (search `function loadLadder(`, ≈ line 6494):

```js
function loadLadder(sessions) {
  const seen = [];
  sessions.forEach(s => s.sets.forEach(x => { if (!x.conv && !seen.some(v => sameLoad(v, x.w))) seen.push(x.w); }));
  return seen.sort((a, b) => a - b);
}
function nextLoad(ladder, w, inc) { const up = ladder.filter(…); … }
function prevLoad(ladder, w, inc) { const dn = ladder.filter(…); … }
```

Its one caller, `targetFor` (search `const ladder = loadLadder(sessions);`),
gets `sessions` from `exHistory(...)`, which returns `liftHistory(...).rule`
— a frozen array (`freezeHistory`) memoised per history answer via
`historyDerived` (search `function historyDerived`), so the same array
comes back until a write drops the answer. `renderCache` (reset every
draw) does not keep it.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check <file>` for each touched `js/` file | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| Bump | `bash tools/bump-cache-version.sh` | old → new |

## Scope

**In scope**: A — `js/app.js` (`writeState`, `flushSave` return values
only), the five `mark(<success>)` sites listed above, `test/unit.js`,
`sw.js` (bump). B — `js/app.js` (`loadLadder` only), `test/unit.js`,
`sw.js` (bump).

**Out of scope**: the quota toast's once-per-page rule; the wording of any
message except the new failure line; `sameLoad`, `nextLoad`, `prevLoad`,
`targetFor`; any other cache.

## Git workflow

Branch per step from `origin/main`, plain-sentence subjects, your
session's `Co-Authored-By:` line, bump last.

## Steps

### Step A: A failed write is not reported as a success

1. `writeState` returns `true` after a successful `setItem`, `false` from
   the `catch`, and `false` from the two early returns (`frozen`; `held`
   without `force`) — nothing was written.
2. `flushSave` returns `true` when there was nothing to write
   (`!saveT && !held`), and otherwise the result of `writeState(true)`.
3. At each of the five sites: `if (flushSave() !== false) mark(<success>);`
   and nothing else — on failure `writeState` has already put
   "No se ha podido guardar — puede que no quede espacio en el navegador"
   in the footer, and it must stay there. Add a short comment at the first
   site (and "same as restoreFromText" at the others) saying why
   `!== false` and not truthiness (the precache-hole rule above).
4. Tests (booted — `bootApp` exposes `boot.ctx.localStorage`; make
   `setItem` throw after boot, e.g. `boot.ctx.localStorage.setItem = () => { throw new Error('quota'); }`):
   - Restore a valid backup through `restoreFromText`, modelled on the
     booted case at `test/unit.js` search `reader.call('restoreFromText(__backup)')`
     (≈ line 8282): build `backup` from a `writer` boot with
     `writer.call('JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2)')`,
     then `reader.ctx.__backup = backup; const restoring = reader.call('restoreFromText(__backup)'); reader.call('closeAsk(true)'); await restoring;`
     — with `reader.ctx.localStorage.setItem` made to throw first →
     `boot.$('status').textContent` contains "No se ha podido guardar" and
     not "Registro restaurado".
   - Same with storage working → contains "Registro restaurado".
   - `boot.call('flushSave()')` with nothing pending → `true`.

**Verify**: `node --check` each touched file; `node test/unit.js` →
`0 failed`. Mutation: make one site `flushSave(); mark(…)` again → its
case FAILs. Bump, PR.

### Step B: Cache the ladder per history

Keep the algorithm. Add a module-level `const ladderMemo = new WeakMap();`
beside `loadLadder`; on entry return the memoised ladder for this
`sessions` array if there is one; otherwise build it as today, freeze it
(`Object.freeze`), store it, return it. Comment: why (57–67 % of a draw on
a long history, the input array is stable per history answer, so its
lifetime is exactly right — a write that changes the log hands back a new
array). Before freezing, check the two readers only `filter` it:
`grep -n "ladder" js/app.js` — if anything writes to it, STOP.

Tests (`test/unit.js`, with the other objetivo cases — search `targetFor`):
1. Same array twice → the same (`===`) frozen ladder.
2. A different array with the same content → an equal but distinct ladder.
3. Boot a history (use `sessionFixture` — search it), read one card's
   objetivo, tick a set of that lift in a later week, read again → the
   objetivo still equals what an uncached computation gives (call a local
   copy of the old `loadLadder` on the new `rule` and compare `nextLoad`
   results), i.e. no stale ladder survives a write.

Measure before/after once (not committed): a throwaway script under your
scratch directory that `bootApp`s a state of 2 profiles × 20 blocks × 16
weeks (build it with the same helpers the unit suite uses) and times 300
day switches; record both numbers in Maintenance notes.

**Verify**: `node test/unit.js` → `0 failed`. Bump, PR.

## Test plan

A: three booted cases + one mutation. B: three cases; one timing
recorded in Maintenance notes.

## Done criteria

- [ ] A: `grep -n "flushSave() !== false" js/*.js` → five lines (one per
      site listed)
- [ ] B: `grep -n "ladderMemo" js/app.js` → the declaration and its use
- [ ] `node test/unit.js` → `0 failed`
- [ ] Each PR bumps `CACHE_VERSION` above `origin/main`'s; only in-scope
      files changed

## STOP conditions

- A: one of the five sites no longer calls `flushSave()` right before its
  success `mark` (drift) — report which.
- A: an existing test asserts `writeState()`'s return value is `undefined`.
- B: a reader of the ladder mutates it; or `exHistory` no longer returns
  the memoised `rule` array (then the cache would never hit — report).

## Maintenance notes

- A new import path must follow the same `if (flushSave() !== false)`
  shape.
- B: if the ladder ever depends on anything besides the sessions array
  (units, the exercise's `inc`), the WeakMap key is no longer enough.

**Step B, landed as `claude/064-b`.** No deviation from the plan's design:
`loadLadder` keeps the algorithm and gains a module-level
`const ladderMemo = new WeakMap();` beside it, checked on entry and filled
before returning a frozen ladder. `grep -n "ladder" js/app.js` confirmed
before writing it that `nextLoad`/`prevLoad` — the only readers — only ever
`.filter()` it, never write.

**Before/after timing** (throwaway script under the system temp dir, not
committed): `bootApp()` with a state of 2 profiles × 20 blocks × 16 weeks
(3 days/block, 4 lifts/day, 3 sets/lift), every set's weight strictly
increasing week over week and block over block so a lift's 319-session
history never repeats a rung (a 638-entry ladder — the worst case for
`seen.some()`, and the realistic one: progressive overload rarely repeats
a load). 300 day switches — `profile.day = i; commit('view');`, the same
call a "Día N" tab's `onclick` makes — cycling the block's 3 days, after an
untimed 3-switch warm-up lap; best of 3 trials; instrumented to confirm
every `loadLadder` call in the timed loop was a cache hit (0 misses) on
the memoised version, and that the *input* array's identity was already
stable turn to turn before this change (a `WeakMap` keyed on an array that
changed identity every call would help nothing).

| | total (300 switches) | per switch |
|---|---|---|
| before (`origin/main`'s `loadLadder`) | 49 307 ms | 164.358 ms |
| after (memoised) | 420 ms | 1.399 ms |

~117×. Larger than the plan's own 31.6→10.9 ms full-draw figures because
this profile's weights never repeat (maximising `seen`) and the timing
isolates 300 *warm-history* switches specifically — the case this plan is
about — rather than one cold draw; the two are different measurements,
not a contradiction.

One dead end worth recording since it cost real time: the first version of
the measurement script built two profiles with
`state.profiles = { hombre: profile('Él', ...), mujer: profile('Ella', ...) }`,
where `profile()` calls `sessionFixture()`, which does
`state = defaultState()` as its own reset on *every* call. The assignment's
target (`state`) is resolved before its right-hand side is evaluated, so
by the time the object literal's two `profile()` calls have each repointed
the global `state`, the assignment lands on the object `state` referenced
*before* either call — which nothing points to any more — and the global
is left an untouched `defaultState()`. The script ran, drew a real (if
tiny) demo profile, and printed a plausible-looking number for it, with no
error to say so. Building both profiles into locals first, then assigning
`state.profiles = { hombre: p1, mujer: p2 }`, fixed it. Caught only by
instrumenting `loadLadder`'s hit/miss counts and the live profile's own
`blockOrder.length` rather than trusting a bare timing number — worth
doing on any throwaway perf script, not just this one.
