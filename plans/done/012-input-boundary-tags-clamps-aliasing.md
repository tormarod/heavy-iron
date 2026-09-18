# Plan 012: Freeform tags, plan-editor numbers and the setup import cannot crash, hang or alias the app

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6def9fc..HEAD -- js/app.js js/block-editor.js js/diagnostics.js test/unit.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug + security (input boundary)
- **Planned at**: commit `6def9fc`, 2026-09-18

## Why this matters

Three small defects share one boundary — text and numbers that arrive from
an import, a paste, or the plan editor and are used as object keys, loop
counts or shared references. Each was reproduced in the Node harness:

1. **A muscle/pattern/type tag of `__proto__` blanks Diagnóstico and the
   block review.** Exercise ids were protected against this in plans/008
   item 2 via `safeKey`; the freeform tags feed the identical
   `if (!byTag[tag]) byTag[tag] = []; byTag[tag].push(...)` pattern in
   `js/diagnostics.js` and were not covered. For `__proto__` the guard reads
   the inherited `Object.prototype` (truthy), the init is skipped, and
   `.push` throws — after the sheet's host was already cleared, so the user
   sees an empty screen. The tag is typeable in the plan editor's free-text
   "Músculo" box as well as importable.
2. **The plan editor's Series / Descanso / "+1 serie desde" boxes are
   unclamped in the draft.** `migrate()` clamps sets to 12 and rest to 900
   only on the *next load*; typing 5000 into Series and saving makes
   `buildExCard` build 5000 set rows and `entry()` pad 5000 row objects —
   a same-device hang until a forced reload. Same class as the plate-bound
   hang fixed in plans/008 item 6.
3. **Importing a plan at first-run setup gives both profiles one shared
   `days` object.** `blockFromNormalized` assigns `days`/`phase` by
   reference and the setup handler calls it once per profile with the same
   normalized object, so editing a machine setting inline on one profile
   edits the other's plan until the first reload breaks the aliasing.

## Current state

- `js/app.js:1263` — `const muscleTag = ex => txt(ex.muscle, MUSCLE_LIMIT) || UNCLASSIFIED_LABEL;`
- `js/app.js:1293-1294`:
```js
const patternTag = ex => txt(ex.pattern, PATTERN_LIMIT) || txt(ex.type, TYPE_LIMIT) || UNCLASSIFIED_LABEL;
const typeTag = ex => txt(ex.type, TYPE_LIMIT) || UNCLASSIFIED_LABEL;
```
- `js/app.js:1283-1290` — `cleanPriority(list)` builds the priority list with `txt(v, MUSCLE_LIMIT)` only.
- `js/app.js:2072-2075`:
```js
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
function safeKey(id) {
  return UNSAFE_KEYS.indexOf(id) >= 0 ? '' : id;
}
```
- `js/app.js:340-342` — `migrate()` stores tags with `txt(...)` only.
- `js/block-editor.js:276-278` — `normalizeImportedBlock` accepts tags with `txt(...)` only.
- `js/diagnostics.js:194-195` and `:399-401` — the two crashing sites:
```js
    const tag = muscleOf[exId];
    if (!byMuscle[tag]) byMuscle[tag] = [];
    byMuscle[tag].push(byEx[exId]);
```
  (`muscleOfBlock` in `js/diagnostics.js` builds `muscleOf` from `muscleTag(ex)`.)
- `js/app.js:3495` and `:3586` — `volumeTotals` / `volumeByWeek` do
  `totals[t] = 0` on a plain `{}`; no throw, but the tag silently vanishes.
- `js/block-editor.js:779-784` — the inputs: `<input type="number" min="1" class="f-sets">`,
  `<input type="number" min="0" step="5" class="f-rest">`,
  `<input type="number" min="1" max="8" class="f-add">` (note `max="8"`
  while `MAX_WEEKS` is 16).
- `js/block-editor.js:809-815` — the handlers:
```js
  row.querySelector('.f-sets').oninput = e => ex.sets = parseInt(e.target.value, 10) || 1;
  ...
  row.querySelector('.f-rest').oninput = e => ex.rest = parseInt(e.target.value, 10) || 0;
  row.querySelector('.f-add').value = ex.add || '';
  row.querySelector('.f-add').oninput = e => { const v = parseInt(e.target.value, 10); if (v) ex.add = v; else delete ex.add; };
```
  Two lines below, `.f-inc` already uses `clampNum(...)` — the pattern to follow.
- `js/block-editor.js:899-928` — `syncDraftFromForm()` is the save gate; it
  clamps `weeks`/`deload` and checks names/reps, but not `sets`/`rest`/`add`.
- `js/block-editor.js:311-321`:
```js
function blockFromNormalized(normalized) {
  const block = {
    id: 'block-' + Date.now(),
    name: normalized.name, createdAt: new Date().toISOString(),
    weeks: normalized.weeks, deload: normalized.deload,
    days: normalized.days, phase: normalized.phase,
  };
```
- `js/app.js:1035-1047` — the setup import branch calls
  `blockFromNormalized(importedNormalized)` inside `profileKeys().forEach(...)`.
- `js/data.js:140-142` — `freshBlock` deep-clones with
  `JSON.parse(JSON.stringify(days))`: the precedent.
- Harness facts: `setsFor(ex, week, block)` (`js/app.js:1305`) returns
  `ex.sets` plus the `add` rule; callable via `call('setsFor({sets: 5000}, 1, null)')`.
  `syncDraftFromForm` reads `$('peBlockName').value` etc., which the inert
  DOM stub returns as `''`, so it is callable once `peDraftBlock` is set.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `for f in js/*.js sw.js test/*.js; do node --check "$f"; done` | exit 0 |
| Unit | `node test/unit.js` | `N passed, 0 failed` (177 at `6def9fc`) |
| Smoke section | `BASE=http://127.0.0.1:8765 node test/smoke.js --only "<substring>"` | `0 failed` |

## Scope

**In scope**: `js/app.js` (tag helpers, `cleanPriority`, `migrate()` tag lines),
`js/block-editor.js` (tag lines in `normalizeImportedBlock`, the three
`oninput` handlers, `syncDraftFromForm`, `f-add` max, `blockFromNormalized`),
`test/unit.js`, `sw.js` (bump).

**Out of scope**: `js/diagnostics.js` and the volume code — once the tag
helpers refuse unsafe keys, every consumer inherits the fix; do not add
per-site guards. `safeKey`/`UNSAFE_KEYS` themselves. `importIdMaps`
(plan 010 owns it). Any input other than the three named numeric boxes.

## Git workflow

- Branch: `claude/012-input-boundary-tags-clamps-aliasing`
- One imperative sentence per commit. No push/PR unless instructed.

## Steps

### Step 1: Failing tests

Add to `test/unit.js`, before the final `console.log('\n== requestWakeLock…` block,
a section `== input boundary: unsafe tags, editor clamps, setup aliasing (plans/012) ==`:

1. Build a profile from `defaultState().profiles.hombre`, set
   `block.days[0].ex[0].muscle = '__proto__'`, log one done set for it in
   week 1, and call `strengthRows(profile, block)` and
   `freqRows(profile, block, 1)` inside a `try`. Assert neither throws.
   Also assert `muscleTag({ muscle: '__proto__' }) === UNCLASSIFIED_LABEL`
   and `cleanPriority(['__proto__', 'Pecho'])` deep-equals `['Pecho']`.
2. Set `peDraftBlock` to a deep copy of the default block with
   `days[0].ex[0].sets = 5000`, `rest = 99999`, `add = 40`, call
   `syncDraftFromForm()`, and assert `sets === 12`, `rest === 900`,
   `add <= peDraftBlock.weeks`.
3. `const n = normalizeImportedBlock(<the ejemplo block from blocks/ejemplo-plantilla.json>)`
   then `const a = blockFromNormalized(n), b = blockFromNormalized(n);`
   assert `a.days !== b.days`, `a.phase !== b.phase`, and that setting
   `a.days[0].ex[0].setup = 'x'` leaves `b.days[0].ex[0].setup` undefined.

**Verify**: `node test/unit.js` → the three new groups FAIL, nothing else does.

### Step 2: Tags refuse unsafe keys at the source

In `js/app.js`:
```js
/* safeKey on a freeform tag, not just on an exercise id: every tag is a
   plain-object key somewhere downstream (byMuscle[tag] in diagnostics,
   totals[t] in the volume dashboard), and a tag of "__proto__" reads the
   inherited Object.prototype as "already there" and then throws on .push —
   an empty Diagnóstico with no message (plans/012). Typeable in the
   editor's Músculo box, so this is not only an import problem. */
const muscleTag = ex => safeKey(txt(ex.muscle, MUSCLE_LIMIT)) || UNCLASSIFIED_LABEL;
```
and the same `safeKey(...)` wrap for both `txt` calls in `patternTag`, for
`typeTag`, and for `const t = txt(v, MUSCLE_LIMIT)` in `cleanPriority`
(`const t = safeKey(txt(v, MUSCLE_LIMIT));`).

In `migrate()` (`js/app.js:340-342`) and `normalizeImportedBlock`
(`js/block-editor.js:276-278`), wrap each `txt(e.muscle|pattern|type, …)`
in `safeKey(...)` so stored data is clean too (an empty result already
means "absent" on both sites).

Note `safeKey` is defined at `js/app.js:2073`, after these `const`
arrow functions — that is fine, they are only *called* at render time.

**Verify**: `node test/unit.js` → group 1 passes.

### Step 3: Clamp the three editor boxes, twice

In `js/block-editor.js:809-815`, following the `.f-inc` pattern:
```js
  row.querySelector('.f-sets').oninput = e => ex.sets = clampInt(e.target.value, 1, 12, 3);
  ...
  row.querySelector('.f-rest').oninput = e => ex.rest = clampInt(e.target.value, 0, 900, 90);
  ...
  row.querySelector('.f-add').oninput = e => { const v = clampInt(e.target.value, 1, MAX_WEEKS, 0); if (v) ex.add = v; else delete ex.add; };
```
Change the markup: `.f-sets` gets `max="12"`, `.f-rest` gets `max="900"`,
`.f-add` gets `max="' + MAX_WEEKS + '"` instead of `max="8"`.

In `syncDraftFromForm`, inside the `for (const e of ex)` loop after the
reps check, add the same three clamps (this is the save gate; the
`oninput` clamps are the UX):
```js
      e.sets = clampInt(e.sets, 1, 12, 3);
      e.rest = clampInt(e.rest, 0, 900, 90);
      if (e.add != null) { const a = clampInt(e.add, 1, peDraftBlock.weeks, 0); if (a) e.add = a; else delete e.add; }
```
with a comment: `migrate()` clamps these on the next load, but the
session draws from the draft as saved, and 5000 sets is 5000 rows.

Values `1..12`, `0..900` are the ones `migrate()` uses at `js/app.js:338-339`.

**Verify**: `node test/unit.js` → group 2 passes.

### Step 4: Deep-clone in `blockFromNormalized`

```js
    days: JSON.parse(JSON.stringify(normalized.days)),
    phase: JSON.parse(JSON.stringify(normalized.phase)),
```
with a comment: the setup handler installs the same normalized plan on both
profiles, and by-reference `days` made an inline machine-setting edit on
one person's card write into the other's plan until the next reload
(plans/012); `freshBlock` in `js/data.js` already clones for the same reason.

**Verify**: `node test/unit.js` → all groups pass; `0 failed`.

### Step 5: Bump and spot-check

`sw.js` `CACHE_VERSION` → next value. Then
`BASE=http://127.0.0.1:8765 node test/smoke.js --only "diagn"` and
`--only "plan editor"` (use `grep -n "await section('" test/smoke.js` for
exact names).

**Verify**: `0 failed` in each.

## Done criteria

- [ ] syntax check exits 0; `node test/unit.js` → `0 failed`, N ≥ 183
- [ ] `grep -c "safeKey(txt(" js/app.js` → ≥ 5; `grep -c "safeKey(txt(" js/block-editor.js` → 3
- [ ] `grep -n 'max="8"' js/block-editor.js` → 0 matches
- [ ] `grep -n "parseInt(e.target.value, 10)" js/block-editor.js` → 0 matches on the sets/rest/add lines
- [ ] `grep -n "JSON.parse(JSON.stringify(normalized.days))" js/block-editor.js` → 1 match
- [ ] `sw.js` bumped; `git status` shows only in-scope files

## STOP conditions

- `muscleTag`/`patternTag`/`typeTag` are not simple arrow functions at the
  cited lines (someone restructured the tag layer).
- Group 1 does not fail before Step 2 (the crash is already gone).
- `syncDraftFromForm` is no longer the single save gate (grep `peSave` and
  the export button handler both call it at `6def9fc`).
- Any existing test in `== normalizeImportedBlock ==` fails after Step 2.

## Maintenance notes

- Rule for reviewers: any new freeform string that becomes an object key
  goes through `safeKey` at the helper that produces it, not at each
  consumer. `VOLUME_DIMENSIONS` (`js/app.js:1300`) is the list of such
  helpers.
- If the plan editor gains another numeric box, clamp it in both the
  `oninput` handler and `syncDraftFromForm`, with the same bounds
  `migrate()` uses.
- `importIdMaps` had the same `__proto__` hazard for raw *day/exercise ids*
  (inert: rows were misfiled, nothing threw). Settled without a `safeKey`:
  plan 010's rewrite builds both maps with `Object.create(null)`, which has
  no chain to inherit from, so any string is just a key.
- `safeKey`/`UNSAFE_KEYS` were left out of scope here, and the three-name
  deny-list turned out to be the same bug one name over: `toString`,
  `valueOf` and the other eight inherited names are equally typeable in the
  Músculo box and threw out of `strengthRows` exactly as `__proto__` did.
  Closed as a follow-up to this plan rather than as a plan of its own —
  `safeKey` now asks the prototype chain instead of naming keys, and
  `UNSAFE_KEYS` holds only `prototype`, which `in` cannot see. See the
  `== safeKey refuses every inherited Object.prototype name ==` section in
  `test/unit.js`.
