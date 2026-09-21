# Plan 040: A profile file or a backup cannot name a prototype property as its profile key, and the plate list from a backup is bounded

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3913b8f..HEAD -- js/app.js js/profile-transfer.js test/unit.js AGENTS.md`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — every change narrows a truthy read into an own-property
  read, or adds a cap; the app's own files use keys (`hombre`, `mujer`,
  `uid()`-generated) none of which is affected.
- **Depends on**: none. Plan 038's PR 1 (the row codec) may touch
  `js/profile-transfer.js`'s `normalizeImportedProfile`; this plan edits a
  different function in that file, so a rebase is expected to be clean.
- **Category**: security
- **Planned at**: commit `3913b8f`, 2026-09-21

## Why this matters

Anything that arrives from a file, a paste or a QR scan is untrusted
(`AGENTS.md` § "Untrusted input"). The repo already refuses prototype
names — `__proto__`, `constructor`, `toString`, … — as exercise ids, day
ids, block ids and tag names, through `safeKey` and `ownGet`, because a
plain `{}` answers `obj['constructor']` with a function (truthy) and
`obj['__proto__'] = x` re-points the object's prototype instead of adding
a property. The fifth audit recorded that the *profile* keys had not been
traced. Two reads and one write still trust them:

1. **A profile file's `key`** (`loadProfileFromText`, also the QR "perfil"
   payload): `state.profiles[parsed.key]` is truthy for a prototype name,
   so the "fall back to the profile you are looking at" branch never runs.
   With `constructor` the confirmation dialog reads "¿Sustituir el perfil
   de undefined?" and the import lands as a phantom extra profile; with
   `__proto__` the assignment re-points `state.profiles`'s prototype,
   nothing is persisted, and the status line reports the incoming label
   as loaded. Either way the user is told their partner's log arrived.
2. **A backup's `activeProfile`** (`restoreFromText` → `migrate()`): the
   only repair is `if (!state.profiles[state.activeProfile])`, which an
   inherited name passes. `getProfile()` then returns a function,
   `getBlock()` throws, and the app lands on the recovery screen with the
   old log still safe in `localStorage` — until the user taps either
   recovery button, which mutates the inherited object and **writes the
   unopenable state to disk**. From there every launch re-enters recovery
   and only "Empezar de cero" gets out. It is the one route from a crafted
   file to a lost log.
3. **`state.prefs.plates`** is the one imported collection with no length
   cap (`IMPORT_LIMITS`, `LOG_LIMITS`, `PROFILE_LIMITS`, `PRIORITY_MAX`,
   `VARIANT_LIMIT`, `ORDER_LIMIT` and `MAX_DROPS` bound every other one),
   and a backup restore reaches `prefs` without passing any
   `normalizeImported*`. A huge list is persisted on every save, joined
   into the Ajustes field and the AI prompt, and spread into `Math.min`
   in the calculator.

None of these is reachable from the app's own files. All three are
reachable from a file someone else wrote, and the repo's standard for that
is "reject or bound, never trust" (`README.md` § "Block JSON shape").

## Current state

All excerpts at `3913b8f`.

- `js/profile-transfer.js` — `ownGet` (`:71-73`, the own-property read the
  file already uses for block ids, with its rationale at `:58-70`),
  `describeProfileProblem` (`:28`, checks shape only — `pk` is used for
  the error message, never validated), `loadProfileFromText` (`:362`).
- `js/app.js` — `migrate()` (`:332-525`), the recovery screen's
  `recoverAndReload` (`:1396-1402`), `safeKey` (`:2671-2674`),
  `PLATE_MIN`/`PLATE_MAX` (`:91`), the setup sheet's plate parser
  (`:1248-1250`).
- `js/qr-transfer.js:536-538` — the QR "perfil" kind hands its payload to
  `loadProfileFromText`, so a scanned code is the same input as a file.
- `js/calculator.js:132` — `Math.min(...plates)`.
- `test/unit.js:342` — an existing `migrate()` probe with
  `activeProfile: 'ghost'`, the pattern to copy.

```js
// js/profile-transfer.js:394-395
  const target = (parsed.key && state.profiles[parsed.key]) ? parsed.key : state.activeProfile;
  const local = state.profiles[target];
// js/profile-transfer.js:419
  state.profiles[target] = incoming;
// js/profile-transfer.js:429
  mark(state.profiles[target].label + ' cargado — ' + setsLabel(theirs) + landingNote(state.profiles[target]));
```

```js
// js/profile-transfer.js:71-73
function ownGet(o, k) {
  return o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}
```

```js
// js/app.js:488 — inside migrate()
  if (!state.profiles[state.activeProfile]) state.activeProfile = profileKeys()[0];
```

```js
// js/app.js:1396-1402 — inside showRecovery
  const recoverAndReload = mutateProfile => {
    try {
      const profile = state.profiles && state.profiles[state.activeProfile];
      if (profile) mutateProfile(profile);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* reload surfaces whatever is still wrong */ }
    location.reload();
  };
```

```js
// js/app.js:91
const PLATE_MIN = { kg: 0.25, lb: 0.5 }, PLATE_MAX = { kg: 50, lb: 100 };

// js/app.js:510-516 — inside migrate()
  if (!Array.isArray(state.prefs.plates) || !state.prefs.plates.length) {
    state.prefs.plates = DEFAULT_PLATES[state.prefs.units].slice();
  } else {
    state.prefs.plates = state.prefs.plates.map(num)
      .filter(p => p >= PLATE_MIN[state.prefs.units] && p <= PLATE_MAX[state.prefs.units]);
    if (!state.prefs.plates.length) state.prefs.plates = DEFAULT_PLATES[state.prefs.units].slice();
  }

// js/app.js:1248-1250 — inside closeSetup, the Ajustes sheet's own parser
    const plates = String(setupDraft.platesText || '').split(',').map(num)
      .filter(p => p >= PLATE_MIN[state.prefs.units] && p <= PLATE_MAX[state.prefs.units]);
    if (plates.length) state.prefs.plates = plates;
```

```js
// js/app.js:2671-2674
const UNSAFE_KEYS = ['prototype'];
function safeKey(id) {
  return (id in Object.prototype) || UNSAFE_KEYS.indexOf(id) >= 0 ? '' : id;
}
```

Conventions: comments explain *why* and name the bug (the `ownGet` comment
at `js/profile-transfer.js:58-70` is the exemplar for exactly this class);
`js/profile-transfer.js` is precached in every deployed shell, so a symbol
it defines may be read by `js/app.js` without a stub (`AGENTS.md`, the
exception under "Two rules the five seams settled") — but this plan needs
no cross-file read anyway. Unit tests are `call(...)` expressions asserted
with `ok(name, cond, extra)`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js && node --check js/profile-transfer.js` | exit 0 |
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed` — **read N before Step A and count in deltas**: it printed 760 at `3913b8f` with this plan's index row in place, and plan 038 is adding assertions concurrently |
| Smoke sections (optional; Playwright + server on :8765) | `node test/smoke.js --only "profile import hardening" --only "recovery screen" --only "corrupt data recovery"` | every line `PASS` |
| Bump the shell version | `bash tools/bump-cache-version.sh` | prints `vN -> vN+1` |

Install and server one-liners are in `README.md` § "Tests". The full smoke
suite runs by itself when the pull request is opened; do not run it by
hand.

## Scope

**In scope** (the only files you may modify):
- `js/app.js` — `migrate()` (two places), `recoverAndReload`, the
  `PLATES_MAX` constant beside `PLATE_MIN`, the setup plate parser.
- `js/profile-transfer.js` — a new `profileSlotFor` helper beside
  `ownGet`, and one line in `loadProfileFromText`.
- `test/unit.js` — new assertions.
- `AGENTS.md` — one sentence under "Untrusted input".
- `sw.js` — the `CACHE_VERSION` bump only.
- `plans/README.md` — your status row.

**Out of scope**:
- `describeProfileProblem` / `describeBackupProblem` — shape checks; the
  key repair belongs where the key is used.
- `normalizeImportedProfile` — plan 038's PR 1 is editing it.
- `js/calculator.js` — with the cap in place `Math.min(...plates)` spreads
  at most `PLATES_MAX` values; leave it.
- The profile *map keys* themselves (`Object.keys(state.profiles)`): a
  JSON-parsed `"__proto__"` key is an own property and every reader takes
  the own value; not part of this finding.

## Git workflow

- Branch: `claude/040-restore-own-keys`
- One commit per step; message a plain sentence, e.g.
  `Plan 040 Step B: a backup's activeProfile is checked as an own key`.
- Do NOT push or open a PR unless the operator instructed it. Rebase on
  `main` first (plan 038 is landing in `js/app.js` and `sw.js`); take the
  higher `CACHE_VERSION` on conflict.

## Steps

### Step A: Pin the two `migrate()` repairs with assertions that fail today

In `test/unit.js`, directly after the existing probe at `:342` (grep
`activeProfile: 'ghost'`; add after the `ok(` that consumes it), insert:

```js
/* A plain object answers obj['constructor'] with a function and
   obj['__proto__'] with Object.prototype — both truthy — so a backup that
   names one as its activeProfile used to pass the repair, getBlock() threw,
   and the recovery screen's own buttons then persisted the unopenable
   state (plans/040). */
['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'].forEach(k => {
  const fixed = call('state = ' + JSON.stringify({ profiles: { hombre: {} }, activeProfile: k }) +
    '; migrate(); state.activeProfile');
  ok('migrate() repairs an activeProfile of "' + k + '" onto a profile that exists (plans/040)',
     fixed === 'hombre', fixed);
});

const platesCap = call('state = ' + JSON.stringify({
  profiles: {}, prefs: { units: 'kg', plates: Array.from({ length: 400 }, (_, i) => 1 + (i % 40) * 0.5) },
}) + '; migrate(); state.prefs.plates.length + "/" + new Set(state.prefs.plates).size');
ok('migrate() de-duplicates and caps the plate list a backup carries (plans/040)',
   platesCap === '24/24', platesCap);
```

**Verify**: `node test/unit.js` → last line `N passed, 6 failed` with N
unchanged from your first run; the six `FAIL` lines are the five
`activeProfile` cases (each printing the reserved name back) and the plates
case printing `400/40`. Nothing else fails.

### Step B: Own-property checks in `migrate()` and the recovery screen; the plates cap

In `js/app.js`:

1. Replace the line at `:488` with:

```js
  /* An own key, not a truthy read: `state.profiles['constructor']` is a
     function and `state.profiles['__proto__']` is Object.prototype, and a
     backup can name either. Either one used to pass here, getBlock() then
     threw on the way to the first draw, and the recovery screen's buttons
     wrote that state back to disk (plans/040). */
  if (!Object.prototype.hasOwnProperty.call(state.profiles, state.activeProfile)) state.activeProfile = profileKeys()[0];
```

2. In `recoverAndReload` (`:1398`), replace
   `const profile = state.profiles && state.profiles[state.activeProfile];`
   with:

```js
      const profile = state.profiles && Object.prototype.hasOwnProperty.call(state.profiles, state.activeProfile)
        ? state.profiles[state.activeProfile] : null;
```

3. Beside `PLATE_MIN`/`PLATE_MAX` (`:91`) add:

```js
/* How many plate sizes a set can hold. Real racks have a dozen at most; the
   list is the one imported collection that had no ceiling, and a backup
   restore reaches prefs without passing any normalizeImported* — so a
   file could carry a list that bloats every save, the Ajustes field and
   the AI prompt, and overflows the spread in the calculator (plans/040). */
const PLATES_MAX = 24;
```

4. In `migrate()` (`:513-514`), replace the two-line assignment with:

```js
    state.prefs.plates = Array.from(new Set(state.prefs.plates.map(num)
      .filter(p => p >= PLATE_MIN[state.prefs.units] && p <= PLATE_MAX[state.prefs.units]))).slice(0, PLATES_MAX);
```

5. In the setup parser (`:1248-1249`), apply the same shape:

```js
    const plates = Array.from(new Set(String(setupDraft.platesText || '').split(',').map(num)
      .filter(p => p >= PLATE_MIN[state.prefs.units] && p <= PLATE_MAX[state.prefs.units]))).slice(0, PLATES_MAX);
```

**Verify**: `node --check js/app.js` → exit 0. `node test/unit.js` → `N+6
passed, 0 failed`.

### Step C: The profile file lands on an own key, or on the active profile

In `js/profile-transfer.js`, directly after `ownGet` (`:73`), add:

```js
/* Which profile a loaded file replaces: the key it names, when that is a
   profile this device actually has, else the one on screen. Both halves of
   the test matter — safeKey refuses the prototype's names outright, and the
   own-property check refuses a name the map merely inherits — because
   `state.profiles[key]` alone was truthy for 'constructor' (the dialog then
   asked to replace "undefined" and the file landed as a phantom third
   profile) and for '__proto__' (the assignment re-pointed the map's
   prototype, nothing was saved, and the status line said it was). Same
   reasoning as ownGet above; this is the one place a key from a file is
   used to WRITE (plans/040). */
function profileSlotFor(key) {
  const k = typeof key === 'string' ? safeKey(key) : '';
  return k && Object.prototype.hasOwnProperty.call(state.profiles, k) ? k : state.activeProfile;
}
```

Then replace the line at `:394` with:

```js
  const target = profileSlotFor(parsed.key);
```

and shorten the comment above it (`:391-393`) to: `/* Land it on the slot
it came from; a file from somewhere stranger falls back to the profile you
are looking at — see profileSlotFor. */`.

Add the assertions to `test/unit.js`, directly after the `platesCap` block
from Step A:

```js
call('state = defaultState(); migrate();');
const slotFor = k => call('profileSlotFor(' + JSON.stringify(k) + ')');
ok('profileSlotFor lands a file on the key it names when that profile exists', slotFor('mujer') === 'mujer', slotFor('mujer'));
ok('...and on the active profile for a key nobody has', slotFor('ghost') === call('state.activeProfile'), slotFor('ghost'));
['__proto__', 'constructor', 'toString', 'hasOwnProperty'].forEach(k => {
  ok('...and on the active profile for "' + k + '", never through the prototype (plans/040)',
     slotFor(k) === call('state.activeProfile'), slotFor(k));
});
```

**Verify**: `node --check js/profile-transfer.js` → exit 0. `node
test/unit.js` → `N+12 passed, 0 failed`.

### Step D: Write the rule down where agents read first

In `AGENTS.md` § "Untrusted input" (the paragraph ending "…rather than
silently coercing it."), append one sentence:

> A key that will be used to *index* `state.profiles` — a backup's
> `activeProfile`, a profile file's `key` — is checked as an own property
> first (`migrate()`, `profileSlotFor` in `js/profile-transfer.js`),
> because a plain object answers `obj['constructor']` truthily and
> `obj['__proto__'] = x` re-points its prototype (plans/040).

**Verify**: `node test/unit.js` → `N+12 passed, 0 failed` (the docs
cross-link check reads `AGENTS.md`).

### Step E: Bump the shell version

`bash tools/bump-cache-version.sh` → `vN -> vN+1`.

**Verify**: `node test/unit.js` → `N+12 passed, 0 failed`. Optionally, with
a server and Playwright: `node test/smoke.js --only "profile import
hardening" --only "recovery screen"` → all `PASS`.

## Test plan

- Step A: five `activeProfile` repairs, one plates cap. Step C: six
  `profileSlotFor` cases. Twelve new assertions, all in `test/unit.js`,
  modelled on the `activeProfile: 'ghost'` probe at `:342`.
- Existing coverage that must stay green: § "profile import hardening"
  (unit and smoke), the `__proto__` block-id and exercise-id cases around
  `test/unit.js:660-740`, and the recovery-screen smoke sections.
- Verification: `node test/unit.js` → `0 failed`, twelve more passed than
  before Step A.

## Done criteria

- [ ] `node --check js/app.js` and `node --check js/profile-transfer.js` exit 0
- [ ] `node test/unit.js` ends `0 failed`, with twelve more `passed` than on `main`
- [ ] `grep -c "hasOwnProperty.call(state.profiles, state.activeProfile)" js/app.js` → `2`
- [ ] `grep -c "^function profileSlotFor" js/profile-transfer.js` → `1`, and
      `grep -c "state.profiles\[parsed.key\]" js/profile-transfer.js` → `0`
- [ ] `grep -c "PLATES_MAX" js/app.js` → `3` (the definition and two uses)
- [ ] `grep -c "plans/040" AGENTS.md` → `1`
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a version one higher than on `main`
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 040 updated

## STOP conditions

- The excerpt at `js/profile-transfer.js:394` or `:419` does not match
  (plan 038's PR 1 restructured `loadProfileFromText`).
- `safeKey` is not reachable from `js/profile-transfer.js` at call time
  (it is defined in `js/app.js`, which loads *after* `profile-transfer.js`
  but before any file is loaded — if `node test/unit.js` reports
  `safeKey is not defined` from Step C's assertions, stop).
- An existing assertion that a reserved name is a *valid* profile key
  exists and now fails — report it; do not delete it.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `profileSlotFor` is the single place a file's key becomes a write
  target. If a second import route ever lands a whole profile (the
  fourth audit's "file lane for plan + registro" option), route it through
  the same helper.
- The `hasOwnProperty` idiom now appears in `migrate()`, `recoverAndReload`,
  `ownGet`, `profileSlotFor` and `sessionsOf`. If a sixth site appears, a
  shared `own(obj, key)` in `js/app.js` is the deepening move; five is
  under the bar the repo uses for that.
- `PLATES_MAX = 24` is generous on purpose. If somebody's rack really has
  more sizes, raise the constant — do not remove the cap.
- Reviewer: check that `platesCap`'s expected string (`24/24`) still
  matches `PLATES_MAX` if the constant is changed in review.
