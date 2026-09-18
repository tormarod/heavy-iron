# Plan 014: The test harness checks the repo's own invariants (script lists, stubs, storage key, published blocks) and `--list` works again

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6def9fc..HEAD -- test/unit.js test/smoke.js tools/smoke-gate.sh`
> On any change, compare the excerpts below against the live code first.

## Status

- **Priority**: P1 (cheap, and it is the verification baseline every other plan leans on)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `6def9fc`, 2026-09-18
- **Overlap**: `plans/009-architecture-deepening.md` item 3 adds a shell-list
  and a storage-key assertion. If it has landed, extend its assertions in
  Steps 2 and 4 rather than adding parallel ones; Steps 1, 3, 5, 6 are unique
  to this plan.

## Why this matters

AGENTS.md lists four things that must move in lockstep when a `js/` file is
added: the `<script>` tag in `index.html`, the `SHELL` entry in `sw.js`, a
guarded `wire*()` call, and the file's place in `test/unit.js`'s
`loadApp()`. CI enforces exactly one (`js/*.js ⊆ SHELL`). The others are
prose. This repo has shipped two stuck-loading crashes from script-list
mistakes, and the defence against the third — the no-op stubs in `app.js`
for a precache hole — is never exercised because the unit harness always
loads all thirteen files.

Meanwhile the documented way to discover smoke sections,
`node test/smoke.js --list`, crashes: one top-level block was never
wrapped in `section()`, so it calls `browser.newContext()` on a `null`
browser in list mode, aborts the listing, and also runs unconditionally
under `--only`.

This plan turns each prose rule into a failing test, all on the CI rung
(`node test/unit.js`), and fixes the harness. **No shell file changes, so
no `CACHE_VERSION` bump.**

## Current state

- `test/smoke.js:1318-1353` — a bare `{ … }` block titled
  "published blocks stay importable offline (plans/008 item 7)" between
  two `await section(...)` calls; it starts with
  `console.log('\n== published blocks …')` and `const ctx = await browser.newContext();`.
  `test/smoke.js:88` — `const browser = LIST ? null : await chromium.launch();`.
  Reproduced: `node test/smoke.js --list` prints section names, then
  `HARNESS ERROR TypeError: Cannot read properties of null (reading 'newContext') at test/smoke.js:1320`.
- `test/smoke.js:50-63` — `section(name, fn)`: in LIST mode prints the name
  and returns; otherwise runs `fn` inside a try/catch.
- `test/smoke.js:583` — `for (const f of ['hombre-bloque-1.json', 'mujer-bloque-1.json', 'ejemplo-plantilla.json'])`
  hardcodes the published block filenames instead of reading `blocks/index.json`.
- `test/unit.js:38-69` — `loadApp()` creates the vm context and runs the
  file list:
```js
  ['js/theme-init.js', 'js/data.js', 'js/block-editor.js', 'js/diagnostics.js', 'js/review.js',
   'js/profile-transfer.js', 'js/calculator.js', 'js/rest-timer.js',
   'js/chart.js', 'js/volume-sheet.js', 'js/qr-transfer.js',
   'js/app.js', 'js/boot-guard.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
```
- `index.html:30` — `<script src="js/theme-init.js"></script>` in `<head>`;
  `index.html:485-500` — the twelve body script tags ending with
  `js/app.js` then `js/boot-guard.js`.
- `sw.js:32-55` — `const SHELL = [ … ];` listing every shell file.
- `js/app.js:1904-1928` — the stubs (`startRest`, `stopRest`,
  `renderSoundBtn`, `askForNotifications`, `keepAliveStop` for
  `js/rest-timer.js`; `openChart` for `js/chart.js`; `closeQr` for
  `js/qr-transfer.js`), each `if (typeof X !== 'function') { var X = … }`
  or equivalent — read the block before writing the test.
- `js/app.js:4231-4248` — the `wire*()` tail with seven `typeof … === 'function'` guards.
- `js/theme-init.js:19` — `localStorage.getItem('heavy-iron-v1')`;
  `js/app.js:1` — `const STORAGE_KEY = 'heavy-iron-v1';`. The comment at
  `js/theme-init.js:15-18` says "nothing to catch the drift".
- `test/unit.js:970-988` — the seed-drift section reads
  `blocks/hombre-bloque-1.json` etc. with `readBlockFile(name)`; the
  pattern to extend for the registry contract.
- `blocks/index.json` — three entries `{ "file", "label" }`.
  `js/block-editor.js:369-373` accepts only `/^[A-Za-z0-9._-]+\.json$/`.
- `test/smoke.js` has 209 `waitForTimeout` calls (`grep -c`), up from 205 at
  the last audit; plans/008 item 21 bullet 2 owns replacing them.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check test/unit.js && node --check test/smoke.js` | exit 0 |
| Unit | `node test/unit.js` | `N passed, 0 failed` (177 at `6def9fc`) |
| List sections | `node test/smoke.js --list` | prints every section name, exit 0, no HARNESS ERROR |
| One section | `BASE=http://127.0.0.1:8765 node test/smoke.js --only "bloques publicados"` | `0 failed` |

## Scope

**In scope**: `test/unit.js`, `test/smoke.js`, `tools/smoke-gate.sh` (one
optional guard line). Nothing under `js/`, `index.html`, `sw.js`.

**Out of scope**: replacing `waitForTimeout` calls (008 item 21); any app
code; `.github/workflows/test.yml` (the unit suite already runs there, so a
new unit assertion is on CI automatically).

## Git workflow

- Branch: `claude/014-harness-invariants`
- One commit per step; imperative sentence messages. No push/PR unless instructed.

## Steps

### Step 1: Wrap the bare block in `section()`

In `test/smoke.js:1318-1353`, replace the opening `{` and its manual
`console.log('\n== published blocks …')` with
`await section('published blocks stay importable offline (plans/008 item 7)', async () => {`
and the closing `}` with `});`. Body unchanged.

**Verify**: `node test/smoke.js --list` → every section name printed,
last lines are the remaining names (no `HARNESS ERROR`), exit 0. Then
`grep -c "await section('" test/smoke.js` equals `grep -c "^  // ----------" test/smoke.js`
or, more robustly, `grep -cE "^\s*\{\s*$" test/smoke.js` returns 0 for the
top-level indentation level (no bare blocks).

Optionally add to `tools/smoke-gate.sh`, before running the suite, a guard
that fails when `node test/smoke.js --list` exits non-zero — that keeps
`--list` working forever.

### Step 2: Script-list invariant test

In `test/unit.js`, immediately **before** `const app = loadApp();` (line ~77),
hoist the file list into a named constant `SHELL_SCRIPTS` (so both
`loadApp()` and the test use one array), then add a section:

```js
console.log('\n== the four script lists agree (AGENTS.md: index.html, sw.js SHELL, loadApp, js/) ==');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const indexScripts = [...indexHtml.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const shellBlock = /const SHELL = \[([\s\S]*?)\];/.exec(swSrc)[1];
const shellFiles = [...shellBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
ok('index.html loads exactly the files loadApp() loads, in the same order',
   JSON.stringify(indexScripts) === JSON.stringify(SHELL_SCRIPTS), JSON.stringify(indexScripts));
ok('every index.html script is in sw.js SHELL', indexScripts.every(f => shellFiles.includes(f)));
ok('every js/*.js file is a script tag in index.html', jsFiles.every(f => indexScripts.includes(f)), JSON.stringify(jsFiles.filter(f => !indexScripts.includes(f))));
ok('every js/ entry in SHELL exists on disk', shellFiles.filter(f => f.startsWith('js/')).every(f => fs.existsSync(path.join(ROOT, f))));
```

Place this **before** `loadApp()` is called so it runs even if a missing
file breaks the load (put the `ok` helper definition above it — it is
currently at line ~71, before `loadApp()`, so this works).

**Verify**: `node test/unit.js` → 4 new PASS lines, `0 failed`. Sanity: temporarily
reorder two entries in `SHELL_SCRIPTS`, run, see the first assertion FAIL, revert.

### Step 3: Stubs survive a partial shell

Change `loadApp()` to `function loadApp(omit = [])` and filter:
`SHELL_SCRIPTS.filter(f => !omit.includes(f)).forEach(...)`. Then add,
after the existing `== the harness ==` section:

```js
console.log('\n== a precache hole: app.js boots without each split file (AGENTS.md rule 1) ==');
[['js/rest-timer.js', ['startRest', 'stopRest', 'renderSoundBtn', 'askForNotifications', 'keepAliveStop']],
 ['js/chart.js', ['openChart']],
 ['js/qr-transfer.js', ['closeQr']]].forEach(([file, stubs]) => {
  let partial = null, err = null;
  try { partial = loadApp([file]); } catch (e) { err = e; }
  ok('the shell loads without ' + file, !err && !!partial, err && err.message);
  if (!partial) return;
  const c = expr => vm.runInContext(expr, partial);
  stubs.forEach(name => ok(file + ' absent: ' + name + ' is a callable stub', c('typeof ' + name) === 'function'));
  ok(file + ' absent: load() still seeded state', c('!!state && !!state.profiles'));
});
```

Read `js/app.js:1904-1928` first and use the exact stub names it declares;
if the list differs from the seven above, use the file's list and note it
in your report (do not change `app.js`).

**Verify**: `node test/unit.js` → new PASS lines for each file, `0 failed`.

### Step 4: `theme-init.js` reads `STORAGE_KEY`

After Step 3's section:
```js
console.log('\n== theme-init.js reads the same storage key as app.js ==');
const themeInitSrc = fs.readFileSync(path.join(ROOT, 'js/theme-init.js'), 'utf8');
ok('the literal in js/theme-init.js matches STORAGE_KEY',
   themeInitSrc.includes("getItem('" + call('STORAGE_KEY') + "')"), themeInitSrc.match(/getItem\([^)]*\)/)[0]);
```

**Verify**: `node test/unit.js` → PASS.

### Step 5: `blocks/` is a checked registry

Extend the seed-drift section (`test/unit.js:970-988`):

```js
console.log('\n== blocks/index.json is a contract: every entry exists, validates, and round-trips ==');
const blockIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks/index.json'), 'utf8'));
ok('index.json is a non-empty array', Array.isArray(blockIndex) && blockIndex.length > 0);
const blockDir = fs.readdirSync(path.join(ROOT, 'blocks')).filter(f => f.endsWith('.json') && f !== 'index.json');
ok('every .json in blocks/ (except index.json) is listed in index.json',
   blockDir.every(f => blockIndex.some(e => e.file === f)), JSON.stringify(blockDir.filter(f => !blockIndex.some(e => e.file === f))));
blockIndex.forEach(entry => {
  ok(entry.file + ': filename is one the importer accepts', /^[A-Za-z0-9._-]+\.json$/.test(entry.file) && !entry.file.includes('..'));
  ok(entry.file + ': has a label', typeof entry.label === 'string' && entry.label.trim().length > 0);
  ok(entry.file + ': exists', fs.existsSync(path.join(ROOT, 'blocks', entry.file)));
  let raw = null, normalized = null, err = null;
  try { raw = readBlockFile(entry.file); normalized = call('normalizeImportedBlock(' + JSON.stringify(raw) + ')'); } catch (e) { err = e; }
  ok(entry.file + ': passes normalizeImportedBlock', !err, err && err.message);
  if (!normalized) return;
  ok(entry.file + ': normalizing changes no exercise name or id',
     JSON.stringify(normalized.days.map(d => d.ex.map(e => [e.id, e.n]))) === JSON.stringify(raw.days.map(d => d.ex.map(e => [e.id, e.n]))));
});
```

Then in `test/smoke.js:583`, replace the hardcoded array with the index:
`const blockIndex = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'blocks/index.json'), 'utf8'));`
`for (const f of blockIndex.map(e => e.file)) { … }` (add `const fs = require('node:fs'); const path = require('node:path');`
at the top if not present).

**Verify**: `node test/unit.js` → new PASS lines, `0 failed`. If the
round-trip assertion fails for a published block, STOP and report which
field changed — that is a real finding about that file, not a test bug.

### Step 6: A ceiling on fixed sleeps

Add to `test/unit.js` (end of the harness section):
```js
const smokeSrc = fs.readFileSync(path.join(ROOT, 'test/smoke.js'), 'utf8');
const sleeps = (smokeSrc.match(/waitForTimeout\(/g) || []).length;
ok('test/smoke.js does not gain fixed sleeps (plans/008 item 21: ' + sleeps + ' now; replace, do not add)', sleeps <= 209, String(sleeps));
```
Set the ceiling to the current count you measure. Whoever works item 21
lowers the number as they go.

**Verify**: `node test/unit.js` → PASS.

## Done criteria

- [ ] `node test/smoke.js --list` exits 0 and prints "published blocks stay importable offline" among the names
- [ ] `node test/unit.js` → `0 failed`, N ≥ 195
- [ ] `grep -n "SHELL_SCRIPTS" test/unit.js` → ≥ 3 matches
- [ ] `grep -n "hombre-bloque-1.json', 'mujer-bloque-1.json', 'ejemplo" test/smoke.js` → 0 matches
- [ ] `git status` shows only `test/unit.js`, `test/smoke.js`, optionally `tools/smoke-gate.sh`
- [ ] `sw.js` **unchanged** (no shell file touched)

## STOP conditions

- `node test/smoke.js --list` does **not** crash at `6def9fc`-equivalent code (bug already fixed).
- `loadApp()` in `test/unit.js` no longer has the inline file array.
- Loading without `js/rest-timer.js` throws inside `app.js` for a reason
  other than a missing stub — that is a real precache-hole regression in
  `app.js`; report it, do not patch `app.js` here.
- A published block fails the round-trip assertion (see Step 5).

## Maintenance notes

- Adding a `js/` file now fails the unit suite until all four lists agree;
  AGENTS.md's "that half is on you" wording is obsolete after this plan
  (plan 015 updates the prose).
- Adding a fourth published block requires an `index.json` entry, and the
  smoke suite picks it up automatically.
- The sleep ceiling is a ratchet: lower it in the same PR that removes sleeps.
