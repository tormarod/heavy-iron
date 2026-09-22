# Plan 060: "Deshacer" ends at the next change, "Recargar" really discards, and a decision toast cannot be pushed off screen

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` unless you were told otherwise.
>
> **Drift check (run first)**:
> `git diff --stat b15ae87..origin/main -- js/app.js test/unit.js test/smoke.js docs/guide.md sw.js`
> Other agent sessions land PRs on this repo mid-task. Re-locate every
> anchor below by `grep`, never by line number alone.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW–MED (touches the save path; every change is covered by a
  booted unit case)
- **Depends on**: none. Plan 065 (docs) edits the same guide section
  afterwards; land this first.
- **Category**: bug (data loss)
- **Planned at**: commit `b15ae87`, 2026-09-22 (tenth audit, findings 1 and 2)

## Why this matters

Two of the app's data-safety promises do the opposite of what they say.
Both were reproduced against the real handlers with `bootApp()`.

1. **Undo has no end.** Six destructive actions take a snapshot of the
   whole state and show a toast with **Deshacer** (`snapshotForUndo`).
   Nothing ever expires the snapshot, and the toast never hides by itself.
   So: save a plan edit ("Plan actualizado." + Deshacer), train for an
   hour with the toast still at the bottom of the screen, tap **Deshacer**
   — by mistake, or meaning "undo the plan edit" — and every set logged
   since is gone, written to storage, with no second undo. The dialogs
   promise the opposite: `UNDO_PROMISE` reads *"Podrás deshacerlo justo
   después, mientras no hagas otra cosa."* After an adopted write from
   another tab the stale snapshot erases that tab's sets too.
2. **"Recargar" overwrites the other tab.** When another tab saves while
   this one has an unsaved change, a toast offers **Quedarme con lo mío** /
   **Recargar**, and sets `held = true`. "Recargar" is a bare
   `location.reload()`. The reload fires `beforeunload`/`pagehide`, whose
   handler `flushSave()` sees `held` and **forces this tab's write** — the
   other tab's data, which the user just chose to keep, is overwritten.
   Reproduced: other tab wrote 22, this tab had 11 pending, "Recargar" →
   storage holds 11.
3. **The conflict and update toasts can be pushed off screen.** There is
   one toast box. Any later `toast()` — the undo toast, the backup nag on
   the tick that finishes a day, the quota warning — replaces the conflict
   toast, leaving `held` stuck with no button to answer it; and a replaced
   "Actualizar" is not offered again until the next cold start (the
   browser does not re-fire `updatefound` for a worker already waiting).

## Current state

All in `js/app.js` unless noted.

- **The toast** (search `function toast(`, ≈ line 1325):

  ```js
  function toast(msg, actionLabel, fn, actionLabel2, fn2) {
    $('toastMsg').textContent = msg;
    const act = $('toastAct');
    if (actionLabel) {
      act.hidden = false;
      act.textContent = actionLabel;
      act.onclick = () => { hideToast(); fn(); };
    } else {
      act.hidden = true;
    }
    … (same for toastAct2 / fn2) …
    $('toast').hidden = false;
  }
  function hideToast() { $('toast').hidden = true; }
  $('toastDismiss').onclick = hideToast;
  ```

  Its callers — all five are in `js/app.js` (`grep -n "toast(" js/*.js`):
  the quota warning inside `writeState` (≈1160), the two-tab conflict in
  the `'storage'` listener (≈1229), `snapshotForUndo` (≈1375), the backup
  nag `maybeNagBackup` (≈7070) and `offerUpdate` in
  `registerServiceWorker` (≈7128). No other file calls `toast`, so its
  signature can change without a precache-hole concern.

- **Undo** (search `let undoSnapshot`, ≈ line 1352):

  ```js
  let undoSnapshot = null;
  const UNDO_PROMISE = 'Podrás deshacerlo justo después, mientras no hagas otra cosa.';

  function snapshotForUndo(what) {
    try {
      undoSnapshot = JSON.stringify(state);
    } catch (e) {
      undoSnapshot = null;
      return;
    }
    toast(what, 'Deshacer', undoLast);
  }

  function undoLast() {
    if (!undoSnapshot) return;
    let restored;
    try { restored = JSON.parse(undoSnapshot); } catch (e) { return; }
    undoSnapshot = null;
    state = restored;
    migrate();
    applyTheme();
    save();
    render();
    mark('Deshecho');
  }
  ```

  The six callers of `snapshotForUndo`: `$('clearDay').onclick` and
  `$('wipe').onclick` (`js/app.js` ≈5892, ≈5910), `deleteBlocks`
  (`js/block-editor.js` ≈81), `$('peSave').onclick` (`js/block-editor.js`
  ≈1427), `restoreFromText` (`js/profile-transfer.js` ≈353) and
  `loadProfileFromText` (`js/profile-transfer.js` ≈427). **In every one,
  the action's own writes (`purgeRecord`/`applyPlanDraft`/`state = …`
  followed by `commit()`) run synchronously right after the snapshot, with
  no `await` in between** — verify this with a read of each before Step 1;
  it is what the design below relies on.

- **The save path** (search `function writeState(`, ≈ line 1148):

  ```js
  let held = false;
  …
  function writeState(force) {
    if (frozen) return;
    if (held && !force) return;
    held = false;
    try { pruneLog(); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); mark('Guardado …'); }
    catch (e) { … quota toast once … }
  }

  function save(scope) {
    logChanged(scope);
    clearTimeout(saveT);
    saveT = setTimeout(() => { saveT = null; writeState(); }, 400);
  }

  function flushSave() {
    if (!saveT && !held) return;
    clearTimeout(saveT);
    saveT = null;
    writeState(true);
  }

  window.addEventListener('pagehide', flushSave);
  window.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  ```

  `save('view')` is the documented narrow claim "nothing a session reads
  changed"; `logChanged('view')` returns early. It is still a real write:
  the session note, the energy chip and the machine-settings box use it.

- **The conflict** (search `window.addEventListener('storage'`, ≈ line 1225):

  ```js
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY || frozen || !ready) return;
    if (saveT || held) {
      clearTimeout(saveT);
      saveT = null;
      held = true;
      toast(
        'Otra pestaña ha guardado cambios. Aquí tienes cambios sin guardar.',
        'Quedarme con lo mío', () => { held = false; writeState(true); },
        'Recargar', () => location.reload()
      );
      return;
    }
    let next;
    try { next = JSON.parse(e.newValue); } catch (err) { return; }
    if (!next || !next.profiles) return;
    state = next;
    migrate();
    applyTheme();
    render();
    mark('Actualizado desde otra pestaña');
  });
  ```

- **Tests to model on** (`test/unit.js`, inside the async block that
  starts `(async () => {` ≈ line 7049):
  - The booted two-tab case (search `Bug 3 through the real button`,
    ≈ line 7394): writes another tab's JSON to `boot.store[key]`, then
    `boot.fire(boot.ctx.window, 'storage', { key: key, newValue: raw });`.
  - The plan-save undo case just above it (search
    `"Deshacer" on the toast the save leaves`), which presses
    `boot.$('toastAct').onclick()`.
  - Helpers: `settled(state)` (boot + `clock.advance(1000)` so load()'s
    own write has landed), `seeded({ week, day })`, `boot.card(exId).set(i)`
    to reach a set row's `tick`, `boot.clock.advance(ms)`, `boot.saved()`,
    `pressAnswering(boot, fn, 'askOk')` for handlers that open a dialog.
  - In the harness `location.reload()` only counts
    (`boot.ctx.location.reloads`); it does **not** fire `beforeunload`, so
    a test fires it by hand: `boot.fire(boot.ctx.window, 'beforeunload')`.
- The browser suite's conflict section is `test/smoke.js`, search
  `dos pestañas: el guardado pendiente no se adelanta al aviso` (≈ line
  3405). It presses "Quedarme", never "Recargar".
- `docs/guide.md` § "Undo" (≈ line 337) and the "Two tabs don't fight"
  bullet (≈ line 405) describe these behaviours.

## The decisions (settled — do not re-open)

1. **Undo expires at the next save after the action's own.** Any
   `save(scope)`, whatever its scope: a tick, a typed box, a plan edit —
   and also `save('view')`, because that scope is not only browsing: the
   session note, the energy chip and the machine-settings box write real
   data with it (`grep -n "save('view')" js/app.js`), and an undo that
   survived a typed note would erase the note. Ending undo early loses
   nothing; ending it late loses sets. Adopting another tab's write ends it
   too. When it expires, the snapshot is dropped
   and, if the undo toast is the one showing, the toast hides. This is
   exactly what `UNDO_PROMISE` already says; the dialogs do not change.
2. **How "the action's own writes" are told apart**: `snapshotForUndo`
   leaves the snapshot *unarmed*, and arms it with `setTimeout(…, 0)`. All
   of an action's own writes happen synchronously in the same task (see
   Current state), so they run while it is unarmed; the first `save()`
   after arming drops it. Do not count saves — how many a `render()` issues
   is not something this code should depend on.
3. **"Recargar" discards this tab's unsaved change.** It clears `held` and
   any pending timer and sets a module-level `discarding = true`, then
   reloads. `discarding` is checked in **`writeState`** (the one function
   every write goes through), not only in `flushSave`: a `save()` that
   lands between the press and the unload — a box losing focus, a timer
   — must not write either. Nothing else changes about
   `flushSave`: hiding the tab mid-conflict still forces this tab's write
   (its comment explains why — a set logged right before the phone is
   pocketed must not be lost); that trade-off is out of scope here.
   *Revised after the review of #170:* "Recargar" first adopts what
   storage holds into `state` (the `'storage'` listener's own adopt, one
   shared function), then sets `discarding`, clears `held`/`saveT` and
   reloads; `discarding` is cleared again 3 s later if the page is still
   alive (the reload can be stopped). And a forced write that clears
   `held` also hides the conflict toast if it is showing — the question
   it asks no longer exists.
4. **Only the conflict holds other toasts back. "Actualizar" is never
   lost but never blocks: it yields to everything and comes back after.**
   *(Revised after the review of #170; the first version pinned both, the
   conflict outranking the update — see Maintenance notes.)* One waiting
   slot each for `note` (every other toast, the undo toast included) and
   `update`, the latest of each winning; the conflict never waits, it
   always takes the box.
   - Conflict showing: a note → `queuedToast.note`; an update →
     `queuedToast.update`; a second conflict replaces the first.
   - Update showing: a note or a conflict takes the box at once, and the
     displaced update goes to `queuedToast.update`; a second update
     replaces it.
   - Note showing: a conflict takes the box and the displaced note waits
     in `queuedToast.note`; an update does **not** take the box — it
     waits in `queuedToast.update`; a note replaces a note, as before.
   - `hideToast()`: show `queuedToast.note` first (unless it is an
     `'undo'` whose snapshot has expired — drop it), else
     `queuedToast.update`.
   Why: the update toast is offered on every load while a new worker
   waits and can sit on screen for a whole session after each deploy.
   Ranked above the rest, it held Deshacer and the quota warning behind
   it: "Borrar este día" with Actualizar up never showed its Deshacer and
   the next tick expired it; a quota warning queued behind it was
   overwritten by the next undo and, with `quotaToastShown`, never came
   back.
5. **The conflict toast has no ✕.** It is a question that holds every
   save until it is answered, so `#toastDismiss` is hidden while it shows
   (and shown again for every other toast). "Actualizar" keeps its ✕ —
   dismissing it is a choice.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| One smoke section | `node test/smoke.js --only "dos pestañas"` | its assertions PASS (needs `python -m http.server 8765` running and Playwright installed — see AGENTS.md) |
| Bump | `bash tools/bump-cache-version.sh` | prints old → new |

Do **not** run the whole `test/smoke.js` or `tools/smoke-gate.sh`.

## Scope

**In scope**: `js/app.js` (toast, undo, save/flush, the `'storage'`
listener, and a `kind` argument at the three `toast(` call sites that
need one — conflict, update, undo);
`test/unit.js` (new booted cases); `test/smoke.js` (one "Recargar" step in
the existing two-tab section — optional, see Step 5); `docs/guide.md`
(§ "Undo" and the "Two tabs don't fight" bullet); `sw.js` (bump only).

**Out of scope**: the six `snapshotForUndo` callers in
`js/block-editor.js` / `js/profile-transfer.js` (they need no change —
if you find you must change one, STOP); the dialogs' wording and
`UNDO_PROMISE`; `flushSave`'s forced write on hide/close; an auto-hide
timeout for ordinary toasts; the guide's list of which actions are
undoable (plan 065 fixes that list).

## Git workflow

- Branch `claude/060-undo-conflict` from `origin/main`
  (`git checkout -B claude/060-undo-conflict --no-track origin/main`).
- One commit per step, plain-sentence subjects, e.g.
  `Undo ends at the next change, as its dialogs say`. End each message
  with your session's `Co-Authored-By:` line.
- Bump `CACHE_VERSION` last (`bash tools/bump-cache-version.sh`). On a
  rebase conflict in `sw.js`, take the higher version and bump again if
  needed.

## Steps

### Step 1: Pinned toasts and a queue

> Superseded in part by revised decision 4: there is no `TOAST_RANK` and
> no `pinned` slot any more — the slots are `note` and `update`, and only
> the conflict holds other toasts back. The rest of this step stands.

In `js/app.js`:

- Add a trailing parameter `kind` to `toast(msg, actionLabel, fn, actionLabel2, fn2, kind)`,
  default `'note'`. Keep module-level `let toastKind = null;` and
  `const queuedToast = { pinned: null, note: null };` next to it, and a
  rank table `const TOAST_RANK = { conflict: 2, update: 1 };` (anything
  not in it is rank 0, i.e. not pinned).
- At the top of `toast`, apply decision 4 against the toast showing
  (`!$('toast').hidden` and `TOAST_RANK[toastKind]`): queue into
  `queuedToast.note` or `queuedToast.pinned` as it says (store the six
  arguments as an array) and `return`; or, when a pinned call displaces a
  pinned toast, first save the displaced one's six arguments into
  `queuedToast.pinned` — so keep the arguments of the toast on screen in a
  module-level `let toastArgs = null;` whenever one is drawn. Then draw as
  today, set `toastKind` and `toastArgs`, and set
  `$('toastDismiss').hidden = kind === 'conflict';` (decision 5).
- `hideToast()` sets `hidden`, clears `toastKind`/`toastArgs`, then takes
  `queuedToast.pinned` if set, else `queuedToast.note`, clears that slot,
  and — unless it is an `'undo'` toast whose `undoSnapshot` is now null —
  calls `toast(...queued)`.
- Pass the kind at the call sites: `'conflict'` (the storage listener),
  `'update'` (`offerUpdate`), `'undo'` (`snapshotForUndo`). The quota
  warning and the backup nag stay `'note'` (omit the argument).
- Comment the block in the repo's style: why two toasts are pinned (the
  conflict leaves `held` set until it is answered; "Actualizar" is never
  offered again in this session once pushed off).

**Verify**: `node --check js/app.js`; `node test/unit.js` → `0 failed`.

### Step 2: Undo ends at the next change

In `js/app.js`:

- Add `let undoArmed = false;` beside `undoSnapshot`, and a
  `function dropUndo()` that clears both and, if `toastKind === 'undo'`,
  calls `hideToast()`.
- `snapshotForUndo`: after taking the snapshot, set `undoArmed = false`
  and `setTimeout(() => { if (undoSnapshot) undoArmed = true; }, 0);`,
  then show the toast with kind `'undo'`.
- `save(scope)`: at the top, `if (undoSnapshot && undoArmed) dropUndo();`.
- `undoLast`: must drop the snapshot *before* its own `save()` (it
  already nulls it first — keep that order, and also clear `undoArmed`).
- The `'storage'` listener's adopt branch (after `state = next;`): call
  `dropUndo()`.
- Update the header comment of the undo block: it currently ends
  "and dropped as soon as the next one replaces it"; say instead that it
  ends at the next change (decision 1), and why (the 2026-09-22 finding:
  an hour-old snapshot wiped a whole session).

**Verify**: `node test/unit.js` → `0 failed`, including the existing
`"Deshacer" on the toast the save leaves brings the sets and the exercise back`
case (it advances the clock but makes no change before pressing, so it
must still pass unchanged).

### Step 3: "Recargar" discards

In `js/app.js`:

- Add `let discarding = false;` beside `held`, with a one-line comment.
- `writeState(force)`: first line becomes `if (frozen || discarding) return;`
  (decision 3). `flushSave` needs no change of its own.
- The conflict toast's second action becomes
  `() => { discarding = true; held = false; clearTimeout(saveT); saveT = null; location.reload(); }`.
- Update `flushSave`'s comment to name the one exception.

**Verify**: `node test/unit.js` → `0 failed`.

### Step 4: Booted unit cases

Add a section in `test/unit.js` inside the async block, near the
`Bug 3 through the real button` case, headed
`console.log('\n== undo ends at the next change; "Recargar" discards; a decision toast is not pushed off (plans/060) ==');`.
Each case boots with `settled(seeded({ week: 1, day: 0 }))` — **week 1**,
because `seeded`'s log is in week 1 and "Borrar este día" clears the week
on screen; the existing clearDay case (search `"Borrar este día" (#clearDay) on a logged day`,
≈ line 7198) uses the same — and presses real handlers:

1. **Undo expires on a tick.** Clear the day (`pressAnswering(boot, () => boot.$('clearDay').onclick(), 'askOk')`),
   `boot.clock.advance(1)` (arms it), tick one set on the first card
   (`boot.card(0).set(0).tick.onclick()`, as `test/unit.js` ≈ line 7143
   does), `boot.clock.advance(1000)`. Assert
   `boot.call('undoSnapshot') === null` and `boot.$('toast').hidden === true`.
   Then press `boot.$('toastAct').onclick()` anyway and assert the ticked
   set is still in `boot.saved()`.
2. **A note typed ends undo too.** Clear the day, advance 1, type into
   the session note (`boot.type(boot.$('sesNote'), 'x')` — its
   `oninput`, bound in `drawSessionNote`, saves with `'view'`),
   advance 1000, and assert `undoSnapshot === null` and that the note is
   in `boot.saved()`.
3. **Undo survives its own action's writes.** The existing plan-save undo
   case already covers this; add one for `clearDay` pressed and Deshacer
   pressed with no advance in between → sets back.
4. **Adopting another tab's write ends undo.** Clear the day, advance
   1000 (nothing pending), fire `'storage'` with another state
   (the `Bug 3` case shows how to build `raw`), then assert
   `undoSnapshot === null`.
5. **"Recargar" leaves the other tab's data on disk.** Type a value so a
   save is pending (or call `boot.call("state.prefs.barWeight = 11, save()")`),
   put another tab's JSON (with `prefs.barWeight = 22`) in
   `boot.store[key]`, fire `'storage'`, assert the toast shows
   "Recargar" (`boot.$('toastAct2').textContent`) and that
   `boot.$('toastDismiss').hidden === true`, press
   `boot.$('toastAct2').onclick()`, then — the late write decision 3 is
   about — `boot.call('save()')`, `boot.fire(boot.ctx.window, 'beforeunload')`,
   `boot.fire(boot.ctx.window, 'pagehide')` and `boot.clock.advance(1000)`.
   Assert `boot.store[key] === raw` and `boot.ctx.location.reloads === 1`.
6. **The conflict toast is not replaced.** Raise the conflict as in 5,
   then trigger a note toast (`boot.call("toast('x')")`) and an update
   toast (`boot.call("toast('y', 'Actualizar', () => {}, null, null, 'update')")`).
   Assert the message is still the conflict's and `held === true`. Press
   "Quedarme con lo mío" → the toast shows `'x'` (the note first, under
   revised decision 4); press its ✕ (`boot.$('toastDismiss').onclick()`)
   → it shows `'y'`.

Mutation checks (run, then revert; say in the PR that you did): remove
the `dropUndo()` from `save` → case 1 fails; remove `|| discarding` from
`writeState` → case 5 fails (through its late `save()`); remove the queue
branch from `toast` → case 6 fails.

**Verify**: `node test/unit.js` → all new cases PASS, `0 failed`.

### Step 5 (optional, only if Step 4 case 5 passes): smoke

In the `dos pestañas` smoke section, after the "Quedarme" assertions,
repeat the setup (page1 pending, page2 writes) and click `#toastAct2`;
after page1 reloads, assert page2's value is what localStorage holds.
Run `node test/smoke.js --only "dos pestañas"` → PASS. If making the
second conflict reliable needs more than ~15 lines or any new fixed
`waitForTimeout`, skip this step and say so in Maintenance notes (the
unit suite ratchets the smoke file's `waitForTimeout` count — search
`waitForTimeout` in `test/unit.js`; do not raise it).

### Step 6: The guide

`docs/guide.md`:
- § "Undo": say that **Deshacer** lasts until the next thing you do — a
  set ticked, a box typed, a note, a plan edit, moving to another week,
  day or profile — or a change arriving from another tab. (Navigation
  saves with `commit('view')` — `js/app.js`, search `profile.week++; commit('view')` —
  so it ends undo too; that is decision 1's "ending early loses
  nothing".) Keep "one level deep" and
  "doesn't survive a reload". Do not rewrite which actions are undoable
  (plan 065 does).
- The "Two tabs don't fight" bullet: add that **Recargar** keeps what the
  other tab saved and drops the change here, and **Quedarme con lo mío**
  does the opposite; and that the question stays on screen until it is
  answered.

**Verify**: `node test/unit.js` → `0 failed` (it checks the docs' links).

### Step 7: Bump, PR

`bash tools/bump-cache-version.sh`, commit, open the PR.

## Test plan

Step 4's six booted cases and three mutation checks; the existing undo and
two-tab cases stay green unchanged; optionally Step 5's smoke step.

## Done criteria

- [ ] `node --check js/app.js` exit 0; `node test/unit.js` → `0 failed`
      with six new `(plans/060)` cases
- [ ] `grep -n "'Recargar', () => location.reload()" js/app.js` → no output
- [ ] `grep -n "toast(" js/*.js` lists call sites in `js/app.js` only, and
      the conflict, update and undo ones pass `'conflict'`, `'update'`,
      `'undo'`
- [ ] Mutation checks run and failed as expected (listed in the PR)
- [ ] `docs/guide.md` § "Undo" says it ends at the next change
- [ ] `CACHE_VERSION` above `origin/main`'s; only in-scope files changed

## STOP conditions

- Something other than the conflict's "Quedarme con lo mío" is found to
  call `writeState` directly with a user's change in it (it would bypass
  undo expiry) — report it.
- One of the six `snapshotForUndo` callers has an `await` (or a
  `setTimeout`) between the snapshot and its `commit()`: decision 2 does
  not hold for it. Report which.
- `render()` → `drawApp()` turns out to call `save()` with no scope
  **after** a `setTimeout(0)` of its own (a deferred save would expire
  undo spontaneously). Check with case 3 plus a case that clears the day,
  advances 1000, and presses Deshacer — it must restore.
- The existing test `"Deshacer" on the toast the save leaves …` fails
  after Step 2 and the cause is not a missing `clock.advance`.
- Any `toast(` call appears outside `js/app.js`.

## Maintenance notes

- Any new destructive action must call `snapshotForUndo` *before* its
  writes and must do its writes synchronously after it, or it has to arm
  the snapshot itself.
- A new write path that bypasses `save()` (e.g. calls `writeState`
  directly) would not expire undo. Today only the conflict's "Quedarme"
  does, and it is not a change to the data.
- Still open, recorded not fixed: hiding the tab while a conflict is
  unanswered forces this tab's write (`flushSave`'s deliberate choice).
  Switching to the *other* tab is a hide. Whether that should instead
  keep the other tab's data is a maintainer call.
- Executor, 2026-09-22 (branch `claude/060-undo-conflict`):
  - Decision 2's premise was checked before coding: all six callers run
    their writes and `commit()` synchronously after `snapshotForUndo`
    (the three `deleteBlocks` callers call it after their `await ask`, not
    between the snapshot and the commit). `restoreFromText` and
    `loadProfileFromText` also call `flushSave()` → `writeState(true)`
    after the commit; that bypasses `save()` but is the action's own write,
    so it needs no expiry. No `setTimeout`/`requestAnimationFrame` in
    `js/` other than `save()`'s own debounce and `js/boot-guard.js`, so no
    deferred save can expire undo on its own; the existing clearDay case
    (advance 1000, then Deshacer) still restores. No STOP condition fired.
  - First version, refinements of the original decision 4 (both kept by
    the revision below): a toast displaced by one of the **same kind** is
    superseded, not queued (a second conflict event would otherwise queue a
    stale copy of the same question); and an ordinary toast the conflict
    pushes aside waits in the `note` slot rather than being lost (the undo
    toast, when the conflict arrives inside its action's 400 ms save
    delay, is still good once the question is answered).
  - **Revised after the review of #170** (tech lead's changes, applied on
    the same branch):
    - Decision 4 replaced (text above): the original pinned "Actualizar"
      too, ranked below the conflict and above everything else. Because it
      is offered on every load while a worker waits, it could sit on
      screen all session and hold back the toasts that cannot wait — the
      reviewer reproduced a Deshacer that never showed and a quota warning
      that was overwritten and, fired once per load, never came back.
      `TOAST_RANK` and the `pinned` slot are gone; `toastPlace()` maps a
      kind to `note`/`update`/`conflict`.
    - A forced write that clears `held` (`flushSave` on hide/close, and so
      every import, restore and profile load, and the worker swap) hides
      the conflict toast if it is showing: that write is "Quedarme con lo
      mío" answered.
    - "Recargar" adopts what storage holds first (`adoptStored`, shared
      with the `'storage'` listener), then discards and reloads, and
      clears `discarding` 3 s later if the page is still alive. A residual
      edge, not handled: a change made inside those 3 s is refused by
      `writeState` and is written only by the next `save()` after it; if
      the tab is closed before any, `flushSave` finds nothing pending and
      it is lost. Reaching it needs the reload stopped and a change within
      3 s.
    - Tests: eight more booted cases (12 more assertions) — Actualizar up
      then Deshacer at once and back after ✕; Actualizar arriving over the
      undo toast waits; Actualizar back after the question is answered;
      the quota warning over Actualizar; the question inside
      "Borrar este día"'s save delay, Deshacer back after "Quedarme" and
      still restoring; the same with a tick in between (no expired
      Deshacer); a forced write hides the question; a stopped "Recargar"
      is on the other tab's data and saves again after 3 s. Case 5 now
      makes a late *change* (barWeight 33) rather than a bare `save()`,
      because after the adopt a bare save would write the other tab's own
      data back and prove nothing. Case 6's order is note first, then
      update.
    - The guide's § Undo says what happens when the other tab's change
      lands inside the action's own save delay.
  - Steps 1–3 landed as one commit (they are interleaved in the same few
    functions of `js/app.js`), not one per step.
  - Step 5 done: 8 lines in the `dos pestañas` section, no new
    `waitForTimeout` (`waitForFunction(() => held === true)` and
    `waitForEvent('load')`). Note that removing only `|| discarding` from
    `writeState` does not fail the smoke step (nothing calls `save()`
    between the click and the unload there); reverting the handler to the
    bare `location.reload()` does. The unit case 5 covers the late save.
  - The guide's "Two tabs" bullet also says that hiding or closing the tab
    (or loading a backup, profile or block) before answering saves this
    tab's change and counts as the answer (`flushSave`'s kept trade-off),
    so "stays on screen until answered" is not read as "nothing is written
    until answered".
