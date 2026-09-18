# Plan 013: Six small correctness fixes (warm-up labels, wake lock, backup nag, Escape, undo copy, stale comment)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6def9fc..HEAD -- js/calculator.js js/rest-timer.js js/qr-transfer.js js/app.js js/block-editor.js js/profile-transfer.js js/review.js test/unit.js sw.js`
> On any in-scope change, compare the excerpts below against the live code
> before proceeding; a mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 012 also edits `js/app.js` and `js/block-editor.js`; land sequentially and take the highest `CACHE_VERSION` on conflict)
- **Category**: bug
- **Planned at**: commit `6def9fc`, 2026-09-18
- **Overlap**: `plans/009-architecture-deepening.md` item 1 (sheet module)
  also fixes Escape on `diagSheet`/`reviewSheet`. If it has landed, skip
  Step D but still add its test.

## Why this matters

Six independent, verified defects, each an hour or less, bundled the way
plan 006 was so they ship as one release. Two are regressions from fixes
in plans/008 (items 19 and 15); one undercuts the undo feature the repo
built specifically for mis-taps; one contradicts the accessibility work
recorded as done.

| # | Defect | Where |
|---|---|---|
| A | Warm-up table labels rows positionally (`40% / 60% / 80% / Objetivo`) but `warmupRamp` now collapses duplicate steps, so a two-row ramp labels the working weight "60%" and never shows "Objetivo". | `js/calculator.js` |
| B | A second rest started while one is live requests a new wake lock and overwrites the variable without releasing the old lock; the screen stays on for the session. | `js/rest-timer.js` |
| C | Selecting "perfil" in the QR sheet resets the backup nag before any frame is shown — including when the payload is too large to send. | `js/qr-transfer.js` |
| D | Escape does not close the Diagnóstico or Revisión sheets: they are missing from `SHEET_IDS`. | `js/app.js` |
| E | Five confirm dialogs say "No se puede deshacer" and then take an undo snapshot. Users told there is no undo do not look for the toast. | `js/block-editor.js`, `js/profile-transfer.js` |
| F | The guard comment at the tail of `app.js` says "these **three** files" while seven calls are guarded; AGENTS.md quotes it as "seven". | `js/app.js` |

## Current state

**A** — `js/calculator.js:26-29`:
```js
function warmupRamp(target, step, floor) {
  const rows = [0.4, 0.6, 0.8].map(p => Math.max(floor || 0, roundToStep(target * p, step)));
  return rows.filter((w, i) => i === 0 || w !== rows[i - 1]);
}
```
and `:126-146` in `drawCalc`:
```js
  const labels = ['40%', '60%', '80%', 'Objetivo'];
  ...
    const weights = warmupRamp(target, step, barWeight).concat([target]);
    rows = weights.map((w, i) => { ... '<tr><td>' + labels[i] + '</td>...' });
  ...
    const weights = warmupRamp(target, inc, 0).concat([target]);
    rows = weights.map((w, i) => '<tr><td>' + labels[i] + '</td>...');
```
`test/unit.js:1059-1063` asserts `warmupRamp(15, 10, 0)` → `[10]` — so the
table has two rows labelled `40%` and `60%`.

**B** — `js/rest-timer.js:32-49` `startRest` calls `requestWakeLock()`
unconditionally; `:369-379`:
```js
async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    const lock = await navigator.wakeLock.request('screen');
    if (!tId) { lock.release().catch(() => {}); return; }
    wakeLock = lock;
  } catch (e) { ... }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
```
`test/unit.js:1065-1077` is the existing wake-lock test (fake
`navigator.wakeLock`, `tId` toggled by hand).

**C** — `js/qr-transfer.js:417-423`:
```js
async function buildQrPayload(kind, profile, block) {
  const base = { app: STORAGE_KEY, v: 1, saved: new Date().toISOString() };
  if (kind === 'profile') {
    resetBackupNag();
    return Object.assign(base, { kind: 'profile', ... });
  }
```
`drawQrShow` (`:387-411`) calls it, then `if (packed.total > QR_MAX_FRAMES)`
shows "Esto ocupa demasiado…" and returns; frames are set at `:401-403`.
Other reset sites (`js/profile-transfer.js:414,435`, `js/app.js:3806`)
fire only after the data left the device.

**D** — `js/app.js:1938`:
```js
const SHEET_IDS = ['setupSheet', 'sheet', 'planSheet', 'blocksSheet', 'importSheet', 'chartSheet', 'calcSheet', 'volumeSheet', 'qrSheet'];
```
`:1959-1969` the Escape handler filters `SHEET_IDS`, closing `planSheet` via
`closePlanEditor`, `setupSheet` via `closeSetup`, `qrSheet` via `closeQr`,
else `closeSheet(top)`. `index.html:384` `reviewSheet` and `:403` `diagSheet`
are opened by `openSheet('reviewSheet')` (`js/review.js:279`) and
`openSheet('diagSheet')` (`js/diagnostics.js:905`). `closeReview`
(`js/review.js:282-287`) also runs a resume callback, so it must be the
close path for `reviewSheet`. The ordering comment at `:1935-1937` says
later entries are the ones that can open on top.

**E** — `grep -n "No se puede deshacer" js/*.js` → `js/block-editor.js:132`,
`:738`, `:959`, `:1083`; `js/profile-transfer.js:268`, `:342`. Of these,
`:738` (deleting a retired item's log from the editor's "Retirados" list)
is genuinely not undoable until the editor's save takes its snapshot —
leave it. The other five each precede a `snapshotForUndo(...)` call
(`js/block-editor.js:74` via `deleteBlocks`; `js/profile-transfer.js:280`
and `:352`).

**F** — `js/app.js:4232-4233`: `/* Guarded, unlike wireBlockEditor/wireProfileTransfer, because these
   three files are newer than some already-deployed shells: …`. Seven
guarded calls follow at `:4241-4247`. `AGENTS.md:54-55` quotes it with
"seven".

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `for f in js/*.js sw.js test/*.js; do node --check "$f"; done` | exit 0 |
| Unit | `node test/unit.js` | `N passed, 0 failed` (177 at `6def9fc`) |
| Smoke section | `BASE=http://127.0.0.1:8765 node test/smoke.js --only "<substring>"` | `0 failed` |

## Scope

**In scope**: `js/calculator.js`, `js/rest-timer.js`, `js/qr-transfer.js`,
`js/app.js` (only `SHEET_IDS`, the Escape handler, the comment at 4232),
`js/block-editor.js` and `js/profile-transfer.js` (only the five strings),
`js/review.js` (only if `closeReview` needs exposing — it is already global),
`test/unit.js`, `sw.js`.

**Out of scope**: `js/block-editor.js:738` (correctly says no undo);
`copyPrev` (`js/app.js:2906`) — it has no undo snapshot either, but the
button does what it says and adding one is a maintainer call, recorded in
`plans/README.md`; `resetBackupNag` itself; the sheet stacking model.

## Git workflow

- Branch: `claude/013-six-small-correctness-fixes`
- One commit per fix (A–F), each message one imperative sentence.
- No push/PR unless instructed.

## Steps

### Step A: Labels travel with the warm-up rows

Change `warmupRamp` to return `[{ pct, weight }]`:
```js
function warmupRamp(target, step, floor) {
  const rows = [0.4, 0.6, 0.8].map(p => ({ pct: Math.round(p * 100) + '%', weight: Math.max(floor || 0, roundToStep(target * p, step)) }));
  return rows.filter((r, i) => i === 0 || r.weight !== rows[i - 1].weight);
}
```
In `drawCalc`, delete the `labels` array and build
`const weights = warmupRamp(...).concat([{ pct: 'Objetivo', weight: target }]);`
then use `row.pct` and `row.weight` in both branches. Add a comment above
`warmupRamp`: collapsing duplicates changed the row count, and positional
labels then called the working weight "60%" (plans/013).

Update the two existing tests at `test/unit.js:1059-1063` to read
`.map(r => r.weight)`, and add: `warmupRamp(15, 10, 0)[0].pct === '40%'`,
and a `drawCalc`-level check is not possible headlessly, so instead assert
the label of the appended row logic by a tiny helper if you extract one —
otherwise the two `warmupRamp` assertions are sufficient.

**Verify**: `node test/unit.js` → `0 failed`. Then `--only "calc"` smoke
section (find its name via `grep -n "await section('" test/smoke.js`) → `0 failed`.

### Step B: Never hold two wake locks

In `requestWakeLock`, before the `await`:
```js
    /* A second rest started while one is live (a superset, a set ticked
       during the countdown) used to request a second lock and drop the
       first reference on the floor; "saltar" then released only the one it
       could see, and the screen stayed on for the whole session (plans/013). */
    if (wakeLock) return;
```
Extend `test/unit.js:1065-1077`: with `tId = 1` and `wakeLock` already set
to `fakeLock`, call `requestWakeLock()` again with a `request` spy that
counts calls; assert the count did not increase and `wakeLock === fakeLock`.
Reset `tId = null; wakeLock = null;` afterwards as the existing test does.

**Verify**: `node test/unit.js` → `0 failed`.

### Step C: Reset the nag only once frames are on screen

Remove `resetBackupNag();` from `buildQrPayload`. In `drawQrShow`, after
`qrFrames = packed.frames;` (i.e. after the too-large check has passed),
add `if (qrKind === 'profile') resetBackupNag();` with a comment: the nag
counts sessions since data actually left the phone; choosing the option, or
being told the payload is too big, is not that.

Unit test: `state.prefs.sessionsSinceBackup = 5;` then
`await buildQrPayload('profile', getProfile(), getBlock())` and assert it
is still 5. (`buildQrPayload` is global and does not touch the DOM.)

**Verify**: `node test/unit.js` → `0 failed`.

### Step D: Escape closes every sheet

`SHEET_IDS` → insert `'reviewSheet', 'diagSheet'` after `'blocksSheet'`
(both open from the main nav or the blocks sheet; `reviewSheet` can open
over `blocksSheet` via "+ Nuevo bloque", so it must come after it). In the
Escape handler add `else if (top === 'reviewSheet') closeReview();` before
the final `else`. Add to the ordering comment that `reviewSheet` has its own
close because it carries a resume callback.

Unit test: `SHEET_IDS.indexOf('diagSheet') > SHEET_IDS.indexOf('blocksSheet')`
and `SHEET_IDS.indexOf('reviewSheet') > SHEET_IDS.indexOf('blocksSheet')`,
plus: every id matched by `/id="(\w+Sheet|sheet)"/g` over `index.html`'s
`class="sheet"` elements, except `askSheet`, is in `SHEET_IDS` (read
`index.html` with `fs` in the test; this stops the next split
reintroducing the gap).

**Verify**: `node test/unit.js` → `0 failed`.

### Step E: Tell the truth about undo

Replace `'No se puede deshacer.'` at `js/block-editor.js:132`, `:959`,
`:1083` and `js/profile-transfer.js:268`, `:342` with
`'Podrás deshacerlo justo después, mientras no hagas otra cosa.'`
(the same promise the undo toast makes; see `js/app.js:683-688`). Leave
`js/block-editor.js:738` unchanged.

**Verify**: `grep -c "No se puede deshacer" js/block-editor.js js/profile-transfer.js`
→ `js/block-editor.js:1`, `js/profile-transfer.js:0`.

### Step F: Fix the comment

`js/app.js:4233` "these three files" → "the files below" (a form that needs
no maintenance). Then update the quoted comment in `AGENTS.md:54-55` to
match verbatim.

**Verify**: `grep -n "three files are newer" js/app.js` → 0 matches.

### Step G: Bump and check

`sw.js` `CACHE_VERSION` → next value. Run the calculator and rest-timer
smoke sections by name.

## Done criteria

- [ ] syntax check exits 0; `node test/unit.js` → `0 failed`, N ≥ 182
- [ ] `grep -n "labels\[i\]" js/calculator.js` → 0 matches
- [ ] `grep -n "if (wakeLock) return;" js/rest-timer.js` → 1 match
- [ ] `grep -n "resetBackupNag" js/qr-transfer.js` → exactly 1 match, inside `drawQrShow`
- [ ] `grep -c "'reviewSheet'\|'diagSheet'" js/app.js` → ≥ 2 on the `SHEET_IDS` line
- [ ] the grep in Step E holds
- [ ] `sw.js` bumped; `git status` only in-scope files

## STOP conditions

- `warmupRamp` callers exist outside `js/calculator.js` (`grep -rn warmupRamp js/ test/`
  at `6def9fc` shows only `js/calculator.js` and `test/unit.js`).
- `resetBackupNag` has more than the four call sites listed above.
- `closeReview` is not a global function (it is at `6def9fc`).
- An existing smoke section fails on something other than a label string.

## What was done differently

Both deviations are recorded here rather than silently absorbed, because
each contradicts a line of the plan above.

1. **Step B's guard is `if (wakeLock && !wakeLock.released) return;`, not
   `if (wakeLock) return;`.** The browser releases the lock itself when the
   tab goes hidden and nothing nulls the variable — the visibilitychange
   handler in `wireRestTimer` re-acquires precisely because of that, and
   says so in its own comment. The bare guard would have turned that
   re-acquire into a no-op and let the screen sleep for the rest of every
   countdown that survived a tab switch: a second bug in place of the
   first. A second `.released` check after the `await` covers the other
   half of "never hold two", two rests started in the same tick, which the
   pre-await guard alone cannot see. `test/unit.js` asserts both, plus the
   re-acquire the guard has to keep working.
2. **`test/smoke.js` was edited, though the Scope section does not list
   it.** The STOP condition "`warmupRamp` callers exist outside
   `js/calculator.js`" says the grep at `6def9fc` showed only
   `js/calculator.js` and `test/unit.js`. It did not: `test/smoke.js:498`
   at that commit already asserted `JSON.stringify(warmupRamp(50, 2.5, 20))`
   against an array of plain numbers. That is a test, not a production
   caller, so the STOP condition's intent was not met — the assertion was
   updated to `.map(r => r.weight)` and the "main session" section run.

Two smaller judgement calls, neither a contradiction: the five Step E
strings became one `UNDO_PROMISE` constant next to `snapshotForUndo` in
`js/app.js` (same cross-file pattern as `UNCLASSIFIED_LABEL`) so the
promise and the snapshot cannot drift apart; and Step F also dropped the
line number `AGENTS.md` pinned the wire call site to, which had already
drifted from 5437 to 4323.

## Maintenance notes

- Step D's test makes "every `.sheet` is in `SHEET_IDS`" a checked
  invariant, in both directions; a future sheet needs both the markup and
  the array entry. Step E's test is the same shape: it counts the dialogs
  that still claim there is no undo, so a new one has to be deliberate.
- The wake-lock guard assumes `releaseWakeLock` is the only place that
  nulls `wakeLock`; if a future change releases elsewhere, keep that true.
  It tolerates a sentinel the browser released on its own — that is what
  the `.released` half of the test is for, and the unit test pins it so
  nobody "simplifies" the guard back to bare truth.
- Open maintainer call, not done here: `copyPrev` overwrites unticked
  weights with no snapshot. One line (`snapshotForUndo('Pesos copiados…')`)
  if wanted.
