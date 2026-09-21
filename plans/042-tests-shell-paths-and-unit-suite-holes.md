# Plan 042: The shell's untested paths get a smoke section, and the unit suite's three blind spots close — translucent tokens in the contrast table, a leaked `drawnSlot`, a loop with no floor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3913b8f..HEAD -- test/unit.js test/smoke.js css/style.css index.html js/app.js`
> If `test/unit.js` or `test/smoke.js` changed, compare the "Current state"
> excerpts before proceeding; if `css/style.css`, `index.html` or
> `js/app.js` changed, check that the ids and tokens this plan asserts
> still exist (`grep -n 'id="themeBtn"\|id="settings"\|id="exMenuSetup"\|id="exMenuCalc"\|id="navSession"\|id="calcSheet"' index.html`
> → six hits; `grep -c "timer-bg\|timer-ink\|timer-dim" css/style.css` → 6 or more).

## Status

- **Priority**: P2
- **Effort**: M (the unit half is S; the smoke half needs Playwright and a
  server)
- **Risk**: LOW — tests only; no shell file changes, so no `CACHE_VERSION`
  bump.
- **Depends on**: none. Independent of 039–041 and of plan 038 (which
  edits `test/unit.js` too, but a different section — expect a clean
  rebase).
- **Category**: tests
- **Planned at**: commit `3913b8f`, 2026-09-21

## Why this matters

Plans 034, 036 and 037 rebuilt the header, the card and the app shell.
Between them they added one smoke section and no unit section, and three
of the shell's behaviours have no assertion in either suite:

- **`data-keep-open`** — the one hub row that must *not* close its hub
  ("Tema" cycles in place). The three theme clicks in `test/smoke.js:694-706`
  each go through `openHub`, which is idempotent (`openSheetVia` returns
  early when the sheet is already up), so deleting the attribute from
  `index.html:261` is a green build that ships a "Tema" row whose result
  you cannot see.
- **The `⋯` menu's "Ajustes de máquina" and "Calculadora" rows**
  (`js/app.js:3627, 3638`) — the first is the only path that sets
  `focusSetup` and hands the keyboard into the fold through
  `takeFocusMark`; the smoke case that reaches the settings box goes in
  through the name button instead.
- **`#navSession`** — the fourth bar destination is never clicked.

Also unpinned: the `inputmode` on the three set boxes, which
`js/app.js:3382-3384` calls load-bearing (a Spanish keyboard sends a
comma; `type=number` throws the value away) — the `type="text"` half is
tested, the keyboard half is not.

And three blind spots in `test/unit.js` itself:

- The contrast table's `tokenMap` regex matches **hex only**. Plan 037's
  timer palette — `--timer-bg`, `--timer-ink`, and the translucent
  `--timer-dim`/`--timer-line` — is not in the table, and neither is
  `--danger`, which is text on `--card` in `.sm.warn` and
  `.sheet-sec.danger`. Every pair measured today passes (the tightest is
  light `--signal` on `--timer-bg` at 3.27:1, a 52 px/700 numeral where
  3:1 applies), so this is a coverage hole, not a live defect — but a
  covered token converted to `rgba()` would silently drop out of the
  table rather than fail.
- The `pruneLog` probe sets the global `drawnSlot` and never clears it
  (`:3065`); the two other probes that set it do (`:2010, 3027`). Stale, it
  only makes later `pruneLog` calls more conservative, so nothing fails
  today — but the suite is one top-level script, and a section added
  after it that asserts an unused slot *was* pruned gets a wrong answer
  with no signal.
- The docs cross-link section emits every assertion inside
  `links.forEach`; if the link regex stops matching, the loop runs zero
  times and the section is green having checked nothing. The same file
  guards this correctly twice (`:3110` asserts a non-empty index before
  its loop; `:3067` asserts the gate regex was found).

## Current state

All excerpts at `3913b8f`.

- `test/unit.js` — the contrast section `:139-208`; `tokenMap` `:141-145`;
  `contrast(hexA, hexB)` `:153-156`; the pair loop `:159-183`; the
  `pruneLog` probe `:3054-3072`; the docs loop `:3121-3143`. `ok(name,
  cond, extra)` at `:85`. The suite ends by printing
  `N passed, M failed` (760/0 at `3913b8f` with `plans/README.md` updated).
- `test/smoke.js` — `section(name, fn)` `:62`; `dismissSetup` `:75`;
  `openSheetVia` `:94-98`; `openHub` `:123`; `openExMenu` `:130-133`;
  `openExMore` `:143-148`; `ok` `:159`. Sections run in order inside one
  `(async () => { … })()`; the last one, `accesibilidad: tamaños, foco y
  área segura`, starts at `:3916`. `--list` prints names; `--only
  <substring>` runs a subset.
- `index.html` — `#themeBtn` (`:261`, `data-keep-open="1"`), `#settings`
  (`:257`), `#exMenuSetup`/`#exMenuCalc` (`:163-164`), `#navSession`
  (`:120`), `#calcSheet`/`#calcClose`, `#setupSheet`/`#setupClose`.
- `css/style.css` — light tokens `:26-52`, dark `:61-87`.

```js
// test/unit.js:141-145
function tokenMap(blockSrc) {
  const map = {};
  for (const m of blockSrc.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) map[m[1]] = m[2];
  return map;
}
// test/unit.js:153-156
function contrast(hexA, hexB) {
  const a = luminance(hexA), b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// test/unit.js:159-162 — the shape of every pair assertion
[['light', lightTokens], ['dark', darkTokens]].forEach(([label, t]) => {
  const softRatios = ['paper', 'card', 'sunk'].map(bg => contrast(t.soft, t[bg]));
  ok(label + ': --soft is >= 4.5:1 on --paper, --card and --sunk',
     softRatios.every(r => r >= 4.5), 'paper/card/sunk: ' + softRatios.map(r => r.toFixed(2)).join('/'));
```

```css
/* css/style.css:49-52 (light) and :84-87 (dark) */
  --timer-bg: #15171A;
  --timer-ink: #F4F2EE;
  --timer-dim: rgba(255,255,255,.6);
  --timer-line: rgba(255,255,255,.3);
/* :39 (light) / :74 (dark) */
  --danger: #B8301F;
```

Ratios at `3913b8f`, computed with the alpha composited over `--timer-bg`
(light / dark): `--timer-ink` 16.06 / 15.28; `--timer-dim` 7.02 / 5.98;
`--signal` 3.27 / 6.65; `--flare` 11.18 / 10.76; `--danger` on `--card`
6.03 / 6.18, on `--paper` 5.40 / 6.77. (`--timer-line` is 2.72 / 2.27 — a
border, not asserted; see Maintenance notes.)

```js
// test/unit.js:3065-3066 — inside the pruneLog probe's call(`…`)
    drawnSlot = { profile: state.activeProfile, block: blockId, key: slot(1, day.id) };
    pruneLog();
// test/unit.js:3132-3135
  docs.forEach(file => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const links = [...src.matchAll(/\]\(([^)\s]+)\)/g)].map(x => x[1]).filter(l => !/^(https?:|mailto:)/.test(l));
    links.forEach(link => {
```

```js
// test/smoke.js:94-98
const openSheetVia = async (page, btn, sheet) => {
  if (await page.locator(sheet + '.up').count()) return;
  await page.click(btn);
  await page.waitForSelector(sheet + '.up', { timeout: 4000 });
};
// test/smoke.js:694-696
    await openHub(page, 'more');
    await page.click('#themeBtn');
    ok('cycles to light', …);
```

The newest section (`:3916-3921`) shows the boot recipe every section uses:

```js
  await section('accesibilidad: tamaños, foco y área segura', async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
```

Conventions: a smoke section is one browser context, `page.goto(BASE)`,
`dismissSetup`, assertions with `ok`, `await ctx.close()` at the end; count
a locator before reading it through `evaluateAll` (the comment at
`test/smoke.js:2854-2860` explains why — `every` over an empty match is
vacuously true); prefer `waitForSelector`/`waitForFunction` to fixed
sleeps. Comments explain *why*.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed` — **read N before Step A and count in deltas**: it printed 760 at `3913b8f` with this plan's index row in place, and plan 038 is adding assertions concurrently |
| Syntax of the smoke file | `node --check test/smoke.js` | exit 0 |
| Section list (no browser) | `node test/smoke.js --list` | prints every section name, one per line |
| Install Playwright (once) | `npm install --no-save --ignore-scripts playwright@1.56.1 && npx playwright install chromium` | exit 0 |
| Serve (once, in another shell) | `python3 -m http.server 8765` (Git Bash) or `Start-Process python3 -ArgumentList '-m','http.server','8765'` (PowerShell) | serving on :8765 |
| One section | `node test/smoke.js --only "la barra y el menú"` | every line `PASS`; the tally reads `N passed, 0 failed` |

Do not run the full `node test/smoke.js`; the PR hook does that once.

## Scope

**In scope**:
- `test/unit.js` — `tokenMap`, `contrast`, new pair assertions, one line
  in the `pruneLog` probe, one line in the docs loop.
- `test/smoke.js` — one new section, appended after the last existing one.
- `plans/README.md` — your status row.

**Out of scope**:
- `css/style.css`, `index.html`, `js/*` — if an assertion here fails
  against them, that is a finding to report, not a token to adjust.
- The existing theme cases at `test/smoke.js:690-708` — leave them; the
  new section pins `data-keep-open` on its own.
- `sw.js` — no shell file changes, so no bump.

## Git workflow

- Branch: `claude/042-tests-shell-and-unit-holes`
- One commit per step, plain-sentence messages
  (`Plan 042 Step A: the contrast table reads rgba() tokens`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step A: The contrast table composites translucent tokens and covers the timer and `--danger`

In `test/unit.js`, replace `tokenMap` (`:141-145`) and `contrast`
(`:153-156`) with:

```js
/* Hex or rgba(): the timer's --timer-dim/--timer-line and the --on-ink-*
   tokens are translucent, and a regex that only read hex dropped them out
   of this table silently — the one section whose job is to fail when a
   token drifts (plans/042). */
function tokenMap(blockSrc) {
  const map = {};
  for (const m of blockSrc.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6}|rgba?\([^)]*\))\s*;/g)) map[m[1]] = m[2];
  return map;
}
/* A translucent colour has no contrast of its own: it is composited over
   the surface it sits on first, and the ratio is taken of the result. */
function over(token, bgHex) {
  if (token[0] === '#') return token;
  const [r, g, b, a = 1] = /rgba?\(([^)]*)\)/.exec(token)[1].split(',').map(Number);
  const bg = [1, 3, 5].map(i => parseInt(bgHex.slice(i, i + 2), 16));
  return '#' + [r, g, b].map((v, i) => Math.round(a * v + (1 - a) * bg[i]).toString(16).padStart(2, '0')).join('');
}
function contrast(fg, bgHex) {
  const a = luminance(over(fg, bgHex)), b = luminance(bgHex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
```

Then inside the per-theme loop, after the `shareInkSoft` assertion
(`:181-182`) and before the loop's closing `});`, add:

```js
  /* The rest timer is its own dark surface in both themes (plans/037) and
     every line on it is text: the second line and the switch at 13px in
     --timer-dim, the label at 11px, the 52px/700 numeral in --signal and,
     once the rest is over, in --flare. The numeral is large text, so 3:1;
     everything else 4.5:1. */
  ok(label + ': the timer tokens are all present', ['timer-bg', 'timer-ink', 'timer-dim'].every(k => !!t[k]),
     ['timer-bg', 'timer-ink', 'timer-dim'].map(k => k + '=' + t[k]).join(' '));
  const timerInk = contrast(t['timer-ink'], t['timer-bg']);
  ok(label + ': --timer-ink is >= 4.5:1 on --timer-bg', timerInk >= 4.5, timerInk.toFixed(2));
  const timerDim = contrast(t['timer-dim'], t['timer-bg']);
  ok(label + ': --timer-dim, composited, is >= 4.5:1 on --timer-bg', timerDim >= 4.5, timerDim.toFixed(2));
  const timerVal = contrast(t.signal, t['timer-bg']), timerOver = contrast(t.flare, t['timer-bg']);
  ok(label + ': --signal and --flare are >= 3:1 on --timer-bg (the 52px numeral is large text)',
     timerVal >= 3 && timerOver >= 3, timerVal.toFixed(2) + '/' + timerOver.toFixed(2));
  /* --danger is text on --card (.sm.warn, .sheet-sec.danger) and on --paper. */
  const dangerRatios = ['card', 'paper'].map(bg => contrast(t.danger, t[bg]));
  ok(label + ': --danger is >= 4.5:1 on --card and --paper',
     dangerRatios.every(r => r >= 4.5), 'card/paper: ' + dangerRatios.map(r => r.toFixed(2)).join('/'));
```

**Verify**: `node test/unit.js` → `N+10 passed, 0 failed` (ten new: five
per theme; N is what your first run printed). The printed ratios should match the table in "Current state" to
two decimals; every pre-existing contrast assertion still passes (the
`over` shortcut returns a hex unchanged, so nothing already covered moved).

### Step B: The `pruneLog` probe puts `drawnSlot` back

In `test/unit.js:3066`, directly after `pruneLog();` inside the probe, add:

```js
    drawnSlot = null;   /* left set, this makes every later pruneLog probe quieter than it should be (plans/042) */
```

**Verify**: `node test/unit.js` → `N+10 passed, 0 failed`;
`grep -c "drawnSlot = null" test/unit.js` → `3`.

### Step C: The docs loop asserts it had something to check

In `test/unit.js`, inside `docs.forEach`, directly after the `const links
= …` line (`:3134`), add:

```js
    ok(file + ' has internal links to check', links.length > 0, String(links.length));
```

**Verify**: `node test/unit.js` → `N+14 passed, 0 failed` (four docs, four
new lines).

### Step D: One smoke section for the shell paths nothing asserted

In `test/smoke.js`, after the closing `});` of the
`accesibilidad: tamaños, foco y área segura` section (the last `await
section(` in the file, `:3916`) and before `if (browser) await
browser.close();` (`:4064`), add:

```js
  // ---------- the bar's fourth destination and the card's "⋯" (plans/036, plans/037) ----------
  /* Three paths the shell rework left with no assertion in either suite:
     the one hub row that must keep its hub up (data-keep-open — "Tema"
     cycles in place and has to still be there to show what it cycled to),
     the "⋯" rows that hand the keyboard into the fold and open the
     calculator, and Sesión itself. Plus the keyboard each set box asks the
     phone for — the one thing about the boxes headless Chromium can still
     see (js/app.js, "text + inputmode rather than type=number"). */
  await section('la barra y el menú de la tarjeta (plans/036, plans/037)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);

    // 1. data-keep-open: "Tema" leaves the hub up; every other row puts it away
    await openHub(page, 'more');
    await page.click('#themeBtn');
    await page.waitForTimeout(150);
    ok('"Tema" leaves the Más hub up (data-keep-open)', await page.locator('#moreSheet.up').count() === 1);
    await page.click('#settings');
    await page.waitForSelector('#setupSheet.up', { timeout: 4000 });
    ok('...and "Ajustes" closes the hub on its way to the settings sheet',
       await page.locator('#moreSheet.up').count() === 0 && await page.locator('#setupSheet.up').count() === 1);
    await page.click('#setupClose');
    await page.waitForSelector('#setupSheet.up', { state: 'hidden', timeout: 4000 });

    // 2. Sesión: back to the top of the day
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => window.scrollY);
    await page.click('#navSession');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.scrollY);
    ok('Sesión scrolls the day back up', before > 0 && after < before, before + ' → ' + after);
    ok('...and is the current page in the bar', await page.getAttribute('#navSession', 'aria-current') === 'page');

    // 3. "Ajustes de máquina" from the "⋯" hands the keyboard into that card's fold
    await openExMenu(page, 0);
    await page.click('#exMenuSetup');
    await page.waitForSelector('#exMenuSheet.up', { state: 'hidden', timeout: 4000 });
    const setupFocus = await page.evaluate(() => {
      const card = document.querySelector('.ex');
      const fold = card.querySelector('.ex-more');
      const el = document.activeElement;
      return { open: !fold.hidden, focused: !!el && el.classList.contains('ex-setup-in') && card.contains(el) };
    });
    ok('"Ajustes de máquina" opens the first card\'s fold', setupFocus.open, JSON.stringify(setupFocus));
    ok('...and puts the keyboard in that card\'s settings box', setupFocus.focused, JSON.stringify(setupFocus));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());

    // 4. "Calculadora" from the "⋯"
    await openExMenu(page, 0);
    await page.click('#exMenuCalc');
    await page.waitForSelector('#calcSheet.up', { timeout: 4000 });
    ok('"Calculadora" from the menu opens the calculator sheet', await page.locator('#calcSheet.up').count() === 1);
    await page.click('#calcClose');
    await page.waitForSelector('#calcSheet.up', { state: 'hidden', timeout: 4000 });

    // 5. the keyboard each box asks for — counted first, so a renamed class fails here and not vacuously
    const boxes = page.locator('.ex').first().locator('.set-row input');
    const modes = await boxes.evaluateAll(els =>
      els.map(e => e.className + ':' + e.inputMode + (e.maxLength > 0 ? ':' + e.maxLength : '')));
    ok('every set row asks for a number pad: weight decimal, reps numeric, RIR numeric and one digit',
       modes.length >= 3 && modes.length % 3 === 0 &&
       modes.every((m, i) => m === ['w-in:decimal', 'r-in:numeric', 'rir-in:numeric:1'][i % 3]),
       modes.join(' '));

    await ctx.close();
  });
```

**Verify**: `node --check test/smoke.js` → exit 0. `node test/smoke.js
--list` → the list now ends with `la barra y el menú de la tarjeta
(plans/036, plans/037)` (before `--list` exits). With Playwright installed
and a server on :8765: `node test/smoke.js --only "la barra y el menú"` →
eight `PASS` lines, then `8 passed, 0 failed`.

## Test plan

- New unit assertions: ten contrast (Step A), four floor (Step C). New
  smoke assertions: eight in one section (Step D). Step B is hygiene.
- Existing coverage that must stay green: the whole contrast section
  (`node test/unit.js`) and, for the smoke file, `--list` (a section
  written as a bare block instead of `section(...)` breaks it — see
  `tools/smoke-gate.sh:205-212`).
- Verification: `node test/unit.js` → `0 failed`, fourteen more passed than
  before Step A; `node test/smoke.js --only "la barra y el menú"` →
  `8 passed, 0 failed`.

## Done criteria

- [ ] `node test/unit.js` ends `0 failed`, with fourteen more `passed` than on `main`
- [ ] `grep -c "rgba" test/unit.js` → at least `2` (the regex and `over`)
- [ ] `grep -c "timer-bg" test/unit.js` → at least `4`
- [ ] `grep -c "drawnSlot = null" test/unit.js` → `3`
- [ ] `grep -c "has internal links to check" test/unit.js` → `1`
- [ ] `node --check test/smoke.js` exits 0 and `node test/smoke.js --list`
      prints `la barra y el menú de la tarjeta (plans/036, plans/037)`
- [ ] `node test/smoke.js --only "la barra y el menú"` → `8 passed, 0 failed`
      (state it plainly in the report if you could not run Playwright)
- [ ] `git status --short` lists only `test/unit.js`, `test/smoke.js` and `plans/README.md`
- [ ] `plans/README.md` status row for 042 updated

## STOP conditions

- Any contrast assertion in Step A **fails**: the ratio in the "Current
  state" table has moved, which means `css/style.css` changed a token.
  Report the pair and the measured ratio; do not lower a threshold.
- `#settings` does not open `#setupSheet`, or `#exMenuSetup` does not focus
  an `.ex-setup-in` — the shell changed under this plan; report.
- `node test/smoke.js --list` crashes after Step D (a bare block instead of
  a `section(` call).
- Playwright cannot be installed or Chromium cannot launch on this
  machine: finish Steps A–C, write Step D, run `--check` and `--list`, and
  report that the section was not executed. Do not mark 042 DONE.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `--timer-line` measures 2.72:1 light / 2.27:1 dark on `--timer-bg`. It
  is a border. Plan 034 recorded the same standing for `--edge` on `--card`
  ("below 1.4.11 … uncovered by the contrast table"); if the timer's
  buttons are ever judged as UI components under SC 1.4.11, both belong in
  the table together, at 3:1.
- The `over()` helper composites against a *hex* background. If a
  background token is ever made translucent, the assertion using it will
  throw on `parseInt` — that is the right failure; extend `over` rather
  than skipping the pair.
- The new smoke section boots the seed plan and reads card 0. If the seed's
  first exercise ever loses its rest (a superset) nothing here changes; if
  it gains a drop row by default, step 5's `.set-row input` selector still
  excludes `.drop-row`.
- Reviewer: the theme click in step 1 leaves `prefs.theme` on `light` for
  that context only; every section opens its own context, so no order
  dependence is introduced.
