# Plan 004: Give imported profiles and backups the same validation blocks already get

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f9afbe0..HEAD -- js/profile-transfer.js js/app.js js/block-editor.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (but `plans/003-headless-assertion-layer.md` makes the
  validator far cheaper to test — prefer landing 003 first if both are queued)
- **Category**: security
- **Planned at**: commit `f9afbe0`, 2026-09-02

## Why this matters

The app takes untrusted structured data through two families of route:

- **Blocks** — pasted JSON, a block fetched from the repo, or a QR scan. These
  are thoroughly hardened by `normalizeImportedBlock` (`js/block-editor.js:198`):
  every string length-capped, every number clamped, day and exercise counts
  ceilinged, ids deduplicated.
- **Profiles and full backups** — a file a partner sent, or a QR scan of
  someone's screen. These get `describeProfileProblem`
  (`js/profile-transfer.js:28-39`), which checks only that the thing is an
  object, has a non-empty `blocks` map, and that each block's `days` is an
  array. No length caps. No count ceilings. Nothing else.

The intent is already written down. `js/app.js:4576-4578` says the QR path
"lands in the confirmation flow that the file-based transfer already uses, so
arriving by camera is not a way to get looser validation than arriving by
file" — which is true, and is exactly why the file route being the loose one
matters. `js/app.js:2030-2035` states the standard the block route meets:
*"a 'block' with 40 000 exercises is not a training plan, it is a way to hang
the phone."* A profile containing forty thousand exercises hangs the phone
just as effectively, and takes a different door.

Nothing here is a script-execution risk — the escaping discipline in this
codebase is genuinely sound, and `esc` (`js/app.js:23`) covers all five
characters including quotes. The concrete harm is narrower and still worth
fixing: an unbounded profile is installed over the user's real one, the
render loop grinds, and `writeState` may blow the storage quota with only
*"puede que no quede espacio"* to show for it — by which point the real
profile is already gone.

Three specific gaps, all cheap:

1. **No bounds on an incoming profile** (`describeProfileProblem`).
2. **`restoreFromText` takes no undo snapshot** — the single most destructive
   operation in the app, and the one the README tells people to rely on. Its
   sibling `loadProfileFromText` does take one (`js/profile-transfer.js:150`),
   as does "Borrar todo el registro" (`js/app.js:2672`).
3. **`profile.theme` is never validated**, and `js/app.js:1969` concatenates
   it raw into the root element's class list — bypassing `accentOf()`
   (`js/app.js:655-657`), the helper that exists to sanitise exactly this.

## Current state

### 1. The whole gate on an incoming profile — `js/profile-transfer.js:28-39`

```js
function describeProfileProblem(p, pk) {
  const who = (p && p.label) || pk || 'sin nombre';
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'el perfil "' + who + '" está corrupto';
  if (!p.blocks || typeof p.blocks !== 'object' || !Object.keys(p.blocks).length) return 'el perfil "' + who + '" no tiene bloques';
  if (p.log && typeof p.log !== 'object') return 'el registro del perfil "' + who + '" está corrupto';
  for (const bk of Object.keys(p.blocks)) {
    const b = p.blocks[bk];
    if (!b || typeof b !== 'object') return 'el bloque "' + bk + '" de "' + who + '" está corrupto';
    if (!Array.isArray(b.days)) return 'el bloque "' + (b.name || bk) + '" de "' + who + '" no tiene días';
  }
  return null;
}
```

### 2. `restoreFromText` replaces everything with no snapshot — `js/profile-transfer.js:99-107`

```js
  if (!okd) return;

  state = data;
  if (!state.activeProfile) state.activeProfile = 'hombre';
  migrate();
  applyTheme();
  save(); render();
  closeSheet('sheet');
  flushSave();
  mark('Registro restaurado — ' + setsLabel(theirs));
```

Compare its sibling at `js/profile-transfer.js:150`, which does it right:

```js
  snapshotForUndo('Perfil de ' + local.label + ' sustituido.');
  state.profiles[target] = incoming;
```

### 3. The raw label in the destructive dialog — `js/profile-transfer.js:141-146`

```js
  const okd = await ask({
    title: '¿Sustituir el perfil de ' + local.label + '?',
    body: 'Entra "' + (incoming.label || target) + '"' + (stamp ? ' del ' + stamp : '') + ': ' + setsLabel(theirs) + '.\n' +
      'Se reemplaza ' + local.label + ', que tiene ahora ' + setsLabel(mine) + '.\n\n' +
      (others.length ? others.join(' y ') + ' no se toca' + (others.length > 1 ? 'n' : '') + '. ' : '') +
      'No se puede deshacer.',
    okLabel: 'Sustituir', danger: true,
  });
```

`incoming.label` goes in raw. The dialog body is rendered with
`white-space: pre-line` (`css/style.css:836`), so newlines in a label become
line breaks in the one dialog that irreversibly replaces a training history.
It is written with `textContent` (`js/app.js:567`), so no markup runs — but
the layout of a destructive confirmation is partly authored by whoever wrote
the payload.

The block route already solved this, at `js/app.js:4602`:

```js
    const from = txt(payload.from, IMPORT_LIMITS.name);
```

### 4. The unvalidated theme — `js/app.js:1969` and `js/app.js:655-657`

```js
  $('app').className = 'profile-' + getProfile().theme + (soloMode() ? ' solo' : '');
```

```js
function accentOf(profile) {
  return LEGACY_ACCENT[profile.theme] || (ACCENTS.indexOf(profile.theme) >= 0 ? profile.theme : 'azul');
}
```

`ACCENTS` is `['azul', 'verde']` (`js/app.js:646`). `migrate()` only fills a
*missing* theme (`js/app.js:209`: `if (!profile.theme) profile.theme = seed.theme;`)
— it never validates an existing one. Meanwhile `state.prefs.theme` **is**
validated, at `js/app.js:312`. The per-profile field was simply missed.

### The tools you will reuse

From `js/app.js`:

```js
const IMPORT_LIMITS = { days: 14, ex: 40, name: 80, exName: 120, alt: 200, cue: 400, reps: 40, pair: 1000, phaseR: 40, phaseT: 400 };

function txt(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}
```

`clampInt(v, lo, hi, dflt)` is at `js/app.js:34`. `normalizeImportedBlock(raw)`
at `js/block-editor.js:198` throws an `Error` with a Spanish message on
rejection and returns a normalized block on success.

### Repo conventions

- Comments explain *why*, in prose, often naming the failure prevented.
- **All user-facing strings in Spanish.** Rejection messages follow the
  existing pattern: `'Ese perfil no se puede usar: ' + problem`, where
  `problem` is a lowercase fragment like `'el perfil "X" no tiene bloques'`.
- No build step, no modules; one shared global scope. `js/profile-transfer.js`
  loads *before* `js/app.js` (`index.html:483-484`), so it may call `txt`,
  `clampInt` and `IMPORT_LIMITS` at runtime — but **must not** reference them
  at its own top level.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | `node --check js/profile-transfer.js && node --check js/app.js` | exit 0 |
| Unit tests (if 003 landed) | `node test/unit.js` | 0 failures |
| Install test dep | `npm install --no-save playwright@1.56.1` | exit 0 |
| Serve the site | `python3 -m http.server 8765` (leave running) | serves on 127.0.0.1:8765 |
| Smoke tests | `node test/smoke.js` | 0 failures |

## Scope

**In scope**:

- `js/profile-transfer.js` — the new normalizer, the snapshot, the dialog fix
- `js/app.js` — the theme validation only (one line in `migrate()`, one at 1969)
- `test/smoke.js` — new assertions
- `test/unit.js` — new assertions, **only if plan 003 has landed**
- `sw.js` — `CACHE_VERSION` only

**Out of scope**:

- `normalizeImportedBlock` (`js/block-editor.js:198`) — **reuse it, do not
  change it.** It is the standard you are meeting, and it is covered by
  existing tests.
- The QR receive path (`js/app.js:4579-4586`) — it already delegates to
  `loadProfileFromText`, which is where your fix lands. Changing it would
  duplicate validation.
- `esc` and the rendering paths — the escaping is correct; this plan is about
  bounds and consent, not output encoding.
- Any change to the *exported* backup format. **The normalizer must accept
  every file the app itself has ever produced.** See STOP conditions.

## Git workflow

- Branch: `advisor/004-harden-profile-import`
- Commit message style: short imperative sentence, no prefix.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write `normalizeImportedProfile`

In `js/profile-transfer.js`, immediately after `describeProfileProblem`, add a
normalizer that bounds an incoming profile. It **mutates and returns** the
profile, throwing an `Error` with a Spanish message when the shape is beyond
saving.

Design rules, in priority order:

1. **Never reject data the app itself wrote.** Prefer clamping and truncating
   over throwing. Throw only for counts so large the profile cannot be a real
   training history.
2. Reuse `normalizeImportedBlock` for each block — it is the audited
   implementation. Wrap it so a single bad block names itself in the error.
3. Cap the number of blocks. `MAX_WEEKS` bounds weeks and `IMPORT_LIMITS`
   bounds days and exercises, but nothing bounds blocks. Add a
   `PROFILE_LIMITS` constant next to the function with a generous ceiling
   (e.g. `{ blocks: 40 }`) — generous enough that no real user hits it,
   small enough that it is not a way to hang a phone.
4. `txt(…, 80)` the `label`.
5. Validate `theme` against `ACCENTS`, falling back to `'azul'` — or simply
   call `accentOf(profile)`, which already encodes that rule.
6. Drop log/rir/notes/energy/order entries whose block id is not in the
   surviving `blocks` map — they are orphans by construction (see
   `plans/002-purge-parallel-maps.md` for the same invariant).

Give it a header comment in the codebase's register, explaining why the
profile route needs this and pointing at the block route as precedent.

**Verify**: `node --check js/profile-transfer.js` → exit 0.

### Step 2: Call it from both entry points

In `loadProfileFromText` (`js/profile-transfer.js:114`), after
`describeProfileProblem` passes and **before** the confirmation dialog is
built, run `incoming` through the normalizer inside a `try`/`catch`, reporting
a rejection with `mark(…, true)` in the existing style.

Normalizing *before* the dialog matters: the dialog quotes the set count and
the label, so the user must be shown numbers from the data that will actually
be installed.

In `restoreFromText` (`js/profile-transfer.js:75`), do the same for every
profile in `data.profiles` after `describeBackupProblem` passes.

**Verify**: `node --check js/profile-transfer.js` → exit 0.

### Step 3: Sanitise the label in the destructive dialog

In `loadProfileFromText`, replace the raw `incoming.label` in the dialog body
with a capped, whitespace-collapsed version, exactly as the block route does
at `js/app.js:4602`:

```js
  const incomingLabel = txt(incoming.label, 80) || target;
```

Use `incomingLabel` in the `body` string. `txt` collapses **all** whitespace
runs to single spaces, so newlines cannot restructure the dialog.

If Step 1 already caps `label` on the normalized object, this is belt and
braces — keep it anyway: the dialog is the consent surface, and it should not
depend on an earlier step having run.

**Verify**: `grep -n "incoming.label" js/profile-transfer.js` → no occurrence
remains inside the `ask({…})` body.

### Step 4: Give `restoreFromText` an undo snapshot

In `js/profile-transfer.js`, immediately after `if (!okd) return;` and before
`state = data;`, add:

```js
  /* The one destructive path that had no way back. Its sibling
     loadProfileFromText has taken a snapshot since it was written, and
     "Borrar todo el registro" takes one too — restoring a copy is at least as
     final as either, and is the operation the README tells people to rely on.
     Undo is one level deep and does not survive a reload, which is exactly
     the window this covers: realising within seconds that it was the wrong
     file. */
  snapshotForUndo('Registro restaurado desde una copia.');
```

`snapshotForUndo` is at `js/app.js:518` and takes a Spanish description shown
in the undo toast.

**Verify**: `grep -n "snapshotForUndo" js/profile-transfer.js` → **two**
matches (the existing one at ~150 and the new one).

### Step 5: Validate `profile.theme`

Two changes, both one line.

In `js/app.js`, in `migrate()`, change line 209 from filling only a missing
theme to validating any theme:

```js
    if (ACCENTS.indexOf(profile.theme) < 0 && !LEGACY_ACCENT[profile.theme]) profile.theme = seed.theme;
```

Keep `LEGACY_ACCENT` in the condition — `accentOf` honours it, so old saved
values must keep migrating rather than being reset.

Then at `js/app.js:1969`, route the class name through the helper that
already encodes the rule:

```js
  $('app').className = 'profile-' + accentOf(getProfile()) + (soloMode() ? ' solo' : '');
```

This is defence in depth: `migrate()` cleans stored data, `accentOf` makes the
render path safe regardless of what is in memory.

**Verify**: `node --check js/app.js` → exit 0, and
`grep -n "className = 'profile-'" js/app.js` shows the `accentOf(` form.

### Step 6: Tests

**If plan 003 has landed**, add to `test/unit.js` — this is the cheap place,
since `normalizeImportedProfile` is pure:

- a profile the app itself exported round-trips unchanged in every meaningful
  field (**the most important assertion in this plan** — build the fixture by
  calling `defaultState()` in the harness, not by hand);
- a profile with more than `PROFILE_LIMITS.blocks` blocks throws;
- a block inside a profile that violates `IMPORT_LIMITS` throws, and the
  message names the block;
- an over-long `label` comes back truncated, not rejected;
- a `theme` of `"azul solo"` comes back as a value in `ACCENTS`;
- log entries under a block id that is not in `blocks` are dropped.

**Always** add to `test/smoke.js`, since these are the user-visible guarantees:

- pasting an oversized profile into "Cargar copia" shows a rejection message
  and leaves the existing log untouched (assert the set count before and
  after);
- a normal backup still restores successfully — **there is currently no
  happy-path restore test at all**, so write one: log a set, take the backup
  blob, wipe, paste it back, accept via `answerDialog(page, true)` (helper at
  `test/smoke.js:28-34`), assert the set is back;
- after a restore, the undo toast is offered.

**Verify**: `node test/unit.js` (if it exists) → 0 failures;
`node test/smoke.js` → 0 failures.

### Step 7: Bump `CACHE_VERSION` and run everything

Read `sw.js:20`, increment the integer by one. Then:

```bash
python3 -m http.server 8765 &
node test/smoke.js
```

**Verify**: 0 failures across both suites. Pay close attention to every
existing assertion touching backup, restore, or profile transfer —
`test/smoke.js:536`, `:539`, `:893-905` and `:898` all exercise these paths and
must still pass.

## Test plan

- **New unit assertions** (if 003 landed): the six cases in Step 6.
- **New smoke assertions**: oversized-profile rejection, happy-path restore
  round-trip, undo offered after restore.
- **Must keep passing**: `test/smoke.js:536` (half-valid backup rejected),
  `:539` (non-backup rejected), `:893-905` (single-profile transfer
  round-trip), `:898` (profile file offered as full backup is rejected).
- Structural pattern for the smoke block: the existing profile-transfer
  section around `test/smoke.js:893`.

## Done criteria

ALL must hold:

- [ ] `node --check js/profile-transfer.js` exits 0
- [ ] `node --check js/app.js` exits 0
- [ ] `node test/smoke.js` exits 0 with 0 failures
- [ ] `node test/unit.js` exits 0 with 0 failures, **if that file exists**
- [ ] `grep -n "normalizeImportedProfile" js/profile-transfer.js` returns 3+ lines (definition + both call sites)
- [ ] `grep -n "snapshotForUndo" js/profile-transfer.js` returns 2 matches
- [ ] `grep -n "className = 'profile-'" js/app.js` shows `accentOf(getProfile())`
- [ ] A backup exported by the app before this change still restores cleanly (see STOP conditions — verify this by hand)
- [ ] `CACHE_VERSION` in `sw.js` is higher than at commit `f9afbe0`
- [ ] `git status` shows only the in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- **The normalizer rejects a backup the app itself produced.** This is the
  failure mode that matters most: it would turn a safety feature into a lockout
  for the exact people who did the right thing and kept backups. Test this
  explicitly before you finish — export a backup from the app running at
  commit `f9afbe0`, then restore it through your changed code. If it is
  refused, the limits are wrong; loosen them, do not ship it.
- Any existing backup/restore/transfer smoke assertion fails.
- You find you need to change `normalizeImportedBlock` to make profiles work.
  Report it — that function is shared with the block routes and changing it
  widens the blast radius well beyond this plan.
- The theme change breaks the accent colours in the UI (profiles render with
  the wrong colour, or none). `LEGACY_ACCENT` exists to migrate old values;
  if it is not doing so, stop rather than deleting the legacy mapping.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this next:

- **The rule this establishes**: every structured payload from outside gets a
  `normalizeImported*` before it touches `state`. There are now two — blocks
  and profiles. A third input format needs a third one, not a shape check.
- **The dialog is a consent surface.** Any value from a payload that reaches
  `ask()`/`tell()` must go through `txt()` first. `js/app.js:4602` and this
  plan's Step 3 are the two precedents; a reviewer should check any new one.
- **Bounds must stay generous.** Every limit here is protecting against
  absurdity, not policing real use. If a user ever hits `PROFILE_LIMITS.blocks`
  legitimately, raise it — the ceiling exists to stop a hang, not to enforce a
  training philosophy.
- **What a reviewer should scrutinise**: the round-trip test in Step 6. Bounds
  that reject the app's own output are worse than no bounds.
- **Deliberately deferred**: `qrInflate` (`js/app.js:3932-3937`) reads a
  decompressed QR payload with no size cap, so a small compressed payload can
  expand without bound before any shape check runs. It is a real robustness
  gap on the same input surface, but it lives in the QR frame layer rather
  than the profile layer and needs a streaming read to fix properly. Tracked
  separately in `plans/README.md`.
