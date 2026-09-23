# Plan 076: "Deshacer" survives a throw inside `migrate()` like every other caller, and the callers are pinned so a new one cannot come unguarded

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If a STOP condition occurs, stop and report — do not
> improvise. Fill in "Maintenance notes" when done; the orchestrator
> maintains `plans/README.md` — do not edit it.
>
> **One PR** (`claude/076-undo-guard`). It changes `js/app.js`, so it
> **bumps `CACHE_VERSION`** once, as its last commit.
>
> **Drift check (run first)**: `git diff --stat dfa29a9..origin/main -- js/app.js test/unit.js AGENTS.md`
> — plans 074, 075 and 077 run at the same time. 077 edits `js/app.js`
> (EX_FIELDS and ROW_FIELDS, far from `undoLast`), and all of them edit
> `test/unit.js` and AGENTS.md in other places. Re-find each excerpt by
> its quoted text; a changed meaning is a STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (robustness)
- **Planned at**: commit `dfa29a9`, 2026-09-23 — the maintainer asked for
  the topics plans 071–073 had set aside to be done after all

## Why this matters

`migrate()` (`js/app.js`) repairs whatever state it is handed, and it runs
on every path that replaces this tab's state. Plan 067 B and plan 071 B
made every such path survive a throw inside it:
- `load()` lands on the recovery screen, which stops writing and hands
  the bytes over;
- `adoptStored` (another tab's write), `restoreFromText` ("Cargar copia")
  and `loadProfileFromText` (a profile file) put this tab's data back
  and say why.

One caller is left: `undoLast()`, the "Deshacer" on the toast. It sets
`state` to the snapshot and calls `migrate()` bare. The snapshot is this
tab's own state from seconds earlier, already migrated, so a throw there
would be an app bug. But an app bug is exactly what a guard is for. A
throw now ends the handler with `state` pointing at a half-repaired
snapshot, the "Deshacer" already spent, and the next `save()` writes it.
Plan 071 B's executor noted it as the last unguarded caller. This plan
guards it the way the others are guarded, and pins the list of callers,
so the sixth is written with a guard from the start.

## The decisions (settled — do not re-open)

1. **`undoLast()` guards `migrate()` like `adoptStored` does**: capture
   `const prev = state;` before `state = restored;`. On a throw,
   `state = prev;`, then `mark('No se ha podido deshacer: ' + err.message, true);`
   and return, before `applyTheme()`/`save()`/`render()`. The snapshot is
   already dropped (`undoSnapshot = null` runs before, on purpose, see
   its comment), so there is no second try. That is right: the same
   snapshot would throw again.
2. **The callers are pinned.** A new assertion collects every `migrate()`
   call in `js/*.js` (block comments stripped, the definition excluded)
   and requires exactly the five known callers, each named by the
   function it sits in: `load`, `adoptStored`, `undoLast`,
   `restoreFromText`, `loadProfileFromText`. It also requires that each
   call sits directly inside a `try {` block. A simple textual rule works:
   the nearest `try {` before the call is less than 3 lines up, and no
   `}` of the try closes in between. The failure message says what a new
   caller needs: a guard, and a booted test that throws through it.
3. **AGENTS.md states the rule once**: a new bullet at the end of
   § "Untrusted input", "**A throw inside `migrate()`**". Every caller
   catches it: `load()` lands on the recovery screen, and the four that
   replace this tab's state put this tab's data back and say why. Name
   the pinned test, and point to `adoptStored` as the pattern.

## Current state

`js/app.js` — `undoLast()` (search for `function undoLast`):

```js
function undoLast() {
  if (!undoSnapshot) return;
  let restored;
  try { restored = JSON.parse(undoSnapshot); } catch (e) { return; }
  /* Before the save() below, which would otherwise take it for the next
     change and try to drop it. */
  undoSnapshot = null;
  undoArmed = false;
  state = restored;
  migrate();
  applyTheme();
  save();
  render();
  mark('Deshecho');
}
```

The pattern, `adoptStored` (search for `function adoptStored`):

```js
  const prev = state;
  state = next;
  try {
    migrate();
  } catch (err) {
    /* migrate() throwing partway (bytes a newer release wrote, say) used to
       leave `state` pointed at a half-migrated object with nothing having
       drawn it — but the next save() still wrote that over this tab's own
       data. Put it back, the same as the parse/shape checks above. */
    state = prev;
    return false;
  }
```

The five calls at `dfa29a9` (`grep -n "migrate();" js/*.js`):
`js/app.js` in `load()`, `adoptStored()` and `undoLast()`, and
`js/profile-transfer.js` in `restoreFromText()` and
`loadProfileFromText()`. All but `undoLast`'s are inside a `try {`.

The booted test pattern: the section
`== no throw inside migrate() strands the app (plans/071 B) ==` in
`test/unit.js`. It has a `stubMigrateThrows(boot)` helper (throws once,
then puts the real `migrate` back), and cases that check `state` is the
same object, storage is unchanged after `boot.clock.advance(1000)`, and
the status line (`boot.$('status').textContent`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| Bump (last commit) | `bash tools/bump-cache-version.sh` | `sw.js` one version up |
| CR check | `node -e "for (const f of ['js/app.js','test/unit.js','AGENTS.md']) console.log(f, (require('fs').readFileSync(f,'utf8').match(/\r/g)\|\|[]).length)"` | `0` each |

## Scope

**In scope**: `js/app.js` (`undoLast` only), `test/unit.js` (one new
section), `AGENTS.md` (one new bullet), `sw.js` (the bump, through the
tool), this plan's Maintenance notes.

**Out of scope**: every other caller of `migrate()` (already guarded),
`migrate()` itself, `snapshotForUndo`/`dropUndo`, the toast code, and
every other AGENTS.md line.

## Git workflow

`git fetch origin && git checkout -B claude/076-undo-guard --no-track origin/main`;
plain-sentence commit subjects; the bump is the last commit.

## Steps

### Step 1: the guard

Per decision 1. The comment follows `adoptStored`'s, and points to it:
the snapshot is this tab's own and already migrated, so a throw here is an
app bug. Before this guard, it left `state` half repaired for the next
save to write.

**Verify**: `node --check js/app.js` → exit 0; `node test/unit.js` →
`0 failed`.

### Step 2: the tests

A new section in the booted area of `test/unit.js`, right after the
section `== no throw inside migrate() strands the app (plans/071 B) ==`
(and so before `== sw.js runs … (plans/066) ==`), headed
`console.log('\n== "Deshacer" survives a throw inside migrate(), and every caller is guarded (plans/076) ==');`:
1. **The pin** (decision 2): the five callers, each inside a `try`.
2. **"Deshacer" over a throwing `migrate()`**: on a booted app with a
   logged day (use `settled(seeded(…))` and a day with sets, as the plan
   060 and 073 sections do), press "Borrar este día" and answer
   "Borrar". Save the state as it is now (the day cleared: `boot.saved()`
   after `advance(1000)`). Stub `migrate` to throw once, and press the
   toast's "Deshacer" (`boot.$('toastAct').onclick()`). Afterwards:
   - `state` is the same object as before the press;
   - the day is still cleared;
   - the status line reads `'No se ha podido deshacer: '` plus the stub's
     message;
   - after `advance(1000)` storage holds the cleared day, unchanged;
   - a second press on the toast's button, if it is still there, does
     nothing.
   Each check is its own `ok`, and the case catches its own errors.

**Mutation checks** (report each):
- remove the guard (call `migrate()` bare again) → case 2 FAILs, and
  the case catches the throw. The suite must still reach its summary;
- add a sixth bare `migrate();` call in any function of
  `js/calculator.js` → the pin FAILs, naming it. Revert.

**Verify**: `node test/unit.js` → `0 failed`.

### Step 3: AGENTS.md

The bullet of decision 3, at the end of § "Untrusted input", in the
file's voice (3–6 lines).

**Verify**: `node test/unit.js` → `0 failed`.

### Step 4: the bump

`bash tools/bump-cache-version.sh`, committed last. Rebase and re-bump at
push time if `origin/main` moved (your brief says how).

## Test plan

Step 2: the pin, the booted case, and two mutation checks. Model the
booted case on the plan 071 B section's cases 3 and 4.

## Done criteria

- [ ] `undoLast` catches a throw from `migrate()` and puts this tab's
      state back
- [ ] the pin lists exactly five callers, all inside `try`, and fails on
      a sixth bare call
- [ ] the booted case passes, and fails without the guard
- [ ] AGENTS.md has the bullet
- [ ] `node test/unit.js` → `0 failed`; CR check `0`; one bump, last

## STOP conditions

- `grep -n "migrate();" js/*.js` on `origin/main` does not list exactly
  the five callers named above.
- Pressing "Deshacer" in a booted app needs something the harness does
  not have: report rather than edit `test/harness.js`.

## Maintenance notes

- A sixth caller of `migrate()` fails the pin until it has a guard and
  its entry.
- The drift check and the STOP condition's grep both came back clean at
  push time (`dfa29a9..origin/main` touched none of `js/app.js`,
  `test/unit.js` or `AGENTS.md`; `origin/main`'s five `migrate();` calls
  matched the plan exactly), so no adaptation was needed there.
- The pin's "directly inside a try" check reads the function each call
  sits in the same way: the nearest preceding `function NAME(` in the
  file, backward from the call. No caller today nests a named function
  between its own declaration and its `migrate()` call, so this is
  enough; a caller that did would need a less naive scan.
- Plan 074 merged first and took v142 while this branch was in progress
  (`origin/main` was `1b91860` at branch time, `de7838b` at push time).
  Rebased onto it and re-bumped at push time, per the brief.
