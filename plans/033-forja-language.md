# Plan 033: Forja — the new design language, as tokens, type and radii on the existing structure

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat efc6eca..HEAD -- index.html css/style.css js/app.js js/theme-init.js manifest.webmanifest icon.svg test/unit.js test/smoke.js docs/guide.md sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition. Plan 032
> must have landed (this plan writes into the token blocks it reshaped).

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW–MED — a stylesheet-wide pass with no behaviour change;
  the risk is a site missed (a control that keeps the old face or the old
  hex) rather than a crash. Nothing here is undoable by `git revert`.
- **Depends on**: 032 (the `--edge` and `--amber-ink` tokens, and the unit
  contrast assertion that keeps this palette honest).
- **Category**: direction (plans/031, option 4 / L17)
- **Planned at**: commit `efc6eca`, 2026-09-20

## Why this matters

The maintainer chose option 4 of plans/031 — "Forja" — as the app's look.
It is a language, not a layout: graphite ground with ember as the one
accent (the first profile's colour, the done state, the objetivo, the
primary button), cyan for the second profile, gold for records; Barlow
Condensed for names and the countdown, Barlow for text, JetBrains Mono for
numbers; square corners (3 px on controls, 4 px on cards). The mockups
(`plans/031-mockups/opcion4-*.png`, and the style tile
`opcion4-estilo.png`, which lists every token with its hex and its role)
draw it on option 2's structure; this plan lands the language first, on
the structure the app has today, so that 034, 036 and 037 build their
screens in the final look instead of restyling twice.

The stylesheet was built for exactly this: "Every colour the app draws with
is a token defined here … Nothing hardcodes a hex outside these two blocks"
(`css/style.css:3-8`). The charts confirm it — `js/chart.js` and
`js/volume-sheet.js` paint with `var(--signal)`, `var(--line)`,
`var(--soft)` (`js/chart.js:145-167`, `js/volume-sheet.js:38-52`), and no
`js/` file outside `vendor/` contains a hex colour. So the palette is the
two blocks, the type is a handful of `font-family` sites, and the radii are
61 declarations of two values.

## Current state

Files and their roles:

- `css/style.css` — the token blocks (`:9-40`, `:47-73`, with 032's
  additions), the profile accents (`:86-92`), `--font-sans` (`:14`) and
  its comment (`:10-13`), 45 literal `'IBM Plex Mono', monospace` sites and
  9 literal `'Archivo', sans-serif` sites (`grep -c`), 61 `border-radius`
  declarations (55 × `2px`, 5 × `3px`, 1 × `50%` — the week dot), the
  `.swatch.azul` / `.swatch.verde` colours (`:827-828`), `.sm` (`:557-564`),
  `.seg-btn` (`:800-808`), the chips (`.energy-chip :358`, `.rir-chip
  :409`, `.pri-chip :752`), `.tick.on` (`:500`), `.timer` tokens.
- `index.html` — the two `theme-color` metas (`:13-14`), the webfont link
  (`:37`, `id="webfont"`, Archivo + IBM Plex Mono).
- `manifest.webmanifest` — `background_color` and `theme_color` (`:12-13`).
- `js/app.js` — `ACCENTS`/`ACCENT_LABEL`/`LEGACY_ACCENT` (`:1064-1068`),
  `applyTheme` (`:961`), the webfont flip (`:4448-4460`).
- `js/theme-init.js` — resolves the theme before the stylesheet applies;
  no colours in it.
- `icon.svg` — three hexes (`#17191C`, `#B87400`, `#E4E2DA`);
  `tools/render-icons.mjs` re-exports the PNGs.
- `docs/guide.md` — § "Making it yours" names the two colours ("blue or
  green", `:145`); § "Offline and installing" describes the Archivo
  fallback rule (`:369-378`).

Excerpt — the profile accents, `css/style.css:86-92`:

```css
#app.profile-hombre, #app.profile-azul { --signal: #1B3FD0; --signal-soft: #E4E8FA; }
#app.profile-mujer,  #app.profile-verde { --signal: #1D6B4C; --signal-soft: #DFEDE6; }
:root[data-theme="dark"] #app[class*="profile-"] { --on-signal: #12141B; }
:root[data-theme="dark"] #app.profile-hombre,
:root[data-theme="dark"] #app.profile-azul { --signal: #7C97F7; --signal-soft: #212842; }
:root[data-theme="dark"] #app.profile-mujer,
:root[data-theme="dark"] #app.profile-verde { --signal: #5FC496; --signal-soft: #173226; }
```

Excerpt — the accent names, `js/app.js:1064-1068`:

```js
const ACCENTS = ['azul', 'verde'];
const ACCENT_LABEL = { azul: 'Azul', verde: 'Verde' };
/* The two profiles the app shipped with were keyed by these names; ... */
const LEGACY_ACCENT = { hombre: 'azul', mujer: 'verde' };
```

Excerpt — the webfont link, `index.html:37`:

```html
<link id="webfont" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" media="print" referrerpolicy="no-referrer">
```

The Forja tokens, as measured for the mockups (every pair ≥ 4.5:1 for
text and ≥ 3:1 for borders; the numbers are in plans/031 § L17):

| role | today's name | dark | light |
|---|---|---|---|
| ground | `--paper` | `#0F1113` | `#F4F2EE` |
| surface (cards, bars) | `--card` | `#181B1F` | `#FFFFFF` |
| sunk (boxes, tracks) | `--sunk` | `#22262B` | `#ECE9E3` |
| divider | `--line` | `#2A2F36` | `#DDD9D1` |
| control border | `--edge` | `#626B78` | `#8B8781` |
| text | `--ink` | `#F2F1EC` | `#15171A` |
| secondary text | `--soft` | `#A7ADB6` | `#5A5F66` |
| accent, profile 1, done | `--signal` | `#FF7A2F` | `#C24A10` |
| accent ground | `--signal-soft` | `#3A2114` | `#FCE9DE` |
| text on the accent | `--on-signal` | `#1A0D06` | `#FFFFFF` |
| profile 2 | (accent rule) | `#3FD6E8` / soft `#0F2E33` | `#0B6E7C` / soft `#DDF2F5` |
| records, deload, forced (fills) | `--amber` | `#FFC24D` | `#FFC24D` |
| text on those fills | `--on-share` (as used today) | `#1A1000` | `#1A1000` |
| amber text | `--amber-ink` | `#E0A33C` | `#8C5800` |
| JUNTOS | `--share` / `--share-soft` / `--share-ink` | `#C7A8FF` / `#2B2340` / `#C7A8FF` | `#6E45C7` / `#EEE7FF` / `#6E45C7` |
| danger | `--danger` | `#FF6B5E` | `#B8301F` |
| timer | `--timer-bg` / `--timer-ink` | `#181B1F` / `#F2F1EC` | `#15171A` / `#F4F2EE` |
| flare (timer over) | `--flare` | `#FFC24D` | `#FFC24D` |

## Steps

### Step A — The palette

**Files**: `css/style.css:9-73`, `:86-92`, `:827-828`; `index.html:13-14`;
`manifest.webmanifest:12-13`.

**Change**:

1. Rewrite the values in both token blocks per the table, keeping every
   token *name* (no selector outside the blocks changes for a colour).
   Recompute the `--on-ink-*` and `--timer-*` derived tokens on the new
   inks (dark `--on-ink-dim: rgba(0,0,0,.6)` stays; light becomes
   `rgba(255,255,255,.65)` on the darker ink). `--shade` stays.
2. The profile accents: `azul` → ember (`--signal: #FF7A2F` dark /
   `#C24A10` light, `--signal-soft` per the table), `verde` → cyan
   (`#3FD6E8` / `#0B6E7C`); `--on-signal` for cyan is `#0F1113` in dark
   and `#FFFFFF` in light (5.9:1). The `hombre`/`mujer` aliases stay on the
   same lines — saved profiles keep their key and change colour with
   everyone else.
3. `.swatch.azul { background: #FF7A2F }`, `.swatch.verde { background:
   #3FD6E8 }` (the setup sheet's colour picker shows what it will paint).
4. `index.html:13-14`: `theme-color` `#F4F2EE` (light) and `#0F1113`
   (dark). `manifest.webmanifest`: `background_color` `#F4F2EE`,
   `theme_color` `#0F1113`.
5. `js/app.js:1065`: `ACCENT_LABEL = { azul: 'Brasa', verde: 'Cian' }`.
   The keys do not change — they are what is saved.

**Verify**: `node test/unit.js` — the contrast section from 032 is green
on the new values (if a pair fails, the hex is mistyped: every pair in the
table was computed). `node --check js/app.js`.

### Step B — The type

**Files**: `css/style.css` (`:14`, the 54 literal font-family sites),
`index.html:37`, `docs/guide.md:369-378`.

**Change**:

1. Tokens: `--font-sans: 'Barlow', system-ui, -apple-system, 'Segoe UI',
   Roboto, Helvetica, Arial, sans-serif;`, new `--font-display: 'Barlow
   Condensed', 'Barlow', system-ui, sans-serif;`, new `--font-mono:
   'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;`.
   Replace every literal `'IBM Plex Mono', monospace` /
   `'IBM Plex Mono', ui-monospace, monospace` with `var(--font-mono)` (45
   sites) and every literal `'Archivo', sans-serif` with `var(--font-sans)`
   (9 sites). `js/chart.js:147-152` names `IBM Plex Mono` inside SVG text
   attributes — change those three to `JetBrains Mono, monospace` (SVG
   attributes cannot read a CSS variable).
2. The display face where the mockups use it, with sizes: `.ex-name`
   (24 px, 700, line-height 1.05), `.timer-val` (52 px, 700), `.sheet-t`
   (22 px, 700), and the small uppercase labels at 11–13 px / 600 /
   `letter-spacing: .08em`: `.banner-l`, `.day-n`, `.energy-lbl`,
   `.ex-rir-lbl`, `.ses-note-lbl`, `.pe-field-lbl`, `.pe-bar-n`, `.last
   .tag`, `.timer-lbl`, `.freq-cal-t`, `.rev-notes-t`, `.set-n`. Body text
   stays `--font-sans`; numbers stay `--font-mono`.
3. The floor: no `font-size` under 11 px; secondary text at 12.5–13 px.
   Raise: 8.5/9/9.5 → 11 (badges, `.pe-field-lbl`, `.diag-chip`,
   `.ex-est-c`), 10/10.5 → 11–12 (`.status`, `.version`, `.ex-rest`,
   `.ex-setup-btn`, `.day-n`, `.banner-l`), 11/11.5 → 12.5–13 (`.ex-alt`,
   `.ex-cue`, `.note`, `.sheet-d`, `.setup-hint`, `.deload-check`,
   `.brake-note`, `.ord-note`, `.last`, `.ex-est`, `.ex-decay`,
   `.ex-parked`), `.sm` 11 → 14, `.fld input` 15 → 17 (this is also F8 in
   plans/031: iOS zooms the page on a focused field under 16 px). The
   `font-size` tally in plans/031 (60 of 118 at ≤ 11 px) should read 0 at
   ≤ 10.5 px afterwards; `grep -o "font-size: *[0-9.]*px" css/style.css |
   sort | uniq -c` is the check.
4. `index.html:37`: the link becomes
   `family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap`.
   The flip in `js/app.js:4448-4460` is untouched. The CSP already allows
   the host.
5. The comment at `css/style.css:10-13` and the guide paragraph at
   `docs/guide.md:369-378` say "Archivo"; rewrite both to say the three
   faces and that every family is a token with its fallback stack.

**Verify**: `grep -c "IBM Plex Mono\|'Archivo'" css/style.css` is 0;
`node --check js/chart.js`; `node test/smoke.js --only "arranque sin la
tipografía"` (the section that boots without the webfont) still passes;
`node test/smoke.js --only layout` passes — the timer's four controls at
14 px text still fit at 375 (if not, `.timer-btn { padding: 8px 8px }`
at the 620 px breakpoint; 037 reshapes the bar anyway).

### Step C — The corners

**Files**: `css/style.css`.

**Change**: `border-radius: 3px` (5 sites: `.ex`, `.sheet-box`, `.toast`,
`.pe-day`, `.pe-retired`) → `4px` **first**, then `border-radius: 2px` (55
sites) → `3px`. `50%` (the week dot) stays. The order matters: doing 2→3
first would then turn those into 4.

**Verify**: `grep -o "border-radius: [0-9]*px" css/style.css | sort | uniq
-c` prints 55 × `3px` and 5 × `4px`.

### Step D — The controls' faces

**Files**: `css/style.css`.

**Change**, keeping every class name:

- `.sm`: `height: 44px; padding: 0 16px; font-size: 14px; font-weight:
  600; border: 1px solid var(--edge); color: var(--ink);` — `.sm.key`
  becomes the filled primary (`background: var(--signal); border-color:
  var(--signal); color: var(--on-signal)`), `.sm.warn` the danger outline.
  The footer wraps to more lines until 037 removes it; that is expected.
- `.seg-btn`, `.energy-chip`, `.rir-chip`, `.pri-chip`: 40 px tall, 14 px
  text, `border: 1px solid var(--edge)`; the pressed/`.on` state is
  `background: var(--signal); color: var(--on-signal); border-color:
  var(--signal)` (the `.pri-chip.on` amber fill stays amber with
  `--on-share` text).
- `.tick.on` and `.drop-add.on`: the ember fill with `--on-signal`; the
  PR states keep the gold fill with `--on-share`.
- `.profile-btn.on`, `.wk.on`, `.day.on`: today an ink fill with card
  text; in Forja the *selected* day is the ember fill (`background:
  var(--signal); color: var(--on-signal)`), the selected week likewise,
  the selected profile keeps the ink fill (it becomes a chip in 034).
- `.banner`: `background: var(--card); border: 1px solid var(--line);
  border-left: 3px solid var(--signal)`; `.banner-v` in the display face,
  ember.
- `.timer`: `background: var(--timer-bg)`, the count in ember
  (`.timer-val { color: var(--signal) }`), `.timer-btn` at 44 px with
  `border-color: var(--edge)`.
- `.sheet-box`: `border-radius: 4px`, `border: 1px solid var(--line)`.

**Verify**: open the app in both themes; the seed plan's Día 1 matches
`plans/031-mockups/opcion4-sesion.png` in colour and type (not in layout —
the header and card are 034 and 036). `node test/smoke.js --only "main
session"` and `--only "nota, energía"` pass (they click chips and ticks by
class, not by colour).

### Step E — The icon (optional, its own commit)

**Files**: `icon.svg`, `icon-*.png` via `node tools/render-icons.mjs`.

**Change**: `#E4E2DA` → `#0F1113` (ground), `#17191C` → `#F2F1EC` (mark),
`#B87400` → `#FF7A2F` (accent). Re-export the PNGs with the tool (needs the
smoke suite's Playwright). The maskable icon must keep its safe zone;
inspect `icon-maskable-512.png` after the export.

**Verify**: `node test/smoke.js --only installable` (the manifest and icon
assertions) passes; the four PNGs differ from `efc6eca`'s in `git status`.

### Step F — Bump and record

**Files**: `sw.js:21`, `docs/guide.md:131-188` (§ "Making it yours"),
`README.md`.

**Change**: `CACHE_VERSION` → next. In the guide's setup table the
**Color** row says "blue or green": now "ember or cyan (brasa / cian)".
The README's "How it's built" sentence about Google Fonts is still true;
add the three family names where it says "the typefaces".

**Verify**: `node test/unit.js` (the docs cross-link section and the
shell-list section both read the changed files).

## STOP conditions

- 032 has not landed (`grep -c -- "--edge" css/style.css` is 0): stop, land
  032 first — this plan writes into its token blocks and relies on its
  contrast assertion.
- A `js/` file outside `vendor/` contains a hex colour (`grep -n
  "#[0-9A-Fa-f]\{6\}" js/*.js` finds one that is not a CSS id selector):
  it was added since `efc6eca`; convert it to a token first and report.
- The unit contrast section fails on a pair not in the table above: a
  derived token (`--on-ink-*`, `--timer-dim`) needs recomputing; do not
  weaken the threshold.
- `--only "arranque sin la tipografía"` fails: the fallback stacks are
  wrong; every family token must end in a generic family.

## Test plan

- Unit: the contrast section (032) on the new values; the shell-list
  section (reads `index.html` and `sw.js`).
- Smoke: `layout`, `main session`, `nota, energía y control de descarga`,
  `arranque sin la tipografía`, `installable` (if Step E is taken).
- By eye, once, both themes, both profiles: the seed plan's Día 1 against
  `opcion4-sesion.png` and `opcion4-claro.png` for colour and type.

## Documentation

- `docs/guide.md`: the colour row in § "Making it yours"; the fallback
  paragraph in § "Offline and installing".
- `README.md`: the typeface names.
- `css/style.css`: the token comment (`:3-13`) rewritten for the roles
  and the three faces.
- `plans/README.md`: the status row.

## Done criteria

- [ ] Both token blocks hold the Forja values; every token name unchanged.
- [ ] Profile accents ember/cyan on the existing `azul`/`verde`/aliases;
      swatches and `ACCENT_LABEL` follow.
- [ ] `theme-color` metas and the manifest colours updated.
- [ ] Three family tokens; no literal `IBM Plex Mono` or `Archivo` left;
      the webfont link carries the three families.
- [ ] No `font-size` under 11 px; inputs at 17 px.
- [ ] Radii 3 px / 4 px; the control faces per Step D.
- [ ] Unit contrast section green; the five smoke sections green.
- [ ] `CACHE_VERSION` bumped; the PR gate is green.

## Maintenance notes

- A `rem`-based type scale (plans/031 L9) was deliberately left out: this
  plan sets the sizes the language needs in `px`, the unit the file
  already speaks, and the `rem` migration remains a separate, mechanical
  plan if a large-text mode (030 N26) is ever taken.
- The mockups' colours are the source: the style tile
  (`plans/031-mockups/opcion4-estilo.png`) is the one-page reference for
  anyone restyling a component later.
