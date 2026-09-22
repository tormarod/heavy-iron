# Plan 063: An exercise keeps its own id through every restore, a save records a rename only when the name changed, and an import files each lift's rows under that lift

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` unless you were told otherwise.
>
> **Three steps (A, B, C), one PR** unless the orchestrator splits them.
>
> **Drift check (run first)**:
> `git diff --stat b15ae87..origin/main -- js/block-editor.js js/app.js js/profile-transfer.js test/unit.js sw.js`
> Re-locate every anchor by `grep`, never by line number alone.

## Status

- **Priority**: P2
- **Effort**: S (each step is a few lines plus tests)
- **Risk**: LOW–MED — A changes which id a restore gives a stored
  exercise; the rule is "exactly the one it had", which is safer than
  today, but it is the import path.
- **Depends on**: none
- **Category**: bug (data integrity)
- **Planned at**: commit `b15ae87`, 2026-09-22 (tenth audit, finding 9)

## Why this matters

An exercise's **id** is what its whole history is filed under: the log,
the objetivo's history across blocks (`sessionsOf`, joined by id), the
rename history (`variants`), the session order. Three places handle ids
in ways that, in narrow but real cases, file one lift's history under
another or cut it:

- **A — a restore shortens ids to 60 characters; a paste does not.** A
  block pasted without ids (the AI prompt says ids are optional for a new
  exercise) gets ids slugged from the names, **uncapped** — a 120-character
  name gives a ~110-character id. Restoring any backup later (or loading a
  profile file, or a QR "perfil") runs the same importer, which cuts every
  stated id to 60. Two exercises on different days whose names share their
  first ~60 slug characters ("Remo con mancuerna a una mano apoyado en
  banco inclinado con …") become the **same id**. The own path deliberately
  allows one id on two days — that is how the app records one lift trained
  twice a week — so nothing flags it: two different lifts silently merge
  their histories, charts and objetivo. Even without a collision, every
  such id changes on the first restore.
- **B — a plan save reports a rename that never happened.** On
  "Guardar cambios", the editor compares each exercise's name with its old
  name to record renames (a rename cuts the objetivo history — see
  `recordVariant`). The old names are kept in a map **keyed by id alone**,
  so when one id sits on two days under two names (after A, or after the
  user renames one copy of a shared-id pair), the last day's name wins and
  the other copy compares against the wrong name. Every save — even one
  that only fixes a cue — then says "1 ejercicio renombrado: su objetivo
  empieza de cero desde hoy" and really does cut the history again.
- **C — an import can file one lift's rows under another.** When a block
  arrives with its log (QR "plan + registro", or a pasted block with its
  log), `importIdMaps` maps each sender id to the id the importer gave it.
  It registers, per exercise, the raw id *and then* a self-mapping of the
  normalized id, first-wins. If the importer's de-duplication hands an
  earlier exercise the literal id a *later* exercise carries (day 2 has
  `press` and `press-2`, and `press` is also on day 1, so day 2's `press`
  becomes `press-2` and the real `press-2` becomes `press-2-2`), the
  self-mapping registered first wins: the incline press's rows land on the
  flat press, and the flat press's are dropped. Reach: a hand-written or
  foreign JSON only (the app's own writers never produce this shape).

## Current state

- `js/block-editor.js`, `normalizeImportedBlock` (search
  `function normalizeImportedBlock`), the exercise map (≈ line 300–330):

  ```js
  /* Ids are unique per block for a paste and per day for own data: … */
  const dayIds = own ? new Set() : usedIds;
  const ex = day.ex.map((e, ei) => {
    …
    const n = exField('n').accept(e.n, { own }) || (own ? 'Ejercicio ' + (ei + 1) : '');
    …
    const baseId = safeKey(txt(e.id, 60)) || safeKey(slugify(n)) || ('ex-' + di + '-' + ei);
    let uniqueId = baseId, suffix = 2;
    while (dayIds.has(uniqueId)) uniqueId = baseId + '-' + (suffix++);
    dayIds.add(uniqueId);
    return acceptExercise(e, { id: uniqueId, n, reps }, { own, weeks, n });
  });
  ```

  `own` is true on the restore / profile-file / QR-perfil path (the app's
  own data coming back) and false on a paste / file / `blocks/` / QR-bloque
  import. Day ids use `safeKey(txt(day.id, 60))` a few lines below — day
  ids are never slugged from names (the app writes `d0`, `d1`, … or
  `uid('d')`), so they are **out of scope**.
- `js/app.js`: `txt(v, max)` (search `function txt(`) collapses
  whitespace, trims, and slices to `max`. `slugify` (search
  `function slugify(`) is uncapped. `safeKey` (search `function safeKey(`)
  refuses prototype names. `IMPORT_LIMITS.exName` is 120 and
  `OWN_TEXT_LIMIT` is 2000 (search both).
- `js/block-editor.js`, `applyPlanDraft` tail (search `const wasNamed`,
  ≈ line 815):

  ```js
  const liveBlock = profile.blocks[block.id];
  let renamed = 0;
  if (liveBlock) {
    const wasNamed = Object.create(null);
    (liveBlock.days || []).forEach(d => (d.ex || []).forEach(e => { if (e && e.id) wasNamed[e.id] = e.n; }));
    block.days.forEach(d => d.ex.forEach(e => {
      if (e && e.id && wasNamed[e.id] != null && recordVariant(profile, e.id, wasNamed[e.id], e.n)) renamed++;
    }));
  }
  ```

  The draft remembers which day each draft exercise object started on:
  `draft.startDay` is a `Map` from the draft exercise object to its
  original day id (search `startDay.set(ex, day.id)`); an exercise added in
  this editor session has no entry.
- `js/app.js`, `importIdMaps` (search `function importIdMaps(`, ≈ line 7568):

  ```js
  const put = (map, from, to) => { if (from != null && !isObj(from) && !(String(from) in map)) map[String(from)] = to; };
  (rawBlock.days || []).forEach((rd, di) => {
    const nd = normalized.days[di];
    if (!nd || !rd) return;
    put(dayMap, rd.id, nd.id);
    put(dayMap, nd.id, nd.id);
    const forDay = exMap[nd.id] || (exMap[nd.id] = Object.create(null));
    (Array.isArray(rd.ex) ? rd.ex : []).forEach((re, ei) => {
      const ne = nd.ex[ei];
      if (!ne || !re) return;
      put(forDay, re.id, ne.id);
      put(forDay, ne.id, ne.id);
    });
  });
  ```

  Its header comment explains the first-wins rule; keep that reasoning.
- Tests: `test/unit.js`. Import cases model — search
  `normalizeImportedBlock(` and `normalizeImportedBackup(` for existing
  round-trip cases; booted editor-save cases — search `peSaveBoot`.

## The decisions (settled — do not re-open)

1. **A paste caps a slugged id at 60, like a stated one.** One cap for an
   id from outside, whichever way it was made: `safeKey(txt(e.id, 60)) ||
   safeKey(capSlug(slugify(n)))` where `capSlug` slices to 60 and trims
   trailing `-`. The block-wide de-duplication then resolves any collision
   with a `-2` suffix, visibly, at import time.
2. **The own path keeps a stored id as long as it is**, up to
   `OWN_TEXT_LIMIT` (the most any app writer could have slugged it from).
   A backup is the app's own data; the importer's job there is to give it
   back, not to reshape it. Stored ids longer than 60 exist today on
   phones that pasted long names, and must survive their next restore.
3. **Rename detection keys the old name by (day, id)** — the day the
   draft exercise *started* on (`draft.startDay`). An exercise with no
   start day (added in this session) is not a rename. Moving an exercise
   to another day with the same name is not a rename (its old name is
   looked up under its start day).
4. **`importIdMaps` registers every raw id of a day before any
   self-mapping** (and every raw day id before any self-mapped day id). A
   raw id is what the sender's log is filed under, so it outranks a
   coincidence of naming.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check js/block-editor.js` / `node --check js/app.js` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| Bump | `bash tools/bump-cache-version.sh` | old → new |

## Scope

**In scope**: `js/block-editor.js` (the `baseId` line and the `wasNamed`
block), `js/app.js` (`importIdMaps` only), `test/unit.js`, `sw.js` (bump).

**Out of scope**: day ids; `migrate()`'s own id repair (search
`safeKey(slugify(ex.n))` in `js/app.js` — it only runs for a missing or
duplicate id in corrupt storage; recorded as a follow-up);
`recordVariant`/`variantSince` and the `variants` part (still keyed by
exercise id alone — a deliberate model; renaming one copy of a shared-id
pair still cuts both copies' objetivo, which is outside this plan);
`RECORD_PARTS`.

## Git workflow

Branch `claude/063-exercise-ids` from `origin/main`
(`git checkout -B claude/063-exercise-ids --no-track origin/main`),
plain-sentence commit subjects, your session's `Co-Authored-By:` line,
bump last.

## Steps

### Step A: One cap for ids from outside; own ids come back whole

In `normalizeImportedBlock`, change the `baseId` line per decisions 1–2:

```js
const idCap = own ? OWN_TEXT_LIMIT : 60;
const baseId = safeKey(txt(e.id, idCap)) || safeKey(capSlug(slugify(n))) || ('ex-' + di + '-' + ei);
```

with a small helper next to it (or inline) that slices a slug to 60 and
strips trailing dashes. A slug on the own path is only made when the
stored id is missing, so capping it at 60 there too is fine. Add a comment
naming the bug (two long names merged into one lift on the first restore —
plans/063). Check `OWN_TEXT_LIMIT` is reachable from `js/block-editor.js`
at the point of use (it is a top-level `const` in `js/app.js`, read at call
time from inside a function — the same pattern `IMPORT_LIMITS` already
uses in this file; `grep -n "IMPORT_LIMITS" js/block-editor.js` shows it).

Tests (`test/unit.js`, near the existing import round-trip cases):
1. **Paste caps**: a block with no ids and two exercises on two days named
   with 110-character names sharing the first 70 characters → the two ids
   are each ≤ 62 characters and different.
2. **Own round trip keeps long ids**: build a profile whose block has an
   exercise id of 100 characters on day 1 and a different 100-character id
   sharing the first 60 on day 2, each with a logged set; run it through
   `normalizeImportedBackup` + `migrate()` the way existing restore cases do
   → both ids unchanged, each day's log under its own id.
3. **Idempotent**: restore the result of case 2 again → identical JSON.

**Verify**: `node test/unit.js` → `0 failed`. Mutation: put `60` back as
the own cap → case 2 FAILs.

### Step B: Rename detection by (day, id)

Replace the `wasNamed` block per decision 3:

```js
const wasNamed = Object.create(null);
const at = (dayId, exId) => dayId + '\u0000' + exId;
(liveBlock.days || []).forEach(d => (d.ex || []).forEach(e => { if (e && e.id) wasNamed[at(d.id, e.id)] = e.n; }));
block.days.forEach(d => d.ex.forEach(e => {
  const from = e && draft.startDay.get(e);
  const old = from != null ? wasNamed[at(from, e.id)] : undefined;
  if (old != null && recordVariant(profile, e.id, old, e.n)) renamed++;
}));
```

(Use whatever variable name the function already has for the draft —
check the function's signature; it is `applyPlanDraft(profile, draft)`.)
Keep and extend the comment above it.

Tests (booted, model on `peSaveBoot`):
1. A block with one id `press` on two days named "Press banca" and
   "Press banca (máquina)". Open the editor, change nothing but one cue,
   save → `renamed === 0` (the status line has no "renombrado"), and
   `getProfile().variants.press` unchanged. Save again → still 0.
2. Rename one copy for real → `renamed === 1` exactly once; save again with
   no edit → 0.
3. Send an exercise to another day ("Enviar a…") without renaming it →
   0 renames.

**Verify**: `node test/unit.js` → `0 failed`. Mutation: key by id alone
again → case 1 FAILs.

### Step C: Raw ids first in `importIdMaps`

Per decision 4, split each day's loop in two passes: first
`put(forDay, re.id, ne.id)` for every exercise of the day, then
`put(forDay, ne.id, ne.id)` for every exercise. Same for days: first
`put(dayMap, rd.id, nd.id)` for every day, then the self-mappings. Update
the header comment with one sentence on why the order matters.

Test: the exact shape from "Why this matters" — raw day 1 `[press]`,
raw day 2 `[press, press-2]` with distinct logged weights (60×10 on day 2's
`press`, 40×12 on `press-2`), imported on the strict path with its log the
way existing QR/paste-with-log cases do → day 2's `press-2` (the
normalized id of raw `press`) holds 60×10, `press-2-2` holds 40×12.
Check the normalized ids first (`press`, `press-2`, `press-2-2`) — if the
importer names them differently, adapt the assertion to the names it
gives, not the rule.

**Verify**: `node test/unit.js` → `0 failed`. Mutation: restore the
interleaved order → the new case FAILs.

Then `bash tools/bump-cache-version.sh`, commit, PR.

## Test plan

Seven new cases across A–C, three mutations. Every existing import,
restore and editor case stays green unchanged.

## Done criteria

- [ ] `grep -n "txt(e.id, 60)" js/block-editor.js` → no output
- [ ] `grep -n "wasNamed\[e.id\]" js/block-editor.js` → no output
- [ ] `node test/unit.js` → `0 failed`, with the seven new `(plans/063)` cases
- [ ] `CACHE_VERSION` above `origin/main`'s; only in-scope files changed

## STOP conditions

- An existing restore or import case fails after Step A and the failing
  expectation is an id being cut to 60 on the own path (a test pinned the
  old behaviour deliberately): report it with its name.
- `applyPlanDraft` no longer receives the draft with `startDay`.
- Step C changes the result of any existing QR or paste-with-log case.

## Maintenance notes

- `migrate()` still slugs a missing id without a cap (`safeKey(slugify(ex.n))`,
  corrupt storage only). If it is ever capped, cap it at 60 with the same
  helper — and remember that `migrate()` de-duplicates within a day only.
- `variants` stays keyed by exercise id: a shared-id pair shares one
  rename history by design.
- Executed A, B and C as one PR on `claude/063-exercise-ids`. Before
  Step A, no test in `test/unit.js` pinned a 60-character cut of an
  *exercise* id on the own path; the one 70-character case
  (`renamedDayProbe`) is a *day* id, which this plan leaves alone.
- A: `capSlug` is a local arrow beside `baseId`, not a shared helper; if
  `migrate()`'s slug is ever capped (above), lift it into `js/app.js`
  beside `slugify`. Case 2 is split into "the ids come back whole" and
  "each day's set is under its own lift", and a fifth assertion (from the
  review) holds `capSlug`'s trailing-dash trim: a name of `x`×59 + " y" on
  two days pastes as `x`×59 and `x`×59`-2`, not `x`×59`-` and
  `x`×59`--2`. The `EX_FIELDS` comment on the `id` entry (`js/app.js`),
  which said the importer holds a stated id to 60, now says a paste caps
  at 60 and a restore keeps a stored id whole.
- B: the booted cases drive the editor's own controls — the name and cue
  boxes through their input handlers, "Enviar a…" through its select, which
  asks `moveExRefusal` first, and a send the select refused fails the case
  — and read the status line straight after "Guardar cambios", before the
  clock moves (save()'s debounced write replaces it with "Guardado hh:mm"),
  failing if the line read is not the save's own ("Plan actualizado…").
  The plain "Enviar a…" case does NOT guard the start-day lookup: looked
  up by the day an exercise is on now (`const from = e && d.id`) it still
  passes, since a lone move lands where its id has no old name either way.
  Two cases from the review do, each on a fresh boot: an exercise sent and
  renamed in one save is exactly one rename (found under the day it
  landed on, there was no old name, so none), and a swap with no rename —
  Lunes' press to Sábado, Jueves' press to Lunes, Remo to Jueves — is none
  (the copy that took Lunes compared with the name Lunes' copy had). Both
  FAIL under that mutation; all seven FAIL under the id-alone one.
- C: the two passes also change the insertion order of each day's map,
  which `normalizeImportedProfile` (`js/profile-transfer.js`, the
  `exIdMap` it builds for the `variants` part) walks first-wins across
  days. Raw ids now come first there too, the same rule; every existing
  restore case is unchanged. The day half has its own case (from the
  review): raw day ids `x`×61 and `x`×60 — the first is cut onto the
  second's literal id and the second renamed — each keep their rows;
  with only the day map interleaved, the second day's rows are dropped.
- In all, sixteen `(plans/063)` assertions: five for A, seven for B, four
  for C.
