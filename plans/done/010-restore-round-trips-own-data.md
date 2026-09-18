# Plan 010: A backup or profile file the app itself wrote always restores, exactly as it was

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6def9fc..HEAD -- js/block-editor.js js/profile-transfer.js js/app.js js/qr-transfer.js test/unit.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug (data loss)
- **Planned at**: commit `6def9fc`, 2026-09-18

## Why this matters

The app stores a training log in `localStorage` with no server and no sync.
Its only safety net is the backup file ("Descargar copia"), the per-person
profile file ("Exportar"), and the QR "perfil" transfer. All three are
re-read by one function, `normalizeImportedProfile`, which since the last
audit (plans/008 item 4) runs every block through `normalizeImportedBlock`
— a validator written for *foreign* pasted JSON, whose policy is "reject
loudly, and output only the fields a plan needs". Applied to the app's own
data, that policy has three consequences, each reproduced in the Node
harness while writing this plan:

1. **A profile with one unnamed exercise cannot be restored by any route.**
   The empty starting plan (`emptyBlock()`) ships exactly one such exercise,
   and `migrate()` inserts another whenever a day has lost all its exercises.
   The user finds out on the day the backup is needed: "Esa copia no se
   puede usar: … Falta el nombre de un ejercicio".
2. **Restoring resurrects every retired day and exercise.** The `off` flag
   ("Retirar", the non-destructive way to drop an exercise while keeping its
   history) is not in the validator's output, so a restored plan silently
   differs from the one the user was following.
3. **A block with the same exercise id on two days loses one day's history
   on restore.** The validator renames the second occurrence (`chestpress`
   → `chestpress-2`), but the id map that re-keys the log is
   first-occurrence-wins and not day-aware, so day B's rows are filed under
   `chestpress` at day B's slot, where no exercise reads them any more.
   Session order (`profile.order`) is never re-keyed at all on this path.

The rule this plan restores is the one plan 004 wrote down: **never reject
or alter data the app itself wrote.** Foreign pasted blocks keep the strict
treatment.

## Current state

Files and their roles:

- `js/block-editor.js` — `normalizeImportedBlock(raw)` at line 218, the
  strict validator; `newExercise()` at 561 (`n: ''`); `blockFromNormalized`
  at 311.
- `js/profile-transfer.js` — `normalizeImportedProfile(p)` at line 76; it is
  called by `restoreFromText` (backup, ~line 250) and `loadProfileFromText`
  (profile file, line 296); the QR "perfil" path calls `loadProfileFromText`
  too (`js/qr-transfer.js:522`).
- `js/app.js` — `importIdMaps` (line 4045), `normalizeImportedLog` (4064),
  `normalizeImportedRir` (4104), `normalizeImportedOrder` (4127);
  `emptyBlock()` at 1083; `migrate()`'s exercise repair at 314 and 336;
  `dayList`/`exList` at 112-113 (`.filter(d => !d.off)`).
- `test/unit.js` — the headless harness. `== normalizeImportedProfile ==`
  section at line 236 is the pattern to extend.

Excerpts (as of `6def9fc`):

`js/block-editor.js:238-245` — the throw and the block-wide id dedupe:
```js
      const n = txt(e.n, IMPORT_LIMITS.exName);
      if (!n) throw new Error('Falta el nombre de un ejercicio en "' + dayName + '".');
      const reps = txt(e.reps, IMPORT_LIMITS.reps);
      if (!reps) throw new Error('Falta el rango de repeticiones en "' + n + '".');
      const baseId = safeKey(txt(e.id, 60)) || (slugify(n) || ('ex-' + di + '-' + ei));
      let uniqueId = baseId, suffix = 2;
      while (usedIds.has(uniqueId)) uniqueId = baseId + '-' + (suffix++);
      usedIds.add(uniqueId);
```
`usedIds` is declared once per block at line 229 (`const usedIds = new Set();`).

`js/block-editor.js:246-250` and `:288` — the output shapes; note no `off`:
```js
      const out = {
        id: uniqueId, n, reps,
        sets: clampInt(e.sets, 1, 12, 3),
        rest: clampInt(e.rest, 0, 900, 90),
      };
      ...
    const out = { id: dayId, name: dayName, ex };
```

`js/block-editor.js:561-563`:
```js
function newExercise() {
  return { id: uid('ex'), n: '', alt: '', cue: '', sets: 3, reps: '10–15', rest: 90, share: 0, ss: 0 };
}
```

`js/app.js:1083-1094` — `emptyBlock()` puts one `newExercise()` in day `d0`.

`js/app.js:333-337` — `migrate()` deliberately dedupes ids **within a day
only**, and `test/unit.js` asserts "the same id on two different days
survives, by design":
```js
        const usedEx = new Set();
        day.ex.forEach((ex, j) => {
          let id2 = safeKey(ex.id);
          if (!id2 || usedEx.has(id2)) { id2 = slugify(ex.n) || ('ex-' + i + '-' + j); while (usedEx.has(id2)) id2 = uid('ex'); }
```

`js/app.js:4045-4062` — `importIdMaps`, first-occurrence-wins, one flat
`exMap` for the whole block:
```js
function importIdMaps(rawBlock, normalized) {
  const dayMap = {}, exMap = {};
  const put = (map, from, to) => { if (from != null && !(String(from) in map)) map[String(from)] = to; };
  (rawBlock.days || []).forEach((rd, di) => {
    const nd = normalized.days[di];
    if (!nd || !rd) return;
    put(dayMap, rd.id, nd.id);
    put(dayMap, nd.id, nd.id);
    (Array.isArray(rd.ex) ? rd.ex : []).forEach((re, ei) => {
      const ne = nd.ex[ei];
      if (!ne || !re) return;
      put(exMap, re.id, ne.id);
      put(exMap, ne.id, ne.id);
    });
  });
  return { dayMap, exMap };
}
```
`normalizeImportedLog` (4064) resolves `dayId = dayMap[m[2]]` from the slot
key `w<week>-<dayId>` and then `exId = exMap[rawExId]` — so it *knows* the
day at the point it looks up the exercise, which is what makes a day-aware
map a local change.

`js/profile-transfer.js:99-137` — inside `normalizeImportedProfile`, per
block: `normalized = normalizeImportedBlock(raw)`, then
`p.log[bk] = normalizeImportedLog(rawLog, raw, normalized)` and
`p.rir[bk] = normalizeImportedRir(rawRir, raw, normalized)`. **There is no
`normalizeImportedOrder` call** — `p.order[bk]` is passed through by the
generic re-key loop at 174-183 with its exercise ids untouched.

`js/app.js:3881-3898` — `blockSharePlan` strips retired items **on purpose**
for the QR/paste share format, with a comment saying so. That path must
keep doing that; this plan does not touch it.

Conventions to match:
- Comments explain *why*, in prose, often naming the bug they prevent. See
  the comment above `ownGet` in `js/profile-transfer.js:56-70` for the
  house style.
- User-visible strings are Spanish; code comments are English.
- Tests: pure logic goes in `test/unit.js` using `call('<expr>')` against
  the shared vm context and `ok(name, cond, extra)`. Model new cases on the
  `roundTrip` block at `test/unit.js:242-262`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/block-editor.js && node --check js/profile-transfer.js && node --check js/app.js` | exit 0, no output |
| Unit tests | `node test/unit.js` | last line `N passed, 0 failed` (177 at `6def9fc`; N grows with your new cases) |
| One smoke section | `BASE=http://127.0.0.1:8765 node test/smoke.js --only "<substring>"` | `… passed, 0 failed` |
| Smoke prerequisites (once) | `npm install --no-save playwright@1.56.1 && npx playwright install chromium` then `python3 -m http.server 8765 &` | server answers on :8765 |

Do **not** run the full `node test/smoke.js` or `tools/smoke-gate.sh`
yourself; the PR hook runs it once. Section names: `grep -n "await section('" test/smoke.js`
(`--list` is currently broken by an unrelated bug, see plan 014).

## Scope

**In scope** (the only files you should modify):
- `js/block-editor.js` — `normalizeImportedBlock` gains an `opts` parameter
- `js/profile-transfer.js` — `normalizeImportedProfile` passes `{ own: true }` and re-keys `order`
- `js/app.js` — `importIdMaps` becomes day-aware; `normalizeImportedLog/Rir/Order` read it
- `test/unit.js` — new assertions
- `sw.js` — `CACHE_VERSION` bump only

**Out of scope** (do NOT touch, even though they look related):
- `blockSharePlan`, `blockShareLog`, `blockShareRir`, `blockShareOrder`
  (`js/app.js` ~3881-3990) — the share format drops retired items on
  purpose.
- `applyQrPayload` in `js/qr-transfer.js` and `applyImportedBlock` in
  `js/block-editor.js` — the strict paste/QR-block path keeps rejecting
  nameless exercises. Do not pass `{ own: true }` there.
- `newExercise()` — its empty name is what shows the user an empty box to
  type into in the plan editor. Do not give it a default name.
- `migrate()` — plan 002 ruled out load-time sweepers; do not add one.
- `README.md`, `AGENTS.md` — plan 015 owns doc changes.

## Git workflow

- Branch: `claude/010-restore-round-trips-own-data`
- Commit per step or per logical unit. Message style is one imperative
  sentence with no prefix, e.g. `Stop rebuilding the whole session on every set tick`.
- Do NOT push or open a PR unless the operator instructed it. Opening a PR
  triggers the 2.5-minute browser suite via a hook; that is expected.

## Steps

### Step 1: Write the failing tests first

In `test/unit.js`, directly after the `== normalizeImportedProfile ==`
section's last `ok(...)` (around line 345, before the next `console.log('\n== `),
add a new section:

```js
console.log('\n== normalizeImportedProfile: the app can read back everything it writes (plans/010) ==');
```

with these probes, each built with `call(...)` like the `roundTrip` block:

1. **Empty starting plan restores.** Build
   `const p = defaultState().profiles.hombre; const b = emptyBlock(); p.blocks = {[b.id]: b}; p.blockOrder = [b.id]; p.activeBlock = b.id;`
   then `normalizeImportedProfile(JSON.parse(JSON.stringify(p)))`.
   Assert it does not throw, and that the surviving exercise has a
   non-empty `n`.
2. **Retired items survive a round trip.** Take the default hombre profile,
   set `block.days[1].off = 1` and `block.days[0].ex[2].off = 1`, round-trip
   through `normalizeImportedProfile`, assert `dayList(block).length` and
   `exList(day0).length` are unchanged and the two `off` flags are still `1`.
3. **Same id on two days keeps both days' rows.** Take the default profile,
   copy `days[0].ex[0]` (id `chestpress`) into `days[2].ex` as well (a
   plain object copy with the same id), log one done set for it in
   `slot(1, days[0].id)` and one in `slot(1, days[2].id)`, round-trip, and
   assert: `days[2]` still has an exercise with `id === 'chestpress'`
   (own data is never renamed), and the row at `slot(1, days[2].id)` is
   found under that exercise's id.
4. **Session order is re-keyed on restore.** Set an order via
   `setOrder(profile, block.id, 1, day.id, [...])`, round-trip, assert
   `after.order` deep-equals `before.order`. (The existing
   `populatedRoundTrip` at line ~280 already asserts `sameOrder`; make sure
   your case uses a block where an id *would* be renamed on the strict
   path, i.e. the duplicate-id fixture from probe 3, so the assertion has
   teeth.)

**Verify**: `node test/unit.js` → probes 1, 2 and 3 **FAIL**, everything
else passes. (Probe 4 may pass or fail depending on fixture; that is fine.)
If probe 1 does not fail, STOP: the premise of this plan has drifted.

### Step 2: Give `normalizeImportedBlock` an `own` mode

In `js/block-editor.js`, change the signature to
`function normalizeImportedBlock(raw, opts)` and add at the top:

```js
  /* `own` is set by normalizeImportedProfile, for data this app itself
     wrote (a backup, a profile file, a QR "perfil"). A pasted or shared
     block stays strict — reject a nameless exercise, drop retired items —
     but the app must be able to read back anything it has ever saved:
     emptyBlock() ships one blank exercise on purpose, `off` is how a user
     retires an exercise without losing its history, and migrate() lets one
     id live on two days by design. Rejecting or rewriting any of those on
     restore turned the backup into a file that could not be restored
     (plans/010). */
  const own = !!(opts && opts.own);
```

Then, in `own` mode only:

- Name: `const n = txt(e.n, IMPORT_LIMITS.exName) || (own ? 'Ejercicio ' + (ei + 1) : '');`
  and keep the throw for `!n` (it now only fires when not `own`).
- Reps: `const reps = txt(e.reps, IMPORT_LIMITS.reps) || (own ? '10–15' : '');`
  (the same default `migrate()` uses at `js/app.js:339`), keep the throw.
- Id dedupe scope: declare `usedIds` per day when `own`, per block
  otherwise. Simplest: keep the block-wide `const usedIds = new Set();`
  and add inside the `days.map` callback `const dayIds = own ? new Set() : usedIds;`
  then use `dayIds` in the `while (…has…)` / `.add(…)` pair.
- Retired flags: after the exercise `out` is built, `if (own && e.off) out.off = 1;`
  and after the day `out` is built, `if (own && day.off) out.off = 1;`.

Everything else in the function is unchanged.

**Verify**: `node --check js/block-editor.js` → exit 0.
`node test/unit.js` → the existing `normalizeImportedBlock` section still
passes (strict behaviour unchanged: the case asserting a nameless exercise
is rejected must still pass).

### Step 3: Pass `own` from `normalizeImportedProfile` and re-key `order`

In `js/profile-transfer.js:102`, change `normalizeImportedBlock(raw)` to
`normalizeImportedBlock(raw, { own: true })`.

After the `rawRir` block (line ~137) and before the notes block, add:

```js
    /* Same re-keying as log and rir: a renamed exercise id (a blocked key,
       or a duplicate on the strict path) would otherwise leave the recorded
       session order pointing at ids no card on this phone has, and it would
       silently fall back to plan order. Never done here before plans/010. */
    const rawOrder = ownGet(p.order, bk);
    if (rawOrder) p.order[bk] = normalizeImportedOrder(rawOrder, raw, normalized);
```

**Verify**: `node --check js/profile-transfer.js` → exit 0.
`node test/unit.js` → probes 1 and 2 now PASS; probe 3 still fails
(the id map is not day-aware yet).

### Step 4: Make `importIdMaps` day-aware

In `js/app.js`, change `importIdMaps` so `exMap` is keyed by the
*normalized* day id first, then the raw exercise id:

```js
function importIdMaps(rawBlock, normalized) {
  const dayMap = {}, exMap = {};
  const put = (map, from, to) => { if (from != null && !(String(from) in map)) map[String(from)] = to; };
  (rawBlock.days || []).forEach((rd, di) => {
    const nd = normalized.days[di];
    if (!nd || !rd) return;
    put(dayMap, rd.id, nd.id);
    put(dayMap, nd.id, nd.id);
    /* Per day, not per block: the log is keyed by slot (week + day) and
       then by exercise id, so an id that appears on two days resolves
       differently depending on which day's slot is being read — a flat map
       sent day B's rows to day A's exercise (plans/010). */
    const forDay = exMap[nd.id] || (exMap[nd.id] = {});
    (Array.isArray(rd.ex) ? rd.ex : []).forEach((re, ei) => {
      const ne = nd.ex[ei];
      if (!ne || !re) return;
      put(forDay, re.id, ne.id);
      put(forDay, ne.id, ne.id);
    });
  });
  return { dayMap, exMap };
}
```

Then in each of `normalizeImportedLog`, `normalizeImportedRir` and
`normalizeImportedOrder`, after `const dayId = dayMap[m[2]]; if (!dayId) return;`,
look exercises up through `const exFor = exMap[dayId] || {};` and replace
`exMap[rawExId]` with `exFor[rawExId]`. There is exactly one such lookup in
each of the three functions.

Note: `exMap` is a plain object keyed by *normalized* day ids, which have
already passed `safeKey` (`js/block-editor.js:287`), so the bracket
assignment is safe. Do not key it by raw day ids.

**Verify**: `node --check js/app.js` → exit 0.
`node test/unit.js` → all probes PASS; total is 177 + your new cases,
`0 failed`. In particular the existing QR `normalizeImportedLog` cases
(grep `normalizeImportedLog` in `test/unit.js`) still pass.

### Step 5: Bump the cache version

In `sw.js`, `const CACHE_VERSION = 'v55';` → `'v56'` (or one higher than
whatever is on `main` when you rebase; on a conflict take the highest).

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → shows the new value.

### Step 6: One targeted browser check

Start the static server, then run the restore section:
`BASE=http://127.0.0.1:8765 node test/smoke.js --only "restore"` (if no
section matches, use `grep -n "await section('" test/smoke.js` to find the
one covering "Cargar copia" / restore and pass its substring).

**Verify**: `… passed, 0 failed`.

## Test plan

- New unit cases (Step 1): empty-plan restore; retired day and exercise
  survive; same id on two days keeps both days' rows and is not renamed on
  the own path; order is re-keyed. Model on `test/unit.js:242-262`.
- Existing cases that must keep passing: the whole `== normalizeImportedBlock ==`
  section (strict path unchanged), `== normalizeImportedProfile ==`,
  `== normalizeImportedProfile: a restore runs the same per-row limits QR
  already had (plans/008 item 4) ==`, and every `normalizeImportedLog`
  case.
- Verification: `node test/unit.js` → `0 failed`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `for f in js/*.js sw.js test/*.js; do node --check "$f"; done` exits 0
- [ ] `node test/unit.js` ends `N passed, 0 failed` with N ≥ 181
- [ ] `grep -n "normalizeImportedBlock(raw, { own: true })" js/profile-transfer.js` → 1 match
- [ ] `grep -n "normalizeImportedOrder" js/profile-transfer.js` → ≥ 1 match
- [ ] `grep -n "own: true" js/qr-transfer.js js/block-editor.js` → **0 matches** (strict paths untouched)
- [ ] `sw.js` `CACHE_VERSION` differs from `main`
- [ ] `git status` shows changes only in the in-scope files
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Probe 1 in Step 1 does **not** fail before any fix — the bug is gone or
  the code has drifted.
- `normalizeImportedBlock` no longer has a single `usedIds` set and a
  `while (usedIds.has(…))` loop at the cited location.
- Any existing `normalizeImportedLog` / QR unit case fails after Step 4 and
  the cause is not obviously the day-aware map — the QR "blocklog" wire
  format depends on this function and must not change behaviour for
  non-duplicate ids.
- You find a caller of `normalizeImportedBlock` other than: `applyImportedBlock`
  / `importFromText` in `js/block-editor.js`, `normalizeImportedProfile`
  in `js/profile-transfer.js`, and `applyQrPayload` in `js/qr-transfer.js`.
- The fix seems to require touching `blockSharePlan` or `migrate()`.

## Maintenance notes

- `normalizeImportedBlock` now has two modes. Any new field added to a
  block (see the `out` object) must be classified: does the strict path
  drop it (share-safe) or carry it? Does the own path carry it? Add both
  answers as a comment on the field.
- Plan 004 (`plans/done/004-harden-profile-import.md`) carries the rule
  "never reject data the app itself wrote" and a STOP condition that the
  normalizer must accept every backup the app ever produced. This plan is
  that rule applied at block level; update 004's maintenance note to point
  here.
- Reviewer: check that `{ own: true }` appears in exactly one call site,
  and that the three `exMap` lookups all go through the per-day object.
- Deferred on purpose: giving `newExercise()` a default name (UX change to
  the editor), and making the *strict* path per-day for ids (would change
  the documented "same lift" semantics for pasted blocks — see README "The
  same lift on two days"; sameLift falls back to name matching today, so
  the rename is cosmetic there).
