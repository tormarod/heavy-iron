# Plan 024: Every import rejection path flushes the pending autosave first, and none of them forces a write through a two-tab conflict

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- js/app.js js/profile-transfer.js js/qr-transfer.js test/unit.js test/smoke.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

Saves are debounced: typing a weight schedules a write 400 ms later, and
that write ends with the status line "Guardado hh:mm". Commit `af2b99a`
found that a set ticked just before loading a backup left that timer
pending, so it fired *after* the restore had printed "Esa copia no se puede
usar: …" and replaced the rejection reason with "Guardado" — the one
message the user needed, gone. The fix was to call `flushSave()` at the top
of `restoreFromText`.

Two things are wrong with it at `4f7e037`:

1. The same race exists on the other two import paths — loading a profile
   file (`loadProfileFromText`, four rejection messages) and applying a
   scanned QR (`applyQrPayload`, three rejection messages, and it routes a
   QR "perfil" into `loadProfileFromText` on top). Neither flushes.
2. `flushSave()` *forces* the write, by design: it exists for the tab going
   away, where an unanswered two-tab toast must never cost a set. Called
   from a restore's pre-flight, it means that while the "Otra pestaña ha
   guardado cambios" toast is up, merely opening a file that turns out not
   to be a backup writes this tab's state over the other tab's newer data
   and clears the conflict — answering the toast on the user's behalf.

After this plan there is a second helper, `flushPending()`, that lands the
pending debounce and does nothing else; all three import entry points call
it first; `flushSave()` keeps forcing only where it should.

## Current state

Files:

- `js/app.js` — storage section: `writeState` (line 598), `save` (616),
  `flushSave` (626), the page-exit listeners (634–642), the `storage`
  handler for two-tab conflicts (651–670).
- `js/profile-transfer.js` — `restoreFromText` (starts near line 270; the
  pre-flight flush is at 282, the post-confirm one at 330);
  `loadProfileFromText` (line 339).
- `js/qr-transfer.js` — `applyQrPayload` (line 529).
- `test/unit.js` — the storage-failure section at 1809–1845 shows how to
  pin `frozen`/`ready`/`held` and stub `localStorage` around a probe.
- `test/smoke.js` — section "dos pestañas: el guardado pendiente no se
  adelanta al aviso" exercises the conflict toast in a real browser.
- `sw.js` — `CACHE_VERSION` at line 21.

The write and its two flags — `js/app.js:598-602`:

```js
function writeState(force) {
  if (frozen) return;
  if (held && !force) return;
  held = false;
  try {
```

The debounce and the forcing flush — `js/app.js:616-632`:

```js
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { saveT = null; writeState(); }, 400);
}

/* Always forces the write through, even mid-conflict: an unanswered toast
   must never be the reason a set logged right before closing the tab is
   lost. The conflict itself was never about *whether* to keep local
   changes — only about not overwriting the other tab's newer ones out from
   under the user without asking first. */
function flushSave() {
  if (!saveT && !held) return;
  clearTimeout(saveT);
  saveT = null;
  writeState(true);
}
```

The conflict handler — `js/app.js:651-660` (excerpt):

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
```

Note: once `held` is true, `saveT` is already null — the handler cancelled
it. So "the pending debounce" and "the conflict" are never both live: a
flush that only lands the debounce has nothing to do while `held`.

The pre-flight in the restore — `js/profile-transfer.js:276-283`:

```js
  /* A set ticked just before this runs leaves a debounced save() pending
     (js/app.js, 400 ms). Left alone, that timer can fire after one of the
     mark() calls below and silently overwrite "no se puede usar…" with
     "Guardado hh:mm" — the rejection reason disappears exactly when it
     matters most. Flushing first means any autosave lands before this
     function's own message, never after. */
  flushSave();
```

The post-confirm flush in the same function (`js/profile-transfer.js:330`,
after `commit(); closeSheet('sheet');`) stays as it is: the user has just
confirmed replacing everything, so forcing is what they asked for.

The profile loader with no flush — `js/profile-transfer.js:339-361`
(excerpt):

```js
async function loadProfileFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch (e) { mark('Ese archivo no es un perfil válido', true); return; }

  if (!parsed || parsed.kind !== 'profile' || !parsed.profile) {
    mark('Eso no es un perfil suelto. Si es una copia completa, usa "Cargar copia".', true);
    return;
  }
  …
  if (problem) { mark('Ese perfil no se puede usar: ' + problem, true); return; }
  …
    mark('Ese perfil no se puede usar: ' + e.message, true);
```

The QR path with no flush — `js/qr-transfer.js:529-543` (excerpt):

```js
async function applyQrPayload(payload) {
  if (!payload || typeof payload !== 'object') { mark('Ese código no trae datos de Heavy Iron', true); return; }

  if (payload.kind === 'profile') {
    closeQr();
    await loadProfileFromText(JSON.stringify(payload));
    return;
  }

  if (payload.kind === 'block' || payload.kind === 'blocklog') {
    let normalized;
    try {
      normalized = normalizeImportedBlock(payload.block);
    } catch (e) {
      mark('Ese bloque no se puede usar: ' + e.message, true);
      return;
    }
```

`js/qr-transfer.js` and `js/profile-transfer.js` both read `flushSave` from
`js/app.js` already; reading a second helper from the same file follows
the same rule (`AGENTS.md`: a symbol another split file reads stays in
`app.js` — it will).

The unit pattern for flag-pinning — `test/unit.js:1830-1843` (excerpt):

```js
  const savedFrozen = call('frozen'), savedReady = call('ready');
  call('frozen = false; ready = true; held = false; quotaToastShown = false;');
  const origSetItem = call('localStorage.setItem');
  …
  app.localStorage.setItem = () => { throw new Error('quota exceeded'); };
  call('writeState(true)'); call('writeState(true)');
  ok('a failed save shows the toast once, not on every retry', call('__toastCalls') === 1);
  app.localStorage.setItem = origSetItem;
  …
  call('quotaToastShown = false; frozen = ' + savedFrozen + '; ready = ' + savedReady + ';');
```

(`app` is the vm context; `call(src)` evaluates in it.)

Conventions: Spanish UI text, English why-comments; `CACHE_VERSION` bump;
rungs 1–2 after each edit; one targeted smoke section at most.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js && node --check js/profile-transfer.js && node --check js/qr-transfer.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| One smoke section | server on `:8765`, then `node test/smoke.js --only "dos pestañas"` | `0 failed` |
| Bump | `bash tools/bump-cache-version.sh` | next version in `sw.js` |

## Scope

**In scope**:
- `js/app.js` (one new function next to `flushSave`)
- `js/profile-transfer.js` (two call sites)
- `js/qr-transfer.js` (one call site)
- `test/unit.js`, `test/smoke.js`
- `sw.js` (bump only)

**Out of scope**:
- The page-exit listeners (`pagehide`, `beforeunload`, `visibilitychange`)
  — they must keep forcing.
- The post-confirm `flushSave()` calls after a restore or a QR install
  (`js/profile-transfer.js:330`, `js/qr-transfer.js:576`) — the user
  confirmed.
- The conflict toast's wording or buttons.

## Git workflow

- Branch: `claude/024-import-preflight-flush-<6 hex chars>`.
- Commits: `Add flushPending: land the debounce without forcing a two-tab conflict`, then `Flush the pending save before every import rejection message`. Trailer:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The non-forcing flush

In `js/app.js`, directly after `flushSave` (after line 632), add:

```js
/* The half of flushSave an import's pre-flight needs: land the pending
   debounce so its "Guardado hh:mm" cannot overwrite the rejection reason
   printed a few lines later — and nothing else. flushSave forces because it
   runs when the tab is going away, where an unanswered conflict toast must
   not cost a set; a file that turns out not to be a backup is not that
   moment, and restoreFromText calling the forcing one meant that opening a
   bad file answered "Quedarme con lo mío" on the user's behalf. While
   `held` the storage handler has already cancelled the timer, so there is
   nothing here to land and the conflict is left exactly as it was. */
function flushPending() {
  if (!saveT) return;
  clearTimeout(saveT);
  saveT = null;
  writeState();
}
```

**Verify**: `node --check js/app.js` → exit 0.

### Step 2: Switch the restore's pre-flight and add the two missing ones

- `js/profile-transfer.js:282`: `flushSave();` → `flushPending();`. Extend
  the comment above it with one sentence: *"`flushPending`, not `flushSave`:
  the forcing one would resolve an open two-tab conflict in this tab's
  favour before the file has even been parsed."*
- `js/profile-transfer.js:339`, `loadProfileFromText`: make
  `flushPending();` the first statement of the function, with a one-line
  comment pointing at `restoreFromText`'s explanation.
- `js/qr-transfer.js:529`, `applyQrPayload`: make `flushPending();` the
  first statement, before the `!payload` guard (that guard is itself a
  rejection message). Same one-line comment.

**Verify**: syntax check all three files → exit 0.
`grep -n "flushPending()" js/profile-transfer.js js/qr-transfer.js` → three
call sites (two in profile-transfer, one in qr-transfer).
`grep -n "flushSave()" js/profile-transfer.js js/qr-transfer.js` → only the
post-confirm sites (`profile-transfer.js:330`, `qr-transfer.js:576`).

### Step 3: Unit assertions

In `test/unit.js`, after the storage-failure block (after line 1845), add
a section that pins both helpers' behaviour against `held`. Use the same
flag-pinning shape. Count writes by stubbing `localStorage.setItem`:

```js
console.log('\n== flushPending lands the debounce and leaves a two-tab conflict alone (plans/024) ==');
{
  const savedFrozen = call('frozen'), savedReady = call('ready');
  call('frozen = false; ready = true; held = false; __writes = 0;');
  const origSetItem = call('localStorage.setItem');
  app.localStorage.setItem = () => { call('__writes++;'); };

  call('save(); flushPending();');
  ok('a pending debounce is landed by flushPending', call('__writes') === 1 && call('saveT') === null, String(call('__writes')));

  call('__writes = 0; held = true; flushPending();');
  ok('with a conflict open and no timer, flushPending writes nothing and leaves held set',
     call('__writes') === 0 && call('held') === true);

  call('__writes = 0; held = true; flushSave();');
  ok('flushSave still forces through a conflict (the page-exit contract)',
     call('__writes') === 1 && call('held') === false);

  app.localStorage.setItem = origSetItem;
  call('held = false; frozen = ' + savedFrozen + '; ready = ' + savedReady + ';');
}
```

`save()` schedules a real 400 ms timer inside the vm; `flushPending()`
clears it synchronously, so the test does not wait. If `saveT` is not
readable by name from `call` (it is a top-level `let` in `js/app.js` —
`grep -n "^let saveT" js/app.js`), drop that half of the first assertion.

Then a source-level guard that the three entry points start with the
flush, so the omission cannot creep back:

```js
const ptSrc = fs.readFileSync(path.join(ROOT, 'js/profile-transfer.js'), 'utf8');
const qrSrc = fs.readFileSync(path.join(ROOT, 'js/qr-transfer.js'), 'utf8');
ok('restoreFromText and loadProfileFromText both open with flushPending',
   (ptSrc.match(/flushPending\(\)/g) || []).length === 2);
ok('applyQrPayload opens with flushPending', (qrSrc.match(/flushPending\(\)/g) || []).length === 1);
ok('no import path calls the forcing flushSave before its rejection messages',
   !/async function loadProfileFromText[\s\S]{0,200}flushSave\(\)/.test(ptSrc) &&
   !/async function applyQrPayload[\s\S]{0,200}flushSave\(\)/.test(qrSrc));
```

**Verify**: `node test/unit.js` → `0 failed`, 6 more assertions. With Step
1–2 stashed, the first and the source-level assertions fail.

### Step 4: Smoke — a rejected restore during a conflict writes nothing

Find the section (`grep -n "dos pestañas" test/smoke.js`) and read it to
the end. It opens two pages on one storage and drives the second one to
raise the conflict toast. After the point where the toast is asserted
visible, add: in the tab that holds the toast, call
`restoreFromText('esto no es json')` through `page.evaluate`, then assert
(a) the status line contains `no es una copia válida`, (b) the toast is
still visible, and (c) `localStorage.getItem('heavy-iron-v1')` still equals
the value the *other* tab wrote (read it before and compare). Use the
section's own selectors for the toast and status.

```js
    /* Opening a file that is not a backup must not answer the toast. */
    await page.evaluate(() => restoreFromText('esto no es json'));
    ok('una copia inválida no resuelve el conflicto de pestañas', await page.evaluate(() => …), …);
```

**Verify**: `node test/smoke.js --only "dos pestañas"` → `0 failed`.

### Step 5: Bump the cache version

`bash tools/bump-cache-version.sh`.

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → above v68.

## Test plan

- Unit (Step 3): `flushPending` lands a pending timer; does nothing while
  `held`; `flushSave` still forces; three source-level guards.
- Smoke (Step 4): a rejected restore during a conflict leaves the other
  tab's data and the toast in place.
- Existing to keep green: "storage-failure paths (plans/008 item 18)" at
  1809–1845; the smoke sections "dos pestañas…" and "profile import
  hardening".

## Done criteria

- [ ] `grep -n "^function flushPending" js/app.js` prints one line
- [ ] `grep -c "flushPending()" js/profile-transfer.js` prints `2`; `grep -c "flushPending()" js/qr-transfer.js` prints `1`
- [ ] `node --check` exits 0 on the three `js/` files
- [ ] `node test/unit.js` exits 0 with `0 failed`, ≥ 6 assertions more than at `4f7e037`
- [ ] `node test/smoke.js --only "dos pestañas"` reports `0 failed`
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a version above v68
- [ ] `git status --short` lists only the six in-scope files
- [ ] `plans/README.md` status row for 024 updated

## STOP conditions

- `flushSave` at `js/app.js:626` no longer has the `if (!saveT && !held)
  return;` / `writeState(true)` shape.
- The `storage` handler no longer clears `saveT` when it sets `held` — then
  `flushPending`'s "nothing to land while held" reasoning is false and the
  helper needs its own `held` check; report rather than guess.
- The smoke section "dos pestañas" cannot be extended without restructuring
  it (e.g. the toast page is closed before the point you need) — land
  Steps 1–3 and 5, report the smoke gap.
- Any verification fails twice after a reasonable fix.

## Maintenance notes

- Two flushes, two contracts: `flushSave` = "the tab is going away, keep
  the user's set at any cost"; `flushPending` = "I am about to print a
  message, land whatever is queued so it does not overwrite me". A new
  path that prints a rejection after user input needs the second one; a new
  path that ends a session needs the first.
- The conflict toast's "Quedarme con lo mío" is the only intended way to
  force over another tab's write while the app is open. Reviewer: grep the
  diff for `flushSave(` outside the page-exit listeners and the two
  post-confirm sites.
- The smoke section's two-page setup is the only end-to-end pin of the
  two-tab guarantee; keep the new assertion inside it rather than in a new
  section so it shares the setup cost.
