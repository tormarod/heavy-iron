# Plan 032: Safe areas, focus under the header, the day-tab colour, contrast tokens and target sizes — pinned by a smoke section

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat efc6eca..HEAD -- index.html css/style.css js/app.js test/unit.js test/smoke.js sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: nil on Android and desktop (every change is inert where there is
  no inset, or a colour); LOW on iOS (the insets appear where they should).
- **Depends on**: none. First of the option 4 series (plans/031, L6 + L7 +
  L13): 033–037 build on the `--edge` token and the smoke section this plan
  adds.
- **Category**: accessibility / correctness
- **Planned at**: commit `efc6eca`, 2026-09-20

## Why this matters

Plans/031 measured the main screen and found four things that are bugs
rather than density, and this plan is all four in one CSS-only PR:

1. **Keyboard focus lands entirely under the sticky header.** From the
   third card's first tick, twelve Shift+Tab presses put focus on a
   `.drop-add` whose box is at y 93–133 while `.top` ends at y 295. WCAG 2.2
   SC 2.4.11 (Focus Not Obscured), and exactly the case its failure F110
   names. `css/style.css` has no `scroll-padding` anywhere.
2. **The day tabs paint in the browser's default button colour.** `.day`
   (`css/style.css:170`) sets no `color`, and the UA colour follows
   `<meta name="color-scheme" content="light dark">` (`index.html:12`) —
   the OS scheme, not `data-theme`. Measured: `data-theme="light"` on a
   dark-system browser draws the unselected day names `rgb(255,255,255)`
   on the light paper.
3. **Nothing is padded for the safe areas.** `index.html:11` sets
   `viewport-fit=cover` and the manifest installs `standalone`, and no
   file uses `env(safe-area-inset-*)`: on an iPhone with a home indicator
   the timer (`css/style.css:516`, `bottom: 0`) and the toast (`:574`)
   sit in the 34 pt indicator zone and the header's first row under the
   status bar.
4. **Contrast and target size.** Light-theme `--soft` is 3.61:1 on paper
   and 4.49:1 on card, the amber cue 3.63:1 on card, all under SC 1.4.3's
   4.5:1 for text under 24 px; control borders drawn with `--line` are
   1.60:1 light and 1.36:1 dark against SC 1.4.11's 3:1; and 28 controls
   are under SC 2.5.8's 24 px — the 14 order arrows at 20×14
   (`css/style.css:226`), 7 "Progreso ↗" at 68×22 (`:259`), 7 "⚙ Ajustes"
   at 59×22 (`:306`).

After this plan the four are fixed and **pinned**: a smoke section asserts
the header height, the target sizes, the focus probe and the day-tab
colour at 375×667, and a unit assertion computes the contrast of the token
pairs from `css/style.css` itself, so 033's new palette cannot regress
them without a red run.

## Current state

Files and their roles:

- `css/style.css` — the two token blocks (`:9-40` light, `:47-73` dark),
  `.top` (`:128-132`), `.day` (`:170-179`), `.ex-num`/`.ex-ord`
  (`:217-232`), `.ex-chart-btn` (`:259-263`), `.ex-setup-btn` (`:306-311`),
  `.fld input` (`:429-436`), `.tick` (`:443-448`), `.drop-add`
  (`:456-465`), `.timer` (`:516-521`), `.toast` (`:574-586`),
  `#app` (`:82`).
- `index.html` — the viewport meta (`:11`), the colour-scheme meta (`:12`).
- `test/smoke.js` — the `layout` section (`:3478-3496`), which asserts
  two things at 375/412/768 wide: the four timer controls fit, and the
  page does not scroll sideways. `dismissSetup(page)` (`:66`) skips the
  first-run sheet.
- `test/unit.js` — reads `index.html` and `sw.js` from disk already for the
  shell-list assertions (search for `SHELL_SCRIPTS`, `:46`), so a
  file-reading assertion has a precedent.

Excerpt — the tokens, `css/style.css:9-27` (light) and `:47-53` (dark):

```css
:root {
  --font-sans: 'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --paper: #E4E2DA;
  --card: #FBFAF7;
  --sunk: #F2F0EA;
  --ink: #17191C;
  --soft: #71747A;
  --line: #CBC8BE;
  --amber: #B87400;
  ...
:root[data-theme="dark"] {
  --paper: #15161A;
  --card: #1D1F24;
  --sunk: #24262C;
  --ink: #E8E6E0;
  --soft: #9A9CA3;
  --line: #33363D;
```

Excerpt — the day tab with no colour, `css/style.css:170-179`:

```css
.day {
  border: 1px solid var(--line); background: transparent; cursor: pointer;
  padding: 9px 6px; border-radius: 2px; text-align: left; transition: all .12s;
}
.day:hover { border-color: var(--ink); }
.day.on { background: var(--ink); border-color: var(--ink); }
.day-n { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--soft); display: block; }
.day.on .day-n { color: var(--on-ink-faint); }
.day-t { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
.day.on .day-t { color: var(--card); }
```

Excerpt — the fixed elements, `css/style.css:82`, `:516-521`, `:574-586`:

```css
#app { min-height: 100vh; padding-bottom: 100px; }
...
.timer {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 50;
  ...
.toast {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 14px; z-index: 70;
  ...
.timer.up ~ .toast { bottom: 86px; }
```

Excerpt — the sub-24 px controls, `css/style.css:226-232`, `:259-262`, `:306-310`:

```css
.ex-ord {
  width: 20px; height: 14px; padding: 0; border: none; background: transparent;
  ...
.ex-chart-btn {
  margin-top: 5px; background: transparent; border: 1px solid var(--line); color: var(--soft);
  font-size: 10px; font-family: var(--font-sans); font-weight: 600; padding: 3px 7px; border-radius: 2px; cursor: pointer;
}
...
.ex-setup-btn {
  background: transparent; border: none; color: var(--soft);
  font-family: 'IBM Plex Mono', monospace; font-size: 10.5px;
  padding: 2px 0 6px; cursor: pointer; text-align: left;
}
```

Excerpt — the `layout` section, `test/smoke.js:3478-3496`:

```js
  await section('layout', async () => {
    for (const [label, width] of [['iPhone SE', 375], ['Pixel', 412], ['tablet', 768]]) {
      const ctx = await browser.newContext({ viewport: { width, height: 820 } });
      ...
      ok(label + ': all 4 rest-timer controls fit on screen', ...);
      ok(label + ': page does not scroll sideways', r.scroll <= r.vw, r.scroll + ' > ' + r.vw);
```

## Steps

### Step A — Safe-area padding on every fixed or sticky edge

**Files**: `css/style.css`.

**Change**:

```css
.top { ... padding-top: env(safe-area-inset-top); }
.timer { ... padding-bottom: env(safe-area-inset-bottom); }
.toast { ... bottom: calc(14px + env(safe-area-inset-bottom)); }
.timer.up ~ .toast { bottom: calc(86px + env(safe-area-inset-bottom)); }
#app { min-height: 100vh; padding-bottom: calc(100px + env(safe-area-inset-bottom)); }
```

`env()` resolves to `0px` wherever there is no inset (Android Chrome,
desktop, the smoke suite's Chromium), so nothing moves there. Add a
three-line comment above `.timer` saying why (the WebKit rule: content
under the home indicator is untappable, and `viewport-fit=cover` at
`index.html:11` opted into it).

**Verify**: `node test/smoke.js --only layout` passes unchanged (the four
timer controls still fit at 375).

### Step B — Focus never under the header

**Files**: `css/style.css`.

**Change**: on `html`, `scroll-padding-top: 310px` and
`scroll-padding-bottom: calc(90px + env(safe-area-inset-bottom))`, with a
comment naming WCAG 2.4.11 / F110 / C43 and the number's source (the
header measured 295 px at 375 wide; plan 034 folds the header and lowers
this to 140 — say so in the comment so 034's executor finds it). Browsers
apply scroll padding when scrolling a focused element into view, which is
the whole mechanism.

**Verify**: Step F's focus probe passes; `node test/smoke.js --only
"accesibilidad: tama"` (the new section) is green.

### Step C — The day tabs own their colour

**Files**: `css/style.css:170`.

**Change**: `.day { color: var(--ink); ... }`. Add one comment line: a
`<button>`'s default colour follows the OS scheme through the
`color-scheme` meta, not `data-theme`, so every button in this file states
its colour, and this was the one that did not. Grep `css/style.css` for
every `button`-styling class that sets no `color` (`.swatch` is colour-only
and needs none); expect `.day` to be the only one.

**Verify**: Step F's colour assertion passes.

### Step D — Tokens that pass, and an `--edge` token for control borders

**Files**: `css/style.css` (both token blocks and the control rules).

**Change**:

1. Light `--soft: #585B61` (5.25:1 on paper, 6.52:1 on card). Dark stays
   `#9A9CA3` (6.59:1).
2. A new token in both blocks, `--edge`, for the visual boundary of a
   control: `#8A887F` light (3.40:1 on card), `#6B6F79` dark (3.28:1).
   `--line` stays for dividers, card borders, the header rule and the
   progress track.
3. A new token in both blocks, `--amber-ink`, for amber *text*: `#8C5800`
   light (5.73:1 on card), `#E0A33C` dark (7.44:1). `--amber` stays for
   fills (the deload week tab, the RÉCORD badge, the PR tick, the forced
   drop chip, the priority chip).
4. Switch the border of every control from `var(--line)` to `var(--edge)`:
   `.profile-btn` (`:111`), `.blockbar select` (`:122`), `.icon-btn`
   (`:141`), `.wk` (`:153`), `.day` (`:171`), `.ex-chart-btn` (`:260`),
   `.ex-setup-box input` (`:315`), `.energy-chip` (`:360`), `#sesNote`
   (`:392`), `.rir-chip` (`:411`), `.fld input` (`:431`), `.tick` (`:444`),
   `.drop-add` (`:458`), `.drop-x` (`:479`), `.drop-chip` (`:490`), `.sm`
   (`:558`), `.sheet-box textarea` (`:607`), the `.pe-*` inputs and
   selects (`:618-648`), `.pe-icon-btn` (`:661`), `.pe-move-sel` (`:670`),
   `.seg-btn` (`:802`), `.setup-name input` (`:816`), `.pri-chip` (`:754`),
   `.ord-reset` (`:245`), `.ex-est-c` (`:344`). The unticked ✓ glyph and
   the ↓ glyph (`.tick { color: var(--line) }`, `.drop-add { color:
   var(--line) }`) become `var(--edge)`.
5. Switch amber *text* to `var(--amber-ink)`: `.ex-cue` (`:253`),
   `.ex-est.down` (`:335`), `.deload-check.bad` (`:373`), `.brake-note`
   (`:379`), `.vol-warn` (`:721`), `.vol-pri` (`:745`), `.freq-row.behind
   .freq-gap` (`:923`), `.diag-row.flat .diag-chip` (`:890`),
   `.rev-deload.bad` (`:965`), `.ex-parked` (`:299`). Fills keep
   `var(--amber)`.
6. Update the token comment at the top (`:3-8`) with the two new names
   and the rule: `--line` divides, `--edge` bounds a control, `--amber` is
   a fill and `--amber-ink` is text.

**Verify**: `node test/unit.js` (Step G's assertion) passes; open the app
in both themes and confirm no control lost its border and no amber text
went missing (a `grep -c "var(--line)" css/style.css` before and after
records how many sites moved — expect about 30).

### Step E — Every control at least 24 px

**Files**: `css/style.css:217-232`, `:259-262`, `:306-310`.

**Change**: `.ex-num { gap: 4px; }` and `.ex-ord { width: 24px; height:
20px; }` — 24×20 with 4 px between the two arrows meets SC 2.5.8 through
its spacing rule (a 24 px circle centred on each does not touch the other);
`.ex-chart-btn { min-height: 28px; padding: 5px 9px; font-size: 11px; }`;
`.ex-setup-btn { min-height: 28px; padding: 6px 0; }`. 28 px is Apple's
stated minimum for a control; plan 036 removes all three controls from the
card, so this is the floor for the interim, not the target.

**Verify**: Step F's size assertion passes.

### Step F — A smoke section that pins all of it

**Files**: `test/smoke.js`, next to `layout`.

**Change**: a section named `accesibilidad: tamaños, foco y área segura`
that at 375×667 (`colorScheme: 'dark'` in the context, and the saved theme
forced to `light` through the same localStorage seeding the objetivo
section uses at `:1271`, so the day-tab case is the one measured):

1. `HEADER_MAX = 300`: `.top`'s height is at most that (034 lowers the
   constant to 140).
2. Every visible `button, input, select` outside a `.sheet` has a bounding
   box of at least 24×24; the set row's inputs and ticks at least 40 tall
   (036 raises this to 44).
3. The focus probe: focus the third card's first `.tick`, press Shift+Tab
   twelve times, and assert `document.activeElement`'s box is not entirely
   above `.top`'s bottom edge (`rect.bottom > topBottom`).
4. `getComputedStyle(document.querySelector('.day:not(.on) .day-t')).color`
   equals the computed `--ink` of the root (read `getComputedStyle(document.documentElement).getPropertyValue('--ink')`
   and compare after normalising to `rgb()` through a scratch element).
5. `getComputedStyle(document.querySelector('.timer')).paddingBottom` is a
   length (the property is set; Chromium reports `0px` with no inset, and
   the point is that the declaration exists — assert the stylesheet text
   contains `safe-area-inset-bottom` as well, read through `fetch('css/style.css')`).

Register the constants at the top of the file with a comment naming the
plans that move them.

**Verify**: `node test/smoke.js --only "accesibilidad: tama"` — 5 or more
PASS lines, 0 FAIL. `node test/smoke.js --list` shows the new name.

### Step G — A unit assertion on the token pairs

**Files**: `test/unit.js`, near the shell-list assertions.

**Change**: read `css/style.css`, parse each token block into a map
(`--name: #hex;` lines under `:root {` and under `:root[data-theme="dark"]
{`), compute WCAG relative luminance and contrast (the formula is ten
lines: sRGB to linear, `0.2126 R + 0.7152 G + 0.0722 B`, `(L1 + 0.05) /
(L2 + 0.05)`), and assert:

| pair | threshold |
|---|---|
| `--soft` on `--paper`, on `--card`, on `--sunk` | ≥ 4.5 |
| `--amber-ink` on `--card` | ≥ 4.5 |
| `--edge` on `--card` | ≥ 3 |
| `--ink` on `--card` | ≥ 4.5 |
| `--on-signal` on `--signal` | ≥ 4.5 |

for both blocks. Name the section `== css tokens keep WCAG contrast
(plans/032) ==`.

**Verify**: `node test/unit.js` — the section prints 10 PASS lines. Then
temporarily set light `--soft` back to `#71747A` and confirm one FAIL;
restore it.

### Step H — Bump and record

**Files**: `sw.js:21`, `AGENTS.md`.

**Change**: `CACHE_VERSION` `v76` → `v77`. In AGENTS.md § "The CSP", one
sentence after the utility-classes paragraph: control borders use
`--edge`, dividers `--line`, amber text `--amber-ink`, and the unit suite
computes the contrast of the token pairs, so a new token pair below 4.5:1
(text) or 3:1 (borders) fails `node test/unit.js`.

**Verify**: `node test/unit.js` (the shell-list assertions read `sw.js`);
`git diff sw.js` shows the one-line bump.

## STOP conditions

- `.top` measures under 250 px or over 330 px at 375 wide on the seed
  plan (someone folded or grew the header since `efc6eca`): re-measure and
  set `HEADER_MAX` and `scroll-padding-top` to the live number.
- `css/style.css` already contains `env(` or `scroll-padding`: read what
  landed and skip the duplicated step.
- `.day` already sets `color`: skip Step C, keep its assertion.
- A `--edge` or `--amber-ink` token already exists under another name:
  use that name throughout rather than adding a second.
- The `layout` section fails before any change: fix nothing here, report.

## Test plan

- Unit: Step G (10 assertions, both themes).
- Smoke: Step F (5 assertions at 375×667 with the light theme on a
  dark-scheme browser); the existing `layout` section unchanged.
- By hand, once, on an installed iPhone (the only place the insets
  exist): the timer's `Saltar` clears the home indicator and the header's
  first row clears the status bar. Record the result in the PR; it is the
  one thing this plan cannot assert.

## Documentation

- AGENTS.md: the sentence in Step H.
- `docs/guide.md`: nothing user-visible changes.
- `plans/README.md`: the status row.

## Done criteria

- [ ] `env(safe-area-inset-*)` on `.top`, `.timer`, `.toast` and `#app`.
- [ ] `scroll-padding-top` and `-bottom` on `html`, with the comment
      naming 034.
- [ ] `.day` declares `color: var(--ink)`.
- [ ] `--edge` and `--amber-ink` in both token blocks; ≈30 control borders
      moved to `--edge`; amber text moved to `--amber-ink`; light `--soft`
      is `#585B61`.
- [ ] No control under 24×24 on the seed plan at 375 wide.
- [ ] The new smoke section and the unit contrast section are green;
      `--only layout` unchanged and green.
- [ ] `CACHE_VERSION` bumped; the PR gate is green.

## Maintenance notes

- The header constant and the 40 px floor in the smoke section are
  deliberately the *current* numbers, so this plan lands green on its own;
  034 and 036 tighten them.
- Everything here is CSS plus tests. If a step's "Verify" needs `node
  --check`, the plan drifted; report.
