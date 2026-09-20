# Plan 034: Fold the chrome — one top row, 60 px day tabs, the week as a selector, the pair note behind a tap, landmarks and headings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat efc6eca..HEAD -- index.html css/style.css js/app.js js/block-editor.js test/smoke.js docs/guide.md sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition. Plans 032
> and 033 must have landed.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW–MED — moves controls the smoke suite clicks by selector
  (the `.wk` week tabs, `.profile-btn`, the `#blockbar` buttons) behind
  one tap each; the data they change is untouched.
- **Depends on**: 032 (the smoke section's `HEADER_MAX`), 033 (the chip
  and tab faces). 037 builds on the `#moreSheet` this plan creates.
- **Category**: direction (plans/031, option 4 / L1 + L2 + L3 + L10)
- **Planned at**: commit `efc6eca`, 2026-09-20

## Why this matters

The sticky region is 295 px at 375 wide — 44 % of a 667 px phone, with 310
px of session left once the timer is up (plans/031 § "The numbers"). It
holds five rows and 19 controls, of which only the three day tabs are
touched every session: the week changes once a week, the four block
actions a few times per block, the profile switch between sets when two
people share one phone, the theme toggle almost never. The title line
(`js/app.js:2364`) repeats what the profile button and the block `<select>`
above it already say. On the first open of a 667 px phone the first set
row is below the fold.

After this plan the sticky region is two rows, about 134 px: `● Hombre ▾ ·
Bloque 1 ▾ · ⋯` and the three day tabs at 60 px, two lines each. The week
is one 40 px row in the flow — `‹ Semana 1 de 8 · 3 RIR ›` — whose tap
opens the week's goal text and the full strip; the pair note is one line
until tapped; the page gets `<header>`, `<main>`, an `h1` and a proper tab
pattern. The mockups: `plans/031-mockups/opcion4-sesion.png` (the header
and the week row) and `opcion4-claro.png` (the week row open).

## Current state

Files and their roles:

- `index.html` — the header (`:48-58`): `.profiles` (`:50`), `.blockbar`
  (`:51`), `.title-row` with `#title` and `#themeBtn` (`:52-55`), `#weeks`
  (`:56`), `#days` (`:57`); below it `#banner` (`:61`), `#energy` (`:62`),
  `#deloadCheck`/`#brakeNote` (`:63-64`), `#pair` (`:65`), the bar (`:66`),
  `#list` (`:68`). No `<header>`, `<main>`, `<nav>` or `<h1>` anywhere
  (the only `h1` is the recovery screen's, `js/app.js:1337`).
- `js/app.js` — `renderProfiles` (`:2215-2233`), `renderNav`
  (`:2359-2395`: the title at `:2364`, the week buttons `.wk` with
  `role="tab"` and the log dot, the day buttons `.day` with `role="tab"`),
  `drawApp` (`:2683-2760`: the banner at `:2707-2716`, the pair note at
  `:2728-2730`), `weekHasLog`/`refreshWeekDot` (`:2335-2358`), `applyTheme`
  and the theme button (`:961-987`), `registerSheet`/`openSheet`/`closeSheet`
  (`:1014-1056`), `expandedSetup` (`:11-12`, the per-session "what is
  open" pattern).
- `js/block-editor.js` — `renderBlockBar` (`:21-58`): the `<select>` and
  four `.sm` buttons (`+ Nuevo bloque`, `Revisión`, `Importar JSON`,
  `Gestionar`) rendered into `#blockbar` on every render.
- `css/style.css` — `.top` (`:128`), `.profiles`/`.profile-btn`
  (`:109-117`), `.blockbar` (`:120-125`), `.title`/`.title-row`/`.icon-btn`
  (`:134-146`), `.weeks`/`.wk` (`:148-166`), `.days`/`.day` (`:168-179`),
  `.banner` (`:182-190`), `.pair` (`:193-198`), `html { scroll-padding-top
  }` (032).
- `test/smoke.js` — clicks `.wk` at `:382, :403, :434-445, :1097, :1680,
  :1687`; `.profile-btn` at `:1031, :1039`; `#blockbar >> text=…` at
  `:473, :575, :594, :614, :622, :642, :668, :1380, :1390, :1554`; `.day`
  at `:129, :1496`; `#themeBtn` in three places; the 032 section's
  `HEADER_MAX`.
- `docs/guide.md` — § "Using it" (`:15-31`, "Pick the week and the day
  in the two rows under the title").

Excerpt — the header, `index.html:48-58`:

```html
  <div class="top">
    <div class="wrap">
      <div class="profiles" id="profiles"></div>
      <div class="blockbar" id="blockbar"></div>
      <div class="title-row">
        <div class="title" id="title"></div>
        <button class="icon-btn" id="themeBtn" type="button" aria-label="Cambiar tema"></button>
      </div>
      <div class="weeks" id="weeks" role="tablist" aria-label="Semanas del bloque"></div>
      <div class="days" id="days" role="tablist" aria-label="Días de entrenamiento"></div>
    </div>
  </div>
```

Excerpt — `renderNav`'s title and day tabs, `js/app.js:2364` and `:2382-2394`:

```js
  $('title').textContent = 'Registro de entrenamiento · ' + block.name + ' · ' + profile.label;
  ...
  days.forEach((d, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day' + (i === profile.day ? ' on' : '');
    b.innerHTML = '<span class="day-n">Día ' + (i + 1) + '</span><span class="day-t"></span>';
    b.querySelector('.day-t').textContent = d.name;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', i === profile.day ? 'true' : 'false');
    b.setAttribute('aria-label', 'Día ' + (i + 1) + ': ' + d.name);
    b.onclick = () => { profile.day = i; stopRest(); commit(); };
    $('days').appendChild(b);
  });
```

Excerpt — the banner, `js/app.js:2707-2716`:

```js
  const ph = block.phase[profile.week] || { r: '', t: '' };
  const dl = profile.week === deloadWeek(block);
  $('banner').innerHTML = '';
  const bannerDiv = document.createElement('div');
  bannerDiv.className = 'banner' + (dl ? ' deload' : '');
  bannerDiv.innerHTML =
    '<div><div class="banner-l">Objetivo semana ' + profile.week + '</div>' +
    '<div class="banner-v"></div></div><div class="banner-r"></div>';
  bannerDiv.querySelector('.banner-v').textContent = ph.r;
  bannerDiv.querySelector('.banner-r').textContent = ph.t;
```

Excerpt — the block bar's four buttons, `js/block-editor.js:37-57` (the
review button, one of four):

```js
  const reviewBtn = document.createElement('button');
  reviewBtn.className = 'sm';
  reviewBtn.textContent = 'Revisión';
  reviewBtn.onclick = openReview;
  host.appendChild(reviewBtn);
```

## Steps

### Step A — The markup: two rows sticky, the rest in sheets or in the flow

**Files**: `index.html:48-66`.

**Change**: replace the header block with:

```html
  <header class="top">
    <div class="wrap">
      <div class="top-row">
        <button class="chip" id="profileBtn" type="button" aria-haspopup="dialog"></button>
        <button class="chip chip-grow" id="blockBtn" type="button" aria-haspopup="dialog"></button>
        <button class="icon-btn" id="moreBtn" type="button" aria-label="Más acciones" aria-haspopup="dialog">⋯</button>
      </div>
      <h1 class="u-visually-hidden" id="title"></h1>
      <div class="days" id="days" role="tablist" aria-label="Días de entrenamiento"></div>
    </div>
  </header>
  <main class="wrap" id="main">
    <div class="week-row">
      <button class="icon-btn" id="weekPrev" type="button" aria-label="Semana anterior">‹</button>
      <button class="week-btn" id="weekBtn" type="button" aria-expanded="false" aria-controls="weekPanel"></button>
      <button class="icon-btn" id="weekNext" type="button" aria-label="Semana siguiente">›</button>
    </div>
    <div class="week-panel" id="weekPanel" hidden>
      <div id="banner"></div>
      <div class="weeks" id="weeks" role="tablist" aria-label="Semanas del bloque"></div>
    </div>
    <button class="pair" id="pair" type="button" aria-expanded="false" hidden></button>
    ... (#energy, #deloadCheck, #brakeNote, the bar, #list, .foot unchanged)
  </main>
```

Three new sheets after `#askSheet`, in the same `.sheet > .sheet-box`
shape with `role="dialog"`, `aria-modal`, `aria-labelledby`:
`#profileSheet` (title "¿Quién entrena?", a `#profiles` host — the
existing id, so `renderProfiles` keeps rendering the two `.profile-btn`s
into it — and a close button), `#blockSheet` (title "Bloque", a
`#blockbar` host — the existing id, so `renderBlockBar` keeps rendering
into it — and a close button), `#moreSheet` (title "Más", holding
`#themeBtn` moved from the title row with a visible label "Tema", and a
close button; 037 fills the rest). The `.wrap` div that wrapped everything
below the header becomes the `<main>`. `#pair` changes from a `div` to a
`button` (it becomes a disclosure); it keeps its id.

The `#list` gets `role="tabpanel"` and `aria-labelledby` pointing at the
selected day tab's id (`day-0`… set in `renderNav`), and each day tab gets
`aria-controls="list"` and `id="day-N"`.

**Verify**: `node test/unit.js` — `loadApp()`'s inert document has the
ids the wire functions look up; a missing id is a thrown error in the
unit run, which is the point of running it first.

### Step B — The renderers

**Files**: `js/app.js` (`renderProfiles`, `renderNav`, `drawApp`, the
theme button), `js/block-editor.js` (`renderBlockBar`).

**Change**:

1. `renderProfiles` (`:2215`): keep rendering the `.profile-btn`s into
   `#profiles` (now inside `#profileSheet`); additionally set
   `#profileBtn`'s content to a dot in the profile's accent plus the
   label plus a chevron (`textContent` for the label, a `span.dot` for the
   colour — no inline style; the accent comes from `#app.profile-*`
   through `.chip .dot { background: var(--signal) }`), and
   `aria-label = 'Perfil: ' + label + '. Cambiar'`. In solo mode hide
   `#profileBtn` (the `display: none` it already applies to the host).
   Clicking a `.profile-btn` also closes `#profileSheet`.
2. `renderBlockBar` (`js/block-editor.js:21`): unchanged except that the
   host is inside `#blockSheet`; set `#blockBtn`'s text to the block's
   picker label and a chevron. The `<select>`'s `onchange` also closes the
   sheet. (037 moves the four action buttons to the Plan hub; here they
   stay in the sheet.)
3. `renderNav` (`:2359`): the `#title` write stays (it is the `h1` now,
   visually hidden — keep the text). The week strip renders into `#weeks`
   inside `#weekPanel` as today; `#weekBtn` gets `'Semana ' + profile.week
   + ' de ' + blockWeeks(block)` plus `' · ' + phase.r` in a `span.week-rir`
   (ember, via CSS) and the chevron; `#weekPrev`/`#weekNext` step
   `profile.week` within `1..blockWeeks(block)` (`disabled` at the ends)
   through the same `stopRest(); commit();` the `.wk` click uses. The day
   tabs: add `id`, `aria-controls`, and a `keydown` handler on `#days` for
   ArrowLeft/ArrowRight/Home/End that moves focus and selects (the WAI
   tabs pattern, automatic activation), since `role="tab"` promises it.
4. `drawApp` (`:2707-2716`): the banner is built as today but into
   `#banner` inside the panel; the pair note (`:2728-2730`) becomes: text
   into `#pair` as `<span class="badge together">JUNTOS</span><span
   class="pair-text">…</span><span class="chev">` (`textContent` for the
   text), `hidden` when empty, and a click toggles `open` on the button
   with `aria-expanded`; `expandedPair` is a `Set` keyed like
   `expandedSetup` (`:11-12`) so the note stays open for the session and
   closed on the next day.
5. `#weekBtn` toggles `#weekPanel`'s `hidden` and its own `aria-expanded`;
   `expandedWeek` is one boolean, reset on a day or block change; when the
   panel is open the strip is rendered (it always is — `hidden` only
   hides). The banner's `Objetivo semana N` label duplicates the row; drop
   the `.banner-l` line and keep `.banner-v` + `.banner-r` as the goal
   text under the strip.
6. The three sheets register with `registerSheet('profileSheet', {
   closeBtn: 'profileClose' })` etc. at the tail of `js/app.js`, unguarded
   (they live in `app.js`); `#profileBtn`, `#blockBtn`, `#moreBtn` open
   them with `openSheet`. `#themeBtn`'s handler (`:980`) is unchanged; it
   is looked up by id and the id moved.
7. `css/style.css`: `html { scroll-padding-top: 140px }` (032 set 310).

**Verify**: `node --check js/app.js js/block-editor.js`; `node
test/unit.js`; `node test/smoke.js --only "main session"` after Step D's
selector updates.

### Step C — The styles

**Files**: `css/style.css`.

**Change**: `.top-row` (flex, 8 px gap, 44 px controls); `.chip` (44 px,
`border: 1px solid var(--line)`, `background: var(--card)`, 15 px 600, the
dot 10×10 at 2 px radius in `var(--signal)`; `.chip-grow { flex: 1 1
auto; min-width: 0 }` with an ellipsis on the label); `.days` as today but
`.day { height: 60px }` with `.day-t` wrapping to two lines
(`-webkit-line-clamp: 2`) — the smoke suite pinned that day names must
not truncate (plans/031 draft renders showed "Tirón + Cuádri…" at one
line); `.week-row` (flex, 6 px gap), `.week-btn` (flex 1, 40 px,
`var(--card)` with a `var(--line)` border, the display face at 14 px
uppercase, `.week-rir { color: var(--signal) }`, the chevron rotating on
`[aria-expanded="true"]`); `.week-panel` (the banner text at 13 px soft +
the strip, `margin-top: 6px`); `.pair` as a 44 px one-line button with the
JUNTOS badge, an ellipsis on `.pair-text`, and `.pair.open .pair-text {
white-space: normal }` with the button growing (`height: auto; min-height:
44px`); `.u-visually-hidden` in the utility section (the standard clip
rule). Delete `.title`, `.title-row`, `.profiles` layout rules that no
longer apply (keep `.profile-btn` — it lives in the sheet now, as a 44 px
segmented pair).

**Verify**: at 375 wide `.top` measures ≤ 140 px (`getBoundingClientRect`
in the console); the day names show in full on two lines;
`node test/smoke.js --only layout`.

### Step D — The smoke suite follows the controls

**Files**: `test/smoke.js`.

**Change**: three helpers next to `dismissSetup` (`:66`):
`openWeeks(page)` (clicks `#weekBtn` if `#weekPanel` is hidden),
`openProfiles(page)` (clicks `#profileBtn` if `#profileSheet` is not
`.up`), `openBlocks(page)` (clicks `#blockBtn` if `#blockSheet` is not
`.up`). Then: every `.wk` click is preceded by `await openWeeks(page)`
(`:382, :403, :445, :1097, :1680, :1687`); the two `.wk` counts
(`:434-444`) likewise; the two `.profile-btn` clicks (`:1031, :1039`) by
`openProfiles`; the ten `#blockbar >> text=…` clicks by `openBlocks`. The
032 section: `HEADER_MAX = 140`; add `ok('the day names are not
truncated', …)` comparing each `.day-t`'s `scrollWidth` to its
`clientWidth` (equal, since it wraps), and `ok('the week row opens the
strip', …)`.

**Verify**: `node test/smoke.js --only "main session" --only "objetivo"
--only "revisión" --only "accesibilidad: tama"` — all green (these are
the sections that touch weeks, profiles and the block bar most).

### Step E — Bump and document

**Files**: `sw.js:21`, `docs/guide.md:15-31`, `AGENTS.md`.

**Change**: `CACHE_VERSION` → next. The guide's "A session, top to bottom"
paragraph: the profile and the block are two chips in the top row and open
a sheet; the days are the row under them; the week is the row under the
header, `‹ Semana N de M · RIR ›`, whose tap opens the goal text and the
week strip; "⋯" holds the theme (for now). AGENTS.md's "Where things
live" gains nothing — `renderNav` still owns the tabs — but the three new
sheet ids are worth one line under the sheets paragraph if one exists;
otherwise skip.

**Verify**: `node test/unit.js` (docs cross-links).

## STOP conditions

- `.top` at 375 is not ≈ 295 px before the change (the header was already
  folded or grown): re-read the live markup; this plan may be partly done.
- `#blockbar` or `#profiles` is read by a file other than
  `js/block-editor.js` / `js/app.js` (`grep -n "'blockbar'\|'profiles'"
  js/*.js`): that reader moves with the host; report before editing it.
- The smoke helpers cannot open a sheet because `openSheet` focuses the
  box and a section then fills an input by keyboard: use `page.click` on
  the control, not `page.keyboard`.
- The unit run throws on a missing id after Step A: an id the wire
  functions need was dropped from `index.html`; restore it — every id in
  the old header survives (`profiles`, `blockbar`, `title`, `themeBtn`,
  `weeks`, `days`), only their homes change.

## Test plan

- Unit: `node test/unit.js` after Steps A and B (ids and syntax).
- Smoke: the four sections in Step D plus `layout`, `orden real de la
  sesión` (it does not touch the header but renders many cards under the
  new `scroll-padding`), `nota, energía y control de descarga` (the pair
  note's day).
- By eye, both themes, 375 and 390 wide: against
  `plans/031-mockups/opcion4-sesion.png` (header and week row) and
  `opcion4-claro.png` (the week row open).

## Documentation

- `docs/guide.md` § "Using it": the paragraph in Step E.
- `plans/README.md`: the status row.

## Done criteria

- [ ] `.top` ≤ 140 px at 375 wide on the seed plan, two rows.
- [ ] Profile chip → sheet; block chip → sheet with the `<select>` and the
      four actions; "⋯" → sheet with the theme toggle.
- [ ] Week row with ‹ › and a tap that opens the goal text and the strip;
      the `.wk` dots still mark logged weeks.
- [ ] Pair note one line, opens on tap, per-session memory.
- [ ] `<header>`, `<main>`, a visually hidden `h1`, tabs with
      `aria-controls` and arrow keys, `#list` as the tabpanel.
- [ ] Smoke helpers in place; every listed section green; `HEADER_MAX`
      140.
- [ ] `CACHE_VERSION` bumped; the PR gate is green.

## Maintenance notes

- The profile switch as a chip is the mockup's shape; plans/031 § L1 keeps
  the alternative (a 44 px segmented pair in row one, the block chip
  moving into "⋯") if the extra tap turns out to matter when two people
  hand one phone back and forth. Both fit under 140 px.
- 037 moves the block sheet's four actions into the Plan hub; this plan
  leaves them in the sheet so the app is complete at every step.
