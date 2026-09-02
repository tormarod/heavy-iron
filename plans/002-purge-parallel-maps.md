# Plan 002: Clear the parallel RIR / notes / energy / order maps when a block, day or exercise is deleted

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f9afbe0..HEAD -- js/app.js js/block-editor.js test/smoke.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f9afbe0`, 2026-09-02

## Why this matters

Alongside `profile.log`, this app keeps four parallel maps with the same
`blockId → slot → …` shape: `rir` (how the last set felt, per exercise),
`notes` (the session note), `energy` (how you felt starting), and `order` (the
order the session was actually done in).

The codebase states the invariant in its own words at `js/app.js:1405-1409`:
*"Whatever clears a session's sets clears these too."* Three deletion paths
break it:

1. `deleteBlocks` removes `profile.blocks[id]` and `profile.log[id]` but leaves
   all four maps behind — forever, with no reader.
2. `purgeExLog` removes an exercise's logged sets but leaves its RIR chips.
3. `purgeDayLog` clears notes/energy/order for the day but leaves RIR.

The maintainer already hit this class of bug once and fixed it in exactly one
place — `js/app.js:2673-2680` clears all five maps, with a comment recording
why: *"Everything the sheet promises, not just the sets: the RIR chips used to
survive this, invisibly … but still on disk after you asked for them to be
gone."* The same reasoning applies to the three paths above; they were simply
missed.

The cost is real but bounded: dead data accumulating in the one storage
backend the browser is allowed to evict when a phone fills up (see the comment
at `js/app.js:419-431` on why storage pressure matters here), and a deletion
dialog that promises more than it delivers — `js/block-editor.js:707-710`
tells the user the block "y sus N series" are gone and cannot be recovered.

## Current state

Files involved:

- `js/block-editor.js` — `deleteBlocks()` at lines 69-85
- `js/app.js` — `purgeExLog()` at 1392-1396, `purgeDayLog()` at 1398-1403,
  `purgeSessionMeta()` at 1410-1417
- `sw.js` — `CACHE_VERSION` at line 20

### The four map shapes (you need these to write correct deletes)

From `js/app.js:1096-1098` and `js/app.js:1264-1270`:

- `profile.rir[blockId][slot(w, dayId)][exId]` → a string like `'2+'`, `'1'`, `'0'`
- `profile.notes[blockId][slot(w, dayId)]` → a string
- `profile.energy[blockId][slot(w, dayId)]` → a string
- `profile.order[blockId][slot(w, dayId)]` → an array of exercise ids

`rir` is the only one keyed **by exercise underneath the slot**. The other
three are keyed by slot alone. That asymmetry is the whole reason
`purgeSessionMeta` handles three maps and not four.

`slot` is defined at `js/app.js:85`:

```js
const slot = (w, dayId) => 'w' + w + '-' + dayId;
```

`MAX_WEEKS` is the upper bound every purge loop already iterates to.

### `js/block-editor.js:69-85` exactly as it exists today

```js
  const drop = new Set(ids.filter(id => profile.blocks[id]));
  if (!drop.size) return 0;
  const keep = profile.blockOrder.filter(id => !drop.has(id));
  if (!keep.length) return 0;

  snapshotForUndo(drop.size === 1 ? 'Bloque eliminado.' : drop.size + ' bloques eliminados.');

  drop.forEach(id => { delete profile.blocks[id]; delete profile.log[id]; });
  profile.blockOrder = keep;
  if (drop.has(profile.activeBlock)) {
    profile.activeBlock = keep[keep.length - 1];
    profile.week = 1; profile.day = 0;
    stopRest();
  }
  save(); render();
  return drop.size;
}
```

### `js/app.js:1392-1417` exactly as it exists today

```js
function purgeExLog(profile, blockId, dayId, exId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) { const s = blk[slot(w, dayId)]; if (s) delete s[exId]; }
}

function purgeDayLog(profile, blockId, dayId) {
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) delete blk[slot(w, dayId)];
  purgeSessionMeta(profile, blockId, dayId);
}

/* The session-level maps are keyed by slot alone, with no exercise under
   them, so unlike `rir` they do not quietly become unreadable when the
   sets they belonged to go: a note — or an order that says you started with
   the third exercise — would still be sitting there when the day came back.
   Whatever clears a session's sets clears these too. */
function purgeSessionMeta(profile, blockId, dayId, onlyWeek) {
  [profile.notes, profile.energy, profile.order].forEach(map => {
    const blk = map && map[blockId];
    if (!blk) return;
    if (onlyWeek) { delete blk[slot(onlyWeek, dayId)]; return; }
    for (let w = 1; w <= MAX_WEEKS; w++) delete blk[slot(w, dayId)];
  });
}
```

Note the early `return` in both purge functions when `profile.log[blockId]` is
missing. **That guard is part of the bug**: a block with RIR chips but no
logged sets returns early and never cleans the RIR. Your fix must not inherit
it.

### The exemplar to match — `js/app.js:2671-2681`

This is the one path that already does it right. Match its spirit:

```js
  snapshotForUndo('Borrado todo el registro de ' + profile.label + '.');
  /* Everything the sheet promises, not just the sets: the RIR chips used
     to survive this, invisibly (nothing reads one without the sets it
     belonged to) but still on disk after you asked for them to be gone. */
  profile.log = {};
  profile.rir = {};
  profile.notes = {};
  profile.energy = {};
  profile.order = {};
```

### Repo conventions

- Comments explain *why*, in prose, often naming the failure they prevent.
  Match the register of the excerpts above.
- Spanish for user-facing strings, English for code comments.
- No build step, no modules. One shared global scope across the six
  `<script>` tags in `index.html:479-484`. `js/block-editor.js` loads *before*
  `js/app.js`, so it may call `purgeExLog` etc. at runtime (it already does,
  at `js/block-editor.js:1002-1003`) — but must not reference them at its own
  top level.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | `node --check js/app.js && node --check js/block-editor.js` | exit 0, no output |
| Install test dep | `npm install --no-save playwright@1.56.1` | exit 0 |
| Serve the site | `python3 -m http.server 8765` (leave running) | serves on 127.0.0.1:8765 |
| Run tests | `node test/smoke.js` | every line `PASS`, 0 failures |

## Scope

**In scope**:

- `js/app.js` — `purgeExLog`, `purgeDayLog`, and one new helper
- `js/block-editor.js` — `deleteBlocks` only
- `test/smoke.js` — one new assertion block
- `sw.js` — the `CACHE_VERSION` string only

**Out of scope**:

- `purgeSessionMeta` (`js/app.js:1410-1417`) — it is correct for the three
  slot-keyed maps and is called with an `onlyWeek` argument from
  `js/app.js:2659`. Do not change its signature or behaviour; call it.
- `js/app.js:2671-2681` (the "borrar todo el registro" path) — already correct.
- `migrate()` — do not add a sweeper that garbage-collects orphaned keys on
  load. That is a tempting generalisation and it is out of scope: it would run
  on every boot over every user's data, which is a much riskier change than
  fixing the three sites that create the orphans. If you think it is needed,
  say so in your report.
- The undo snapshot in `deleteBlocks` — `snapshotForUndo` at
  `js/block-editor.js:74` already captures whole-state, so undo keeps working
  unchanged.

## Git workflow

- Branch: `advisor/002-purge-parallel-maps`
- Commit message style: short imperative sentence, no prefix. Example from
  `git log`: `Let the same lift on two days share its history`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a RIR purge helper next to the others

In `js/app.js`, immediately after `purgeSessionMeta` (so the four purge
helpers sit together), add:

```js
/* `rir` is the one parallel map keyed by exercise under the slot, so it needs
   its own sweep: purgeSessionMeta cannot reach into it, and a chip left
   behind with no set under it is invisible until the day comes back and
   shows a RIR nobody recorded. */
function purgeRir(profile, blockId, dayId, exId) {
  const blk = profile.rir && profile.rir[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) {
    const k = slot(w, dayId);
    if (!blk[k]) continue;
    if (exId) delete blk[k][exId];
    else delete blk[k];
  }
}
```

Called with an `exId` it clears one exercise's chips across every week; called
without one it clears the whole day's.

**Verify**: `node --check js/app.js` → exit 0.

### Step 2: Call it from both purge paths, and drop the early return that skips it

Rewrite `purgeExLog` and `purgeDayLog` in `js/app.js` so the RIR sweep happens
**before** the `profile.log[blockId]` guard can return early:

```js
function purgeExLog(profile, blockId, dayId, exId) {
  purgeRir(profile, blockId, dayId, exId);
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) { const s = blk[slot(w, dayId)]; if (s) delete s[exId]; }
}

function purgeDayLog(profile, blockId, dayId) {
  purgeRir(profile, blockId, dayId);
  purgeSessionMeta(profile, blockId, dayId);
  const blk = profile.log[blockId];
  if (!blk) return;
  for (let w = 1; w <= MAX_WEEKS; w++) delete blk[slot(w, dayId)];
}
```

Note `purgeDayLog` now calls `purgeSessionMeta` at the top rather than the
bottom, for the same reason: a day with a session note but no logged sets used
to keep the note.

**Verify**: `node --check js/app.js` → exit 0.

### Step 3: Clear all four maps in `deleteBlocks`

In `js/block-editor.js`, replace the single `drop.forEach` line at line 76:

```js
  drop.forEach(id => { delete profile.blocks[id]; delete profile.log[id]; });
```

with:

```js
  /* The log is not the only thing filed under a block id: rir, notes, energy
     and order are four parallel maps with the same blockId key, and nothing
     reads one without the block it belonged to. Leaving them behind grows the
     log forever with data no screen can ever show — on a storage backend the
     browser may evict when the phone fills up. */
  drop.forEach(id => {
    delete profile.blocks[id];
    [profile.log, profile.rir, profile.notes, profile.energy, profile.order]
      .forEach(map => { if (map) delete map[id]; });
  });
```

**Verify**: `node --check js/block-editor.js` → exit 0.

### Step 4: Add a smoke test for the block-delete case

The block-delete path is the one with the largest orphan (four whole
sub-trees), so it gets the regression test. Add a new block to `test/smoke.js`,
modelled structurally on the existing block-manager section — find it with
`grep -n "Gestionar\|blocksSheet\|deleteBlocks" test/smoke.js` and place your
block after it, following the same `browser.newContext()` / `newPage()` /
`await ctx.close()` shape every other block in the file uses.

The test must:

1. Open the app and dismiss setup (`await dismissSetup(page)`, helper at
   `test/smoke.js:19-25`).
2. Seed a second block plus RIR/notes/energy/order entries under a known block
   id, directly via `page.evaluate` writing to `localStorage` then reloading —
   this is the pattern the migration tests already use at
   `test/smoke.js:1121-1129`.
3. Delete that block through the UI (Gestionar → select → delete), answering
   the confirm with `answerDialog(page, true)` (helper at
   `test/smoke.js:28-34`).
4. Assert all five maps no longer hold the deleted block id:

```js
    const leftovers = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const p = s.profiles[s.activeProfile];
      return ['log', 'rir', 'notes', 'energy', 'order']
        .filter(m => p[m] && Object.prototype.hasOwnProperty.call(p[m], 'block-orphan-test'));
    });
    ok('deleting a block takes its rir/notes/energy/order with it',
       leftovers.length === 0, 'still present in: ' + leftovers.join(', '));
```

Pass the third `extra` argument as shown — it names exactly which map leaked,
which is what makes a failure diagnosable.

**Verify**: `node --check test/smoke.js` → exit 0.

### Step 5: Bump `CACHE_VERSION` and run the suite

Read the current value at `sw.js:20` and increment the integer by one. Do not
assume the current value — other plans may have landed first.

```bash
python3 -m http.server 8765 &
node test/smoke.js
```

**Verify**: 0 failures, including your new assertion and every pre-existing
one. Pay attention to any assertion mentioning `Retirados`, `Borrar registro`,
or the plan editor — those exercise `purgeExLog`/`purgeDayLog`.

## Test plan

- **New**: the block-delete orphan test in Step 4. This is the regression test
  for the primary defect.
- **Must keep passing**: every existing assertion touching the plan editor's
  "Retirados" flow and the per-day "Vaciar día" flow, since Step 2 changes
  both purge functions.
- Structural pattern: any existing `{ const ctx = await browser.newContext(); … await ctx.close(); }`
  block in `test/smoke.js`.
- Verification: `node test/smoke.js` → all pass, including 1 new assertion.

## Done criteria

ALL must hold:

- [ ] `node --check js/app.js` exits 0
- [ ] `node --check js/block-editor.js` exits 0
- [ ] `node --check test/smoke.js` exits 0
- [ ] `node test/smoke.js` exits 0 with 0 failures
- [ ] `grep -n "purgeRir" js/app.js` returns 3 lines: the definition and two call sites
- [ ] `grep -n "delete profile.log\[id\]" js/block-editor.js` returns **no matches** (replaced by the loop over all five maps)
- [ ] `CACHE_VERSION` in `sw.js` is higher than at commit `f9afbe0`
- [ ] `git status` shows only `js/app.js`, `js/block-editor.js`, `test/smoke.js` and `sw.js` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `deleteBlocks` or the purge functions do not match the "Current state"
  excerpts.
- Any existing smoke assertion starts failing — particularly one about undo
  (`snapshotForUndo` runs before your deletes, so undo should still restore
  everything; if it does not, something about snapshot ordering is different
  from what this plan assumes).
- You conclude a `migrate()`-time sweeper is needed to clean up orphans that
  already exist on real devices. That may well be true — but it is a separate,
  riskier change. Report it rather than adding it here.
- `node test/smoke.js` fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this next:

- **The invariant is stated at `js/app.js:1405-1409` — keep it true.** Any
  future map added alongside `log`/`rir`/`notes`/`energy`/`order` needs a line
  in three places: `deleteBlocks`, `purgeSessionMeta` (if slot-keyed) or
  `purgeRir` (if exercise-keyed), and the "borrar todo el registro" handler at
  `js/app.js:2673-2681`. Adding a map and forgetting one of those is exactly
  how this bug happened.
- **What a reviewer should scrutinise**: that the RIR sweep in Step 2 runs
  *before* the `profile.log[blockId]` early return. That ordering is the
  non-obvious part of the fix — a block with chips but no sets is the case
  that motivated moving it.
- **Explicitly not fixed here**: orphans already sitting on real devices from
  past deletions. They are invisible and harmless apart from size; cleaning
  them needs a migration pass, deliberately deferred (see Out of scope).
