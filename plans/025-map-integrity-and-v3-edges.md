# Plan 025: The `obj` and `variants` maps survive every purge, move and import like the maps beside them, and two v3 rule edges stop producing numbers no stack has

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- js/app.js js/block-editor.js js/profile-transfer.js test/unit.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Plans 021 and 026 edit nearby
> code; if they landed first, some excerpts have moved a few lines — that
> is fine — and Step E may already be done.

## Status

- **Priority**: P1
- **Effort**: M (eight small steps, each S)
- **Risk**: LOW (Steps A–F), MED (Step G — a considered exception to "the rule does not round")
- **Depends on**: plans/026 (soft: the characterization tests should be in place before Step G and H change what the rule returns); plans/021 (soft: Step E is a no-op if 021 landed)
- **Category**: bug
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

Peso objetivo v3 added two per-profile maps. `obj` has the same
`blockId → slot → exerciseId` shape as `log` and `rir`; `variants` is keyed
by exercise id alone. Every helper that walks the older maps was written
before they existed, and two of them were not extended: deleting an
exercise's history leaves its `obj` records behind, and "enviar a otra
sesión" moves the log, the chips and the order but files the target record
under the day the lift no longer trains — so the next session writes a
*second* record. A profile import re-keys every exercise id in `log`,
`rir`, `order` and `obj` through the same id map but not in `variants`, so
a renamed id leaves its rename history attached to the wrong lift. Two id
fallbacks (`slugify(name)`) skip `safeKey`, so an exercise named
"Constructor" gets an id every prototype-less map handles but `recordVariant`
silently refuses. The week-1 hint band and the rule disagree on what a
deload week is. And `installBlockData` lists `'obj'` as something a block
share could carry, which nothing produces (decision: it never will — the
receiving phone recomputes the objetivo from the log it is sent).

Two edges in the rule itself: a set logged in the other unit is converted
per row (correct) and then becomes a ladder rung — `45,36 kg` — that the
tick adopts into the log, where it becomes a real rung next week; and when
the rule cannot bring a set into the rep range within three rungs it prints
reps below the range with no explanation, while the mirror-image case ("the
next rung up does not fit") has a note.

## Current state

Files (all at `4f7e037`):

- `js/app.js` — `installBlockData` (line 128), `migrate()`'s exercise-id
  repair (423), `purgeExLog`/`purgeRir` (1911–1948), `moveExKeyed` and
  the `moveEx*` wrappers (1965–2017), `priorBlockSets` (2505),
  `exSession` (3562), `loadLadder`/`nextLoad`/`prevLoad` (3754–3764),
  `targetFor`'s down-walk (3966–3979), `targetNotes` (4031),
  `normalizeImportedObj` (4752).
- `js/block-editor.js` — `normalizeImportedBlock`'s id fallback (263), the
  `moveEx*` trio on save (1129–1131).
- `js/profile-transfer.js` — `normalizeImportedProfile`: the per-block loop
  (99–177), the `variants` block (218–229).
- `test/unit.js` — sections to extend: "moveExLog / moveExRir / moveExOrder
  merge rather than overwrite" (1332), "priorBlockSets…" (2435),
  "objetivo: los quince casos de la v3" (811, with the `targetProbe`
  harness at 826–873), "__proto__ / constructor / prototype ids are never
  trusted as keys" (1196).
- `sw.js` — `CACHE_VERSION` at line 21.

### A. `purgeExLog` skips `obj` — `js/app.js:1911-1948`

```js
function purgeExLog(profile, blockId, dayId, exId) {
  purgeRir(profile, blockId, dayId, exId);
  forEachSlot(profile.log, blockId, (k, w, d, s) => { if (s) delete s[exId]; }, { dayId: dayId });
}

function purgeDayLog(profile, blockId, dayId) {
  …
}

/* `rir` is the one parallel map keyed by exercise under the slot, so it needs
   its own sweep: purgeSessionMeta cannot reach into it, and a chip left
   behind with no set under it is invisible until the day comes back and
   shows a RIR nobody recorded. */
function purgeRir(profile, blockId, dayId, exId) {
  const blk = profile.rir && profile.rir[blockId];
  if (!blk) return;
  forEachSlot(profile.rir, blockId, (k, w, d, s) => {
    if (!s) return;
    if (exId) delete s[exId];
    else delete blk[k];
  }, { dayId: dayId });
}
```

The comment is now false: `obj` is the second map keyed by exercise under
the slot. `purgeDayLog` and `purgeSessionMeta` (1928, the slot-level list
`[profile.notes, profile.energy, profile.order, profile.obj]`) already cover
`obj` at slot level; only the per-exercise sweep is missing.

### B. No `moveExObj` — `js/app.js:1965-1989` and `js/block-editor.js:1126-1133`

```js
function moveExKeyed(map, blockId, fromDayId, toDayId, exId) {
  const blk = map[blockId];
  if (!blk) return;
  forEachSlot(map, blockId, (fromKey, w, d, from) => {
    if (!from || from[exId] === undefined) return;
    const toKey = slot(w, toDayId);
    if (!blk[toKey]) blk[toKey] = {};
    const dest = blk[toKey];
    if (Array.isArray(from[exId])) {
      dest[exId] = dest[exId] ? dest[exId].concat(from[exId]) : from[exId];
    } else if (dest[exId] === undefined) {
      dest[exId] = from[exId];
    }
    delete from[exId];
    if (!Object.keys(from).length) delete blk[fromKey];
  }, { dayId: fromDayId });
}

function moveExLog(profile, blockId, fromDayId, toDayId, exId) {
  moveExKeyed(profile.log, blockId, fromDayId, toDayId, exId);
}

function moveExRir(profile, blockId, fromDayId, toDayId, exId) {
  moveExKeyed(profile.rir, blockId, fromDayId, toDayId, exId);
}
```

```js
      day.ex.forEach(ex => {
        const from = peDraftOriginalDay.get(ex);
        if (from && from !== day.id) {
          moveExLog(profile, peDraftBlock.id, from, day.id, ex.id);
          moveExRir(profile, peDraftBlock.id, from, day.id, ex.id);
          moveExOrder(profile, peDraftBlock.id, from, day.id, ex.id);
        }
      });
```

`moveExKeyed` is map-generic; an `obj` record is a plain object, so the
non-array branch ("keep the destination's if it has one") is the right
merge.

### C. `variants` is not re-keyed on import — `js/profile-transfer.js:212-230`

```js
  /* Variants are keyed by exercise id and not by block, so the re-keying
     above does not reach them: an id the whole file never mentions is
     harmless (nothing asks for it) but a malformed date is not — it would
     cut a history at a moment nobody can name. Anything that is not a
     plain YYYY-MM-DD is dropped, which leaves the exercise reading as one
     unbroken variant: the reading it had before v3. */
  if (p.variants && typeof p.variants === 'object' && !Array.isArray(p.variants)) {
    const vars = {};
    Object.keys(p.variants).slice(0, IMPORT_LIMITS.days * IMPORT_LIMITS.ex).forEach(rawExId => {
      const exId = safeKey(rawExId);
      const list = p.variants[rawExId];
      if (!exId || !Array.isArray(list)) return;
      const clean = list.filter(v => v && typeof v === 'object' && VARIANT_SINCE_RE.test(String(v.since)))
        .map(v => ({ n: txt(v.n, IMPORT_LIMITS.exName) || '', since: String(v.since) }))
        .slice(-VARIANT_LIMIT);
      if (clean.length) vars[exId] = clean;
    });
    p.variants = vars;
  } else {
    p.variants = {};
  }
```

Inside the per-block loop above it (lines 99–177), each block's raw and
normalized forms are both in hand (`raw`, `normalized`), and the four
slot-keyed maps are re-keyed through `importIdMaps(raw, normalized)`
(`js/app.js`, near line 4650), which returns `{ dayMap, exMap }` with
`exMap[normalizedDayId][rawExId] = normalizedExId`, built on
prototype-less objects.

### D. The `slugify(name)` id fallback bypasses `safeKey`

`js/block-editor.js:263`:

```js
      const baseId = safeKey(txt(e.id, 60)) || (slugify(n) || ('ex-' + di + '-' + ei));
```

`js/app.js:423` (inside `migrate()`):

```js
          if (!id2 || usedEx.has(id2)) { id2 = slugify(ex.n) || ('ex-' + i + '-' + j); while (usedEx.has(id2)) id2 = uid('ex'); }
```

`slugify` (`js/app.js:2224`) lowercases and strips to `[a-z0-9-]`, so a
name like "Constructor" slugs to `constructor`, which `safeKey`
(`js/app.js:2265`) refuses everywhere else. Consequence at HEAD: no crash
(every per-exercise map is prototype-less or uses own-property writes),
but `recordVariant` and the import's `variants` block both `safeKey` the
id and silently drop it, so that exercise can never carry a rename cut.

### E. `conf` validated by a truthy lookup — `js/app.js:4778-4779`

```js
      kept[exId] = { v: 3, at: clampInt(rec.at, 0, Number.MAX_SAFE_INTEGER, 0),
                     conf: TARGET_CONF_LABEL[rec.conf] ? rec.conf : 'baja', sets: sets };
```

**Plan 021 replaces this with a `TARGET_CONF_OPTIONS.indexOf` test.** If
`grep -n "TARGET_CONF_OPTIONS" js/app.js` finds it, skip Step E.

### F. Two definitions of "deload week" — `js/app.js:2514-2516` vs `3734`

`priorBlockSets`:

```js
    const dl = deloadWeek(prev);
    for (let w = blockWeeks(prev); w >= 1; w--) {
      if (w === dl) continue;
```

`exHistory` (`js/app.js:3734`) uses `if (deloadAt(bk, w)) return;`, and
`deloadAt` (`js/app.js:3533`) is the field *or* a phase text matching
`/descarga/i`. A previous block whose deload was written into the phase
text by hand shows its ~60 % weights in the week-1 hint band while the rule
correctly ignores them.

### G. Converted rows become ladder rungs — `js/app.js:3562-3585` and `3754-3764`

```js
function exSession(profile, blockId, week, dayId, exId, lo, hi) {
  …
  const work = rows.filter(r => r && r.done && rowWeight(r) > 0 && num(r.r) > 0);
  …
    sets: work.map(r => {
      const w = rowWeight(r), n = num(r.r);
      return { w: w, r: n, e: capOf(w, n, rho),
               cens: n >= hi || raw === '2+' || raw == null || n > CENSOR_REPS };
    }),
```

```js
function loadLadder(sessions) {
  const seen = [];
  sessions.forEach(s => s.sets.forEach(x => { if (!seen.some(v => sameLoad(v, x.w))) seen.push(x.w); }));
  return seen.sort((a, b) => a - b);
}
function nextLoad(ladder, w, inc) {
  const up = ladder.filter(v => v > w + WEIGHT_EPS && v <= w + 1.5 * inc + WEIGHT_EPS);
  return up.length ? up[0] : w + inc;
}
```

`rowWeight(r)` converts an `lb`-stamped row into the active unit
(`rowUnit(r)` is `'lb'` or `'kg'`; `units()` is the active one). A profile
with one block logged in lb behind one in kg yields a ladder
`[45, 45.359237]`; `nextLoad` returns `45.359237`; the card shows
`↗ objetivo: 45,36×10`; the tick adopts that placeholder into the log
(`js/app.js:2951`), and it is a genuine rung from then on. The comment at
`js/app.js:4057-4060` says the rule deliberately does not round — this
step is a considered exception: a converted number was never a rung on
*this* stack. The capacity (`e`) stays converted; only the ladder ignores
those rows. The existing case T5 (`test/unit.js:920-929`) pins that a
1 kg micro-plate rung must survive, which a tolerance-based dedupe would
threaten — this design does not touch tolerances.

### H. The down-walk gives up silently — `js/app.js:3966-3979`

```js
      r = Math.min(r, hi);
      /* Coming down needs the model AND that floor to agree the bottom of
         the range is out of reach — three rungs at most, because past that
         something other than the weight is wrong. */
      for (let s = 0; r < lo && s < 3; s++) {
        const down = prevLoad(ladder, W, inc);
        if (!(down > 0)) break;
        W = down;
        r = Math.min(hi, repsAt(W, base * (1 + g), rirWeek));
        move = '↓';
      }
    }
    prevW = W;
    t.sets.push({ w: round2(W), r: Math.max(1, r), move: move });
```

Two sessions of `100 × 4/3/3` and `100 × 4/3/2` on a `10–15` range print
`↘ objetivo: 97×4 · 94×4 · 91×4` under a card header that says
`3 × 10–15`, with `notes = ['moreRir']` at most. The mirror case has a
note: `js/app.js:3957` pushes `'step'` when the next rung *up* does not
fit, and `targetNotes` (`js/app.js:4031-4043`) renders it:

```js
  const txts = {
    vuelta: 'Vuelta de parón: repite la última sesión.',
    hold: 'La última sesión bajó: hoy no sube la carga. Si vuelve a bajar, el nivel se ajusta.',
    confirmed: 'Dos sesiones seguidas por debajo: el objetivo baja contigo.',
    step: 'El siguiente escalón (' + loadText(t.step) + u + ') no cabe en el rango: micro-carga, medio escalón o más tempo.',
    moreRir: 'Esta semana pide más RIR: las reps pueden bajar y no es retroceso.',
  };
  return ['vuelta', 'hold', 'confirmed', 'step', 'moreRir']
    .filter(k => t.notes.indexOf(k) >= 0).map(k => txts[k]);
```

### I. The dead `'obj'` entry — `js/app.js:128-137`

```js
function installBlockData(profile, blockId, data) {
  const id = safeKey(blockId);
  if (!id) return false;
  const d = data || {};
  ['log', 'rir', 'order', 'notes', 'energy', 'obj'].forEach(name => {
    if (!d[name]) return;
    if (!profile[name]) profile[name] = {};
    profile[name][id] = d[name];
  });
  return true;
}
```

Its only caller (`js/block-editor.js:380`, `installImportedBlock`) passes
`{ log, rir, order }`; the QR "plan + registro" payload
(`js/qr-transfer.js:436-437`) carries `log`, `rir`, `order`. **Decision
(2026-09-19): `obj` does not travel with a block share.** Remove the entry.

### Not in this plan: hold semantics

The guide and the `levelOf` comment say one declining session "holds every
weight where it is"; the code lets a set that fell under the range still
come down a rung on a hold day (`js/app.js:3933` gates only the up-branch
on `hold`). **Decision (2026-09-19): the docs change, not the code** — plan
029 rewords the guide and the comment. Do not touch the down-walk's `hold`
handling here.

Conventions: Spanish UI text, English why-comments naming the bug; ids and
tags through `safeKey`; every `js/` change needs a `CACHE_VERSION` bump;
rungs 1–2 after each step, no full smoke run. The `targetProbe` harness
(`test/unit.js:826-873`) builds a one-exercise profile from
`[{ sets: [[w, r], …], rir, day }]` sessions and returns `{ kind, conf,
dir, notes, show, line, says, phi }`; `call(src)` evaluates inside the vm.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `for f in js/app.js js/block-editor.js js/profile-transfer.js; do node --check $f; done` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| Bump | `bash tools/bump-cache-version.sh` | next version in `sw.js` |

## Scope

**In scope**: `js/app.js`, `js/block-editor.js`, `js/profile-transfer.js`, `test/unit.js`, `sw.js` (bump only).

**Out of scope**:
- `targetFor`'s `hold` handling (decision above), `theilSen`, `levelOf`,
  the trend — plan 026 tests them, nothing here changes them.
- `js/qr-transfer.js` — the share payload stays as it is.
- `recordTarget`/`recordTargetOnStart` — plan 021.
- `docs/guide.md`, `AGENTS.md` — plan 029.

## Git workflow

- Branch: `claude/025-map-integrity-and-v3-edges-<6 hex chars>`.
- One commit per step, imperative subjects (`Purge and move the obj record with the log and the chips`, `Re-key variants through the import id map`, …), trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step A: `purgeExLog` sweeps `obj`

In `js/app.js`, add directly after `purgeRir`:

```js
/* The same sweep for the objetivo record: it is the other map keyed by
   exercise under the slot, and a record left behind after "borrar
   registro" outlives the sets it described — and, if the id is ever reused
   on that day, blocks the real record (recordTarget writes once). */
function purgeObj(profile, blockId, dayId, exId) {
  const blk = profile.obj && profile.obj[blockId];
  if (!blk) return;
  forEachSlot(profile.obj, blockId, (k, w, d, s) => {
    if (!s) return;
    if (exId) delete s[exId];
    else delete blk[k];
  }, { dayId: dayId });
}
```

Call it from `purgeExLog` right after `purgeRir(...)`. Rewrite the stale
sentence in the comment above `purgeRir` ("`rir` is the one parallel map
keyed by exercise under the slot") to say `rir` and `obj` are the two.
Check whether any other caller of `purgeRir` should also purge `obj`
(`grep -n "purgeRir(" js/*.js`) — at `4f7e037` `purgeExLog` is the only one
besides its definition; if there are more, add `purgeObj` beside each.

**Verify**: `node --check js/app.js`. In `test/unit.js`, after the
"moveExLog / moveExRir / moveExOrder…" section (1332–1373), add:

```js
ok('purgeExLog drops the objetivo record with the rows and the chip', call(`
  (function () {
    const p = { log: { B: { 'w2-D': { E: [{ w: '40', r: '10', done: true }] } } },
                rir: { B: { 'w2-D': { E: '1' } } }, obj: { B: { 'w2-D': { E: { v: 3, sets: [] } } } } };
    purgeExLog(p, 'B', 'D', 'E');
    return !p.log.B['w2-D'] || p.log.B['w2-D'].E === undefined ? (p.obj.B['w2-D'] === undefined || p.obj.B['w2-D'].E === undefined) : false;
  })()
`) === true);
```

`node test/unit.js` → `0 failed`.

### Step B: `moveExObj`

Add next to `moveExRir`:

```js
function moveExObj(profile, blockId, fromDayId, toDayId, exId) {
  moveExKeyed(profile.obj, blockId, fromDayId, toDayId, exId);
}
```

Extend the comment above `moveExKeyed` (it names "the log, the RIR chips
(moveExRir) and the session order (moveExOrder)") to include the objetivo
record (`moveExObj`), and say the non-array branch is what a record wants:
a destination that already has its own record keeps it.

In `js/block-editor.js:1129-1131` add `moveExObj(profile, peDraftBlock.id,
from, day.id, ex.id);` after `moveExRir`.

**Verify**: syntax on both files. Add to the same unit section a probe
modelled on the existing move assertions (read 1332–1373 for the shape):
a profile with `obj.B['w2-D'].E` set, `moveExObj(p, 'B', 'D', 'D2', 'E')`,
assert the record is now at `obj.B['w2-D2'].E` and gone from `w2-D`; and
that with a record already at the destination, the destination's is kept.
`node test/unit.js` → `0 failed`.

### Step C: re-key `variants` on profile import

In `js/profile-transfer.js`, before the per-block loop (before line 99's
`rawIds.forEach`), declare `const exIdMap = new Map();` with a comment:
raw exercise id → the id it ended up with, unioned across every block,
because `variants` is keyed by exercise id alone. Inside the loop, right
after `blocks[id] = normalized;` (line 131), add:

```js
    const ids = importIdMaps(raw, normalized).exMap;
    Object.keys(ids).forEach(dayId => Object.keys(ids[dayId]).forEach(rawEx => {
      if (!exIdMap.has(rawEx)) exIdMap.set(rawEx, ids[dayId][rawEx]);
    }));
```

(`importIdMaps` is in `js/app.js`; `profile-transfer.js` already reads
other `app.js` symbols.) Then in the `variants` block change
`const exId = safeKey(rawExId);` to
`const exId = exIdMap.get(rawExId) || safeKey(rawExId);` and extend the
comment: an id the importer renamed (a duplicate, or a blocked key) follows
its exercise, exactly as the log, chips, order and record do; an id the file
never mentions is kept as before.

**Verify**: syntax. In `test/unit.js`, in the "normalizeImportedProfile:
the app can read back everything it writes (plans/010)" section (431) or
next to the `variants` round-trip at 1148–1150, add a probe: a profile
whose block has two exercises with the same stated id `'dup'` on one day,
and `variants: { dup: [{ n: 'a', since: '1970-01-01' }, { n: 'b', since:
'2026-01-01' }] }`; after `normalizeImportedProfile`, the first exercise
keeps `dup` and the second was renamed (read `p.blocks[…].days[0].ex[1].id`);
assert `p.variants.dup` exists and `p.variants[renamedId]` does not — i.e.
the variant followed the exercise that kept the id. Then a second probe
where the *first* exercise's id is a blocked key (`'constructor'`) and the
variant is keyed `'constructor'`: assert the variant lands under the id
that exercise received. `node test/unit.js` → `0 failed`.

### Step D: `safeKey` on both slug fallbacks

- `js/block-editor.js:263` → `const baseId = safeKey(txt(e.id, 60)) || safeKey(slugify(n)) || ('ex-' + di + '-' + ei);`
- `js/app.js:423` → `id2 = safeKey(slugify(ex.n)) || ('ex-' + i + '-' + j);`

One sentence of comment at each: a name can slug to a reserved word.

**Verify**: syntax. In the "__proto__ / constructor / prototype ids are
never trusted as keys" section (1196), add: `normalizeImportedBlock({ name:
'B', days: [{ name: 'D', ex: [{ n: 'Constructor', reps: '10-15', sets: 3
}] }] })` → the exercise id is `'ex-0-0'`, not `'constructor'`; and a
`migrate()` probe with `state` seeded so an exercise has no id and name
`'Prototype'` → id `'ex-0-0'`. `node test/unit.js` → `0 failed`.

### Step E: `conf` whitelist (skip if plan 021 landed)

If `grep -n "TARGET_CONF_OPTIONS" js/app.js` is empty: add `const
TARGET_CONF_OPTIONS = ['baja', 'media', 'alta'];` next to
`TARGET_CONF_LABEL` (4045) and change the kept record's `conf` to
`TARGET_CONF_OPTIONS.indexOf(rec.conf) >= 0 ? rec.conf : 'baja'`. Add a
unit case in the same section as Step D: an `obj` record with `conf:
'constructor'` restores as `'baja'`.

**Verify**: `node test/unit.js` → `0 failed`.

### Step F: `priorBlockSets` uses `deloadAt`

`js/app.js:2514-2516`: delete `const dl = deloadWeek(prev);` and change
`if (w === dl) continue;` to `if (deloadAt(prev, w)) continue;`. One
sentence: the same definition the rule uses, so the band and the objetivo
cannot disagree about which week was the deload.

**Verify**: In the "priorBlockSets…" section (2435+), model on "a previous
block whose only logged week is the deload is not used": a previous block
with `deload: 0` and `phase[8] = { r: 'Descarga' }`, logged on week 8 and
week 7; assert the hint comes from week 7. `node test/unit.js` → `0 failed`.

### Step G: converted rows are not rungs

In `exSession`, add a `conv` flag to each set:

```js
      return { w: w, r: n, e: capOf(w, n, rho), conv: rowUnit(r) !== units(),
               cens: … };
```

In `loadLadder`, skip them:

```js
  sessions.forEach(s => s.sets.forEach(x => { if (!x.conv && !seen.some(v => sameLoad(v, x.w))) seen.push(x.w); }));
```

Comment above `loadLadder`: a row logged in the other unit is converted for
the capacity it proves, but the number it converts to was never a pin on
this stack; without this a kg profile with one lb block behind it gets a
rung at 45,36 and the tick writes it into the log for good. If every session
is converted (a permanent unit switch), the ladder is empty and the step
falls back to `w ± inc`, which is the documented fallback.

**Verify**: syntax. Unit: (1) `call` `exSession` on a hand-built profile
with `state.prefs.units = 'kg'` and a row `{ w: '100', r: '10', done: true,
u: 'lb' }` → the set has `conv === true` and `w` ≈ 45.36; a row without `u`
→ `conv === false`. (2) `loadLadder([{ sets: [{ w: 45.359237, conv: true },
{ w: 45, conv: false }] }])` → `[45]`. (3) An end-to-end through
`targetProbe` needs an `lb` row: extend the harness's row builder to accept
a third element (`[w, r, 'lb']` → `u: 'lb'`; plan 026 adds the same
extension — reuse it if it is there) and add a case labelled **G1** (not
T16 — plan 026 owns T16–T18): three sessions, the first `[[100, 10, 'lb'],
…]`, the rest at 45 kg topping the range → the target's weights are all on
the kg ladder or `45 + inc`, and `show` contains no `45,36`. Run T5
(micro-plate) unchanged → still passes.

**Known limit of this step — do not improvise past it.** It fixes the
case where the converted rows are *behind* the kg ones. When the *last*
session is the converted one (the unit was switched last week), `targetFor`
still starts each set from `last.sets[k].w` (`js/app.js:3960`), which is
the converted number, so the first kg target reads `45,36×10` once and the
tick can adopt it. Rounding that to a rung is a design decision the
maintainer has not made; leave it, and say so in the PR. It is recorded in
`plans/README.md`.
`node test/unit.js` → `0 failed`.

### Step H: a note when the floor is not reached

After the down-walk loop (after the `for (let s = 0; r < lo && s < 3; s++)
{…}` block), add:

```js
      if (r < lo && notes.indexOf('floor') < 0) notes.push('floor');
```

In `targetNotes`, add the key to `txts` and to the ordered list, after
`step`:

```js
    floor: 'Ni tres escalones abajo entran las reps del rango: el peso sigue alto — baja más de lo que propone la línea, o revisa el rango.',
```

The displayed reps stay as computed (they are honest); the note says why
they sit under the range.

**Verify**: syntax. Unit, in the fifteen-cases section, a case labelled
**H1**: two sessions `[[100, 4], [100, 3], [100, 3]]` and `[[100, 4],
[100, 3], [100, 2]]`, both with `rir: '1'`, and `{ range: '10–15', inc: 3,
sets: 3, rirWeek: 1 }` → `t.notes` includes `'floor'`, `t.says` includes
`'escalones'`, and `t.dir === 'down'`. (Plan 026's three-rung-cap case
uses the same sessions and asserts the weights; if it landed first, extend
that case rather than duplicating it, and flip its "no `'floor'`" clause.)
And a case that comes down one rung *into* the range (T12/T13 already do)
has no `'floor'` note — assert on the existing `t` from T13. `node test/unit.js`
→ `0 failed`.

### Step I: remove the dead entry

`js/app.js:133`: `['log', 'rir', 'order', 'notes', 'energy']`. Add to the
comment above `installBlockData`: `obj` is deliberately absent — the
record of what the rule asked for travels only with a whole profile
(`normalizeImportedProfile`), never with a block share; the receiving
phone recomputes the objetivo from the log it is sent, and a record it did
not show is not its record to hold.

**Verify**: `grep -n "'obj'" js/app.js` → no hit inside `installBlockData`.
`node test/unit.js` → `0 failed` (the section "commit() is both halves, and
installBlockData refuses a bad id" at 2212 does not pass `obj`; confirm with
`grep -n "installBlockData" test/unit.js`).

### Step J: bump the cache version

`bash tools/bump-cache-version.sh`.

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → above v68 (or above
whatever the last landed plan set).

## Test plan

- New unit assertions: A (1), B (2), C (2), D (2), E (1, unless 021 did
  it), F (1), G (3–4), H (2). Pattern for each is named in its step.
- Existing to keep green: the whole fifteen-cases section (T5 especially),
  "moveExLog / moveExRir / moveExOrder…", "priorBlockSets…", "__proto__ /
  constructor / prototype…", "normalizeImportedProfile: the app can read
  back everything it writes".
- Smoke: none required; if the executor has the environment, `node
  test/smoke.js --only "objetivo de peso"` is the section most likely to
  notice G/H.

## Done criteria

- [ ] `node --check` exits 0 on `js/app.js`, `js/block-editor.js`, `js/profile-transfer.js`
- [ ] `grep -n "^function purgeObj\|^function moveExObj" js/app.js` prints two lines; `grep -c "moveExObj(" js/block-editor.js` prints `1`
- [ ] `grep -n "exIdMap" js/profile-transfer.js` shows the declaration, the fill and the `variants` lookup
- [ ] `grep -n "safeKey(slugify(" js/block-editor.js js/app.js` prints two lines
- [ ] `grep -n "TARGET_CONF_LABEL\[rec.conf\]" js/app.js` prints nothing
- [ ] `grep -n "deloadAt(prev, w)" js/app.js` prints one line and `grep -n "const dl = deloadWeek(prev)" js/app.js` prints nothing
- [ ] `grep -n "conv:" js/app.js` shows the `exSession` set and `grep -n "!x.conv" js/app.js` shows `loadLadder`
- [ ] `grep -n "floor:" js/app.js` shows the `targetNotes` entry and `grep -n "notes.push('floor')" js/app.js` one line
- [ ] `grep -n "'obj'\]" js/app.js` prints nothing (the `installBlockData` list has five entries)
- [ ] `node test/unit.js` exits 0 with `0 failed` and ≥ 14 assertions more than at `4f7e037`
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a bumped version
- [ ] `git status --short` lists only the five in-scope files
- [ ] `plans/README.md` status row for 025 updated

## STOP conditions

- Any "Current state" excerpt has a different shape at the cited location
  (a few lines of drift from plans 021/026 is expected; a rewritten
  function is not).
- `moveExKeyed`'s non-array branch no longer keeps the destination's value
  — then `moveExObj` would overwrite a genuine record; report.
- `importIdMaps` is not callable from `js/profile-transfer.js` with
  `(raw, normalized)` (signature changed).
- Step G makes T5 or any of T1–T15 fail — the ladder change reached
  something it should not have; report the failing case rather than
  loosening it.
- Step H's H1 does not produce `dir === 'down'` at `4f7e037` with the
  sessions given — the probe shapes are from a verified reproduction; if
  they no longer reproduce, the rule changed underneath.

## Maintenance notes

- Every helper that enumerates the per-exercise maps now names `rir` and
  `obj` together (`purgeExLog`, the `moveEx*` quartet). A seventh
  per-exercise map would need the same three additions; `variants` is the
  exception (keyed by exercise id alone, no slot) and is handled by the
  import's `exIdMap` and by `migrate()`'s own sanitizer.
- `conv` is a per-set flag that only `loadLadder` reads. If a future reader
  of `exSession` wants "the weight as logged" it should read `rowWeight(r,
  rowUnit(r))` at the row, not un-convert `x.w`.
- Step G does not cover a unit switch *last week*: the target then starts
  from the last session's converted weight (`js/app.js:3960`) and shows
  `45,36` once. If that turns out to matter, the decision is whether the
  first kg target snaps to `nextLoad`/`prevLoad` of the kg ladder — a
  rounding the rule otherwise refuses — and it belongs to the maintainer.
- The `'floor'` note fires at most once per target; if the target text
  ever grows a per-set note channel, this is the first candidate to move
  there.
- Reviewer: check Step C's `exIdMap` is filled *inside* the block loop
  (after `normalized` exists) and read *after* it (in the `variants`
  block) — the order matters.
