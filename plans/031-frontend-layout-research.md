# 031 — Seventh pass: the main screen's layout and accessibility, direction and mockups

Generated 2026-09-20 against commit `efc6eca` (the merge of PR #106, the
sixth pass). Direction only, like the fourth and sixth passes: no
correctness, security or performance pass this round. It answers one
question — **how could the main screen be less crowded and more
accessible without changing what the app does** — and records the answer,
with measurements, so the next agent does not re-derive it.

Nothing here is planned. The maintainer picks from the tables, and each
pick becomes its own numbered plan with a drift check, steps and a
`CACHE_VERSION` bump. Every option below touches `index.html`, `css/` or
`js/`, so every one bumps `CACHE_VERSION` in `sw.js` (`v76` at this
commit, `sw.js:21`).

The mockups are in `plans/031-mockups/` (PNG renders, listed under
[The mockups](#the-mockups)) and on a design canvas at
<https://claude.ai/artifact/1tZhQATovU4bRjRZbvwKPB> (private to the
maintainer's account until shared). The canvas has the same twenty
artboards as the PNGs, editable, in five rows: today as captured, then
four options — fold the chrome (1), an app shell (2), a one-exercise
flow (3) and a new design language, "Forja" (4). Options 1 and 2 answer
the findings; 3 and 4 were asked for afterwards as a different approach
and a different look, and are recorded as choices rather than findings.

## What this is not

Five decisions are settled (AGENTS.md § "Documented limits") and were not
weighed: **Spanish only, no sync, the QR transfer is one-way, undo is one
level deep, two profiles.** Three more constraints every option was
checked against: **no build step, no modules, and a CSP with no inline
styles** — so every layout change is a class in `css/style.css` and DOM
built the way `buildExCard` builds it, never a framework, a CSS-in-JS
helper or a `style=""` attribute. The visual language (paper, ink, the
two accents, Archivo and Plex Mono, 2 px radii, the hairline borders) is
kept on purpose: the ask is layout and accessibility, not a restyle, and
the mockups change tokens only where a measured contrast ratio forced it.

Feature options are the sixth pass's business (plans/030). Where a layout
option and a 030 option touch the same screen it is said, so they can
land together or in the right order.

## How it was done

Three lenses, each grounded before it made a table:

1. **The screen, measured.** The app was served from this commit and
   driven with Playwright and the built-in browser at 375×812 (the smoke
   suite's "iPhone SE" width at a modern height), 375×667 (the SE's real
   height), 768 and 1280, on the seed plan, Día 1, both themes. Every
   number below — heights, control sizes, contrast ratios, what keyboard
   focus lands under — is a `getBoundingClientRect` or a WCAG luminance
   calculation on the app's own tokens, not an estimate. The captures are
   in `plans/031-mockups/hoy-*.png`.
2. **The code, read as the screen's author.** `index.html` in full,
   `css/style.css` in full, `renderProfiles`, `renderNav`, `drawApp`,
   `buildExCard`, `drawSessionFoot`, `drawEnergy`, `drawOrderNote`
   (`js/app.js:2215-3395`), `renderBlockBar` (`js/block-editor.js:21`),
   the timer's controls (`js/rest-timer.js`), the smoke suite's `layout`
   and accessibility sections (`test/smoke.js:3448-3496`). Every finding
   cites the line that shows it.
3. **The standards, and what comparable apps do.** A research subagent
   read WCAG 2.2's Understanding documents for the criteria a phone-first
   app actually trips (target size, contrast, focus not obscured, resize,
   reflow), the Apple Human Interface Guidelines (through Apple's DocC
   JSON endpoints, since the HTML pages are script-rendered), Material 3
   (through Google's own component docs on GitHub, since
   `m3.material.io` is script-only, so its 2025 "Expressive" changes are
   included), the WebKit safe-area rules, NN/g on sticky headers and
   progressive disclosure, browser support from caniuse's raw data, and
   the documented in-session layouts of Hevy, Strong, Liftosaur, Alpha
   Progression, Boostcamp, JEFIT, FitNotes, RP Hypertrophy and Setgraph.
   Its numbers are quoted under "Standards applied" and its sources are
   listed at the end. Two caveats it reported and this document keeps:
   the Spanish public-sector accessibility portal and the UNE catalogue
   rejected every fetch, so those two facts come from search snippets;
   and where an app shows its layout only in screenshots, the report
   says "not confirmed" rather than describing the picture.

## The numbers (the headline)

375 px wide, the seed plan, Día 1, light theme, first open. "Sticky
region" is `.top` (`index.html:48`, `css/style.css:128`), the part that
never scrolls away.

| What | Measured | Why it matters |
|---|---|---|
| Sticky region height | **295 px** at 375 wide (233 px at 1280) | 36 % of an 812 px viewport, **44 % of a 667 px one**. NN/g's test for a sticky element is whether it is "likely to be needed often or at any point during a session" and its measure is the content-to-chrome ratio (their good example is 13:1, their bad one 2:1); this screen is under 2:1 on the SE |
| …made of | profiles 48 · block bar 83 (wraps to two rows) · title row 44 (wraps to two lines) · weeks 44 · days 75 | The title line repeats what the profile button and the block `<select>` above it already say (`js/app.js:2364`) |
| Controls inside the sticky region | **19** (2 profiles, 1 select, 4 block buttons, theme, 8 weeks, 3 days) | Of these, only the day tabs are touched every session; the week changes once a week; the four block buttons a few times per block |
| Screen left for the session while resting, 375×667 | **310 px** (667 − 295 header − 62 timer) | Less than half the viewport, on the phone's most-used state |
| First set row on first open, 375×667 | **below the fold** (its top is at y ≈ 707 on the 812 capture) | The banner (68), energy (36), the pair note (98 on Día 1) and the card head (117) sit between the header and the first thing you tap. NN/g measures 57 % of viewing time above the fold |
| Page height, 7 exercises / 27 sets | **≈ 3 600 px** | About 4.5 screens; the footer's nine buttons are at the very bottom |
| First card, 4 sets | **394 px**, of which the head is 117 | Order arrows, name, two badges, the alternative, a 2–3-line amber cue, target, rest, a "Progreso" button and a "⚙ Ajustes" line, before the first input |
| Global actions | **14** (9 footer buttons, `index.html:77-87`; 4 block-bar buttons, `js/block-editor.js:37-57`; the theme toggle, `index.html:54`) | Spread over the top and the bottom of a 3 600 px page, 28 px tall, 11 px text, with "Borrar todos los datos" one wrap away from "Ajustes". Every guideline read caps a persistent bar at four or five items |
| Tappable controls on the page | **193**; **28 under 24 px** in one dimension; **190 under 44 px** | The 28 fail WCAG 2.2 SC 2.5.8 (24×24 CSS px, AA) outright: 14 order arrows at 20×14 (`css/style.css:226`), 7 "Progreso ↗" at 68×22 (`:259`), 7 "⚙ Ajustes" at 59×22 (`:306`). The 190 miss the 44 pt / 48 dp both platforms recommend for a control used mid-set: the ✓ is 42×40, the weight box 40 tall, RIR chips 30×26, energy chips 44×26, week tabs 38×34, footer buttons 28 tall, timer buttons 29 tall |
| Font sizes declared | 118 `font-size` rules: **60 at 11 px or less**, 78 at 11.5 px or less, 11 at 14 px or more | Apple's smallest Dynamic Type style is 11 pt (Caption 2) and Material's smallest label is 11 sp; the app's secondary text sits on that floor and its badges (8.5–9.5 px) under it. The set inputs are 15 px (`css/style.css:432`) |
| `px` vs `rem` | 352 `px`, 0 `rem` | Browser zoom and pinch still work (SC 1.4.4 is met that way); a large-text mode (030's N26) is a whole-stylesheet pass because of it |
| Contrast, light theme | `--soft` on paper **3.61:1**, on card 4.49:1, on sunk 4.11:1; amber cue on card **3.63:1**; amber on amber-soft 3.33:1; soft on the blue banner 3.84:1; white on amber (RÉCORD badge, PR tick) 3.79:1 | All under WCAG's 4.5:1 for text under 24 px (SC 1.4.3), and the text they colour is 10–11.5 px. Dark theme text passes everywhere |
| Contrast, control borders | `--line` on card **1.60:1** light, **1.36:1** dark; on paper 1.29:1 / 1.49:1 | SC 1.4.11 asks 3:1 for a component's visual boundary; input boxes, ticks and chips are drawn with this line, and the unticked ✓ glyph is painted in it |

The two facts that are bugs rather than density:

- **Keyboard focus lands under the header.** From the third card's first
  tick, twelve Shift+Tab presses put focus on a `.drop-add` button whose
  box is at y 93–133 while the sticky header ends at y 295: the focused
  control is entirely hidden. That is WCAG 2.2 SC 2.4.11 (Focus Not
  Obscured, AA, new in 2.2), and it is the exact case its failure
  technique F110 describes: a sticky header "tall enough to completely
  cover the element in focus as a user tabs up the page". `css/style.css`
  sets no `scroll-padding-top` or `scroll-margin` anywhere, so the
  browser scrolls a focused element to the viewport edge, under the
  sticky region; technique C43 is the one-line remedy.
- **The day tabs lose their text colour when the theme and the OS
  disagree.** `.day` (`css/style.css:170`) sets no `color`, so an
  unselected tab's name is painted in the browser's default button
  colour, which follows `<meta name="color-scheme" content="light dark">`
  (`index.html:12`) — the OS scheme, not `data-theme`. Measured: with
  `data-theme="light"` on a dark-system browser the unselected day names
  are `rgb(255,255,255)` on the light paper. The reverse (dark theme on a
  light-system phone: black on near-black) follows from the same
  mechanism. Every other button in the stylesheet declares its colour;
  this is the one that does not, and it is in the sticky region.

And two that only show on an installed phone:

- **No safe-area padding, with `viewport-fit=cover`.** `index.html:11`
  opts into the full screen and `manifest.webmanifest` installs as
  `standalone`, but nothing in `css/`, `index.html` or `js/` uses
  `env(safe-area-inset-*)` (grep: no match). On an iPhone with a home
  indicator (a 34 pt inset in portrait) the fixed timer
  (`css/style.css:516`, `bottom: 0`) and the toast (`:574`, `bottom:
  14px`) sit in the indicator zone, and the sticky header's first row
  sits under the status bar. The smoke `layout` section
  (`test/smoke.js:3478`) cannot see this: Chromium reports zero insets.
- **The page has no landmarks or headings.** No `<main>`, `<nav>`,
  `<header>` or `<h1>` in `index.html` (the only `h1` is the recovery
  screen's, `js/app.js:1337`); the title is a `div`. `role="tablist"` on
  the week and day rows (`index.html:56-57`) carries `role="tab"` buttons
  with `aria-selected` but no `aria-controls`, no `tabpanel` and no
  arrow-key handling (`renderNav`, `js/app.js:2359`). A screen-reader
  user gets 193 controls with good labels and no map.

What is already right, so nobody re-audits it: every control is a real
`<button>` or `<input>` with an `aria-label` (`buildExCard`), the ticks
and chips carry `aria-pressed`, `:focus-visible` draws a ring
(`css/style.css:101`), `prefers-reduced-motion` collapses every
transition (`:998`), `Escape` closes sheets, pinch-zoom is not blocked
(and must stay unblocked: `maximum-scale=1` is the anti-pattern every
source warns against), inputs are `type="text"` with `inputmode` so the
Spanish comma works — which is also the pattern the research found to
be the robust one, since `type="number"` with a comma is unreliable
across browsers and has a live regression in the iOS 26.2–26.4 betas —
and the CSP forbids the inline styles that would have made half the
fixes below tempting to do wrong.

## The findings, ranked

Ranked by how much of the crowding each one accounts for, then by risk.
**Conf.** is how sure the reading is (HIGH = measured or the cited line
settles it).

| # | Finding | Evidence (`efc6eca`) | Impact | Conf. | Fix is option |
|---|---|---|---|---|---|
| F1 | The sticky region is 295 px: five rows, 19 controls, two of them wrapping | `index.html:48-58`, `css/style.css:106-179`, measured | HIGH | HIGH | L1, L2 |
| F2 | 14 global actions in two clusters (top bar, page foot), same size and weight as each other, destructive beside routine | `index.html:77-87`, `js/block-editor.js:37-57`, `css/style.css:556-564` | HIGH | HIGH | L4 or L8 |
| F3 | The card head is 117 px of text you read once per block (alt, cue, "Ajustes"), drawn every session above the sets you came for | `js/app.js:2830-2862`, `css/style.css:212-263, 305-311` | HIGH | HIGH | L5 |
| F4 | 28 controls under 24 px, 190 under 44 px; the set row's ✓ is 42×40 and the inputs 40 tall | measured; `css/style.css:226, 259, 306, 358, 409, 421-448` | HIGH (a11y) | HIGH | L5, L7 |
| F5 | Keyboard focus can be entirely hidden under the header (SC 2.4.11, F110) | measured; no `scroll-padding` in `css/style.css` | MED (a11y) | HIGH | L6 |
| F6 | Nothing is padded for the safe areas on an installed iPhone; timer and toast sit in the home-indicator zone | `index.html:11`, `manifest.webmanifest`, `css/style.css:516, 574`, grep | MED (iOS) | HIGH (rule) / MED (not device-tested) | L6 |
| F7 | Light-theme secondary text and both themes' control borders are under the WCAG ratios; the day tabs' colour follows the OS instead of the theme | computed from `css/style.css:9-73`; `.day` at `:170` | MED (a11y) | HIGH | L7 |
| F8 | Set inputs are 15 px; iOS Safari zooms the page when a field at 15 px or less gets focus | `css/style.css:432`; documented WebKit behaviour (see Sources) | MED (iOS) | HIGH (rule) / MED (not device-tested) | L5, L9 |
| F9 | The pair note is 98 px of plan text repeated on every visit to that day; the week banner's text and the cues likewise | `index.html:65`, `css/style.css:193`, `js/data.js:63`; `drawApp` at `js/app.js:2728` | MED | HIGH | L3 |
| F10 | Secondary text is 10–11.5 px in a 352-`px`, 0-`rem` stylesheet | measured tally of `css/style.css` | MED | HIGH | L9 |
| F11 | No landmarks, no `h1`, tabs without panels or arrow keys | `index.html`, `js/app.js:2359-2395` | MED (a11y) | HIGH | L10 |
| F12 | Sheets are centred dialogs with `max-height: 88vh`; 12 of them, 14 segmented-control rows, the volume sheet opens with three toggle rows (7 buttons) before its chart | `css/style.css:589-614`, `index.html` (`volumeSheet`) | LOW–MED | HIGH | L11 |
| F13 | Tablet and desktop get the phone layout at 640 px, with a 233 px header | `css/style.css:106`, measured at 1280 | LOW | HIGH | L12 |
| F14 | The smoke `layout` section asserts two things (timer controls fit, no sideways scroll); nothing pins header height, target size or contrast | `test/smoke.js:3478-3496` | LOW (until a fix lands) | HIGH | L13 |
| F15 | The guide's footer list names eight buttons; the row has nine (Diagnóstico is missing from the list) | `docs/guide.md:32-36` vs `index.html:77-87` | LOW (docs) | HIGH | one line, with whichever option first touches the footer |

## The options

Effort S/M/L as in the plans. **Risk** is what a wrong step costs the
person mid-session: a layout that hides a control they were about to tap
is MED; a colour token is LOW. **Smoke** says which sections would need
their selectors updated (the suite locates cards by `.ex`, sets by
`.set-row`, and buttons by id: `#volumeBtn`, `#diagBtn`, `#editPlan`,
`#backup`, `#copyPrev`, `#clearDay`, `#settings`, `#wipe`; keep the ids
on the new controls and most sections survive a move).

| # | Option (what the user sees) | Effort | Risk | Smoke | Disposition |
|---|---|---|---|---|---|
| L6 | **Safe areas, focus and the day-tab colour** — three CSS lines with no visual change on Android: `padding-bottom: env(safe-area-inset-bottom)` on `.timer` and `.toast`, `padding-top: env(safe-area-inset-top)` on `.top`, `scroll-padding-top` on `html` sized to the header, `color: var(--ink)` on `.day` | S | nil | none | **plan first** — a fix, not a design |
| L7 | **Tokens that pass** — darken `--soft` in light (`#585B61` is 5.25:1 on paper), an `--edge` token for control borders (`#8A887F` light 3.4:1, `#6B6F79` dark 3.3:1) distinct from the `--line` dividers, an amber *ink* token (`#8C5800`, 5.7:1) separate from the amber *fill*; the 28 sub-24 px controls to 24 px or spaced | S | LOW | none | **plan**, with L6 |
| L1 | **Fold the chrome** — one row: profile chip · "Bloque 1 ▾" (a sheet with nuevo, revisión, importar, gestionar) · "⋯"; the title line goes (its words are the two buttons); the theme toggle moves into Ajustes or "⋯"; the day tabs keep the second row at 60 px, two lines each. Sticky region 295 → **134 px** | S–M | LOW | `#themeBtn` moves; block-bar buttons get ids | **plan** |
| L2 | **The week as one line** — `‹ Semana 3 de 8 · 2 RIR ▾ ›` under the header, not sticky, with the goal text under it; the full strip (with its logged-week dots) opens on tap. Weeks (44) + banner (68) → 44 + one line of text | S–M | LOW–MED (the strip is how you browse history; it must stay one tap away) | the `.wk` locator (used by the week-switching sections) moves into the picker | **plan**, after L1 |
| L3 | **Fold the plan text** — the pair note to one line with a chevron; the cue and the alternative behind the exercise name (the name becomes the disclosure, `aria-expanded`); "⚙" joins them. Nothing is removed; it opens in place (never scrolling the card to the top — the NN/g accordion trap) and stays open for the session | S | LOW | `.ex-setup-btn` (used by the machine-settings section) | **plan**, with L5 or alone |
| L4 | **Group the footer** — the nine buttons at 44 px in labelled groups (Esta sesión · Análisis · Plan y bloques · Datos) with a separated "Zona de peligro" for the two destructive ones, the block-bar four folded in | S | LOW | none (ids stay) | **plan** if L8 is not taken; otherwise superseded |
| L5 | **The card on a diet** — one 44 px head row (position · name · badges · "⋯"), one mono meta line (`4 × 6–10 · desc. 2:30 · asiento 4`), the history band, 48 px inputs at 17 px, a 44 px "↓" and a 48 px ✓, then the objetivo line with the RIR chips at 36 px beside it. "Progreso", "mover arriba/abajo" and the machine settings live in the card's "⋯" menu — the per-exercise "…" is the market's shape (Hevy, Strong, JEFIT, Setgraph). Height for four sets ≈ 360 px (from 394), noise down more than height | M | MED (the order arrows go from one tap to two; see below) | `.ex-chart-btn`, `.ex-ord`, `.ex-setup-btn`, `.rir-chip` | **plan**, design the "⋯" first |
| L15 | **Collapse a finished card** — when its last set is ticked, the card folds to its head row plus one mono summary line (`60×10 · 60×9 · 60×8 · 57,5×9 · RIR 1`), tap to reopen; the session's done work stops pushing the next exercise down. Boostcamp's "finished exercises collapse as you go" | S | LOW (a fold, not a hide: reopen is one tap and unticking reopens) | the sections that read a ticked card's inputs after the tick | **plan**, with or after L5 |
| L8 | **App shell** — a bottom bar with four destinations (Sesión · Progreso · Plan · Más) over the safe area, ~64 px tall (Material 3 Expressive's bar, not the older 80), the timer taking the bar's place while a rest runs (Material: never a toolbar and a navigation bar at once), the footer gone, "Rellenar con el objetivo" and "Calculadora" kept with the session above the list. Sheets open as bottom sheets | M–L | MED (a navigation model, not a layout; and with the keyboard up on iOS a fixed bottom bar floats above it — hide the bar on `focusin` of an input) | every section that clicks a footer id: keep the ids on the "Más" sheet's rows | **decide after L1–L5 have been used for a block**; 030's N2 (open on the next session) belongs in the same decision |
| L9 | **A type scale** — `--fs-*` tokens in `rem`, secondary text to 12.5–13 px (Apple's Footnote is 13 pt, Material's body-medium 14 sp), inputs to 16–17 px, the 8.5–10 px badges and labels to 10.5–11 px; 030's N26 (large text) becomes one media query afterwards, and `font: -apple-system-body` on `html` would follow iOS Dynamic Type for free | M | LOW | none | **plan**, its own PR |
| L10 | **Landmarks and headings** — `<header>`, `<main>`, `<nav aria-label>` for the bar or the footer, an `h1` (visually the block name), `aria-controls` from each day tab to the list and arrow keys on the two tablists | S | nil | none | **plan**, with L1 |
| L11 | **Bottom sheets** — `.sheet-box` anchored to the bottom, `max-height: 92dvh`, a grabber, `padding-bottom: env(safe-area-inset-bottom)`, swipe to dismiss; the three toggle rows of the volume sheet collapse to one row of chips and one "más". Apple's rule, one sheet at a time, is what the sheet stack already enforces | M | LOW | none (ids stay) | option, with L8 |
| L12 | **A rail on wide screens** — at ≥ 900 px the folded header becomes a left column (profile, block, days, weeks) and the session takes the rest | S–M | LOW | `layout` at 768 | record only; the app is used on phones |
| L13 | **Layout assertions** — a smoke section at 375×667: sticky region ≤ 140 px, every visible control ≥ 24×24, set-row controls ≥ 44 tall, and after Shift+Tab from the third card no focused element under `.top`; plus the four contrast pairs as a unit assertion on the tokens | S | nil | new | **plan**, in the same PR as L6/L7 so the fix is pinned |
| L14 | **The timer bar** — 44 px controls, "Siguiente: serie 2 · 60 kg × 6–10" under the count, "Son." as a labelled switch, 34 px count, safe-area padding. The market's alternative, recorded: none of the nine apps documents a persistent bottom timer bar; Strong and FitNotes put a compact indicator in the top bar that expands to full screen on tap, and Hevy, Alpha, Boostcamp and Setgraph mirror it as an OS Live Activity — which this app already does with its lock-screen media card. A header chip would give the session the 62 px back, at the cost of the −30/+30 being one tap further | S | LOW | `layout` (four controls must still fit at 375) | option, with 030's N29 |
| L16 | **Enfoque: one exercise per screen** — the session becomes a flow. A one-line header (≡ · day and week · profile) over a strip of exercise chips (done · current · next); one exercise at full size with 56 px controls and its cue, alternative and history in full; the rest timer inline under the set that started it; prev/next as the only fixed chrome; a "Resumen" screen with the whole day as a checklist; profile, block, week, day and the fourteen actions behind ≡ | M | MED (a different mental model — the list is gone — and hidden navigation) | most sections walk `.ex` cards on one page; they would drive the strip instead | **an alternative to L1–L5 and L8**, chosen by preference after a block on option 1, not from the pictures |
| L17 | **"Forja", a new design language** — on option 2's structure: graphite ground, ember as the one accent (profile 1, the done state, the objetivo), cyan for profile 2, gold for records; Barlow Condensed for names and the countdown, Barlow for text, JetBrains Mono for numbers; square corners (3 px on controls, 4 px on cards, near the app's own 2 px), a floating bar over the safe area; a light variant and a style tile | M–L (the two token blocks, the four `font-family` rules, the radii, the webfont link) | LOW–MED (taste; nothing technical — the CSP already allows the font host) | none beyond L8's | **a choice, not a finding** — take it or keep paper-and-ink |

### L1 + L2 + L3 — fold the chrome (what the first mockup shows)

**What the user sees.** `plans/031-mockups/opcion1-cabecera.png`. Two
rows stay put: `● Hombre ▾ · Bloque 1 ▾ · ⋯` and the three days. Under
them, in the flow, `‹ Semana 1 de 8 · 3 RIR ▾ ›` with the week's goal
under it in one or two lines, then the pair note folded to one line with
its JUNTOS badge, then the energy chips at 40 px, then the cards exactly
as they are today. The sticky region is 134 px; the first set row is on
screen at 375×667 on first open, where today it is not.

**Why these three together.** They share one idea — the things you set
once a week or once a block do not need to be on screen every set — and
one file each: `index.html` for the rows, `renderNav`/`renderBlockBar`
for the buttons, `css/style.css` for the sizes. Nothing they fold is
removed: the block sheet holds the four block actions, the week strip
opens on tap with its logged-week dots (`weekHasLog`, `js/app.js:2335`),
the pair note and the cue open in place. It is also the pattern Apple
describes for a scrolling screen (a large title that collapses to one
line, with the rest in a More menu) and what NN/g's two-level rule
allows: everything used every set stays at level 0, everything used
once a week is one tap away, nothing is two.

**Evidence.** The title text is built at `js/app.js:2364` from the same
`block.name` and `profile.label` the two rows above it already show. The
block bar's four buttons (`js/block-editor.js:37-57`) are all one-per-
block actions. `day.pair` is a plan field (`js/data.js:63`) drawn every
render (`js/app.js:2728-2730`).

**Effort S–M, risk LOW.** The one decision: the profile switch. Today it
is two always-visible buttons, which is also how a couple sharing one
phone hands it over between sets. The mockup makes it a chip that opens
a two-row picker (one tap more, and NN/g's finding is that hidden
options are the least discovered). If that tap matters in the gym, keep
the two buttons as a 44 px segmented pair in row one and move "Bloque"
into "⋯" — the region is still under 140 px.

### L5 — the card on a diet (what the card pair shows)

**What the user sees.** `tarjeta-hoy.png` beside `tarjeta-dieta.png`.
The head becomes one row: the position number, the name with its badges,
a "⋯" at the right. Under the name, one mono line: sets × reps, rest,
and the machine setting if there is one. The history band stays. Each
set row is `nº · [ 60 kg ] · [ 6–10 rep ] · ↓ · ✓` with 48 px inputs at
17 px and a 48 px tick; the set the objetivo says is next has a signal
border (Boostcamp highlights the current set the same way). Under the
sets, the objetivo line on the left and the three RIR chips at 36 px on
the right. Everything that was in the head and is not in the new row —
the alternative, the cue, "Progreso ↗", the two order arrows, "⚙
Ajustes" — is in the "⋯" menu or behind the name.

**Why.** The head is what you read once per block; the sets are what you
touch four times per exercise. Today the first costs 117 px above every
card and the second is drawn at 40 px with a 42 px tick. The mockup
inverts the weights. The 17 px inputs also end the iOS focus zoom (F8).
The set row's column order — number, weight, reps, tick, with the
previous value doing the target's job as the placeholder — is the one
every comparable app documents (Set · Previous · kg · Reps · ✓), so
nothing here asks the person to relearn a convention.

**The decisions it needs.** The order arrows (`js/app.js:2880-2892`)
exist for "the machine was taken" and are one tap today; in the "⋯"
menu they are two. Three shapes to choose from before writing the plan:
keep the arrows in the row but at 24×24 with 8 px between them (SC 2.5.8
is met by size); a long-press on the position number that reveals them;
or drag-to-reorder on the name (Strong's shape), which is the most work
and the least discoverable. The mockup draws the menu; the plan should
draw whichever the maintainer would reach for with a hand on the stack.
The second, smaller decision is the "↓" column: Hevy changes a set's
type by tapping the set number, which would free 44 px of row width for
the two inputs; the mockup keeps the column because a drop is added
mid-set and a visible control is the honest affordance.

**Effort M, risk MED.** `buildExCard` is 400 lines and `drawCard` swaps a
card in place; four smoke sections locate the controls that move. Land
it after L1–L3 so the header is settled first, and alone in its PR.

### L8 — the app shell (what the second mockup row shows)

**What the user sees.** `opcion2-sesion.png`, `opcion2-descanso.png`,
`opcion2-mas.png`, `opcion2-oscuro.png`. A bottom bar with Sesión ·
Progreso · Plan · Más over the home indicator. The session screen is L1–
L5 with two 44 px actions above the list, "Rellenar con el objetivo" and
"Calculadora", because they are the two footer buttons used mid-session
and NN/g's finding on hidden navigation ("out of sight is out of mind")
argues for keeping them visible. While a rest runs the timer takes the
bar's place — you do not navigate mid-rest, and Material's rule is never
to show a toolbar and a navigation bar at once — with 44 px controls,
the next set named, and the sound as a switch. "Más" is a bottom sheet:
Datos (copia, with its last date, the profile transfer, QR), Ajustes
(ajustes, tema, aviso con la pantalla apagada), then a separated Zona de
peligro with the two destructive actions, each still behind the existing
confirmation. Progreso would hold the chart, the volume dashboard, the
Diagnóstico and the review; Plan the editor, the blocks, import and
"+ Nuevo bloque".

**Why four, and why these.** Both platforms' guidance converges on three
to five destinations for a bottom bar (Material 3's navigation bar,
Apple's tab bar, which UIKit enforces by folding a sixth into "More");
the app's fourteen actions sort into exactly four groups by when they
are used: every set, every week, every block, once. Apple's tab bar is
for navigation and not for actions, which is why the two session actions
stay above the list rather than in the bar. Comparable apps do the same
split: Strong's five tabs and Hevy's three are app-level, and neither
puts the logging screen's actions in them.

**Why not first.** It changes the navigation model, and the sheet
registry (`registerSheet`, `js/app.js:1014`) already gives every screen a
place to open from; L1–L5 recover most of the space without it. It is
the right shape if the household keeps opening the analysis screens and
finds them buried — which is a thing to learn from a block on L1–L5
rather than to decide now. 030's N2 (open on the next session) removes
the other reason to keep the week and day rows permanently visible, so
the two decisions are one.

**Effort M–L, risk MED.** New markup, the bar's CSS with
`env(safe-area-inset-bottom)`, a `hidden`/`up` dance with the timer, the
bar hidden while an input has focus (iOS has not shipped
`interactive-widget=resizes-content`, so a fixed bottom element floats
above the keyboard), sheets re-anchored to the bottom (L11), the footer
gone, the ids kept on the sheet rows so the smoke suite's
`#volumeBtn`-style clicks survive.

### L16 — Enfoque: one exercise per screen (what the third mockup row shows)

**What the user sees.** `opcion3-sesion.png`, `opcion3-descanso.png`,
`opcion3-lista.png`, `opcion3-menu.png`. The header is one line —
≡ · `Empuje` with `Día 1 · Sem. 1 de 8 · 3 RIR` under it · the profile
chip — over a horizontal strip of exercise chips: a tick on the ones
done, the current one filled, the rest numbered, cut at the edge so the
strip reads as scrollable. The progress bar is the header's bottom
edge. Below, one exercise: its name at 22 px, the meta line, the
alternative and the cue in full (there is room now), the history band,
56 px inputs at 20 px, a 56 px tick, the objetivo line and 40 px RIR
chips. When a set is ticked the rest timer appears under that set,
inside the card, with its −30/+30/Saltar at 40 px, and the next set gets
the signal border. The only fixed chrome is a prev/next pair at 52 px
over the safe area; on the last set the right one turns primary. Tapping
the title opens `Resumen`: the whole day as a checklist, one 60 px row
per exercise with its summary or its prescription, the session note and
the totals, and a `Seguir: …` button. ≡ opens a drawer with the two
profiles, the block and its four actions, the week, the three days, the
tools, the data actions and the danger zone, grouped.

**Why it is a different approach.** Options 1 and 2 keep the list and
shrink what surrounds it; this one changes the scope of the screen. With
one exercise on it, the controls can be 56 px and the cue can stay open
without crowding anything, and the timer can live where the rest
happens instead of over the page. It is the shape Alpha Progression
documents (a horizontal thumbnail strip as the tab header, one exercise
at a time) and the one Strong reaches with its full-screen timer.

**What it costs.** Two things the research argues against: hidden
navigation (NN/g's "out of sight is out of mind" — every global action
is two taps away, and the day and week are behind ≡), and losing the
glance at the whole session, which `Resumen` gives back as a second
screen. It is also the largest code change of the four: a paging model
over `drawApp`, though the pieces exist — `buildExCard` already builds
one detached card (`js/app.js:2761`), `drawCard` already redraws one in
place, and `orderedEx` (`:1775`) already gives the strip its order; the
smoke sections that walk every `.ex` on one page would drive the strip
instead. Effort M, risk MED.

**How to choose.** By preference, after a block on option 1: if the
household finds itself scrolling past finished cards to reach the next
one, this is the answer; if it likes seeing the day, L15 (fold the
finished cards) gets most of the effect inside the list.

### L17 — Forja: a new design language (what the fourth row shows)

**What the user sees.** `opcion4-sesion.png`, `opcion4-descanso.png`,
`opcion4-claro.png`, `opcion4-estilo.png`. The structure is option 2's;
the language is new. Ground and surfaces in graphite (`#0F1113`,
`#181B1F`, `#22262B`), a warm off-white set for the light theme
(`#F4F2EE`, `#FFFFFF`, `#ECE9E3`). One accent, ember (`#FF7A2F` dark,
`#C24A10` light), doing the jobs the signal blue does today: the first
profile's colour, the done state, the objetivo, the primary button, the
selected tab. Cyan for the second profile, gold for records, a lavender
for JUNTOS, a coral for danger. Names and the countdown in Barlow
Condensed (24 and 52 px); text in Barlow at 13–15 px; numbers in
JetBrains Mono. The week is a selector, not a headline: one 40 px row,
`‹ Semana 1 de 8 · 3 RIR ›`, with the week's goal text behind a tap on
the row — it is read at the start of a session and never again, so it
no longer spends 110 px on every screen (the light board shows it
open). Square corners throughout — 3 px on every
control (chips, inputs, ticks, the day tabs, the round buttons become
squares), 4 px on cards, the bar and the timer — which is one step from
the app's own 2 px and keeps the hard, forged look the name asks for; a
floating bar 16 px in from the edges over the safe area, and the timer
as a floating card in the same place. The set row is `kg · rep · RIR ·
↓ · ✓` with the units drawn once per card as a column-header line (the
shape every logging app's table has) and no set number: the order is
the order, and the person knows how many sets there are. RIR is per
set, typed in the third box, with the week's target RIR as its greyed
placeholder the way the weight box shows the objetivo — the maintainer
has decided to add per-set RIR (030 recorded it as not weighed), so the
once-per-exercise chips are gone from this option and the objetivo line
is the card's only foot. The style tile lists every token with its hex
and its role, the type specimen and each control in its states.

**What it changes in code.** The two colour blocks at the top of
`css/style.css` (`:9-73`) and the profile accent lines (`:86-92`, which
keep `azul`/`verde` as the saved names and only change the values), the
four `font-family` rules (`--font-sans`, the three mono declarations),
the radii (2 → 3 px on controls, 3 → 4 px on cards: a token, not a
hunt), the webfont link in `index.html:37` (Barlow,
Barlow Condensed and JetBrains Mono are on the same host the CSP already
allows, about 60 KB more than the two faces today, cached by the worker
like them), and the fallback stack `theme-init.js`'s comment insists
on. Nothing structural: it rides on whichever of the other options
lands, and it is its own PR because it touches most of the stylesheet.
Effort M–L, risk LOW–MED and entirely a matter of taste.

**Measured, so it is not a regression.** Every pair drawn passes: soft
text 7.7:1 on the dark surface and 6.4:1 on the light one, ember 6.7:1
and 4.9:1, control borders 3.2:1 and 3.6:1, the dark text on ember
7.3:1, on gold 11.7:1, the JUNTOS pair 7.4:1 and 5.2:1, danger 6.2:1 and
6.0:1. The 2.3:1 of ink on ember in dark mode is why the buttons on
ember carry the dark `#1A0D06` and never the ink.

### L6, L7, L13 — the fixes, and pinning them

Not a design; the first PR. `.timer` and `.toast` get
`padding-bottom: env(safe-area-inset-bottom)` (with `bottom: 14px`
becoming `bottom: calc(14px + env(safe-area-inset-bottom))` for the
toast), `.top` gets `padding-top: env(safe-area-inset-top)`, `html` gets
`scroll-padding-top: 300px` (or the folded header's height once L1
lands; a `scroll-margin-top` on `.set-row` is the alternative that does
not need the number), `.day` gets `color: var(--ink)`. The tokens
change as in the L7 row. The 28 sub-24 px controls: the arrows to 24×20
with 4 px between them (the spacing exception of SC 2.5.8 then holds),
"Progreso" and "⚙" to 28 px tall — Apple's own floor for a control is
28×28 pt, its default 44. The smoke section in L13 asserts all of it at
375×667 so it cannot regress silently, and a unit assertion on the four
token pairs (the luminance formula is ten lines) pins the ratios.

`env()` is inert where there is no inset (Android Chrome, desktop, the
smoke suite's Chromium), so the change is invisible everywhere it is not
needed and cannot break the `layout` section.

## The mockups

Twenty artboards, on the canvas and as PNGs in `plans/031-mockups/`.
They are direction, not specification: the spacing is the app's, the
strings are the app's, the tokens are the app's except the four pairs
L7 changes (and option 4, whose whole point is new tokens), and nothing
is drawn that the code could not do under the CSP.

| File | What it shows |
|---|---|
| `hoy-arriba.png` | Today, first open, 375×812, light — the capture the numbers above were taken from |
| `hoy-descanso-se.png` | Today on a 375×667 phone with the timer up — 310 px of session between the header and the bar |
| `hoy-pie.png` | Today's foot: the note, the status line, the nine buttons |
| `opcion1-cabecera.png` | Option 1: the folded header (L1), the week line (L2), the folded pair note (L3), the card unchanged |
| `opcion1-pie.png` | Option 1: the footer grouped (L4) with 44 px buttons and the danger zone apart |
| `tarjeta-hoy.png` / `tarjeta-dieta.png` | The card today and on the diet (L5), same exercise, same data |
| `opcion2-sesion.png` | Option 2: the app shell (L8) — bar, session actions above the list, the card on the diet |
| `opcion2-descanso.png` | Option 2 while resting: the timer in the bar's place with 44 px controls and the next set named (L14) |
| `opcion2-mas.png` | Option 2: the "Más" bottom sheet (L11) |
| `opcion2-oscuro.png` | Option 2 in the dark theme, with the dark `--edge` token |
| `opcion3-sesion.png` | Option 3: the flow (L16) — one-line header, the exercise strip, one exercise with 56 px controls, prev/next |
| `opcion3-descanso.png` | Option 3 with a set ticked: the timer inline under it, the next set marked |
| `opcion3-lista.png` | Option 3: `Resumen`, the day as a checklist (its rows link to the session board in Play) |
| `opcion3-menu.png` | Option 3: the ≡ drawer with profile, block, week, day, tools, data and the danger zone |
| `opcion4-sesion.png` | Option 4: Forja (L17) on option 2's structure, dark |
| `opcion4-descanso.png` | Option 4 while resting: the floating timer card with the condensed countdown |
| `opcion4-claro.png` | Option 4 in the light theme, ember darkened to `#C24A10` |
| `opcion4-estilo.png` | Option 4's style tile: every token with its role, the type specimen, each control in its states |

What the mockups keep on purpose: the "↓" drop control in every set row
(it is used mid-set and has no cheaper home), the RIR chips per exercise
(options 1–3; option 4 moves RIR into the set row, see L17), the energy
chips at the top, the history band, the JUNTOS badge and the
purple rule, the 2–4 px radii and the hairline look. What they change
beyond layout: `--soft` and the control border in light mode, because
the measured ratios left no choice, and the input font to 17 px.

What they do not settle, in the order the plans would hit them: the
profile switch as a chip or a pair (L1); where the order arrows go (L5);
whether "Rellenar con el objetivo" lives above the list or in the card
"⋯" as a per-exercise apply (030's carried #17 is the per-exercise
version); whether the timer stays a bottom bar or becomes a header chip
(L14); and whether the bar is worth its navigation change at all (L8).

## Landing order and the bump cascade

1. **L6 + L7 + L13** as one PR: CSS and a smoke section, one bump. Zero
   visual risk; it fixes the two bugs (focus, day colour) and the iOS
   inset, and pins them.
2. **L1 + L10** (fold the top row, add the landmarks) and then **L2**
   (the week line) — two PRs or one; they edit `renderNav`,
   `renderBlockBar` and `index.html` only.
3. **L3** and **L4** — small, independent of each other; L4 is moot if
   L8 is taken, so it can wait for that call.
4. **L5** alone, after the "⋯" decision; **L15** with it or just after.
5. **L9** any time after 1; its own PR because it touches most of
   `css/style.css`.
6. **L8 + L11 + L14** together with 030's N2, only after a block on
   1–4.
7. **L16** is a fork, not a step: if the flow is preferred after that
   block, it replaces L5, L8 and L15 and lands as one PR on top of 1–2;
   if not, it is recorded here and closed. **L17** rides on whichever
   structure wins, any time after step 1, as its own PR.

**Planned.** The maintainer picked option 4 on 2026-09-20, with four
revisions made on the canvas (square corners, the week as a 40 px
selector, no set number, RIR per set in the row). Its landing order is
plans 032–037 in `plans/README.md`: the fixes (032), the language (033),
the header (034), the per-set RIR model (035, a data change that precedes
the card), the card (036), the shell (037).

Every step bumps `CACHE_VERSION`; `docs/guide.md` § "Using it" describes
the footer, the header rows and the card, so each step that moves one
rewrites that paragraph (and fixes F15 on the way); the README's layout
table does not change unless a file is added.

## Standards applied

The numbers the findings are measured against, so the next reader does
not have to look them up. AA is the level the findings use; AAA where
both platforms' own guidance is stricter than WCAG. Units: CSS `1pt =
1.333px`, so WCAG's "18 pt" is 24 CSS px; Apple's pt and Android's dp
are the density-independent units a phone browser exposes 1:1 as CSS px
at `width=device-width`, so 44 pt ≈ 44 px and 48 dp ≈ 48 px.

| Rule | Threshold | Where the app stands |
|---|---|---|
| WCAG 2.2 SC 2.5.8 Target Size (Minimum), AA | 24×24 CSS px, or spaced so a 24 px circle centred on each target touches no other target; inline, user-agent and essential exceptions | 28 controls fail (arrows, "Progreso", "⚙") |
| WCAG 2.2 SC 2.5.5 Target Size (Enhanced), AAA | 44×44 CSS px | 190 of 193 controls under 44 px; the set row's ✓ is 42×40 |
| Apple HIG | control size default 44×44 pt, minimum 28×28 pt; "a button needs a hit region of at least 44x44 pt" | as above; the arrows (20×14) are under Apple's floor too |
| Material 3 | 48×48 dp, "separated by 8dp of space or more" (≈ 9 mm; the recommended physical target is 7–10 mm) | as above |
| WCAG SC 1.4.3 Contrast (Minimum), AA | 4.5:1 for text under 24 px (18.67 px if bold); 3:1 at or above. Apple's table says the same: 4.5:1 up to 17 pt, 3:1 from 18 pt or bold | Light theme secondary text 3.3–4.5:1; dark passes |
| WCAG SC 1.4.11 Non-text Contrast, AA | 3:1 against adjacent colours for a component's boundary and state indicators; inactive components exempt | Control borders 1.3–1.6:1 in both themes |
| WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum), AA; F110; C43 | a focused component is not entirely hidden by author content; F110 is the sticky header that covers it on Shift+Tab; C43 is `scroll-padding` | Fails: Shift+Tab lands under the 295 px header |
| WCAG SC 1.4.4 Resize Text, AA; SC 1.4.10 Reflow | 200 % without loss; 320 px without two-way scroll | Met by browser zoom (the viewport must keep allowing it); reflow met (the `layout` section pins no sideways scroll) |
| WCAG SC 1.4.12 Text Spacing, AA | no loss at line-height 1.5×, paragraph 2×, letter 0.12×, word 0.16× | not measured; nothing clips text by height except the timer label |
| WCAG SC 1.3.1 / 2.4.1 / 2.4.6 (structure, bypass, headings) | landmarks and headings as the map | No landmarks, no `h1` |
| Type floors | Apple Dynamic Type: Body 17 pt, Subhead 15, Footnote 13, Caption 2 11 (the smallest style); Material: body-medium 14 sp, label-small 11 sp; WCAG sets no minimum size | Secondary text 10–11.5 px; badges 8.5–9.5 px; inputs 15 px |
| Apple HIG tab bars; Material 3 navigation bar | 3–5 destinations (UIKit folds a sixth into "More"); Material bar 80 dp, or 64 dp since Expressive (2025); a tab bar is for navigation, a toolbar for actions | n/a today; L8 draws four |
| Apple HIG toolbars, action sheets, sheets; Material bottom sheets | toolbars: at most three groups, the rest in a More menu; action sheets: at most four buttons, destructive first; one sheet at a time, a grabber, swipe to dismiss, a medium detent; Material bottom sheets replace inline menus on phones | 14 actions in two flat rows; centred dialogs |
| WebKit safe areas (`viewport-fit=cover` + `env()`) | pad fixed and sticky edges by the insets; the bottom inset is 34 pt in portrait on Face ID phones | `viewport-fit=cover` set, no `env()` anywhere |
| iOS Safari focus zoom | a field at 15 px or less zooms the page on focus; `maximum-scale=1` is not a fix (WCAG needs 2× and iOS 10+ ignores it anyway) | Set inputs 15 px, note 13 px, textareas 11 px |
| NN/g sticky headers, progressive disclosure, mobile navigation | keep persistent chrome to what is needed during the session and maximise the content-to-chrome ratio; at most two disclosure levels; hidden menus are the least discovered; more than five options do not fit a bar at a usable target size | 295 px persistent; the cue, the alternative and the pair note always open; 14 flat actions |

### Platform support checked

First versions with full support, from caniuse's raw data and the
`web-features` set (Chrome for Android tracks desktop Chrome). Everything
the options use is years old on both phones.

| Technique | Chrome | iOS Safari | Used by |
|---|---|---|---|
| `env(safe-area-inset-*)` with `viewport-fit=cover` | 69 | 11.3 | L6, L8, L11, L14 |
| `scroll-padding-top` / `scroll-snap-type` | 69 | 11 | L6; a snapping week strip in L2 |
| `position: sticky` | 91 (partial from 56) | 13 | today's header; sticks to the nearest ancestor with an overflow other than visible, which is why `.wrap` must never gain one |
| `dvh` | 108 | 15.4 | L11 |
| `overscroll-behavior` | 65 | 16 | L11 (`contain` on a sheet stops pull-to-refresh under it) |
| `:has()` | 105 | 15.4 | optional, for a "card complete" style without a class |
| `<dialog>` / `showModal()` | 37 | 15.4 | optional for L11 |
| `popover` attribute | 116 | 17 (18.3 full) | optional for the card "⋯" and the week picker in L2/L5 |
| `interactive-widget=resizes-content` | 108 (Android) | not shipped | why L8 hides the bar while an input has focus |

### Spanish conventions, in one paragraph

The RAE accepts both the comma and the point as the decimal separator
(Spain uses the comma, Mexico and the Caribbean the point), so the app's
`type="text" inputmode="decimal"` inputs, which take either, are the
right shape and should stay it. Spain's accessibility standard is
UNE-EN 301549:2022, the Spanish text of EN 301 549 V3.2.1, whose web and
mobile chapters are WCAG 2.1 A/AA; RD 1112/2018 binds the public sector
and Ley 11/2023 (the European Accessibility Act) the private sector from
28 June 2025, with microenterprises exempt. A two-person training log is
under no legal duty; WCAG 2.2 AA is the reference this pass uses because
it is what those standards point at.

## Considered and rejected

- **A restyle as a finding.** The crowding is structural and the tokens
  are one line each, so no finding above asks for a new look. Option 4
  draws one because it was asked for afterwards; it is listed as a
  choice (L17), and none of the measured problems needs it.
- **Hiding the header on scroll down** (the "collapse on scroll"
  pattern). Cheap in CSS-only form it is not — it needs a scroll listener
  and a state class — and it hides the day tabs exactly when someone
  scrolling back up to check a set wants them. Folding beats hiding.
- **A floating action button.** There is no single primary action; the
  primary action is the ✓ on the next set, which is already where the
  thumb is.
- **Swipe gestures** (swipe a set to tick, swipe a card to reorder). No
  visible affordance, no keyboard equivalent, and a gym thumb is wet; the
  sixth pass's haptic-tick option (N16) is the honest version.
- **`maximum-scale=1` to stop the iOS zoom on input focus.** It stops
  pinch-zoom too, iOS 10+ ignores it, and the guide says pinch-zoom was
  deliberately unblocked. 16 px inputs are the fix.
- **Native `<dialog>` for the sheets.** Supported on both phones since
  2022, but the sheet stack, its return-focus rules and the
  `#askSheet`/`#qrSheet` z-order (`css/style.css:838-845`) are already
  handled by `registerSheet`; a migration buys `inert` for free and
  nothing else the app lacks. Record for L11, not required by it.
- **Removing the "↓" drop control from the set row** to widen the
  inputs. It is the feature's only entry point and is used mid-set;
  Hevy's tap-the-set-number is recorded under L5 as the alternative.
- **A custom numeric keypad or ± steppers.** Feature questions, in 030
  (N45); NN/g's rule for steppers — fine for small discrete steps, never
  without a typeable field — is the constraint any plan for it inherits.
- **Per-set RIR.** In 030.
- **A "compact mode" toggle.** Two layouts to test and document for a
  two-person app; the folded layout should simply be the layout.
- **Bottom-only reach as the layout's premise.** The grip study read for
  this pass (Hoober, 1 333 observations) has 49 % one-handed, 36 %
  cradled, 15 % two-handed, and people change grip to reach; the day
  tabs at the top are fine, and the bar in L8 is for frequency, not
  reach.

## Not audited

The sheets' internal layouts beyond what F12 counts; the plan editor;
the recovery screen; the QR sheet; the printed CSV; screen-reader
behaviour on a real device (VoiceOver, TalkBack) — the audit is
structural and measured, not a device pass; the safe-area and focus-zoom
findings are rule-derived and should be confirmed on an installed
iPhone before the plan is marked done; `js/vendor/`; performance.

## Sources

Read on 2026-09-20; the standards and vendor guidance by the research
subagent, the browser-support rows from caniuse's raw JSON. Primary
unless marked. Two fetch caveats: `m3.material.io` and the HIG's HTML
are script-rendered, so Material is cited from Google's component docs
on GitHub and Apple from its DocC JSON endpoints (same text as the
pages); the Spanish public-sector portal and the UNE catalogue rejected
every fetch and are cited from search snippets.

- WCAG 2.2, Understanding documents — SC 2.5.8 Target Size (Minimum):
  <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>;
  SC 2.5.5 Target Size (Enhanced):
  <https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html>;
  SC 1.4.3 Contrast (Minimum):
  <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>;
  SC 1.4.11 Non-text Contrast:
  <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>;
  SC 2.4.11 Focus Not Obscured (Minimum):
  <https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>;
  SC 2.4.12 (Enhanced):
  <https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-enhanced.html>;
  Failure F110: <https://www.w3.org/WAI/WCAG22/Techniques/failures/F110>;
  Technique C43: <https://www.w3.org/WAI/WCAG22/Techniques/css/C43>;
  SC 1.4.4 Resize Text:
  <https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html>;
  SC 1.4.12 Text Spacing:
  <https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html>;
  SC 1.4.10 Reflow:
  <https://www.w3.org/WAI/WCAG22/Understanding/reflow.html>;
  CSS Values 4, absolute lengths (`1pt = 1/72in`, `1in = 96px`):
  <https://www.w3.org/TR/css-values-4/#absolute-lengths>.
- Apple Human Interface Guidelines — Accessibility (44 pt default,
  28 pt minimum, the contrast table, 200 % text):
  <https://developer.apple.com/design/human-interface-guidelines/accessibility>;
  Buttons: <https://developer.apple.com/design/human-interface-guidelines/buttons>;
  Tab bars: <https://developer.apple.com/design/human-interface-guidelines/tab-bars>;
  Toolbars: <https://developer.apple.com/design/human-interface-guidelines/toolbars>;
  Action sheets: <https://developer.apple.com/design/human-interface-guidelines/action-sheets>;
  Sheets: <https://developer.apple.com/design/human-interface-guidelines/sheets>;
  Menus: <https://developer.apple.com/design/human-interface-guidelines/menus>;
  Layout (safe areas): <https://developer.apple.com/design/human-interface-guidelines/layout>;
  Typography (Dynamic Type sizes):
  <https://developer.apple.com/design/human-interface-guidelines/typography>;
  UIKit `UITabBarController` (the "More" fold):
  <https://developer.apple.com/documentation/uikit/uitabbarcontroller>;
  the 34 pt bottom inset — secondary:
  <https://useyourloaf.com/blog/supporting-iphone-x/>.
- Material Design 3 (Google's component docs) — Navigation bar:
  <https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md>;
  Bottom app bar (deprecated for the docked toolbar):
  <https://github.com/material-components/material-components-android/blob/master/docs/components/BottomAppBar.md>;
  Docked toolbar:
  <https://github.com/material-components/material-components-android/blob/master/docs/components/DockedToolbar.md>;
  Bottom sheet:
  <https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md>;
  Top app bar:
  <https://github.com/material-components/material-components-android/blob/master/docs/components/TopAppBar.md>;
  Typography (type scale):
  <https://github.com/material-components/material-components-android/blob/master/docs/theming/Typography.md>;
  the M3 Expressive changes (64 dp bar, toolbars) — secondary:
  <https://9to5google.com/2025/05/14/material-3-expressive-navigation/>,
  <https://9to5google.com/2025/05/18/material-3-expressive-toolbars/>;
  touch targets: <https://support.google.com/accessibility/android/answer/7101858>,
  <https://developer.android.com/guide/topics/ui/accessibility/apps>.
- WebKit and MDN — "Designing Websites for iPhone X" (`viewport-fit`,
  `env(safe-area-inset-*)`): <https://webkit.org/blog/7929/designing-websites-for-iphone-x/>;
  "Using the System Font in Web Content" (`-apple-system-body` and
  Dynamic Type): <https://webkit.org/blog/3709/using-the-system-font-in-web-content/>;
  MDN `env()`: <https://developer.mozilla.org/en-US/docs/Web/CSS/env>;
  MDN `scroll-padding-top`: <https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-padding-top>;
  MDN `position` (sticky's containing rule):
  <https://developer.mozilla.org/en-US/docs/Web/CSS/position>;
  MDN `color-scheme`: <https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme>;
  MDN viewport meta (`maximum-scale`, iOS 10+):
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport>;
  MDN `font-size` (px vs relative units):
  <https://developer.mozilla.org/en-US/docs/Web/CSS/font-size>;
  MDN `inputmode`: <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode>;
  MDN CSP `style-src` (what an inline-free policy blocks):
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src>;
  MDN `<dialog>`: <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog>;
  MDN `popover`: <https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/popover>;
  MDN `length` (`dvh`): <https://developer.mozilla.org/en-US/docs/Web/CSS/length>;
  MDN `overscroll-behavior`: <https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior>;
  Chrome, viewport resize behaviour (`interactive-widget`):
  <https://developer.chrome.com/blog/viewport-resize-behavior>; WebKit's
  unshipped implementation — secondary:
  <https://www.bram.us/2026/09/11/webkit-supports-interactive-widget-and-hopefully-safari-will-too/>;
  browser versions: caniuse raw data,
  <https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/>
  (`css-env-function`, `css-snappoints`, `css-sticky`, `dialog`,
  `viewport-unit-variants`, `css-overscroll-behavior`, `css-has`,
  `prefers-reduced-motion`), and `web-features`
  (<https://github.com/web-platform-dx/web-features>) for `popover`,
  `prefers-contrast` and `scroll-snap`.
- iOS Safari zoom on inputs at 15 px or less — secondary, the behaviour
  is undocumented by Apple:
  <https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/>;
  "Don't disable zoom": <https://adrianroselli.com/2015/10/dont-disable-zoom.html>.
- Nielsen Norman Group — Sticky headers:
  <https://www.nngroup.com/articles/sticky-headers/>; Progressive
  disclosure: <https://www.nngroup.com/articles/progressive-disclosure/>;
  Accordions on mobile: <https://www.nngroup.com/articles/mobile-accordions/>;
  Visual hierarchy: <https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>;
  Aesthetic and minimalist design:
  <https://www.nngroup.com/articles/aesthetic-minimalist-design/>;
  Mobile navigation patterns:
  <https://www.nngroup.com/articles/mobile-navigation-patterns/>;
  Mobile input checklist: <https://www.nngroup.com/articles/mobile-input-checklist/>;
  Input steppers: <https://www.nngroup.com/articles/input-steppers/>;
  Scrolling and attention: <https://www.nngroup.com/articles/scrolling-and-attention/>;
  Wroblewski on primary and secondary actions:
  <https://www.lukew.com/ff/entry.asp?571>; Hoober's grip study:
  <https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php>.
- The comparable apps' in-session screens — Hevy:
  <https://www.hevyapp.com/features/track-workouts/>,
  <https://www.hevyapp.com/features/workout-rest-timer/>,
  <https://www.hevyapp.com/hevy-tutorial/>; Strong:
  <https://help.strongapp.io/article/229-my-first-workout>,
  <https://help.strongapp.io/article/231-rest-timer>; Liftosaur:
  <https://www.liftosaur.com/blog/posts/liftosaur-overview/>,
  <https://github.com/astashov/liftosaur>; Alpha Progression:
  <https://alphaprogression.com/en/blog/alpha-progression-guide>;
  Boostcamp: <https://www.boostcamp.app/workout-tracker>, App Store
  listing id1529354455; JEFIT:
  <https://www.jefit.com/wp/jefit-news-product-updates/upcoming-enhancements-revamped-workout-tab-and-improved-exercise-screens/>;
  FitNotes: <http://www.fitnotesapp.com/workout_tracking/>,
  <https://www.getfitnotes.com/docs/rest-timer.html>,
  <https://www.getfitnotes.com/docs/settings.html>; RP Hypertrophy:
  <https://dr-muscle.com/rp-hypertrophy-app-critique/> (secondary), App
  Store listing id1555614554; Setgraph:
  <https://setgraph.app/articles/get-the-most-out-of-setgraph-s-rest-timer>,
  App Store listing id1209781676.
- Spanish conventions — the RAE on the decimal separator, via
  <https://www.infobae.com/cultura/2025/08/26/tip-de-la-rae-decimales-coma-y-punto-son-signos-validos/>
  (the RAE page itself refused the fetch); `type="number"` and the
  comma: <https://www.ctrl.blog/entry/html5-input-number-localization.html>,
  <https://developer.apple.com/forums/thread/818268> (the iOS 26 beta
  regression); UNE-EN 301549:2022:
  <https://accesibilidadweb.dlsi.ua.es/?menu=une301549-2022>,
  <https://www.discapnet.es/accesibilidad/marketing-inclusivo/accesibilidad-web/guia-simplificada-sobre-la-norma-une-3015492022>;
  RD 1112/2018: <https://www.boe.es/buscar/act.php?id=BOE-A-2018-12699>;
  Ley 11/2023: <https://www.boe.es/buscar/act.php?id=BOE-A-2023-11022>;
  Directive (EU) 2019/882:
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L0882>;
  the Observatorio de Accesibilidad Web (PAe) — search snippets only,
  the portal rejected every fetch:
  <https://administracionelectronica.gob.es/accesibilidad>.
