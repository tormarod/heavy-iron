# Plan 069: What an AI round trip hands back keeps its lifts' ids, and "series x 5 RIR 2" reads 2

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md`.
>
> **One PR** (`claude/069-round-trip`), two steps. Bumps `CACHE_VERSION`.
>
> **Drift check (run first)**:
> `git diff --stat c9114bc..origin/main -- js/block-editor.js js/app.js js/review.js js/qr-transfer.js test/unit.js sw.js`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW — the import path gains one narrowly scoped exception; the
  phase-label change is one alternation in an existing check.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `c9114bc`, 2026-09-22 — follow-ups recorded by
  plans 062 and 063 (`plans/README.md`, "Tenth audit — follow-ups")

## Why this matters

**A — long ids.** An exercise's id is what its history is filed under,
and the weekly objetivo joins a lift's history across blocks **by id**.
Before plan 063 a pasted block without ids got ids slugged from the names
with no length cap, so some phones hold ids longer than 60 characters.
Plan 063 made a restore give those back whole — but the **paste** path
still cuts every *stated* id at 60. The block review's round trip is
exactly that path: the app's AI prompt includes the current block with
its ids and asks the AI to keep them ("conserva el id de cada ejercicio
que mantengas, para que su historial siga unido"); the AI hands the ids
back; the paste cuts a 75-character id to 60, and the lift starts the next
block with no history. The prompt itself also says `máx 60 car.` for an
id, which invites the AI to cut it first.

**B — `series x 5 RIR 2`.** Plan 062 refuses a number right after
`<digit> x` as reps (`3x5 RIR 2` → 2), but `series x 5 RIR 2` still reads
5: the refusal needs a digit before the `x`, so `máx 2 RIR` is not
mistaken for sets×reps. A word for sets before the `x` is as clear a
signal as a digit. It was pinned as a known limit; it is a one-line fix.

## The decisions (settled — do not re-open)

1. **Keep a stated id longer than 60 only when the profile already has
   it.** The paste stays strict for anything new (60 characters, as the
   prompt tells the AI). An id that already names an exercise in the
   target profile's blocks is the app's own id coming back, so it is kept
   whole (up to `OWN_TEXT_LIMIT`, the most any writer could have produced).
   Nothing new can be smuggled in: the exception only admits a string the
   profile already holds.
2. **The importer derives the known ids itself.** Callers pass the target
   profile (`normalizeImportedBlock(raw, { profile: getProfile() })`); the
   importer walks its blocks. That keeps every mixed shell safe (AGENTS.md
   precache holes): a new split file with an old cached
   `js/block-editor.js` passes an option the old importer ignores, and an
   old split file with a new importer passes none — both fall back to
   today's 60-character cap. Do **not** add a new helper to `js/app.js`
   for callers to use.
3. **The prompt tells the AI to copy a given id exactly**, and keeps the
   60-character limit for a new one.
4. **Sets words count like a digit before an `x`**: `series`, `serie`,
   `sets`, `set` (whole words, case-insensitive). `máx 2 RIR` still reads 2.

## Current state

**The paste's id rule** — `js/block-editor.js`, `normalizeImportedBlock`
(search `const idCap = own ? OWN_TEXT_LIMIT : 60;`):

```js
const idCap = own ? OWN_TEXT_LIMIT : 60;
const capSlug = s => s.slice(0, 60).replace(/-+$/, '');
const baseId = safeKey(txt(e.id, idCap)) || safeKey(capSlug(slugify(n))) || ('ex-' + di + '-' + ei);
```

`own` comes from `opts.own` (search `const own = !!(opts && opts.own);`).
The block-wide de-duplication right below it (`dayIds`/`usedIds`) is
unchanged by this plan.

**The strict callers** (`grep -n "normalizeImportedBlock(" js/*.js`):
`js/block-editor.js` `applyImportedBlock` (paste, file, `blocks/`),
`js/qr-transfer.js` (QR "bloque"), `js/review.js` (the review's paste —
the AI round trip), and `js/app.js` (the first-run setup's import — there
is no history yet, leave it). The own path (`js/profile-transfer.js`,
`{ own: true }`) is unchanged.

**The prompt** — `js/app.js`, `EX_FIELDS`, the `id` entry (search
`string opcional (máx 60 car.)`):

```js
prompt: () => 'string opcional (máx 60 car.) — identificador estable del ejercicio. Si abajo te paso mi bloque actual, conserva el id de cada ejercicio que mantengas, para que su historial siga unido; un ejercicio nuevo puede ir sin id. …' },
```

and the comment above it (search `A paste holds an id to 60 characters`).

**`phaseRir`'s sets×reps refusal** — `js/app.js` (search
`const notReserve = lead =>`):

```js
const notReserve = lead => /[\d.,]$/.test(lead) || /\d\s*[x×]\s*$/i.test(lead)
  || (/\b(?:semana|sem|s|week|wk|w)\.?\s*$/i.test(lead) && !/\d\s*(?:s|w|wk)\.?\s*$/i.test(lead));
```

and the pinned known-limit case in `test/unit.js` (search
`"series x 5 RIR 2" → 5`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check <each touched js file>` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| Bump | `bash tools/bump-cache-version.sh` | old → new |

## Scope

**In scope**: `js/block-editor.js` (the id rule, and passing the profile
in `applyImportedBlock`), `js/review.js` and `js/qr-transfer.js` (pass
the profile — one argument each), `js/app.js` (the `id` prompt text and
its comment; `notReserve`), `test/unit.js`, `docs/guide.md` (one sentence
if the guide describes the id rule — search `60`), `sw.js`.

**Out of scope**: the own path; `migrate()`'s id repair; the setup
import; any other `phaseRir` rule.

## Git workflow

`git checkout -B claude/069-round-trip --no-track origin/main`;
plain-sentence commit subjects with your `Co-Authored-By:` line; bump last.

## Steps

### Step A: known long ids survive the paste

A.1 In `normalizeImportedBlock`, before the exercise loop, build the set
of known ids from `opts.profile` when present (every `ex.id` of every day
of every block of that profile; tolerate missing/odd shapes), e.g.
`const known = knownExerciseIds(opts && opts.profile);` with a small
function **in `js/block-editor.js`** next to the importer. Then:

```js
const stated = txt(e.id, OWN_TEXT_LIMIT);
const idCap = own || (known && known.has(stated)) ? OWN_TEXT_LIMIT : 60;
```

keeping `capSlug` and the fallback exactly as they are. Comment: decision
1 and why (the review's round trip handed back a 75-character id and the
paste cut it, starting the lift over).

A.2 Pass `{ profile: getProfile() }` at the three strict callers (not the
setup import). Each is one argument.

A.3 The prompt: change `(máx 60 car.)` to say a new id is at most 60
characters and an id given below is copied exactly, whatever its length —
e.g. `'string opcional (máx 60 car. si es nuevo; si te paso uno, cópialo
tal cual) — …'`. Update the comment above the entry. If a unit test pins
the prompt's text, update that assertion to the new text (and say so).

A.4 Tests (`test/unit.js`, near plan 063's id cases — search `plans/063`):
1. A profile whose block has an exercise with a 75-character id and a
   logged session; paste (through `normalizeImportedBlock(raw, { profile })`)
   a block carrying that same id → the id comes back whole.
2. The same paste with an unknown 75-character id → cut to 60.
3. Through the review's real button (booted — search the existing
   `reviewImport` / review paste cases) with the long id → after the
   import the new block's exercise has the full id, so
   `sessionsOf(profile, { weeks: 'logged', lift: { id } })` finds the old
   session.
Mutation: drop the `known.has(stated)` branch → cases 1 and 3 FAIL.

### Step B: sets words before an `x`

B.1 `notReserve`: replace `/\d\s*[x×]\s*$/i` with
`/(?:\d|\b(?:series?|sets?))\s*[x×]\s*$/i`. Update the rules comment above
`phaseRir` (the × bullet) and the plan-062 known-limit note in it.

B.2 Tests: flip the known-limit case to `"series x 5 RIR 2" → 2 (plans/069)`
and add `"sets x 5 RIR 2"` → 2, `"Serie x 8 · 1 RIR"` → 1, and keep
`"máx 2 RIR"` → 2 and `"3x5 RIR 2"` → 2 passing. The seed/published/
generic equivalence case must still pass unchanged.
Mutation: revert B.1 → the flipped case FAILs.

**Verify**: `node --check` each touched file; `node test/unit.js` →
`0 failed`. Bump, PR.

## Test plan

Three id cases (one booted through the review), four label cases, two
mutations.

## Done criteria

- [ ] `grep -n "profile: getProfile()" js/block-editor.js js/review.js js/qr-transfer.js` → three call sites
- [ ] `phaseRir({ phase: { 1: { r: 'series x 5 RIR 2' } } }, 1) === 2`
- [ ] `node test/unit.js` → `0 failed`; `CACHE_VERSION` above `origin/main`'s
- [ ] Only in-scope files changed

## STOP conditions

- `normalizeImportedBlock` is also called with a profile-shaped `opts`
  somewhere else for a different purpose.
- The review's paste imports into a profile other than `getProfile()`.
- Any seed or published block label changes its `phaseRir` value.

## Maintenance notes

- A future import path for AI-written blocks passes `{ profile }` too.
- *(Executor: record deviations here.)*
