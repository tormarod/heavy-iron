# Plan 027: A set tick reuses the draw's render cache instead of re-walking the whole log; the Diagnóstico reads through the same cache

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- js/app.js js/diagnostics.js test/unit.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (a cache lifetime change; the invariance argument below must hold)
- **Depends on**: plans/026 (soft — the v3 characterization tests)
- **Category**: perf
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

Plan 008 item 14 made a single set tick redraw one card (`drawCard`)
instead of the whole session, and the comment at `js/app.js:2599-2601`
records the win: "the difference between O(exercises) and O(exercises²)
work on every tick". Peso objetivo v3 undid it by another route. `drawCard`
starts by resetting the per-draw cache; the card it rebuilds asks
`targetNow` for its objetivo; `targetNow` asks for the day's global brake;
and `brakeOn` asks *every exercise of every live day of the block* for its
history — each one a walk of every populated slot across every block of
the profile. On a cold cache that is the whole-block, whole-log walk, on
every tick. At a realistic profile (six blocks, four days, eight exercises,
~1 500 sets) that is roughly two thousand slot visits and five hundred
session builds per tick — single-digit milliseconds on a phone today, so
not user-visible, but it grows with the log rather than the plan, and the
guarantee is gone.

Every entry in that cache is invariant under a tick (see "Current state"),
so the fix is to stop resetting it in `drawCard`. Two smaller items ride
along: `diagLevelTrend` calls `exHistory` directly instead of the cached
wrapper, and `diagPoints` still parses every log key once per week (the
third audit's finding #11) while `js/chart.js` shows the one-pass shape.

## Current state

Files:

- `js/app.js` — `resetRenderCache` (2546), the cached wrappers (2556–2610),
  `drawApp` (2616), `drawCard` (3072), `brakeOn` (3999), `exHistory`
  (3701), `lastTime` (2033), `priorBlockSets` (2505).
- `js/diagnostics.js` — `diagPoints` (72–124), `diagLevelTrend` (507).
- `js/chart.js` — `collectHistoryAll` (88–110), the one-pass grouping to
  copy.
- `test/unit.js` — "render cache" section (747–777).
- `sw.js` — `CACHE_VERSION` at line 21.

The cache and its contract — `js/app.js:2540-2549`:

```js
/* Everything below is a pure function of (profile, block, week, day) and is
   asked for the same answer several times inside one render — lastTime twice
   per card, liftSlots once per card over every card. Held for the duration of
   one draw and dropped at the start of the next, so nothing can go stale:
   every path that changes the log already ends in render(). */
let renderCache = null;

function resetRenderCache() {
  renderCache = { lastTime: Object.create(null), liftSlots: Object.create(null), slug: Object.create(null),
                  priorBlock: Object.create(null), history: Object.create(null), target: Object.create(null), brake: null };
}
```

The brake goes through the cache once per draw — `js/app.js:2580-2583`
and `2588-2596`:

```js
function brakeCached(profile, block, week, now) {
  if (!renderCache) return brakeOn(profile, block, week, now);
  if (renderCache.brake == null) renderCache.brake = brakeOn(profile, block, week, now);
  return renderCache.brake;
}
…
function targetNow(profile, block, day, ex, week) {
  const now = Date.now();
  const dayId = day && day.id;
  if (!renderCache) return targetFor(profile, block, day, ex, week, now, brakeOn(profile, block, week, now));
  const k = block.id + '|' + ex.id + '|' + (dayId || '') + '|' + week;
  if (!(k in renderCache.target)) {
    renderCache.target[k] = targetFor(profile, block, day, ex, week, now, brakeCached(profile, block, week, now));
  }
  return renderCache.target[k];
}
```

`brakeOn` fans out — `js/app.js:3999-4018`:

```js
function brakeOn(profile, block, week, now) {
  let down = 0;
  const seen = Object.create(null);
  dayList(block).forEach(day => {
    exList(day).forEach(ex => {
      if (seen[ex.id]) return;
      seen[ex.id] = 1;
      const sessions = exHistoryCached(profile, block, ex, day.id, week);
      …
```

`drawApp` resets, and so does `drawCard` — `js/app.js:2616-2618` and
`3072-3084`:

```js
function drawApp() {
  resetRenderCache();
  const profile = getProfile();
```

```js
function drawCard(exId) {
  if (!ready) return;
  const i = dayCards.findIndex(c => c.ex.id === exId);
  const old = i < 0 ? null : dayCards[i].el;
  /* The card is not on screen any more: something redrew the day under this
     handler. A full draw is the right answer and costs nothing here, because
     this is not the path being made cheap. */
  if (!old || !old.parentNode) { render(); return; }
  try {
    resetRenderCache();
    const profile = getProfile();
    const block = getBlock();
```

**Why every cache entry is invariant under a tick.** A tick (or typing in a
box) writes only `profile.log[activeBlock][slot(profile.week, day.id)]`
and, through the chip, `profile.rir` for the same slot.

- `history` (`exHistory`, `js/app.js:3732`): `if (bId === block.id && w >=
  beforeWeek) return;` — the current block's current week and later are
  excluded, so the current slot never feeds it.
- `target` is a pure function of `history`, the plan, and the brake.
- `brake` is a function of `history` for every exercise.
- `lastTime` (`js/app.js:2033`) starts at `beforeWeek - 1` and walks
  backward: never the current week.
- `priorBlock` (`priorBlockSets`, `js/app.js:2505-2509`) reads strictly
  earlier blocks.
- `liftSlots` and `slug` are pure functions of the plan.

The only thing a tick changes that a card reads is the RÉCORD bar, and
`drawCard` already recomputes that on its own (`bestForExercise` at
`js/app.js:3091`). Every path that changes *which* cards exist, which week
is shown, or an earlier week's rows (plan-editor save, undo, restore,
delete, week/day navigation) goes through `render()` → `drawApp()`, which
resets. The comment at 2540–2544 already states this contract; `drawCard`
is the one caller that does not need its own reset.

The existing cache test — `test/unit.js:747-777` (excerpt):

```js
    resetRenderCache();
    const a = lastTimeCached(profile, blockId, day.id, exId, 2);
    const b = lastTimeCached(profile, blockId, day.id, exId, 2);
    const sameRef = a === b;

    resetRenderCache();
    const c = lastTimeCached(profile, blockId, day.id, exId, 2);
    return { sameRef, differentAfterReset: a !== c };
```

The uncached read in the Diagnóstico — `js/diagnostics.js:507-508`:

```js
function diagLevelTrend(profile, block, day, ex, scopeBlockId) {
  const sessions = exHistory(profile, block, ex, day && day.id, MAX_WEEKS + 1, scopeBlockId);
```

`exHistoryCached(profile, block, ex, dayId, beforeWeek, onlyBlockId)` at
`js/app.js:2571-2576` takes exactly these arguments and keys on all of
them, so the sheet's `MAX_WEEKS + 1` / `scopeBlockId` entries never
collide with the card's.

The per-week re-walk — `js/diagnostics.js:79-88`:

```js
    for (let w = 1; w <= blockWeeks(block); w++) {
      …
      if (w === deloadWeek(block)) continue;
      Object.keys(blk).forEach(k => {
        const s = parseSlot(k);
        if (!s || s.week !== w) return;
        const rows = blk[k][exId];
        if (!Array.isArray(rows)) return;
```

`W × S` key parses per exercise per block; the chart's `collectHistoryAll`
(`js/chart.js:88-110`) groups the keys by week in one pass into a `Map`
and then iterates the weeks — read it and copy the shape. Note the two
differ on purpose in what they skip (the chart keeps weeks above the
block's current length; `diagPoints` skips the deload week) — keep
`diagPoints`'s own skips.

Conventions: English why-comments; a `js/` change bumps `CACHE_VERSION`;
rungs 1–2 after each step.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js && node --check js/diagnostics.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| One smoke section (optional) | server on `:8765`, `node test/smoke.js --only "main session"` | `0 failed` |
| Bump | `bash tools/bump-cache-version.sh` | next version in `sw.js` |

## Scope

**In scope**: `js/app.js` (`drawCard` only, plus the cache comment), `js/diagnostics.js` (`diagLevelTrend`, `diagPoints`), `test/unit.js`, `sw.js` (bump only).

**Out of scope**:
- `drawApp`'s reset — it stays.
- `brakeOn`, `exHistory`, `targetFor` — no change to what they compute.
- The `brake` slot being unkeyed (recorded in `plans/README.md` as not
  planned) — do not key it here.
- `pruneLog` on every save (carried forward, not this plan).

## Git workflow

- Branch: `claude/027-tick-keeps-the-render-cache-<6 hex chars>`.
- Commits: `Let drawCard reuse the draw's render cache — a tick changes nothing it holds`, `Read the Diagnóstico's level trend through the history cache`, `Group log keys by week once in diagPoints`. Trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `drawCard` keeps the cache

In `js/app.js:3081` change `resetRenderCache();` to
`if (!renderCache) resetRenderCache();` and add a comment above it stating
the invariance in the repo's voice — that a tick writes only the current
slot, that every map in the cache excludes the current week by
construction (name `exHistory`'s `w >= beforeWeek`, `lastTime`'s
`beforeWeek - 1`, `priorBlockSets`' earlier blocks), that the RÉCORD bar
is the one exception and is recomputed below, and that resetting here
made every tick pay for `brakeOn`'s walk of the whole block. Update the
contract comment at 2540–2544 ("dropped at the start of the next [draw]")
to say "the next full draw".

**Verify**: `node --check js/app.js`. `node test/unit.js` → `0 failed`.

### Step 2: Pin it

In `test/unit.js`, after the render-cache section's assertions (after line
777), add a source-level guard and a behavioural one:

```js
ok('drawCard reuses the render cache rather than resetting it on every tick',
   /function drawCard\(exId\) \{[\s\S]{0,600}if \(!renderCache\) resetRenderCache\(\);/.test(
     fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')));
```

and a probe that counts `brakeOn` calls: stub it in the vm (`app.brakeOn =
…` counting wrapper around the original — check `call('typeof brakeOn')`
is `'function'`), then `resetRenderCache(); brakeCached(p, b, 1, now);
brakeCached(p, b, 1, now);` → one call; then `resetRenderCache();
brakeCached(…)` → two. Restore the original afterwards. (Use a profile from
`defaultState()` as the render-cache probe does.)

**Verify**: `node test/unit.js` → `0 failed`, 3 more. With Step 1 stashed,
the source-level assertion fails.

### Step 3: `diagLevelTrend` through the cache — and the sheet is its own draw

**Why this step needs a second line.** `diagLevelTrend` asks for history
with `beforeWeek = MAX_WEEKS + 1`, so its entries *include the current
week* — unlike the card's entries, which stop at `profile.week`. The
tick-invariance argument of Step 1 does not cover them: open the
Diagnóstico (its entries are cached through week N), close it, tick a set
(no reset any more), reopen — and the level trend would be read from the
pre-tick cache. So the sheet must drop the cache itself when it is built.

- `js/diagnostics.js:508`: `exHistory(` → `exHistoryCached(`. Add one
  sentence to the comment above the function: it shares the history
  entries of the sheet's own build, keyed by block, exercise, day,
  `MAX_WEEKS + 1` and the scope, so the sheet no longer re-walks the log
  once per exercise on top of what `targetNow` (two lines below in
  `diagRows`) already cached.
- `diagRows` (`js/diagnostics.js`, starts near line 645): make
  `resetRenderCache();` its first statement, with a comment: the sheet
  reads the *current* week too, which a tick changes and the card cache
  never holds, so the sheet starts from an empty cache every time it is
  built — it is a draw of its own, the way `drawApp` is. (The card cache
  is rebuilt lazily on the next tick; that is one cold `drawCard` after a
  sheet, not one per tick.)

**Verify**: syntax. `node test/unit.js` → `0 failed` (the diagnostics
sections at 779–810 and the 016 review test drive `diagRows`). Then add,
in the "diagnostics statistics" section (779), a probe that proves the
sheet sees a tick: seed a profile as the 016 test does (four sessions,
`pr.week = 5`), call `diagRows(pr, block, 'block')` and read the
exercise's `sessions` count; then append a done row to
`pr.log[blockId][slot(5, day.id)][exId]` (the current week, as a tick
would) and call `diagRows` again — the count must be one higher. Without
the reset in `diagRows` the second call reads the first call's cached
history and the count does not move (that is the assertion's job — check
it fails with the reset line removed).

### Step 4: `diagPoints` groups by week once

Rewrite the loop at `js/diagnostics.js:79-88` so `Object.keys(blk)` is
walked once, building `byWeek` (a `Map` from week number to the slot
objects of that week — mirror `js/chart.js:88-110`), then iterate `w = 1 ..
blockWeeks(block)`, skip the deload week as today, and read `byWeek.get(w)`
instead of re-filtering the keys. Everything inside the per-slot body
(`rows`, `done`, `best`, `worked`, `out.push({…})`) stays as it is, and the
output order stays week-ascending. Keep the comments; replace the one
sentence that describes the per-week filter.

**Verify**: syntax. `node test/unit.js` → `0 failed`. Add one
characterization assertion in the "diagnostics statistics" section (779):
for a seeded profile with sessions in weeks 1, 2, 4 and the deload at 3,
`diagPoints(profile, exId, blockId)` returns labels ending `S1`, `S2`, `S4`
in that order (read the `label` field, `block.name + ' · S' + w`).

### Step 5: Bump the cache version

`bash tools/bump-cache-version.sh`.

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → bumped.

## Test plan

- New unit assertions: `drawCard` source guard, `brakeCached` call count
  (2), `diagPoints` week order (1).
- Existing to keep green: "render cache" (747–777), "diagnostics
  statistics" (779), "diagVerdict" (799), the 016 review test, the
  fifteen-cases section (its harness calls `resetRenderCache()` itself
  and is unaffected).
- Optional smoke: `--only "main session"` ticks sets and reads the footer;
  `--only "objetivo de peso"` reads the target line after ticks.

## Done criteria

- [ ] `node --check` exits 0 on both `js/` files
- [ ] `grep -n "if (!renderCache) resetRenderCache();" js/app.js` prints one line inside `drawCard`, and `grep -c "resetRenderCache();" js/app.js` is one lower than at `4f7e037`
- [ ] `grep -n "exHistory(" js/diagnostics.js` prints nothing (only `exHistoryCached(`)
- [ ] `grep -n "resetRenderCache();" js/diagnostics.js` prints one line, inside `diagRows`, and the "sheet sees a tick" assertion fails when that line is removed
- [ ] `grep -n "byWeek" js/diagnostics.js` shows the one-pass grouping inside `diagPoints`
- [ ] `node test/unit.js` exits 0 with `0 failed` and ≥ 4 more assertions
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a bumped version
- [ ] `git status --short` lists only the four in-scope files
- [ ] `plans/README.md` status row for 027 updated

## STOP conditions

- `exHistory` no longer excludes `w >= beforeWeek` for the current block
  (`js/app.js:3732`) — the invariance argument fails and `drawCard` must
  keep resetting; report.
- A tick path is found that writes to a week other than `profile.week`
  (grep the tick handler and the input handlers in `buildExCard` for
  `slot(`) — same.
- `exHistoryCached`'s signature no longer matches `exHistory`'s.
- Any of T1–T15 (or 026's cases) changes result after Step 3 or 4 — those
  steps must be behaviour-neutral.

## Maintenance notes

- The cache now lives from one full draw to the next, with `drawCard`
  reading it in between. Anyone adding a per-card value to `renderCache`
  must ask "can a tick change this?" — if yes, it does not belong in the
  cache, or `drawCard` must evict that key.
- The `brake` slot is still a single value valid for the drawn block and
  week (recorded in the index); keying it is a two-line change if a caller
  ever asks about another block.
- `diagLevelTrend`'s entries are keyed with `MAX_WEEKS + 1`, so they are
  distinct from the card's `profile.week` entries — and they include the
  current week, which is why `diagRows` resets the cache before it reads.
  Any other reader that asks `exHistoryCached` for a `beforeWeek` above
  `profile.week` outside a full draw needs the same reset first. The
  review (`js/review.js:122`) goes through `diagRows` and inherits it.
- Reviewer: measure once on a device if you can — `performance.now()`
  around `drawCard` on a seeded 1 500-set profile — and put the before and
  after numbers in the PR. The audit's estimate is a slot-count derivation.
