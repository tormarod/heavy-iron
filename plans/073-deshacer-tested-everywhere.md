# Plan 073: "Deshacer" is tested through the real button of every action that offers it, a new one cannot slip in untested, and AGENTS.md states the rule

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If a STOP condition occurs, stop and report — do not
> improvise. Fill in "Maintenance notes" when done; the orchestrator
> maintains `plans/README.md` — do not edit it.
>
> **One PR** (`claude/073-undo-tests`). Tests and docs only — **no**
> `CACHE_VERSION` bump; do not touch `sw.js`, `js/`, `css/`,
> `index.html`. If a test shows an action's "Deshacer" does NOT put
> everything back, that is a bug in `js/`: STOP and report it; do not fix
> it here.
>
> **Drift check (run first)**: `git diff --stat 8ff9355..origin/main -- test/unit.js AGENTS.md js/profile-transfer.js js/block-editor.js js/app.js`
> — plan 071 B edits `restoreFromText`/`loadProfileFromText` (only their
> failure path), and plans 071/072 edit `test/unit.js` and AGENTS.md in
> other places. Re-find each excerpt by its quoted text; a changed
> meaning is a STOP.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW (tests and one doc section; no shipped code)
- **Depends on**: none
- **Category**: tests / docs
- **Planned at**: commit `8ff9355`, 2026-09-23 — the follow-ups recorded
  when plans 067–070 were executed (`plans/README.md`, "Follow-ups found
  while executing 067–070")

## Why this matters

Every destructive action in the app asks first, then takes a snapshot of
the whole state, and a "Deshacer" toast puts it back: the one recourse
after "the wrong day, the wrong profile, the wrong block". What keeps it
working is a rule written only in a code comment (`js/app.js`, above
`let undoArmed`). The snapshot comes before the action's first write,
with no `await` between them, because the first `save()` after the
snapshot is armed ends the undo. An action that awaits in between loses
its own "Deshacer" the moment it writes, and nothing on screen says so.

Six actions take a snapshot. Two are tested through their real button,
with "Deshacer" pressed after: "Borrar este día" (the plans/052 booted
section) and "Guardar cambios" in the plan editor (plans/053). The other
four are not: "Borrar todos los datos", deleting blocks, "Cargar copia" and
loading a profile file. The last two replace the whole log. AGENTS.md
does not state the rule at all, so the next destructive action is
written from memory.

## The decisions (settled — do not re-open)

1. **A booted test for each of the four untested actions, through its
   real button**, in the shape of the "Borrar este día" test (below):
   the question is asked; "Cancelar" changes nothing and leaves no undo;
   "OK" does what the dialog said; `save()` writes it; "Deshacer" on the
   toast puts back exactly what was there. "Exactly" means `boot.saved()`
   after `boot.clock.advance(1000)`, deep-equal before the action and
   after "Deshacer". The saved copy is compared because `pruneLog` drops
   the rows a draw pads, which in-memory `state` still has.
2. **Deleting blocks is tested through all three of its buttons**, since
   each reaches `deleteBlocks` differently: the block manager's
   per-row "Eliminar" (`.blk-del`), "Eliminar los demás"
   (`#blkKeepCurrent`), and the plan editor's "Eliminar bloque"
   (`#peDeleteBlock`, which closes the editor first). The full cycle
   (cancel, OK, save, Deshacer) is for the per-row button. The other two
   need OK then Deshacer.
3. **The list of actions is pinned.** A new assertion collects every call
   of `snapshotForUndo(` in `js/*.js`, excluding its definition. It fails
   unless the calls are exactly the six known ones, each keyed by its file
   and the first string literal of its message. The failure message tells
   the author to add a booted "Deshacer" test and then the new entry. This
   is the same "pinned on purpose" pattern the suite uses for
   `save('view')`.
4. **AGENTS.md states the rule once**, transcribed from the comment above
   `undoArmed` and from `UNDO_PROMISE`'s comment, in a new subsection at
   the end of "## The data model's rules", titled
   `### Destructive actions and Deshacer`. It also gets one checklist
   line. "Undo is one level deep and doesn't survive a reload" is already
   in § Documented limits: point to it, do not repeat it. No new policy:
   every sentence must be true of the code today.

## Current state

The six calls, at `8ff9355`:

| File:line | Message (first literal) | Reached from | Tested with "Deshacer"? |
|---|---|---|---|
| `js/app.js:6278` | `'Borrado '` | `$('clearDay').onclick` | yes (plans/052 section) |
| `js/app.js:6296` | `'Borrado todo el registro de '` | `$('wipe').onclick` ("Borrar todos los datos") | **no** |
| `js/block-editor.js:81` | `'Bloque eliminado.'` or `' bloques eliminados.'` (a ternary) | `deleteBlocks(profile, ids)`: `.blk-del` (line ~142), `#blkKeepCurrent` (~1404), `#peDeleteBlock` (~1539) | **no** |
| `js/block-editor.js:1504` | `'Plan actualizado.'` | `#peSave` | yes (plans/053 section) |
| `js/profile-transfer.js:353` | `'Registro restaurado desde una copia.'` | `restoreFromText`: `#bRestore` with `#blob`'s text, or a file | **no** |
| `js/profile-transfer.js:432` | `'Perfil de '` | `loadProfileFromText`: a profile file, or a QR "perfil" | **no** |

For the ternary in `deleteBlocks`, key it by the file plus the text
`drop.size === 1 ? 'Bloque eliminado.'`, or by the first literal found.
Choose one way, and say which in a comment.

The rule's source, `js/app.js:1624-1631`:

```js
/* False for the rest of the task that took the snapshot. The action's own
   writes (purgeRecord / applyPlanDraft / state = …, then commit()) all run
   synchronously right after snapshotForUndo, so they land while it is
   unarmed; the first save() after the timer arms it is the next change.
   Counting saves instead would tie undo to how many a render() issues. A
   new destructive action has to keep that shape — snapshot, then its
   writes with no await between — or arm the snapshot itself. */
let undoArmed = false;
```

`js/app.js:1633-1643` (`UNDO_PROMISE`'s comment): five dialogs used to say
"No se puede deshacer." and then snapshot anyway; the dialog in front of a
snapshot promises `UNDO_PROMISE` ('Podrás deshacerlo justo después,
mientras no hagas otra cosa.'); the one dialog that still says "No se
puede deshacer" (deleting a retired exercise's log in the plan editor) is
right to, because nothing snapshots it until the editor's own save.

`js/app.js:1610-1622` (the undo block's opening comment): one snapshot of
the whole state, offered through the toast, ended by the next change of
any kind or by a write adopted from another tab (plans/060).

The pattern to copy, the "Borrar este día" test (`test/unit.js`, inside
the section `== bootApp(): the shell booted for real, and its own handlers
(plans/052) ==`, about line 8390):

```js
    const press = async answer => {
      const out = { asked: false, err: '' };
      try {
        const pressing = boot.$('clearDay').onclick();
        out.asked = boot.call('!!askResolve') && boot.$('askT').textContent === '¿Borrar este día?';
        boot.$(answer).onclick();
        await pressing;
      } catch (e) { out.err = e.message; }
      return out;
    };
    …
    let undoErr = '';
    try { boot.$('toastAct').onclick(); } catch (e) { undoErr = e.message; }
    ok('"Deshacer" on the toast it leaves brings all of it back', …);
```

Helpers already in the booted area: `seeded(at, edit)` and `settled(state)`
(about line 8288), `reopen(boot)` (8311), and in the plan 053 section
`pressAnswering(boot, press, answer)` and `planEditor(boot)` (8518-8540).
They are local to their blocks, so copy what you need into your section.

Building the inputs, as existing tests do:
- a backup's text:
  `boot.call("JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2)")`
  (the plans/055 section, about line 10012);
- a profile file's text: `boot.call("profileExportPayload('hombre')")`
  (`js/app.js:7624`, the export the "Guardar perfil" buttons use);
- answering a dialog without a button:
  `boot.call('closeAsk(true)')` (the plans/010 section).

What each action's dialog says (for the "it asked" assertion). Check the
titles in the source:
- `#wipe`: `'¿Borrar todo el registro de ' + profile.label + '?'`;
- `.blk-del`: `'¿Eliminar "' + block.name + '"…'`;
- `#blkKeepCurrent`: `'¿Eliminar los otros ' + n + ' bloques de …'`;
- `#peDeleteBlock`: `'¿Eliminar "' + peDraft.block.name + '"?'`;
- `#bRestore`: `'¿Reemplazar todo tu registro con esta copia?'`;
- `loadProfileFromText`: `'¿Sustituir el perfil de ' + local.label + '?'`.

AGENTS.md's checklist (after the intro, "## Before you change anything")
has, in order, "… **A new field on a plan exercise** …", then "**Code
that reads or writes logged sets** …". § "The data model's rules" ends
with "### What a plan exercise may hold", followed by "## The CSP".

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit | `node test/unit.js` | `0 failed` |
| Syntax | `node --check test/unit.js` | exit 0 |
| CR check | `node -e "for (const f of ['test/unit.js','AGENTS.md']) console.log(f, (require('fs').readFileSync(f,'utf8').match(/\r/g)\|\|[]).length)"` | `0` each |

## Scope

**In scope**: `test/unit.js` (one new section, and the pinning assertion
inside it), `AGENTS.md` (one checklist line, one new subsection), this
plan's Maintenance notes.

**Out of scope**: all of `js/`, `sw.js`, `test/harness.js`, `README.md`,
`docs/guide.md` (it already names the six undoable actions), every other
AGENTS.md line (plan 072 edits the checklist's log-key line and § Log
keys at the same time).

## Git workflow

`git fetch origin && git checkout -B claude/073-undo-tests --no-track origin/main`;
plain-sentence commit subjects; no bump.

## Steps

### Step 1: the section and the four actions

A new section in the booted area of `test/unit.js`, right after the
section `== undo ends at the next change; "Recargar" discards; a decision
toast is not pushed off (plans/060) ==` ends, and before `== adoptStored
migrates before it commits (plans/067 B) ==`:

```js
  console.log('\n== "Deshacer" on every action that offers it, through its real button (plans/073) ==');
```

Each case gets its own block `{ … }`, catches its own errors into a
string, and reports a FAIL. A throw must never end the suite. Use a
seeded state with something to lose: sets in two weeks and on two days, a
note, and for the block cases a second and a third block with sets of
their own (a block can be added in `seeded`'s `edit` callback by copying
the active block under a new key, and adding it to `blockOrder`).

1. **"Borrar todos los datos"** (`#wipe`): asks (title as above);
   "Cancelar" (`askCancel`) changes nothing, and `undoSnapshot` is still
   `null`. "Borrar todo" (`askOk`) leaves no used row in any block of the
   profile, while the plan is still there. After `clock.advance(1000)`
   the saved copy agrees. The toast's action reads "Deshacer"
   (`boot.$('toastAct').textContent`). Pressing it puts `boot.saved()`
   back, deep-equal to before.
2. **Deleting a block, three ways** (decision 2):
   - a. Open the block manager as the app does (find how `#blocksSheet` is
     opened and its rows are drawn: `renderBlockManager()`). Press a
     non-active block's `.blk-del` with "Cancelar", then with "Eliminar".
     The block and its record are gone and the active block is
     untouched; the saved copy agrees; "Deshacer" puts it all back.
   - b. `#blkKeepCurrent` with "Eliminar": only the active block is left;
     "Deshacer" puts the others back, in their order (`blockOrder`) and
     with their record.
   - c. The plan editor on the active block (`boot.$('editPlan').onclick()`
     as the plan 053 section does), then `#peDeleteBlock` with
     "Eliminar": the editor closes, the block is gone and another is
     active. "Deshacer" puts the block back as the active one, with its
     record.
3. **"Cargar copia"** (`#bRestore`): take a backup of a *different* state
   (another seeded boot's text), and put it in `boot.$('blob').value`.
   "Cancelar" changes nothing. "Reemplazar" (the dialog's OK) makes the
   saved copy the backup's data. "Deshacer" puts this phone's own data
   back.
4. **Loading a profile file**: `loadProfileFromText(text)` with a profile
   file taken from a different state (another seeded boot's
   `profileExportPayload('hombre')`). "Cancelar" changes nothing.
   "Sustituir" replaces that one profile and leaves the other untouched.
   "Deshacer" puts it back.

**Verify**: `node test/unit.js` → `0 failed`, the new section's assertions
among the passes. If a "Deshacer" assertion fails because the state is
*not* put back, go to the STOP conditions. That is a bug to report, not
to fix.

### Step 2: pin the list

In the same section, before the four cases:

```js
  /* A new destructive action has to keep the shape the comment above
     undoArmed describes, and nothing but a test through its real button
     shows that it does. So the actions are pinned: a seventh call fails
     here until it has a "Deshacer" test and an entry below. */
```

Collect every `snapshotForUndo(` call in `js/*.js`, block comments
stripped first, excluding `function snapshotForUndo(`. Map each to
`file + ': ' + <first string literal after the call, or your chosen key
for the ternary>`. Assert that the sorted list equals the six known
entries, and print the actual list as the diagnostic.

**Mutation check**: add `snapshotForUndo('Prueba.');` to any handler in
`js/calculator.js`. The assertion FAILs, listing it. Revert, and it
PASSes. Report it.

**Verify**: `node test/unit.js` → `0 failed`.

### Step 3: AGENTS.md

**3a.** A checklist line between "**A new field on a plan exercise**" and
"**Code that reads or writes logged sets**":

```
- **A destructive action** — `ask` first; then `snapshotForUndo` before
  its first write, with no `await` between; its dialog promises
  `UNDO_PROMISE`; and a booted test presses its real button, then
  "Deshacer". Held by unit "\"Deshacer\" on every action that offers it,
  through its real button", which pins the list of actions.
  → [Destructive actions and Deshacer](#destructive-actions-and-deshacer)
```

**3b.** The subsection, appended at the end of "## The data model's
rules", after "### What a plan exercise may hold". About 12–18 lines, in
the file's voice. It must say:
- every destructive action asks first, then takes one snapshot of the
  whole state before its first write, and "Deshacer" on the toast puts
  it back;
- the snapshot comes before the writes with no `await` between them, or
  the action arms it itself. Say why: the action's own writes land while
  the snapshot is unarmed, and the first `save()` after it is armed ends
  it. Name `undoArmed` in `js/app.js` as where this is explained;
- undo ends at the next change of any kind, or at a write adopted from
  another tab (plans/060). Its depth and reload limits are in
  [Documented limits](#documented-limits--settled-decisions-not-bugs).
  Link it; the unit link check verifies the anchor, so run it;
- the dialog in front of a snapshot promises `UNDO_PROMISE`. Include the
  one exception and its reason: deleting a retired exercise's log in the
  plan editor, which nothing snapshots until the editor's save;
- the six actions, named as the user sees them, and that each is tested
  through its real button, naming the three unit sections (plans/052,
  plans/053, and this plan's).

**Verify**: `node test/unit.js` → `0 failed` (the link check covers the
new anchors); CR check `0`; `git diff --stat origin/main` shows only
`test/unit.js`, `AGENTS.md` and the plan.

## Test plan

Covered in Steps 1–2: four actions (six buttons), each with its
"Cancelar" and "Deshacer" assertions, plus the pinned list and its
mutation check. No harness changes.

## Done criteria

- [ ] the new section passes: #wipe, `.blk-del`, `#blkKeepCurrent`,
      `#peDeleteBlock`, `#bRestore`, `loadProfileFromText`, each put
      back by "Deshacer"
- [ ] the pinning assertion lists exactly six calls, and fails on a
      seventh (mutation check)
- [ ] AGENTS.md has the checklist line and
      `### Destructive actions and Deshacer`; the link check passes
- [ ] `node test/unit.js` → `0 failed`; CR check `0`; no `js/`/`sw.js`
      change

## STOP conditions

- "Deshacer" does not put the state back for some action (the assertion
  fails with a real difference, not a test mistake). That is a bug in
  `js/`. Report the action, the difference and the code path. Do not fix
  it here.
- The number of `snapshotForUndo(` calls on `origin/main` is not six.
- A button named above does not exist or does not reach
  `snapshotForUndo`.
- Driving the block manager or the plan editor needs a change to
  `test/harness.js`.

## Maintenance notes

- A seventh destructive action: write its booted "Deshacer" test here
  first, then add it to the pinned list, then its line in AGENTS.md's
  subsection.
- *(Executor: record deviations here.)*
