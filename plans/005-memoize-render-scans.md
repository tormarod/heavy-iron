# Plan 005: Stop re-walking the whole training log several times per render

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f9afbe0..HEAD -- js/app.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f9afbe0`, 2026-09-02

## Why this matters

Ticking a set — the single most frequent interaction in the app, done between
sets with a phone in one hand — ends in `save(); render();`
(`js/app.js:2392`), which rebuilds the whole session list. That rebuild does
substantially more work than it needs to:

- **`lastTime` is computed twice per exercise card, with identical arguments.**
  `js/app.js:2207` calls it directly, then `js/app.js:2223` calls
  `targetEstimate`, whose first line (`js/app.js:2750`) calls `lastTime` again
  with the same five arguments.
- **`liftSlots` runs per card and is O(days × exercises)**, so the render is
  O(exercises²). Each comparison goes through `sameLift` → `slugify`, and
  `slugify` does a Unicode `normalize('NFD')` plus three regex passes. For the
  default 3-day × 7-exercise block that is a few hundred `slugify` calls per
  render; a block at the import ceiling (14 days × 40 exercises) reaches tens
  of thousands.
- **`bestByExercise` walks every block, every slot, every exercise, every row**
  of the entire profile log, once per render (`js/app.js:2179`).

None of it changes between two renders of the same session except for the one
row just toggled. This plan removes the duplicated work without changing a
single rendered pixel — it is memoization at existing function boundaries, so
there is no behavioural risk to reason about, which is exactly what makes it a
good change to make before the larger rendering rework (see Maintenance notes).

## Current state

All in `js/app.js`. `drawApp()` begins at line 2138.

**The per-render full-log scan**, `js/app.js:2100-2122`:

```js
function bestByExercise(profile, skipBlockId, skipSlot) {
  const best = {};
  Object.keys(profile.log).forEach(bId => {
    const blk = profile.log[bId];
    if (!blk) return;
    Object.keys(blk).forEach(k => {
      if (bId === skipBlockId && k === skipSlot) return;
      const s = blk[k];
      if (!s) return;
      Object.keys(s).forEach(exId => {
        const rows = s[exId];
        if (!Array.isArray(rows)) return;
        rows.forEach(r => {
          if (!r || !r.done) return;
          const w = num(r.w);
          if (isNaN(w)) return;
          if (!(exId in best) || w > best[exId]) best[exId] = w;
        });
      });
    });
  });
  return best;
}
```

Called once per render at `js/app.js:2179`:

```js
  const best = bestByExercise(profile, block.id, slot(profile.week, day.id));
```

**The duplicated `lastTime`**. In the card loop, `js/app.js:2207`:

```js
    const prev = lastTime(profile, block.id, day.id, ex.id, profile.week);
```

then `js/app.js:2223`:

```js
    const est = targetEstimate(profile, block, day, ex, profile.week);
```

and `targetEstimate`'s own first line, `js/app.js:2750`:

```js
function targetEstimate(profile, block, day, ex, week) {
  const prev = lastTime(profile, block.id, day.id, ex.id, week);
  if (!prev) return null;
```

`lastTime` itself, `js/app.js:1450-1459`:

```js
function lastTime(profile, blockId, dayId, exId, beforeWeek) {
  for (let w = beforeWeek - 1; w >= 1; w--) {
    const s = profile.log[blockId] && profile.log[blockId][slot(w, dayId)];
    if (s && s[exId]) {
      const done = s[exId].filter(x => x.done && x.w !== '');
      if (done.length) return { week: w, sets: done };
    }
  }
  return null;
}
```

**The O(exercises²) scan**, `js/app.js:1493-1501`:

```js
function liftSlots(block, ex) {
  const out = [];
  (block.days || []).forEach((day, i) => {
    (day.ex || []).forEach(e => {
      if (sameLift(e, ex)) out.push({ dayId: day.id, dayIdx: i, exId: e.id });
    });
  });
  return out;
}
```

reached per card via `js/app.js:2213`:

```js
    const other = lastTimeOtherDay(profile, block, day, ex, profile.week);
```

and `lastTimeOtherDay`'s first line, `js/app.js:1523-1524`:

```js
function lastTimeOtherDay(profile, block, day, ex, week) {
  const slots = liftSlots(block, ex).filter(s => s.dayId !== day.id);
```

with `sameLift` and `slugify` at `js/app.js:1483-1488` and `js/app.js:2023-2026`:

```js
function sameLift(a, b) {
  if (!a || !b) return false;
  if (a.id && a.id === b.id) return true;
  const an = slugify(a.n), bn = slugify(b.n);
  return !!an && an === bn;
}
```

```js
function slugify(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}
```

### Repo conventions

- Comments explain *why*, in prose, naming the cost or bug involved.
- No build step, no modules; one shared global scope.
- Existing module-local caches in this codebase use a plain `let` at file
  scope with an explicit reset — `reviewCache` in `js/review.js:193` is the
  closest precedent. Follow that shape rather than inventing a cache class.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | `node --check js/app.js` | exit 0, no output |
| Unit tests (if 003 landed) | `node test/unit.js` | 0 failures |
| Install test dep | `npm install --no-save playwright@1.56.1` | exit 0 |
| Serve the site | `python3 -m http.server 8765` (leave running) | serves on 127.0.0.1:8765 |
| Smoke tests | `node test/smoke.js` | 0 failures |

## Scope

**In scope**:

- `js/app.js` — a render-scoped cache and the four call sites that use it
- `sw.js` — `CACHE_VERSION` only

**Out of scope**:

- **Any change to what is rendered.** This plan must be pixel-identical. If
  you find yourself changing markup, you have gone too far.
- Splitting `drawApp()` into structural and incremental update paths. That is
  the larger change this one clears the ground for; it is deliberately **not**
  in this plan because it carries real behavioural risk (the header aggregates
  — tonnage, PR badges, progress bar, the day-complete nag at
  `js/app.js:2388-2391` — must stay in sync) and belongs in its own review.
- `test/smoke.js` — no new assertions needed; the existing suite is the
  regression check. Adding a timing assertion would be flaky.
- The `tick()` function (`js/app.js:1570-1595`). It was checked and is already
  clean — it touches two elements and does no list work. Leave it.

## Git workflow

- Branch: `advisor/005-memoize-render-scans`
- Commit message style: short imperative sentence, no prefix.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a render-scoped cache, cleared at the top of every render

In `js/app.js`, just above `function drawApp()` (line 2138), add:

```js
/* Everything below is a pure function of (profile, block, week, day) and is
   asked for the same answer several times inside one render — lastTime twice
   per card, liftSlots once per card over every card. Held for the duration of
   one draw and dropped at the start of the next, so nothing can go stale:
   every path that changes the log already ends in render(). */
let renderCache = null;

function resetRenderCache() { renderCache = { lastTime: {}, liftSlots: {}, slug: {} }; }
```

Then call `resetRenderCache()` as the **first statement** of `drawApp()`.

The lifetime rule is what keeps this safe: the cache never outlives a single
`drawApp()` call, and every mutation path in the app already calls `render()`.
There is no invalidation to get wrong.

**Verify**: `node --check js/app.js` → exit 0.

### Step 2: Memoize `lastTime`

Do **not** change `lastTime` itself — other callers (`js/app.js:2362`
`priorWeight`, and `js/diagnostics.js`) rely on it and some run outside a
render. Add a cached wrapper next to `resetRenderCache`:

```js
/* Same five arguments, same answer — and the card loop asks twice: once
   directly for the previous-week band, once inside targetEstimate. */
function lastTimeCached(profile, blockId, dayId, exId, beforeWeek) {
  if (!renderCache) return lastTime(profile, blockId, dayId, exId, beforeWeek);
  const k = blockId + '|' + dayId + '|' + exId + '|' + beforeWeek;
  if (!(k in renderCache.lastTime)) {
    renderCache.lastTime[k] = lastTime(profile, blockId, dayId, exId, beforeWeek);
  }
  return renderCache.lastTime[k];
}
```

The `if (!renderCache)` guard makes it safe to call from anywhere, including
before the first render.

Now use it in the two hot call sites:

- `js/app.js:2207` — `const prev = lastTimeCached(profile, block.id, day.id, ex.id, profile.week);`
- `js/app.js:2750`, inside `targetEstimate` — `const prev = lastTimeCached(profile, block.id, day.id, ex.id, week);`

That single change removes one full week-walk per exercise card.

**Verify**: `node --check js/app.js` → exit 0, and
`grep -n "lastTimeCached" js/app.js` shows the definition plus at least two
call sites.

### Step 3: Memoize `liftSlots` and `slugify`

`liftSlots(block, ex)` depends only on the block and the exercise, so key it on
`block.id` plus `ex.id`. Add:

```js
/* O(days × exercises) per call, and the card loop calls it once per card —
   so this is the difference between O(exercises) and O(exercises²) work on
   every tick. */
function liftSlotsCached(block, ex) {
  if (!renderCache) return liftSlots(block, ex);
  const k = block.id + '|' + ex.id;
  if (!(k in renderCache.liftSlots)) renderCache.liftSlots[k] = liftSlots(block, ex);
  return renderCache.liftSlots[k];
}
```

Use it at `js/app.js:1524`, inside `lastTimeOtherDay`.

Then memoize `slugify`, which `sameLift` calls on both operands of every
comparison. Because `slugify` is a pure string→string function, its cache can
be keyed on the input directly:

```js
function slugifyCached(s) {
  if (!renderCache) return slugify(s);
  const k = String(s == null ? '' : s);
  if (!(k in renderCache.slug)) renderCache.slug[k] = slugify(k);
  return renderCache.slug[k];
}
```

Use it in `sameLift` (`js/app.js:1486`) in place of both `slugify` calls.

**Be careful with the `in` check on the slug cache**: keys come from
user-supplied exercise names, so a name like `constructor` or `__proto__`
would find an inherited property on a plain object literal. Guard it — either
create the cache with `Object.create(null)` in `resetRenderCache`, or use
`Object.prototype.hasOwnProperty.call(...)`. **Use `Object.create(null)` for
all three caches**; it is the smaller change and removes the hazard for every
key at once. Note this codebase already uses
`Object.prototype.hasOwnProperty.call` defensively at `js/app.js:1107`, so
either idiom is in keeping — but do not use a bare `in` on a `{}` literal.

**Verify**: `node --check js/app.js` → exit 0.

### Step 4: Hoist `bestByExercise` out of nothing — confirm it is already once per render

`bestByExercise` is called exactly once per render (`js/app.js:2179`), so
there is no duplication to remove. **Do not add a cache for it**, and do not
try to make it incremental — that would need invalidation on every log write,
which is precisely the complexity this plan avoids.

Confirm the situation rather than changing it:

**Verify**: `grep -n "bestByExercise(" js/app.js` → exactly two lines (the
definition at ~2100 and the single call at ~2179). If there are more call
sites, report it — the plan's assumption was wrong.

### Step 5: Bump `CACHE_VERSION` and verify nothing changed

Read `sw.js:20` and increment the integer by one.

```bash
python3 -m http.server 8765 &
node test/smoke.js
```

**Verify**: 0 failures. The existing suite is the regression check here — it
asserts rendered values throughout (previous-week bands, targets, PR badges,
the same-lift-on-two-days band), which is exactly what would break if a cache
key were wrong.

Pay particular attention to any assertion mentioning:

- the previous-week greyed numbers (`lastTime`)
- `Sem.` bands and the other-day band (`lastTimeOtherDay` / `liftSlots`)
- the **RÉCORD** badge (`bestByExercise`)
- the same lift on two days

### Step 6: Sanity-check the win

Confirm the duplication is actually gone. With the server running, open the
app in a browser, log a few sets, and in DevTools count calls — or, more
simply, add a temporary counter and check it, then remove it.

A quick way that needs no browser, **if plan 003 has landed**: in
`test/unit.js`, call `resetRenderCache()`, then call `lastTimeCached` twice
with the same arguments and assert the second call returns the identical
object reference (`===`), proving it was cached rather than recomputed.

**Verify**: either the counter shows one `lastTime` call per card where there
were two, or the `===` assertion passes.

## Test plan

- **No new smoke assertions.** This plan must not change behaviour, so the
  existing 439 assertions in `test/smoke.js` are the test: they pass
  unchanged, or the change is wrong.
- **If plan 003 has landed**, add unit assertions that:
  - `lastTimeCached` returns the same object reference on a second identical
    call after one `resetRenderCache()`;
  - it returns a *different* reference after a `resetRenderCache()` in between;
  - `slugifyCached('constructor')` returns the slug of the string, not an
    inherited property (the prototype-pollution guard from Step 3);
  - `slugifyCached` agrees with `slugify` for a sample of names including
    accented Spanish text (e.g. `'Press militar'`, `'Extensión de tríceps'`).
- Verification: `node test/smoke.js` → 0 failures; `node test/unit.js` → 0
  failures if it exists.

## Done criteria

ALL must hold:

- [ ] `node --check js/app.js` exits 0
- [ ] `node test/smoke.js` exits 0 with 0 failures
- [ ] `node test/unit.js` exits 0 with 0 failures, **if that file exists**
- [ ] `grep -n "resetRenderCache()" js/app.js` shows it called as the first statement of `drawApp()`
- [ ] `grep -n "Object.create(null)" js/app.js` shows the caches created without a prototype
- [ ] `grep -n "lastTime(profile, block.id, day.id, ex.id" js/app.js` returns **no** direct calls left in `drawApp` or `targetEstimate` (both now go through `lastTimeCached`)
- [ ] `CACHE_VERSION` in `sw.js` is higher than at commit `f9afbe0`
- [ ] `git status` shows only `js/app.js`, `sw.js`, and optionally `test/unit.js` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any existing smoke assertion fails. A failure means a cache key is missing a
  dimension the function actually depends on — that is a correctness bug, not
  a test to adjust. Find the missing key component; do not weaken the test.
- The cited functions do not match the "Current state" excerpts.
- `grep -n "bestByExercise(" js/app.js` shows more than two lines (Step 4).
- You conclude the cache needs to survive across renders to be worthwhile. It
  must not — a cross-render cache needs invalidation on every write, which is
  a different and much riskier change. Report the idea rather than building it.
- You find yourself modifying `lastTime`, `liftSlots`, `slugify` or
  `bestByExercise` themselves. The wrappers exist so the originals stay
  untouched for their non-render callers, including `js/diagnostics.js`.

## Maintenance notes

For whoever owns this next:

- **The safety property is the cache's lifetime, not its keys.** It is created
  at the top of `drawApp()` and dropped at the top of the next one, and every
  path that mutates the log ends in `render()`. If someone ever introduces a
  mutation that does *not* re-render, or holds the cache across renders, that
  invariant breaks and stale data reaches the screen. Any change to
  `resetRenderCache`'s call site deserves a careful read.
- **Non-render callers must keep using the uncached originals.**
  `js/diagnostics.js` calls `lastTime` outside any render; the
  `if (!renderCache)` guards make that correct today, and they are load-bearing.
- **What a reviewer should scrutinise**: every cache key, against the full
  argument list of the function it wraps. `lastTimeCached` keys on four of its
  five arguments — `profile` is deliberately omitted because a render is
  always for one profile. If per-profile rendering is ever added, that key
  must gain a profile component.
- **What this clears the ground for**: the bigger win is not rebuilding the
  entire list on every tick (`js/app.js:2177` does `list.innerHTML = ''`), and
  deleting the two focus workarounds that exist only because of it — the
  `data-drop-focus` marker at `js/app.js:2450` and the `focus()` +
  `setSelectionRange` restore at `js/app.js:2320-2321`. That change is
  behaviourally risky and needs its own plan; this one makes it cheaper by
  removing the redundant scans first.
