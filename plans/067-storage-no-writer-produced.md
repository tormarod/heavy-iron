# Plan 067: Storage no writer produced is repaired without stealing, sharing or polluting — and another tab's data is taken in whole or not at all

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md`.
>
> **Two independent steps, one PR each**: A (`claude/067-a`, `migrate()`
> and the session reader) and B (`claude/067-b`, `adoptStored`). Both bump
> `CACHE_VERSION`. Read the whole plan, execute only your step.
>
> **Drift check (run first)**:
> `git diff --stat c9114bc..origin/main -- js/app.js test/unit.js sw.js`
> Other sessions land PRs mid-task. Re-locate every anchor by `grep`,
> never by line number alone.

## Status

- **Priority**: P2
- **Effort**: S (B), S–M (A)
- **Risk**: LOW — every change is on a path the app's own writers never
  produce; the unit suite pins what they do produce.
- **Depends on**: none
- **Category**: bug (hardening)
- **Planned at**: commit `c9114bc`, 2026-09-22 — the tenth audit's
  recorded follow-ups (`plans/README.md`, "Tenth audit — follow-ups") and
  the ninth audit's findings 4, 5, 6 and 12

## Why this matters

`localStorage` is not an import: nothing validates it the way
`normalizeImported*` validates a file, so `migrate()` is the only repair
between whatever is on disk and the first draw. The repo's principle,
written above `migrate()`, is to open "even when the data is half broken"
and never to lose a training history on the way. Five places break it for
shapes no writer produces (a hand-edited backup restored long ago, a
browser extension, a bug in some future release):

1. **Two blockless profiles share one block object.** The "no blocks"
   branch assigns `profile.blocks = seed.blocks` by reference, and the seed
   selector sends index 0 and every index ≥ 2 to `hombre`'s seed — so two
   such profiles hold the *same* object, and editing one plan rewrites the
   other's.
2. **The id repair steals an id another day holds.** A day with no id (or
   a duplicate) is given `'d' + i`. If a *later* day already holds that
   id, the later day is renamed instead — and the rows filed under it now
   belong to the earlier day. Same for exercises within a day. Example:
   days `[{ id: undefined }, { id: 'd0' }]` → day 0 becomes `d0` and adopts
   day 1's whole history; day 1 becomes `d1` with none.
3. **An array passes for an object.** `ensureRecord` keeps `log: []`
   (`typeof [] === 'object'`); ticks then write string keys onto the array
   and `JSON.stringify` drops every one — a session's sets gone on the
   next reload. An array `phase` is kept too, and every week reads no RIR.
4. **A prototype-named exercise key pollutes `Object.prototype`.** The
   session reader enumerates a slot's raw keys, so a log key `__proto__`
   (which `JSON.parse` does create as an own key) comes back as a lift.
   `strengthByExercise` tests it against a plain `{}` map
   (`muscleOf['__proto__']` is `Object.prototype`, truthy) and then writes
   `out['__proto__'][w - 1] = best` — onto `Object.prototype` itself, so
   every object in the page grows an index property.
5. **Another tab's data is committed before it is repaired.**
   `adoptStored` assigns `state = next` and only then runs `migrate()`; if
   `migrate()` throws partway (bytes written by a newer release, say),
   `state` is left half-migrated — and on a page whose "Recargar" reload
   was stopped, the next save writes that back over everything.

## The decisions (settled — do not re-open)

1. **Clone the seed, don't purge.** Each blockless profile gets its own
   deep copy of the seed's blocks (`JSON.parse(JSON.stringify(...))` —
   `structuredClone` is Safari 15.4, above the floor). The record is **not**
   purged: from the first commit every profile has had blocks and a log
   filed per block, so a blockless profile only comes from damaged storage,
   and its likeliest owner is exactly the seed plan whose ids the record
   still matches. Keeping it loses nothing; purging it would.
2. **Claimed ids first.** The id repair runs in two passes per list: first
   collect every id that is valid (`safeKey`) and unique, in order; then give
   each day (exercise) that has none, or a duplicate, a fresh id that no
   day (exercise) in the list claims. Legacy data — every day id-less,
   keyed by index (`'w3-d1'`) — still gets exactly `d0`, `d1`, … because
   nothing is claimed. The duplicate rule is unchanged: the **first**
   holder keeps a duplicated id, later ones get fresh ids (their rows stay
   with the first, as today — the record cannot say which duplicate a row
   belonged to).
3. **Arrays are not objects** in `ensureRecord` and in the `phase` check.
   An array `phase` is replaced by `genericPhase(...)` like any other
   non-object.
4. **The session reader never yields a lift key `safeKey` refuses.** One
   guard where `readSessions` enumerates a slot's raw keys, so every reader
   downstream is covered; plus an own-key test in `strengthByExercise`
   (defence in depth, one line). The data stays on disk and in backups —
   it is only not read.
5. **`adoptStored` migrates before it commits.** Keep the old `state`;
   assign the candidate; run `migrate()` in a `try`; on a throw put the old
   `state` back and return `false` — the existing comment already promises
   that bytes this tab cannot read are "left where they are — this tab
   carries on with what it has". `dropUndo()`, `applyTheme()`, `render()`
   and `mark()` run only on success.

## Current state

All in `js/app.js` (re-locate by the search strings).

**Step A — `migrate()`** (search `function migrate()`):

```js
Object.keys(state.profiles).forEach((pk, i) => {
  …
  const seed = fallback.profiles[pk] || fallback.profiles[Object.keys(fallback.profiles)[i]] || fallback.profiles.hombre;
  …
  if (!profile.blocks || typeof profile.blocks !== 'object' || !Object.keys(profile.blocks).length) {
    profile.blocks = seed.blocks;
    profile.blockOrder = seed.blockOrder.slice();
  }
```

`const fallback = defaultState();` is built once per `migrate()` call.

The phase check (search `block.phase = genericPhase(block.weeks, block.deload)`):

```js
if (!block.phase || typeof block.phase !== 'object') block.phase = genericPhase(block.weeks, block.deload);
```

The id repair (search `const usedDays = new Set();`), with its comment
about legacy `'w3-d1'` keys — keep that comment and extend it:

```js
const usedDays = new Set();
block.days.forEach((day, i) => {
  let id = safeKey(day.id);
  if (!id || usedDays.has(id)) {
    id = 'd' + i;
    while (usedDays.has(id)) id = uid('d');
  }
  day.id = id;
  usedDays.add(id);
  …
  const usedEx = new Set();
  day.ex.forEach((ex, j) => {
    let id2 = safeKey(ex.id);
    /* safeKey on the slug too: … */
    if (!id2 || usedEx.has(id2)) { id2 = safeKey(slugify(ex.n)) || ('ex-' + i + '-' + j); while (usedEx.has(id2)) id2 = uid('ex'); }
    ex.id = id2;
    usedEx.add(id2);
    repairExercise(ex, block.weeks);
  });
});
```

Note the exercise branch's fresh id is the slug of the name first, then
`'ex-i-j'`, then `uid('ex')` — keep that order; only make it skip ids
another exercise of the same day **claims**.

`ensureRecord` (search `function ensureRecord(`):

```js
function ensureRecord(profile) {
  RECORD_PARTS.forEach(part => {
    if (!profile[part.name] || typeof profile[part.name] !== 'object') profile[part.name] = {};
  });
  RECORD_PARTS.forEach(part => { if (part.repair) part.repair(profile); });
}
```

The session reader (search `function readSessions(`), where it enumerates
a slot's keys:

```js
const exIds = liftId != null ? [liftId]
  : match ? Object.keys(match[dayId] || {})
  : Object.keys(s);
exIds.forEach(exId => {
  const rows = Object.prototype.hasOwnProperty.call(s, exId) ? s[exId] : null;
  if (!Array.isArray(rows)) return;
```

`strengthByExercise` (search `function strengthByExercise(`):

```js
const muscleOf = muscleOfBlock(block);
…
sessionsOf(profile, { weeks: 'plan', blocks: [block.id] }).forEach(sess => {
  const exId = sess.lift, w = sess.week;
  if (!muscleOf[exId]) return;
  …
  if (!out[exId]) out[exId] = new Array(weeks).fill(null);
```

**Step B — `adoptStored`** (search `function adoptStored(`):

```js
function adoptStored(raw) {
  let next;
  try { next = JSON.parse(raw); } catch (err) { return; }
  if (!next || !next.profiles) return;
  state = next;
  dropUndo();
  migrate();
  applyTheme();
  render();
  mark('Actualizado desde otra pestaña');
}
```

Its two callers: the `'storage'` listener's adopt branch
(`adoptStored(e.newValue);`) and the conflict's "Recargar", which already
wraps it in `try { adoptStored(readRaw()); } catch (err) {}`. Neither
reads a return value today.

**Tests** — `test/unit.js`. `migrate()` cases on hand-built states run in
the `loadApp()` context (search `state = defaultState(); migrate();` for
the shape); booted cases use `bootApp({ state })` (search `settled(`).
The two-tab booted cases from plan 060 fire the storage event with
`boot.fire(boot.ctx.window, 'storage', { key, newValue: raw })` (search
`'storage', { key`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0 |
| Unit | `node test/unit.js` | `N passed, 0 failed` |
| Bump | `bash tools/bump-cache-version.sh` | old → new |

No smoke section is needed; none of these shapes can be produced through
the UI.

## Scope

**In scope** — A: `migrate()`'s seed and id repair and phase check,
`ensureRecord`, `readSessions`' enumeration, `strengthByExercise`;
`test/unit.js`; `sw.js` (bump). B: `adoptStored`; `test/unit.js`; `sw.js`
(bump).

**Out of scope**: `normalizeImported*` (the import path already re-keys
and refuses these shapes); purging any record (decision 1); re-keying a
record under a refused id to a fresh one (the data stays on disk, unread
— decision 4); `load()`; the conflict toast.

## Git workflow

`git checkout -B claude/067-<a|b> --no-track origin/main`; plain-sentence
commit subjects ending with your `Co-Authored-By:` line; bump last.

## Steps

### Step A (PR 1): `migrate()` and the session reader

A.1 **Seed clone.** In the "no blocks" branch use
`profile.blocks = JSON.parse(JSON.stringify(seed.blocks));` with a comment
(two blockless profiles used to share one block object; decision 1 on why
the record is kept, not purged).

A.2 **Claimed ids first.** Rewrite the day loop as two passes:

```js
/* pass 1: ids that are valid and unique, first holder wins */
const claimedDays = new Set();
const keepDay = block.days.map(day => {
  const id = safeKey(day.id);
  if (!id || claimedDays.has(id)) return null;
  claimedDays.add(id);
  return id;
});
/* pass 2: a fresh id for the rest, never one another day claims */
block.days.forEach((day, i) => {
  let id = keepDay[i];
  if (!id) {
    id = 'd' + i;
    while (claimedDays.has(id)) id = uid('d');
    claimedDays.add(id);
  }
  day.id = id;
  …
```

and the exercise loop inside it the same way (per day: pass 1 claims valid
unique ids; pass 2 gives the rest `safeKey(slugify(ex.n)) || ('ex-' + i + '-' + j)`,
then `uid('ex')` while claimed). Keep `repairExercise(ex, block.weeks)`
where it is. Extend the legacy comment: what changed and why (the
2026-09-22 finding: an id-less day took `d0` from the day that held it,
and its history with it).

A.3 **Arrays.** `ensureRecord`: add `|| Array.isArray(profile[part.name])`
to the replace condition. The phase check: add
`|| Array.isArray(block.phase)`. One comment each.

A.4 **Reader guard.** In `readSessions`, at the top of the `exIds.forEach`
callback: `if (!safeKey(exId)) return;` — only needed for the
`Object.keys(s)` branch but harmless for the others. Comment: a slot key
`__proto__`/`constructor` is no lift any plan can hold (migrate and every
import refuse such ids), and handing it out made plain `{}` maps downstream
answer with `Object.prototype` (the ninth audit's finding 12). In
`strengthByExercise`, replace `if (!muscleOf[exId]) return;` with an
own-key test: `if (!Object.prototype.hasOwnProperty.call(muscleOf, exId)) return;`.

Then grep the rest of `js/` for the same pattern — a plain `{}` indexed by
a lift id that came from the log (`sess.lift`, or raw slot keys) and then
**written through** (`map[id][…] = …`, `map[id].push`) — and list every
hit in the PR body with a one-line verdict (safe because …, or fixed the
same way). Do not refactor anything that is already safe.

A.5 **Tests** (`test/unit.js`, one new section
`console.log('\n== storage no writer produced (plans/067) ==');`, in the
`loadApp()` part near the other `migrate()` cases):
1. Two profiles, both with `blocks: {}` → after `migrate()`,
   `state.profiles.a.blocks['block-1'] !== state.profiles.b.blocks['block-1']`
   and editing one block's name leaves the other's.
2. Days `[{ id: undefined, … }, { id: 'd0', … }]` with a log under
   `w1-d0` → after `migrate()`, the second day still has id `d0` and the
   log is still under it; the first day has a fresh id.
3. Exercises `[{ id: undefined, n: 'Remo' }, { id: 'remo', n: 'Remo' }]`
   on one day with a log under `remo` → the second keeps `remo`.
4. Legacy: every day id-less → ids are exactly `d0`, `d1`, `d2`.
5. `log: []` → becomes `{}`; `phase: []` → `genericPhase` (check that
   `phaseRir(block, 1)` answers the same as for a block built with
   `genericPhase` and the same weeks/deload).
6. A log slot with an own `__proto__` key (build the state with
   `JSON.parse('{"__proto__": [{"w":"50","r":"5","done":true}]}')` as the
   slot) → `sessionsOf(profile, { weeks: 'logged' })` contains no session
   with `lift === '__proto__'`, and after `strengthByExercise(profile, block)`
   `Object.prototype.hasOwnProperty('0')` is `false` (and no index key on
   `Object.prototype` at all — check `Object.getOwnPropertyNames(Object.prototype)`
   contains no digit-only name). **Clean up** any pollution the test itself
   could leave, so a failure here cannot cascade into later sections.

Mutations: revert A.1 (by reference) → case 1 FAILs; revert A.2 → case 2
FAILs; drop the `Array.isArray` in `ensureRecord` → case 5 FAILs; drop
the reader guard **and** the own-key test → case 6 FAILs.

**Verify**: `node --check js/app.js`; `node test/unit.js` → `0 failed`.
Bump, PR.

### Step B (PR 2): `adoptStored` commits only a repaired state

B.1 Rewrite per decision 5:

```js
function adoptStored(raw) {
  let next;
  try { next = JSON.parse(raw); } catch (err) { return false; }
  if (!next || !next.profiles) return false;
  const prev = state;
  state = next;
  try {
    migrate();
  } catch (err) {
    /* comment: why (a newer release's bytes, say): put back what this tab had */
    state = prev;
    return false;
  }
  dropUndo();
  applyTheme();
  render();
  mark('Actualizado desde otra pestaña');
  return true;
}
```

`dropUndo()` moves after the successful `migrate()`. Both callers keep
working unchanged (neither needs the return value; "Recargar"'s `try`
stays). Update the header comment's last sentence to say a state
`migrate()` cannot repair is left where it is too.

B.2 Tests (booted, next to plan 060's two-tab cases):
1. Nothing pending here; fire `'storage'` with bytes that make
   `migrate()` throw — build them so `migrate` throws on a real path, or
   stub it for the one call:
   `boot.call("(function(){ const m = migrate; migrate = function(){ migrate = m; throw new Error('x'); }; })()")`
   — then assert `boot.call('state')` is the same object as before and its
   data unchanged, and a later `save()` writes this tab's own data.
2. The same through "Recargar" (reload stubbed, as plan 060's cases do):
   after the throw `state` is still this tab's.

Mutation: remove the `state = prev;` line → case 1 FAILs.

**Verify**: `node test/unit.js` → `0 failed`. Bump, PR.

## Test plan

A: six cases, four mutations. B: two booted cases, one mutation. Every
existing `migrate()`, import and two-tab case stays green unchanged.

## Done criteria

- [ ] A: `grep -n "profile.blocks = seed.blocks;" js/app.js` → no output
- [ ] A: `grep -n "Array.isArray(profile\[part.name\])" js/app.js` → one line
- [ ] B: in `adoptStored`, `migrate()` runs inside a `try` and `state = prev` restores on a throw
- [ ] `node test/unit.js` → `0 failed`; each PR bumps `CACHE_VERSION` above `origin/main`'s
- [ ] Only in-scope files changed

## STOP conditions

- An existing test fails because it relied on the old id-repair order
  (a legacy fixture whose day ids change) — report it; do not edit the
  fixture to fit.
- A.4's grep finds a write-through map where the fix is not a one-line
  own-key test or `Object.create(null)` — list it and stop at listing.
- `migrate()` turns out to write outside `state` (a module-level variable,
  the DOM) before it can throw — then restoring `prev` is not enough;
  report what it writes.

## Maintenance notes

- A future repair in `migrate()` that renames an id must never hand out
  an id another item of the same list claims: claim first, then assign.
- The reader guard means a record key `safeKey` refuses is never read. If
  one ever needs recovering, it is still in storage and in every backup.
- **Step B (PR #178, branch `claude/067-b`, shell v135): no deviations.**
  Implemented B.1 and B.2 as written. The two new booted tests landed
  inside plan 060's own top-level block in `test/unit.js` (reusing its
  `settled`/`seeded` helpers) rather than as a new sibling block, since
  the plan's own hint was to model them on plan 060's two-tab cases and
  reuse its `boot.fire(boot.ctx.window, 'storage', { key, newValue: raw })`
  pattern. Read `migrate()` and everything it calls
  (`ensureRecord`/`repairExercise`/`purgeRecord`/`cleanPlates`) to confirm
  none writes outside the `state` object graph before it can throw —
  `historyCache` is a `WeakMap` keyed by profile-object identity, so an
  entry for an object inside a discarded candidate is unreachable once
  `state = prev` runs, not a stale wrong answer — so the third STOP
  condition did not fire.
- **Step A (`claude/067-a`), deviations and findings:**
  - **Case 1's fixture names.** Profiles `a` and `b` never shared a seed:
    `a` (first place) gets hombre's and `b` (second place) mujer's. The
    case uses the two pairs that really share one: `a` with `hombre`, and
    `mujer` with `b` (added after review). Reverting A.1 fails both. One
    more assertion per pair pins decision 1: the log a blockless profile
    carried is kept and reads against the seed plan
    (`block-1/1/d0/chestpress`).
  - **Case 5** sets every `RECORD_PARTS` part to `[]`, not only `log`, and
    also checks that a set ticked through `entry()` survives
    `JSON.stringify`. The phase half compares `phaseRir` week by week with
    a `genericPhase(6, 4)` block.
  - **Case 6** puts `constructor` (which wrote onto `Object`) and a real
    lift in the slot beside `__proto__`. It checks both `Object.prototype`'s
    and `Object`'s own names for index keys, and sweeps both in a
    `finally`. The section also puts back the `state` the section before
    it left.
  - **Comment wording.** The A.1 comment avoids the literal word for the
    browser's deep-copy call. The Safari-floor scan in `test/unit.js` is
    line-based and flags it even inside a comment.
  - **Mutations beyond the four the plan names:** without the phase
    `Array.isArray`, the phase assertion fails. Reverting only the exercise
    loop fails case 3. Without only the reader guard, the reader assertion
    fails. Without only the own-key test, nothing fails, which is expected:
    the reader guard stands in front of it (defence in depth).
  - **A.4 sweep.** One map is written through by a log-derived lift id:
    `strengthByExercise`'s `out`, now fixed. Every other place reviewed is
    safe: `muscleSessions` and `strengthRows` write maps keyed by the
    muscle tag, `deloadCheck` only reads, and `pruneLog` and `foldRirMap`
    only touch the slot's own key or a row of its array. `weeksBeyondEnd`,
    `countSets` and `weekHasLog` only count. `buildCsv` reads through
    own-key tests, and the import path's maps are `Object.create(null)`.
  - **Outside A.4's pattern, not fixed here:** `buildCsv`'s `byDay` was a
    plain `{}` indexed by a slot's *day* id, so a slot keyed
    `w1-__proto__` made "Exportar CSV" throw
    (`byDay[dayId].push is not a function`). The orchestrator handed it to
    plan 068 step B, which fixed it in #182. Separately, a `__proto__` lift
    on a planned day prints `[object Object]` in the CSV's `orden` column.
    It is read-only and writes nothing.
  - **Decision 3 extended one level down, after review of #179 (the
    orchestrator's decision, 2026-09-23).** The reviewer reproduced the
    same bug under what the plan covered, and the extension landed in this
    PR:
    - `ensureRecord` replaces a block's map stored as a list with `{}` in
      every part filed by block, and one slot's in every part filed by
      lift. `log: { b1: [] }` and `log: { b1: { 'w1-d0': [] } }` still lost
      a ticked set on reload. The lists that are lists by design are left
      alone: an exercise's variants, and a slot of the session order.
      One visible difference on a damaged shape: `order: { b1: [] }`,
      which the order part's own repair used to delete, now stays as
      `{ b1: {} }`. The two read the same.
    - `migrate()` drops a day or an exercise stored as a list, like null.
      A day stored as `[]` came back with a fresh exercise id on every
      load, so its sets were orphaned each time.
    - A phase table missing a week of the block gets the generic ramp's
      entry for that week, the way `syncDraftFromForm` fills a block made
      longer. An entry that is there is never touched, including one past
      the block's length.
    - The seed-clone comment names both seeds that can be shared (the
      nit).
    - Cases 7, 8 and 9 cover the three. Each fails when its change is
      reverted: containers off, list days and exercises kept, fill off.
      Two over-broad variants fail case 7's "lists kept by design"
      assertion: repairing the order's slot lists, or the variants. A fill
      that overwrites fails case 9.
    - **Writer shapes unchanged.** Every writer builds a phase for every
      week: the seed, the import and restore, the plan editor,
      `emptyBlock`, "+ Nuevo bloque". Configurable weeks and the editor's
      fill arrived together in `b3af260`, so no older editor made a
      shorter table. A local differential probe of `origin/main`'s
      `migrate()` against this one found 3,356 writer-shaped states
      byte-identical: the seed, random ticks, notes, energy, orders and
      objetivo records, imports, new and empty blocks, editor phases,
      unit switches, restores, reloads and legacy id-less blocks.
  - **Widened from "a list" to "not a map" (the orchestrator's call on the
    finding above, 2026-09-23).** A block's or a slot's map stored as a
    string, a number or `true` took no write at all, and the log's first
    tick threw in `rowsFor`/`entry()` (`Cannot read properties of
    undefined`), so a draw of that session landed on the recovery screen.
    - `ensureRecord` now asks one test at all three levels,
      `notMap = v => !v || typeof v !== 'object' || Array.isArray(v)`.
      The block level applies it to every part filed by block, and the
      slot level to the parts keyed `'slot+exercise'` only. A falsy value
      becomes `{}` too, on purpose, so the one rule reads the same
      everywhere. The part keyed by exercise is still skipped, and so are
      the slot values of the parts keyed by slot alone: a note's or an
      energy's string, an order's list.
    - Differences on damaged shapes: `log: { b1: 'x' }` and `{ b1: null }`
      now store `{ b1: {} }`, and `order: { b1: 'x' }` stays as
      `{ b1: {} }` where the order part's repair used to delete it.
    - **The Done criteria's grep** for `Array.isArray(profile\[part.name\])`
      now finds nothing. The part level reads `notMap(profile[part.name])`,
      and `Array.isArray(v)` lives in the helper; grep for
      `notMap(profile\[part.name\])` instead.
    - **Case 10** covers a string, a number, `true` and `null` at the
      block level in every part filed by block, and at the slot level in
      every part filed by lift. Each becomes `{}`, and a tick, a note and
      an energy written into them land and survive a reload. A note's and
      an energy's string, an order's list and the variants are kept,
      before and after the reload.
    - **Mutations:** the old list-only test at the inner levels fails case
      10's scalar assertions (7) while case 7 passes. Letting the slot
      level reach the parts keyed by slot alone wipes every note and
      energy, which fails the by-design assertions of cases 7 and 10 and
      crashes a later order test. Case 7's own mutations still fail.
      `notMap` without `Array.isArray` fails cases 5 and 7 but not 10.
    - Writer shapes are still unchanged: the differential probe again
      found 2,556 writer-shaped states byte-identical.
  - **Known, not done: the leaf level.** A lift's rows stored as a
    non-list (`'x'`, `5`, `{}`, `{"0": row}`), or a row stored as `null`,
    still throws inside `entry()` when the card draws, and `migrate()`
    leaves the value as stored. Reproduced on this branch:
    - rows `'x'` → "a.push is not a function"
    - rows `5`, `{}` or `{"0": row}` → "a.slice is not a function"
    - rows `[null]` → "Cannot set properties of null (setting 'w')"

    That repair belongs to the log part itself: it is part-specific, and
    a walk over every row on every load. It is left for a later plan,
    which the orchestrator lists in `plans/README.md`'s follow-ups.
- *(Executor: record deviations here.)*
