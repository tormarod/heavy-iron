# Plan 001: Send unreadable saved data to the recovery screen instead of silently overwriting it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f9afbe0..HEAD -- js/app.js test/smoke.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f9afbe0`, 2026-09-02

## Why this matters

This app is the only copy of a person's training history. There is no server,
no sync, and no automatic backup — `README.md` says so explicitly. The app
already has a recovery screen built for exactly the case where saved data
cannot be read: it stops writing so the damaged bytes are not overwritten, and
offers to download them as a file first.

That screen is wired to only one of the two ways data can be unreadable. If
`render()` throws, you get recovery. If `JSON.parse` fails — or the parsed
object has no `profiles` key — `load()` silently substitutes a brand-new
default state and then **writes it back over the damaged bytes** about 400 ms
later. The user's history is gone, unrecoverably, and they were never offered
the download.

`README.md:315-321` promises the opposite behaviour: "If the saved data is
broken past repairing, you get a recovery screen instead of a blank page: it
**stops writing** so the damaged copy is not overwritten, and offers to
download the raw bytes as a file before you reset anything." Unparseable JSON
is definitionally "broken past repairing", and it is the one case that does
not get that screen. After this plan, the code matches the promise.

## Current state

Files involved:

- `js/app.js` — `load()` at lines 103-122 is the defect; `showRecovery()` at
  lines 887-921 is the existing machinery to reuse; `readRaw()` at 98-101.
- `test/smoke.js` — line 1138 currently asserts the destructive behaviour and
  must be rewritten.
- `sw.js` — line 20 holds `CACHE_VERSION`, which CI requires you to bump.

`js/app.js:97-122` exactly as it exists today:

```js
/* ---------- storage ---------- */
function readRaw() {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch (e) { return null; }  /* private mode / storage blocked — run in memory */
}

function load() {
  const raw = readRaw();
  const firstRun = raw == null;
  try {
    state = raw ? JSON.parse(raw) : defaultState();
  } catch (e) {
    state = defaultState();
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || !state.profiles) state = defaultState();
  if (firstRun) state.setupDone = false;
  migrate();
  ready = true;
  applyTheme();
  render();
  /* Write straight back: on a first run that persists the starting plan, and
     on a later one it persists whatever migrate() had to repair, so the same
     repair does not have to be redone on every open. */
  save();
  mark('Cargado');
  if (!state.setupDone) openSetup(true);
}
```

The two destructive lines are the `catch` at 108-110 and the shape check at
111. Both discard `raw` and fall through to `save()` at 120.

`js/app.js:882-890` — the recovery screen's own stated contract, and its
signature:

```js
/* ---------- recovery ----------
   The app draws straight from whatever is in localStorage, so data it cannot
   read used to mean a white screen and no way back. Instead: stop writing
   (so the broken copy is not overwritten with something worse), and offer to
   hand the raw bytes over as a file before anything is thrown away. */
function showRecovery(err, raw) {
  frozen = true;
  ready = false;
  clearTimeout(saveT); saveT = null;
  stopRest();
```

`showRecovery(err, raw)` already does everything needed: it sets `frozen`
(which makes `writeState()` a no-op — see `js/app.js:374-375`), cancels the
pending save timer, replaces `document.body`, and wires a download button that
writes `raw` to a file. **You are not writing a recovery screen. You are
routing one more case into the one that exists.**

Its only current call site, `js/app.js:2093`, inside `render()`'s catch:

```js
    showRecovery(e, readRaw());
```

The smoke test that pins today's behaviour, `test/smoke.js:1136-1139`:

```js
    // truly broken JSON
    await page.evaluate(() => localStorage.setItem('heavy-iron-v1', '{not json'));
    await page.reload({ waitUntil: 'networkidle' });
    ok('unparseable data falls back to a fresh plan', await page.locator('.ex').count() > 0);
```

Note the block immediately above it (`test/smoke.js:1121-1134`) covers
*repairable* damage — a dangling `activeBlock`, a ghost `blockOrder`, a missing
`phase`, an empty `ex` array — and asserts `no recovery screen needed`. That
block must keep passing unchanged. Repairable damage goes to `migrate()`;
only unreadable data goes to recovery.

### Repo conventions to match

- **Comments explain *why*, not *what*.** Every non-obvious branch in this
  codebase carries a prose comment giving the reasoning, often naming the bug
  it prevents. Match that register — see the `showRecovery` header comment
  quoted above as the exemplar. Do not write `// parse the JSON`.
- **Spanish for anything the user sees**, English for code comments.
- No build step, no modules, no TypeScript. Plain ES2017-era browser JS in one
  shared global scope across the six `<script>` tags in `index.html:479-484`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | `node --check js/app.js` | exit 0, no output |
| Install test dep | `npm install --no-save playwright@1.56.1` | exit 0 |
| Serve the site | `python3 -m http.server 8765` (leave running) | serves on 127.0.0.1:8765 |
| Run tests | `node test/smoke.js` | every line `PASS`, final summary shows 0 failures |

Chromium must be installed once: `npx playwright install chromium`.

## Scope

**In scope** (the only files you should modify):

- `js/app.js` — `load()` only
- `test/smoke.js` — the "truly broken JSON" assertion at ~1136-1139, plus one
  new assertion
- `sw.js` — the `CACHE_VERSION` string only

**Out of scope** (do NOT touch, even though they look related):

- `showRecovery()` itself (`js/app.js:887-921`) — it already does the right
  thing; changing it risks the `render()`-throw path that currently works.
- `migrate()` (`js/app.js:193-345`) — repairable damage must keep being
  repaired silently. This plan is only about data that cannot be read at all.
- The `storage` event handler (`js/app.js:403-417`) — it has its own
  `JSON.parse` with a deliberate silent `return`. That is correct: another
  tab's bad write should be ignored, not treated as local corruption.
- `test/smoke.js:1121-1134` (the repairable-damage block) — must keep passing
  as-is.

## Git workflow

- Branch: `advisor/001-recovery-on-unreadable-data`
- One commit is fine. Message style matches this repo's history: a short
  imperative sentence in plain English, no conventional-commit prefix. Recent
  examples from `git log`: `Let the same lift on two days share its history`,
  `Stop the webfont holding the app hostage`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Route parse and shape failures into the recovery screen

In `js/app.js`, rewrite `load()` so that a non-null `raw` which cannot be
parsed — or which parses to something without a `profiles` object — calls
`showRecovery(err, raw)` and returns immediately, before `migrate()`,
`render()` or `save()` can run.

Only `raw == null` (a genuinely fresh device) may reach `defaultState()`.

Target shape:

```js
function load() {
  const raw = readRaw();
  const firstRun = raw == null;
  if (firstRun) {
    state = defaultState();
    state.setupDone = false;
  } else {
    /* Anything that is on disk but unreadable goes to the recovery screen
       rather than being replaced: the seed plan written back over it would
       be the last thing that ever happened to a training history nobody
       else has a copy of. Repairable damage is migrate()'s job, below —
       this is only for bytes we cannot get a state object out of at all. */
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      showRecovery(e, raw);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.profiles) {
      showRecovery(new Error('Los datos guardados no tienen la forma que la app espera.'), raw);
      return;
    }
    state = parsed;
  }
  migrate();
  ready = true;
  applyTheme();
  render();
  /* Write straight back: on a first run that persists the starting plan, and
     on a later one it persists whatever migrate() had to repair, so the same
     repair does not have to be redone on every open. */
  save();
  mark('Cargado');
  if (!state.setupDone) openSetup(true);
}
```

Keep the existing trailing comment on `save()` verbatim — it is still accurate.

**Verify**: `node --check js/app.js` → exit 0, no output.

### Step 2: Replace the smoke assertion that pins the old behaviour

In `test/smoke.js`, replace the "truly broken JSON" case (currently lines
~1136-1139). It must now assert that the recovery screen appears **and** that
the damaged bytes are still on disk afterwards — the second half is the part
that actually protects the user.

Target shape (match the file's existing `ok(...)` style, and pass a third
`extra` argument so a failure is diagnosable):

```js
    // truly broken JSON: unreadable, so it must reach the recovery screen
    // rather than being replaced by a fresh plan and written back over.
    await page.evaluate(() => localStorage.setItem('heavy-iron-v1', '{not json'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    ok('unreadable data lands on the recovery screen',
       await page.locator('.recovery').count() === 1);
    ok('the damaged bytes are left on disk, not overwritten',
       await page.evaluate(() => localStorage.getItem('heavy-iron-v1')) === '{not json',
       await page.evaluate(() => localStorage.getItem('heavy-iron-v1')));
```

The 600 ms wait must be longer than the 400 ms save debounce at
`js/app.js:386` — that is the whole point: if the fix regresses, the write
lands inside this window and the second assertion catches it.

After this block, the page is sitting on the recovery screen and
`localStorage` still holds `{not json`. The next block in the file
(`// unrenderable: force render to throw`, ~line 1141) begins with
`page.evaluate(() => { const s = JSON.parse(localStorage.getItem(...)) ... })`,
which will now throw because the stored value is not JSON. **You must reset
storage to a good state before that block runs.** Add this immediately after
the two assertions above:

```js
    /* Back to a readable log, so the next case starts from a page that
       actually booted rather than from the recovery screen. */
    await page.evaluate(() => localStorage.removeItem('heavy-iron-v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(300);
```

`dismissSetup` is defined at `test/smoke.js:19-25` and is needed because a
device with no saved data now opens on the first-run setup sheet.

**Verify**: `node --check test/smoke.js` → exit 0.

### Step 3: Bump `CACHE_VERSION`

`js/app.js` changed, so `sw.js`'s `CACHE_VERSION` must move or CI fails the
pull request (`.github/workflows/test.yml`, the `cache-version` job). Returning
users are served the shell cache-first, so an unbumped version leaves them on
the old `app.js` indefinitely.

Read the current value at `sw.js:20` and increment the integer by one (at the
time of writing it is `'v39'`, so it becomes `'v40'` — but read the file, do
not assume, since other plans may have landed first).

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → shows a version strictly
higher than the one in `git show f9afbe0:sw.js | grep CACHE_VERSION`.

### Step 4: Run the full suite

Start the server and run the tests.

```bash
python3 -m http.server 8765 &
node test/smoke.js
```

**Verify**: every assertion reports `PASS` and the final summary shows 0
failures. In particular confirm these three still pass, because they exercise
the paths this change is closest to:

- `repairs dangling references instead of dying`
- `no recovery screen needed`
- `bad days array is repaired, not fatal`

If `no recovery screen needed` now fails, you have routed repairable damage
into recovery — that is a regression, see STOP conditions.

## Test plan

- **Modified**: the "truly broken JSON" case in `test/smoke.js` (~line 1136),
  now asserting the recovery screen appears and the raw bytes survive.
- **New**: the second assertion above (`the damaged bytes are left on disk,
  not overwritten`) is the regression test for this specific bug. It is the
  one that would have caught the original defect.
- **Must keep passing unchanged**: the repairable-damage block at
  `test/smoke.js:1121-1134`, and the render-throw block that follows at ~1141.
- Structural pattern to follow: the surrounding blocks in the same section of
  `test/smoke.js` — `page.evaluate` to corrupt storage, `page.reload`, then
  `ok(...)` assertions.
- Verification: `node test/smoke.js` → all pass.

## Done criteria

ALL must hold:

- [ ] `node --check js/app.js` exits 0
- [ ] `node --check test/smoke.js` exits 0
- [ ] `node test/smoke.js` exits 0 with 0 failures
- [ ] `grep -n "unparseable data falls back to a fresh plan" test/smoke.js` returns **no matches** (the old assertion is gone)
- [ ] `grep -n "showRecovery" js/app.js` returns **three** lines: the definition (~887), the `render()` catch (~2093), and at least one new call inside `load()`
- [ ] `CACHE_VERSION` in `sw.js` is higher than at commit `f9afbe0`
- [ ] `git status` shows only `js/app.js`, `test/smoke.js` and `sw.js` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `load()` function in `js/app.js` does not match the excerpt in "Current
  state" — someone has already changed it.
- The smoke assertion `no recovery screen needed` (`test/smoke.js:1132`)
  starts failing. That means repairable damage is now reaching the recovery
  screen, which is a worse bug than the one you are fixing: it would show a
  scary screen to users whose data was fine. Do not "fix" it by loosening the
  shape check — report instead.
- The first-run path breaks (a device with empty `localStorage` shows recovery
  instead of the setup sheet). The `raw == null` branch must never reach
  `showRecovery`.
- `node test/smoke.js` fails twice after a reasonable fix attempt.
- You find yourself needing to modify `showRecovery()` or `migrate()`.

## Maintenance notes

For whoever owns this next:

- **The distinction this change draws is "unreadable" vs. "repairable", and it
  is load-bearing.** `migrate()` is deliberately generous — it repairs
  dangling block ids, missing week-goal tables, days with no exercises. All of
  that must keep working silently. Recovery is only for bytes that cannot be
  turned into a state object at all. If a future change makes `migrate()`
  stricter, this boundary is where the damage will show up.
- **What a reviewer should scrutinise**: that `raw == null` still seeds a fresh
  device without touching recovery, and that nothing between the parse and
  `showRecovery` can write to `localStorage`. `frozen` is what guarantees the
  second property (`js/app.js:374-375`); it is set inside `showRecovery`, so
  the `return` immediately after the call is essential — without it, execution
  would fall through to `save()`.
- **Deliberately deferred**: the recovery screen's "Empezar de cero" button
  still uses a native `confirm()` (`js/app.js:917`), which is the only one left
  in the app. That is intentional and documented in the comment above it — the
  dialog sheet is no longer in the page at that point. Leave it.
- A related gap this plan does **not** close: `restoreFromText` in
  `js/profile-transfer.js` replaces the whole state with no undo snapshot.
  That is plan 004.
