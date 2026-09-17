# Plan 003: Add a headless assertion layer under `test/` for the pure logic

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f9afbe0..HEAD -- js/ test/ .github/workflows/test.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `f9afbe0`, 2026-09-02

## Why this matters

The only test suite is `test/smoke.js` — 2,767 lines driving the real app in
real Chromium. It is genuinely good at what it is for, and it stays. But it is
the *only* way to assert anything, which means:

- Pure functions get round-tripped through a browser to be tested at all —
  `est1RM` at `test/smoke.js:374`, `fitPlates` at `:389-396`, `warmupRamp` at
  `:397`, `setVolume` at `:144-148`.
- `migrate()` (`js/app.js:193-345`), 150 lines of schema repair standing
  between years of accumulated `localStorage` shapes and a user's training
  history, is exercised for four failure shapes and none of its actual
  migration branches.
- The statistics engine in `js/diagnostics.js` — `fitSlope` (:461),
  `diagMedianGap` (:481), `diagVerdict` (:496), all pure — has no cheap way to
  be tested against hand-built inputs.
- No contributor can check *any* logic without a static server plus a Chromium
  download.

**This is achievable with zero new dependencies and no build step**, which is
why it is worth doing here rather than dismissed as "the repo has no test
framework". The architecture already supports it: `js/app.js:4705-4717`
documents that every file except `app.js` defers all DOM wiring into a
`wire*()` function, so five of the six sources evaluate in a bare Node context
with no shims at all.

**This has been verified, not assumed.** Loading all six files into one
`node:vm` context with the ~15-line shim in Step 1 below succeeds, and
`est1RM`, `fitPlates`, `slugify`, `clampInt`, `txt`, `normalizeImportedBlock`,
`migrate`, `fitSlope`, `esc` and `slot` are all reachable and callable
afterwards. You are implementing something already demonstrated to work.

## Current state

- `test/smoke.js` — the existing Playwright suite. **Not modified by this
  plan.** Read its header (lines 1-14) for the house style on test comments.
- `.github/workflows/test.yml` — the CI workflow. The `smoke` job installs
  Playwright and Chromium, serves the site with `python3 -m http.server 8765`,
  then runs `node test/smoke.js`.
- `js/app.js:4705-4720` — the tail, which explains the wiring contract and
  ends with:

```js
wireBlockEditor();
if (typeof wireDiagnostics === 'function') wireDiagnostics();
if (typeof wireReview === 'function') wireReview();
wireProfileTransfer();

load();
enableWebfont();
registerServiceWorker();
```

Those three trailing calls run at load time. Under the shim they are harmless
— `load()` finds empty storage, seeds a default state and renders into inert
elements — and usefully leave `state` populated. Do not try to prevent them.

- `js/app.js:158-160` — three top-level `innerHTML` writes that are the reason
  `app.js` (alone) needs a `document` shim:

```js
$('muscleSuggestions').innerHTML = MUSCLE_SUGGESTIONS.map(m => '<option value="' + esc(m) + '"></option>').join('');
$('patternSuggestions').innerHTML = PATTERN_SUGGESTIONS.map(m => '<option value="' + esc(m) + '"></option>').join('');
$('typeSuggestions').innerHTML = TYPE_SUGGESTIONS.map(m => '<option value="' + esc(m) + '"></option>').join('');
```

- Script load order, from `index.html:479-484` — your harness **must** use this
  exact order, because it is the order the browser uses:

```html
<script src="js/data.js"></script>
<script src="js/block-editor.js"></script>
<script src="js/diagnostics.js"></script>
<script src="js/review.js"></script>
<script src="js/profile-transfer.js"></script>
<script src="js/app.js"></script>
```

### Repo conventions

- No `package.json`, no dependencies, no build step — **and this plan must not
  introduce any.** Use only Node built-ins (`node:vm`, `node:fs`,
  `node:assert`, `node:path`).
- Comments explain *why*, in prose.
- `test/smoke.js` uses a hand-rolled `ok(name, cond, extra)` reporter
  (lines 36-39) rather than a framework. Match that style in the new file so
  the two suites read alike.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax check | `node --check test/unit.js` | exit 0, no output |
| Run new suite | `node test/unit.js` | all `PASS`, exit 0 |
| Run existing suite | `node test/smoke.js` (needs server + Chromium) | 0 failures |

The new suite needs **no server and no browser**. That is the point.

## Scope

**In scope**:

- `test/unit.js` (create)
- `.github/workflows/test.yml` — add one step to the existing `smoke` job
- `README.md` — the "Tests" section (~line 1457) gains the new command

**Out of scope**:

- `test/smoke.js` — do not modify, do not migrate cases out of it. The
  browser suite keeps testing browser-observable behaviour; this is additive.
- Any `js/**` source file. **If a source file needs changing to make it
  testable, STOP and report.** The whole premise is that no production change
  is required.
- `package.json` — do not create one.
- `sw.js` `CACHE_VERSION` — no app-shell file changes here, so no bump is
  needed and CI will not ask for one.

## Git workflow

- Branch: `advisor/003-headless-assertion-layer`
- Commit message style: short imperative sentence, no prefix.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `test/unit.js` with the loader and shim

Create `test/unit.js`. Start with the header comment explaining why this file
exists (match the register of `test/smoke.js:1-14`), then the shim and loader
below. **This shim is verified working — use it as given.**

```js
/* Headless assertions for the logic that does not need a browser.
 *
 *   node test/unit.js
 *
 * No server, no Chromium, no dependencies. The six source files are plain
 * <script> tags sharing one global scope (see index.html), so loading them
 * into a single node:vm context in the same order reproduces that scope
 * closely enough to call the pure functions directly.
 *
 * This does not replace test/smoke.js. Anything a user could observe — a
 * class on an element, a value surviving a reload, a sheet opening — belongs
 * there, in a real browser. What belongs here is arithmetic and data repair:
 * migrate(), the import validators, the statistics. Those are expensive and
 * imprecise to assert through a browser and cheap to assert here.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Every DOM object the sources touch at load time answers to the same inert
   stub: the three innerHTML writes at js/app.js:158-160 and the wire*()
   handlers just need something that does not throw. Nothing here pretends to
   be a real DOM — if a test needs real rendering, it belongs in smoke.js. */
const inert = () => ({
  style: {}, dataset: {}, children: [], hidden: false,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
  appendChild() {}, replaceChildren() {}, remove() {},
  addEventListener() {}, removeEventListener() {}, insertAdjacentHTML() {},
  querySelector() { return inert(); }, querySelectorAll() { return []; },
  focus() {},
  get innerHTML() { return ''; }, set innerHTML(v) {},
  get textContent() { return ''; }, set textContent(v) {},
  get value() { return ''; }, set value(v) {},
});

function loadApp() {
  const store = {};
  const ctx = vm.createContext({
    document: {
      getElementById: () => inert(), createElement: () => inert(),
      querySelector: () => inert(), querySelectorAll: () => [],
      addEventListener() {}, documentElement: inert(), body: inert(), head: inert(),
    },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    navigator: {},
    location: { hostname: 'localhost', pathname: '/' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
  });
  ctx.window.self = ctx.window;
  ctx.globalThis = ctx;

  /* The same order as the <script> tags in index.html — app.js last, because
     it is the one that wires the others and then calls load(). */
  ['js/data.js', 'js/block-editor.js', 'js/diagnostics.js', 'js/review.js',
   'js/profile-transfer.js', 'js/app.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}
```

Then add the reporter, mirroring `test/smoke.js:36-39` so both suites report
identically:

```js
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
};
```

And the tail:

```js
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

**Verify**: `node --check test/unit.js` → exit 0.

### Step 2: Assert the loader itself works

Before any real test, prove the harness. Add as the first section:

```js
const app = loadApp();
const call = expr => vm.runInContext(expr, app);

console.log('\n== the harness ==');
ok('every source file loads in one shared scope', call('typeof migrate') === 'function');
ok('load() seeded a state object', call('!!state && !!state.profiles'));
```

**Verify**: `node test/unit.js` → both PASS.

If either fails, STOP — every later step depends on this.

### Step 3: Cover the pure arithmetic

Add a section asserting the functions the browser suite currently
round-trips. Read each function's real behaviour in the source before writing
its expectations — **do not guess return shapes**:

- `est1RM` — `js/app.js`, find with `grep -n "function est1RM" js/app.js`.
  Assert a known weight/rep pair, and that reps above `EST_MAX_REPS` (15) are
  refused.
- `fitPlates(perSide, plateSet)` — `js/app.js:3167`. Returns
  `{ plates: [...], remainder: n }`. Assert an exact fit, and a fit that
  leaves a remainder (the comment at 3163-3166 says the remainder is reported
  rather than hidden — assert that).
- `clampInt` / `clampNum` — `js/app.js:34-84`. Assert below-range,
  above-range, and non-numeric input each fall back to the default.
- `txt(v, max)` — `js/app.js:2038`. Assert whitespace collapsing and length
  capping.
- `esc` — `js/app.js:23`. Assert all five escaped characters
  (`&`, `<`, `>`, `"`, `'`).
- `slot(w, dayId)` — `js/app.js:85`. Assert the `'w' + w + '-' + dayId` shape.

Use `call('...')` to reach each one, e.g.:

```js
ok('fitPlates reports a remainder rather than hiding it',
   call('fitPlates(21, [20, 10, 5]).remainder') === 1,
   String(call('JSON.stringify(fitPlates(21, [20, 10, 5]))')));
```

Always pass the third `extra` argument showing the observed value — that is
what makes a failure diagnosable without a debugger.

**Verify**: `node test/unit.js` → all PASS.

### Step 4: Cover `normalizeImportedBlock`

`js/block-editor.js:198` is the validator for every untrusted block. It throws
`Error` with a Spanish message on rejection and returns a normalized object on
acceptance. `IMPORT_LIMITS` is at `js/app.js:2036`:

```js
const IMPORT_LIMITS = { days: 14, ex: 40, name: 80, exName: 120, alt: 200, cue: 400, reps: 40, pair: 1000, phaseR: 40, phaseT: 400 };
```

Assert at minimum:

- a minimal valid block is accepted and comes back with the expected shape;
- a block with more than `IMPORT_LIMITS.days` days throws;
- a day with more than `IMPORT_LIMITS.ex` exercises throws;
- an over-long `name` is truncated to `IMPORT_LIMITS.name`, not rejected;
- `sets` and `rest` outside their clamps come back clamped
  (`clampInt(e.sets, 1, 12, 3)` and `clampInt(e.rest, 0, 900, 90)` at
  `js/block-editor.js:228-229`);
- exercise ids are made unique **across the whole block**, not per day (the
  `usedIds` set is declared at `js/block-editor.js:209`, outside the
  `days.map`) — feed it two days carrying the same `id` and assert the second
  comes back suffixed.

That last one documents a real invariant other code depends on. Write it.

Use a helper for the throwing cases:

```js
const throws = expr => { try { call(expr); return false; } catch (e) { return true; } };
```

**Verify**: `node test/unit.js` → all PASS.

### Step 5: Cover `migrate()` on hand-built legacy shapes

This is the highest-value section. `migrate()` is at `js/app.js:193-345` and
runs on three paths: boot, restore, and cross-tab adopt.

Because `migrate()` operates on the global `state`, drive it by assigning
`state` in the context and calling it:

```js
const migrated = obj => call(
  'state = ' + JSON.stringify(obj) + '; migrate(); JSON.parse(JSON.stringify(state));'
);
```

Read `migrate()` in full before writing expectations. Cover the branches the
browser suite does not, each of which the source comments describe:

- the deleted-profile guard (`js/app.js:202-206`) — its comment records that
  iterating the seed "used to resurrect a deleted profile". Assert it does not.
- the four parallel maps being created when absent (`:210-222`) — assert
  `rir`, `notes`, `energy`, `order` all exist as objects afterwards.
- the session-order sanitiser (`:223-233`) — assert a non-array value is
  deleted, that duplicate ids are removed, and that the list is truncated to
  `ORDER_LIMIT`.
- `week` / `day` clamping (`:247-248`).
- per-day exercise id dedup (`:288-292`) — note this is **per day**, so the
  same id on two *different* days survives. Assert that as the documented
  behaviour it is.
- `state.prefs.theme` validation (`:312`) — an unknown value falls back to
  `'auto'`.

**Verify**: `node test/unit.js` → all PASS.

### Step 6: Cover the diagnostics statistics

`js/diagnostics.js` loads with no shim at all. Assert the pure functions,
reading each before writing expectations:

- `fitSlope` (`:461`) — a clean upward series gives a positive slope; a flat
  series gives 0; a single point does not produce `NaN` (the guards at
  `:461-469` are there for this — assert they hold).
- `diagMedianGap` (`:481`) — even and odd-length inputs, and an empty input.
- `diagVerdict` (`:496`) — each branch it can return.

Assert `Number.isNaN(...) === false` explicitly wherever a small sample could
produce `NaN`. A `NaN` reaching the rendered output is the failure mode this
section exists to prevent.

**Verify**: `node test/unit.js` → all PASS.

### Step 7: Wire it into CI

In `.github/workflows/test.yml`, add a step to the existing `smoke` job,
**before** the `Run smoke tests` step (it is faster and needs no server, so a
logic regression fails the build in seconds rather than minutes):

```yaml
      - name: Run headless unit tests
        run: node test/unit.js
```

Place it after `Set up Node` and before `Serve the site`. It needs neither the
server nor Playwright, so it can run before both.

**Verify**: `grep -n "test/unit.js" .github/workflows/test.yml` → one match,
positioned before the `Run smoke tests` step.

### Step 8: Document it

In `README.md`, find the "Tests" section (~line 1457). Add the new suite ahead
of the browser one, keeping the existing prose about `test/smoke.js` intact.
Something in the README's established voice, e.g.:

```
The fast half needs nothing at all:

    node test/unit.js

It loads the six source files into one Node context — the same shared scope
the <script> tags create — and asserts the parts that are arithmetic rather
than interface: the schema repair in migrate(), the import validators, the
statistics behind Diagnóstico.
```

While you are in this section, also fix the stale line: the README currently
says the tests "run on every push and pull request", but
`.github/workflows/test.yml` declares `on: pull_request, workflow_dispatch`
and carries a comment saying "Pull requests only, not push-to-main". Change
the README to say pull requests only. Do **not** change the workflow's
triggers — that is a separate decision.

**Verify**: `grep -n "test/unit.js" README.md` → at least one match;
`grep -n "on every push and pull request" README.md` → no matches.

## Test plan

The deliverable *is* tests, so the test plan is the coverage bar:

- `test/unit.js` exists and passes with **at least 30 assertions** across the
  six sections above.
- It runs in under 2 seconds with no server, no browser, no `node_modules`.
- `test/smoke.js` still passes unchanged.
- Deliberate coverage targets, in priority order: `migrate()` branches,
  `normalizeImportedBlock` limits, `fitSlope`/`diagMedianGap`/`diagVerdict`
  edge cases, then the arithmetic helpers.

## Done criteria

ALL must hold:

- [ ] `node --check test/unit.js` exits 0
- [ ] `node test/unit.js` exits 0, reports 0 failures and at least 30 passes
- [ ] `node test/unit.js` succeeds with no static server running and no `node_modules` present
- [ ] `grep -rn "require('playwright')\|require(\"playwright\")" test/unit.js` returns no matches
- [ ] `ls package.json` → no such file (none was created)
- [ ] `node test/smoke.js` still exits 0 with 0 failures
- [ ] `grep -n "test/unit.js" .github/workflows/test.yml` returns a match before the `Run smoke tests` step
- [ ] `grep -n "on every push and pull request" README.md` returns no matches
- [ ] `git status` shows only `test/unit.js` (new), `.github/workflows/test.yml` and `README.md` modified — **no `js/**` file changed**
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any source file under `js/` would need to change to make it loadable or
  testable. The premise of this plan is that none does; if that is false, the
  premise needs revisiting before code moves.
- The shim in Step 1 does not load all six files. Report the exact error
  rather than growing the shim indefinitely — a shim that starts needing real
  DOM semantics means the boundary is wrong and those assertions belong in
  `test/smoke.js`.
- You find yourself needing to stub a function's *behaviour* (not just its DOM
  dependencies) to make an assertion pass. That is a sign the test is
  reaching past pure logic.
- You are tempted to add a dependency or a `package.json`. Do not; report
  instead.
- A test you write fails because the source has a genuine bug. **Do not fix
  the source in this plan.** Record the failing case, comment it out with a
  note naming what it found, and report it — several known bugs are already
  planned separately (see `plans/README.md`), and a fix landing here would
  make this PR unreviewable.

## Maintenance notes

For whoever owns this next:

- **The dividing line between the two suites**: if a user could observe it —
  markup, a class, a value surviving a reload, a sheet opening — it belongs in
  `test/smoke.js`. If it is arithmetic or data repair, it belongs in
  `test/unit.js`. Keeping that line sharp is what stops the shim from growing
  into a fake browser.
- **The shim is deliberately inert and should stay that way.** Every property
  it grows is a way for a test to pass here and fail in a real browser. If a
  test needs more DOM, that is the signal it is in the wrong file.
- **Load order matters** and mirrors `index.html:479-484`. If a new source
  file is added to the app, add it to the array in `loadApp()` in the same
  position, or the shared-scope reproduction silently drifts from what the
  browser does.
- **What a reviewer should scrutinise**: that no `js/**` file is in the diff,
  and that the assertions describe *behaviour the source actually has* rather
  than behaviour the test author assumed. The `migrate()` section is the one
  worth reading line by line.
- This plan makes plan 004 (import hardening) substantially cheaper to verify
  — that plan's validators are pure functions and can be asserted here.
