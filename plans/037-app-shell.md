# Plan 037: The app shell — a four-destination bar, the "Más" sheet, the session's two actions above the list, the timer in the bar's place, bottom sheets

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat efc6eca..HEAD -- index.html css/style.css js/app.js js/block-editor.js js/review.js js/rest-timer.js test/smoke.js docs/guide.md README.md AGENTS.md sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition. Plans
> 032–036 must have landed.

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED — a navigation model, not a layout: fourteen actions move
  from two flat rows into a bar and three sheets, the footer goes, the
  timer and the bar share one place. Every action keeps its id, so the
  wiring in the split files does not change; the smoke suite needs a
  helper per hub.
- **Depends on**: 034 (the `#moreSheet`, `#blockSheet`, the sheet
  registrations), 036 (the card's "⋯" carries Progreso and Calculadora,
  so the bar needs neither). Land last of the series.
- **Category**: direction (plans/031, option 4 / L8 + L11 + L14)
- **Planned at**: commit `efc6eca`, 2026-09-20

## Why this matters

Fourteen global actions sit in two clusters — nine 28 px footer buttons
at the bottom of a 3 600 px page (`index.html:77-87`) and four block-bar
buttons plus the theme toggle at the top — all the same size and weight,
with "Borrar todos los datos" one wrap away from "Ajustes" (plans/031 F2).
Every guideline read for that pass caps a persistent bar at four or five
items and puts the rest in a sheet; Apple's tab bar is for navigation, a
toolbar for actions; Material's rule is never a toolbar and a navigation
bar at once. The rest timer is a fixed bar with 29 px buttons and no
safe-area padding (032 fixed the padding).

After this plan the mockups' shell (`plans/031-mockups/opcion4-sesion.png`,
`opcion4-descanso.png`, `opcion2-mas.png` for the sheet's rows): a bar
with four destinations — **Sesión · Progreso · Plan · Más** — 64 px over
the safe area; Progreso opens a hub with Volumen muscular, Diagnóstico and
Revisión del bloque; Plan a hub with Editar plan, + Nuevo bloque, Importar
JSON and Gestionar bloques; Más the sheet 034 started, now with Datos
(copia de seguridad, with the QR and profile transfer inside it as
today), Ajustes (ajustes, tema, aviso con la pantalla apagada — a shortcut
into Ajustes) and a separated Zona de peligro (borrar este día, borrar
todos los datos). The two actions used mid-session — **Rellenar con el
objetivo** and **Calculadora** — sit above the list. While a rest runs the
timer takes the bar's place, with −30 / +30 / Saltar at 44 px, the next
set named, and the sound as a labelled switch. The sheets anchor to the
bottom with a grabber and safe-area padding. The footer keeps the session
note, the totals line, the status line and the version.

## Current state

Files and their roles:

- `index.html` — the footer (`:69-90`: `.ses-note` `:70-74`, `#beyond`
  `:75`, `#note` `:76`, `.foot-btns` `:77-87` with `#copyPrev`,
  `#editPlan`, `#calcBtn`, `#volumeBtn`, `#diagBtn`, `#clearDay`,
  `#backup`, `#settings`, `#wipe`; `#status` `:88`, `#version` `:91`);
  the timer (`:466-482`: `#tlbl`, `#tval`, `#tmsg`, the four `.timer-btn`s
  `#tminus`, `#tplus`, `#tsound`, `#tskip`); the toast (`:483`); the
  sheets (twelve `.sheet` blocks); 034's `#moreSheet`, `#blockSheet`,
  `#profileSheet`.
- `js/app.js` — `$('settings')` (`:1288`), `$('copyPrev')` (`:3401`),
  `$('clearDay')` (`:3447`), `$('wipe')` (`:3463`), `maybeNagBackup`
  (`:4440`, clicks `$('backup')`), the theme button (`:964-987`),
  `registerSheet`/`openSheet`/`closeSheet` (`:1014-1056`), the tick handler's
  `startRest(ex.rest, ex.n + ' · serie ' + (si + 1))` (`:3036`),
  `drawSessionFoot` (`:3221`, writes `#note` and the progress bar).
- `js/block-editor.js` — `renderBlockBar` (`:21-58`) creating the four
  block buttons (no ids) and `$('editPlan')` (`:1083`), `openBlockManager`
  (`:96`), `openImportSheet`, `newBlock`; `openReview` in `js/review.js:300`
  (called by the review button and at `js/block-editor.js:172`).
- `js/calculator.js:156` (`#calcBtn`), `js/volume-sheet.js:231`
  (`#volumeBtn`), `js/diagnostics.js:969` (`#diagBtn`),
  `js/profile-transfer.js:462` (`#backup`), `js/qr-transfer.js:587`
  (`#qrBtn`, inside the backup sheet), `js/rest-timer.js:32-90`
  (`startRest`: `$('timer').classList.add('up')` at `:38`; `stopRest`
  `:82`; `renderSoundBtn` `:187`; `#tsound` `:406`).
- `css/style.css` — `.foot`/`.note`/`.foot-btns`/`.sm` (`:554-564`), the
  timer (`:516-551`, the 620 px breakpoint hiding `.timer-msg`), `.toast`
  (`:574-586`), `.sheet`/`.sheet-box` (`:589-602`), `#askSheet`/`.ask-box`
  (`:838-841`), `#qrSheet` (`:845`), `#app` (`:82`).
- `test/smoke.js` — `#editPlan` 12 clicks, `#diagBtn` 8, `#backup` 7,
  `#copyPrev` 5, `#volumeBtn` 4, `#clearDay` 4, `#settings` 3, `#themeBtn`
  3, `#qrBtn` 3, `#wipe` 1, `#calcBtn` 1; `#blockbar >> text=Importar JSON`
  8, `text=Gestionar` 1, `+ Nuevo bloque` 1 (034 wrapped these in
  `openBlocks`); the `layout` section's "all 4 rest-timer controls fit"
  (`:3487-3491`).
- `docs/guide.md` — "The footer buttons" (`:32-36`, lists eight of the
  nine: Diagnóstico is missing, plans/031 F15), "The rest timer runs along
  the bottom" (`:29-30`), § "During the session" (the timer bullets
  `:437-470`).

Excerpt — the footer buttons, `index.html:77-87`:

```html
      <div class="foot-btns">
        <button class="sm" id="copyPrev">Rellenar con el objetivo</button>
        <button class="sm" id="editPlan">Editar plan</button>
        <button class="sm" id="calcBtn">Calculadora</button>
        <button class="sm" id="volumeBtn">Volumen muscular</button>
        <button class="sm" id="diagBtn">Diagnóstico</button>
        <button class="sm" id="clearDay">Borrar este día</button>
        <button class="sm" id="backup">Copia de seguridad</button>
        <button class="sm" id="settings">Ajustes</button>
        <button class="sm warn" id="wipe">Borrar todos los datos</button>
      </div>
```

Excerpt — the timer, `index.html:466-482` (abridged):

```html
  <div class="timer" id="timer">
    <div class="timer-fill" id="tfill"></div>
    <div class="timer-in">
      <div class="timer-main">
        <div class="timer-lbl" id="tlbl">Descanso</div>
        <div class="timer-val" id="tval">0:00</div>
      </div>
      <div class="timer-msg" id="tmsg" role="status" aria-live="polite"></div>
      <div class="timer-acts">
        <button class="timer-btn" id="tminus" …>−30</button>
        <button class="timer-btn" id="tplus" …>+30</button>
        <button class="timer-btn" id="tsound" … aria-pressed="false" …>Son.</button>
        <button class="timer-btn" id="tskip" type="button">Saltar</button>
      </div>
    </div>
  </div>
```

Excerpt — `startRest`'s entry, `js/rest-timer.js:32-38`:

```js
function startRest(sec, label) {
  ...
  $('timer').classList.add('up');
```

Excerpt — the sheets, `css/style.css:589-602`:

```css
.sheet {
  position: fixed; inset: 0; z-index: 60; display: none;
  background: var(--shade); padding: 16px;
  align-items: center; justify-content: center; overflow-y: auto;
}
.sheet.up { display: flex; }
...
.sheet-box {
  background: var(--card); border: 1px solid var(--line); border-radius: 3px;
  width: 100%; max-width: 600px; max-height: 88vh; overflow: auto; padding: 18px;
}
```

## Steps

### Step A — The bar and the hubs (markup)

**Files**: `index.html`.

**Change**:

1. After `</main>` (034), the bar:

```html
  <nav class="bar" id="navBar" aria-label="Secciones">
    <button class="bar-btn" id="navSession" type="button" aria-current="page">…svg… Sesión</button>
    <button class="bar-btn" id="navProgress" type="button" aria-haspopup="dialog">…svg… Progreso</button>
    <button class="bar-btn" id="navPlan" type="button" aria-haspopup="dialog">…svg… Plan</button>
    <button class="bar-btn" id="navMore" type="button" aria-haspopup="dialog">…svg… Más</button>
  </nav>
```

   The four icons are inline `<svg aria-hidden="true">` stroke paths (the
   mockup's: a dumbbell, a trend line, a list, three dots); the CSP allows
   inline SVG markup (it is not a script or a style).
2. Two hub sheets in the standard `.sheet > .sheet-box[role=dialog]`
   shape: `#progressSheet` ("Progreso": `#volumeBtn` "Volumen muscular",
   `#diagBtn` "Diagnóstico", `#reviewBtn` "Revisión del bloque", a close
   button) and `#planHubSheet` ("Plan": `#editPlan` "Editar plan",
   `#newBlockBtn` "+ Nuevo bloque", `#importBtn` "Importar JSON",
   `#manageBtn` "Gestionar bloques", a close button). The **existing ids
   move** with their buttons (`#volumeBtn`, `#diagBtn`, `#editPlan`), so
   `wireVolumeSheet`, `wireDiagnostics` and `wireBlockEditor` find them
   unchanged; `#reviewBtn`, `#newBlockBtn`, `#importBtn`, `#manageBtn` are
   new ids for buttons `renderBlockBar` used to create without ids. Each
   row is a 48 px `.sheet-row` button with a label and a chevron (the
   `opcion2-mas.png` shape).
3. `#moreSheet` (034) gains its rows: a "Datos" heading and `#backup`
   "Copia de seguridad" (the profile transfer and the QR live inside that
   sheet already, `index.html`'s backup sheet); an "Ajustes" heading with
   `#settings` "Ajustes", `#themeBtn` "Tema" (the existing toggle, with
   the current theme name as the row's hint — `applyTheme` at `:961`
   already knows it), and `#bgAlarmBtn` "Aviso con la pantalla apagada"
   opening Ajustes (it is a field there — `openSetup(false)` and a focus
   on `#setupBgAlarm`); a "Zona de peligro" heading with `#clearDay` and
   `#wipe` (`.sheet-row.warn`). The version line (`#version`) and the
   "Guardado" status stay in the footer.
4. The session's two actions above the list, after `#pair` and the
   energy row: `<div class="session-tools"><button class="sm key"
   id="copyPrev">Rellenar con el objetivo</button><button class="sm"
   id="calcBtn">Calculadora</button></div>`.
5. Delete `.foot-btns` (`:77-87`); the footer keeps `.ses-note`,
   `#beyond`, `#note`, `#status`, `#version`.
6. The timer: `#tmsg` stays (it is the coaching line at wide widths); the
   controls become `#tminus`, `#tplus`, `#tskip` at 44 px in `.timer-acts`,
   and a second line `.timer-foot` with `#tnext` (the next set) and
   `#tsound` restyled as a switch (`role="switch"` — it already carries
   `aria-pressed`; change to `aria-checked` and keep `renderSoundBtn` in
   step, `js/rest-timer.js:187-192`) with the visible label "Aviso sonoro".

**Verify**: `node test/unit.js` — every id the wire functions look up
exists in the inert document (a missing one throws in `loadApp()`).

### Step B — Wiring

**Files**: `js/app.js` (tail), `js/block-editor.js:21-58`, `:1041`,
`js/review.js` (`wireReview`), `js/rest-timer.js:32-90`.

**Change**:

1. `js/app.js` tail: `registerSheet('progressSheet', { closeBtn:
   'progressClose' })`, `registerSheet('planHubSheet', { closeBtn:
   'planHubClose' })`; `#navProgress`/`#navPlan`/`#navMore` open their
   sheets; `#navSession` scrolls to the top of `#main` and closes any
   open hub (it is the current page — `aria-current` stays on it; a real
   route model is not needed with sheets). A hub row that opens another
   sheet (Volumen, Diagnóstico, Editar plan…) first closes the hub
   (`closeSheet('progressSheet')`) so the stack holds one sheet — the
   `sheetStack` (`:1012`) supports nesting, but a hub under a dashboard
   is noise on Escape.
2. `js/block-editor.js` `renderBlockBar` (`:21-58`): render only the
   `<select>` into `#blockbar` (034's block sheet); the four buttons are
   static now. In `wireBlockEditor` (`:1041`): `$('newBlockBtn').onclick =
   () => newBlock()`, `$('importBtn').onclick = openImportSheet`,
   `$('manageBtn').onclick = openBlockManager` — each behind `if
   ($('newBlockBtn'))`-style null guards, because this file is precached
   in every deployed shell but the ids are new to the shell (AGENTS.md's
   precache-hole rule applies to ids as it does to symbols).
3. `js/review.js` `wireReview`: `const b = $('reviewBtn'); if (b) b.onclick
   = () => openReview();`.
4. `js/rest-timer.js`: `startRest(sec, label, next)` gains a third,
   optional argument — the next set's text — written to `#tnext` when the
   element exists (`const n = $('tnext'); if (n) n.textContent = next ||
   ''`). `js/app.js:3036` passes it: the next row's index and its hint,
   `'Siguiente: serie ' + (si + 2) + (rows[si + 1] ? ' · ' + (hintFor(si + 1)) +
   ' ' + units() + ' × ' + ex.reps : '')`, or `'Última serie hecha'` on the
   last set — compute the next hint with the same `priorWeight`/`est`
   logic the row loop uses (factor the hint computation into a small
   function `rowHint(si)` inside `buildExCard` so both read one answer).
   `startRest` also hides the bar: `const nav = $('navBar'); if (nav)
   nav.hidden = true;` and `stopRest` (`:82`) shows it again — guarded,
   since an old shell has no bar. `#tsound`'s handler (`:406`) is
   unchanged; `renderSoundBtn` sets `aria-checked`.
5. The keyboard: on `#list`, `focusin` on an `input` adds `kb-open` to
   `#app` and `focusout` removes it (`js/app.js`, next to
   `takeFocusMark`); CSS hides the bar under `#app.kb-open` — iOS has no
   `interactive-widget`, so a fixed bar floats over the keyboard otherwise
   (plans/031 § L8).

**Verify**: `node --check js/app.js js/block-editor.js js/review.js
js/rest-timer.js`; `node test/unit.js`; by hand: every hub row opens its
sheet, Escape returns to the page (not to the hub), the bar hides while a
rest runs and while a box has focus.

### Step C — The styles

**Files**: `css/style.css`.

**Change**: `.bar` (`position: fixed; left: 0; right: 0; bottom: 0;
z-index: 50; height: calc(64px + env(safe-area-inset-bottom));
padding: 6px 8px env(safe-area-inset-bottom); background: var(--card);
border-top: 1px solid var(--line); display: grid; grid-template-columns:
repeat(4, minmax(0, 1fr)); gap: 4px;`), `.bar-btn` (52 px, the display
face at 12 px uppercase, `color: var(--soft)`, the icon 24 px; the current
one `color: var(--signal); background: var(--signal-soft)`), `.bar[hidden]
{ display: none }`, `#app.kb-open .bar { display: none }`; `#app {
padding-bottom: calc(120px + env(safe-area-inset-bottom)) }` (032 set
100); `.timer` restyled per `opcion4-descanso.png`: `z-index: 55` (above
the bar), the count 52 px in the display face and `var(--signal)`, the
three `.timer-btn`s 44 px with `var(--edge)` borders, `.timer-foot` a
13 px soft line with the switch (`.switch` 36×22, the knob 16 px, ember
when checked); `.timer.up ~ .toast` bottom recomputed for the taller bar
(`calc(150px + env(safe-area-inset-bottom))`); the 620 px breakpoint
(`:546-551`) keeps hiding `#tmsg` and no longer shrinks the buttons.
`.session-tools` (flex, 8 px gap, the primary growing). `.sheet`:
`align-items: flex-end; padding: 0`; `.sheet-box`: `max-width: none;
border-radius: 4px 4px 0 0; max-height: 92dvh; padding: 8px 18px calc(18px
+ env(safe-area-inset-bottom))` with a `.sheet-grab` bar (36×4, decorative,
`aria-hidden`) as the first child of every `.sheet-box` — add it in
`index.html` to each sheet, or draw it with `.sheet-box::before` (a
pseudo-element needs no markup and the CSP allows it); `#askSheet
.sheet-box` keeps the centred `.ask-box` shape (`:838-841`) by overriding
back to `align-items: center` on `#askSheet`. `dvh` is supported on both
phones (iOS 15.4+, Chrome 108+, plans/031 § "Platform support checked");
keep a `max-height: 92vh` line before it as the fallback. Delete
`.foot-btns`; `.sm` stays for the sheets' and tools' buttons.

**Verify**: `node test/smoke.js --only layout` after Step D updates its
timer assertion; at 375 wide the bar's four buttons are ≥ 48 px tall and
inside the viewport; with the timer up the bar is hidden and the timer's
three controls fit.

### Step D — The smoke suite follows the actions

**Files**: `test/smoke.js`.

**Change**: helpers next to `dismissSetup`: `openHub(page, 'progress' |
'plan' | 'more')` (clicks the bar button if the sheet is not `.up`). Then:
`#volumeBtn`/`#diagBtn` clicks (12) → `openHub('progress')` first;
`#editPlan` (12) → `openHub('plan')`; `#backup` (7), `#settings` (3),
`#wipe` (1), `#clearDay` (4), `#themeBtn` (3) → `openHub('more')`;
`#qrBtn` (3) is inside the backup sheet — unchanged after `#backup`;
`#copyPrev` (5) and `#calcBtn` (1) are on the page — unchanged; 034's
`openBlocks` + `#blockbar >> text=Importar JSON` (8) → `openHub('plan')` +
`#importBtn`; `text=Gestionar` → `#manageBtn`; `+ Nuevo bloque` →
`#newBlockBtn`. The `layout` section: "all 4 rest-timer controls fit" →
"the three rest-timer controls and the sound switch are on screen" (four
boxes still); add: the bar's four buttons within the viewport and ≥ 48 px
tall at 375/412/768; the bar hidden while the timer is up (`#navBar`
`hidden`); the bar hidden while a weight box has focus (`#app.kb-open`).
The 032 section keeps its constants.

**Verify**: `node test/smoke.js --list`; then the sections touched most:
`--only "main session" --only "volumen" --only "frecuencia" --only
"índice" --only "revisión" --only "almacenamiento" --only "layout" --only
"descanso con la pantalla"` — all green.

### Step E — Bump and document

**Files**: `sw.js:21`, `docs/guide.md:15-36`, `:437-470`, `README.md`,
`AGENTS.md`.

**Change**: `CACHE_VERSION` → next. The guide: "The footer buttons"
paragraph becomes "The bar": Sesión (the page you are on), Progreso
(Volumen muscular, Diagnóstico, Revisión del bloque), Plan (Editar plan,
+ Nuevo bloque, Importar JSON, Gestionar bloques), Más (Copia de
seguridad — with the profile transfer and the QR inside — Ajustes, Tema,
the pocket alarm shortcut, and, apart, Borrar este día and Borrar todos
los datos); "Rellenar con el objetivo" and "Calculadora" above the list;
the rest timer takes the bar's place with −30 / +30 / Saltar, the next set
named and the sound as a switch (this also fixes F15: Diagnóstico was
missing from the list). README "What it does": the bullet naming the
footer, if any. AGENTS.md: the new sheet ids (`progressSheet`,
`planHubSheet`) in the same sentence 034 added, and the `startRest` third
argument in the rest-timer stub note if the stub list names its arity.

**Verify**: `node test/unit.js` (docs cross-links).

## STOP conditions

- 034 or 036 has not landed (`grep -c 'id="moreSheet"' index.html` is 0,
  or `.ex-menu-btn` is absent from `js/app.js`): stop; the "⋯" and the
  "Más" sheet are this plan's homes for Calculadora and the theme.
- A wire function reads a footer id at load without a null guard and the
  id would be absent from an old shell: the id is not absent — every
  footer id survives, moved — but if a *new* id is read unguarded in a
  split file, add the guard; report the file.
- `sheetStack` nesting misbehaves with a hub closing before the row's
  sheet opens (focus returns to a hidden row): open the row's sheet
  first, then close the hub, and report which order worked.
- `dvh` in `.sheet-box` breaks the smoke suite's Chromium (it should not,
  Chrome 108+): keep the `vh` fallback line and remove `dvh`, report.

## Test plan

- Unit: `node test/unit.js` after Steps A and B (ids), and at the end.
- Smoke: the sections in Step D; `layout` with its new assertions;
  `descanso con la pantalla apagada` (the timer's DOM changed).
- By hand, both themes, 375×667 and 390×844: `opcion4-sesion.png`,
  `opcion4-descanso.png`, `opcion2-mas.png`; a full session with the
  keyboard (the bar hides and returns); an installed iPhone once for the
  safe area under the bar.

## Documentation

- `docs/guide.md`: Step E.
- `README.md`, `AGENTS.md`: Step E.
- `plans/README.md`: the status row.

## Done criteria

- [ ] The bar with four destinations over the safe area; hubs for
      Progreso and Plan; "Más" complete with the danger zone apart.
- [ ] Every former footer and block-bar action reachable, every id kept,
      four new ids wired with null guards.
- [ ] "Rellenar con el objetivo" and "Calculadora" above the list; the
      footer keeps note, totals, status, version.
- [ ] The timer replaces the bar while a rest runs: three 44 px controls,
      the next set named, the sound as a switch; the bar hides under the
      keyboard.
- [ ] Sheets anchored to the bottom with a grabber, `92dvh`, safe-area
      padding; `askSheet` still centred.
- [ ] Smoke helpers in place; the listed sections and `layout` green.
- [ ] `CACHE_VERSION` bumped; the PR gate is green.

## Maintenance notes

- 030's N2 (open on the next session) belongs with this shell — with the
  week and day rows folded, it is what removes the last reason to look at
  the header on a new day. It is a feature plan of its own; this plan
  does not take it.
- The timer as a header chip (plans/031 § L14, the market's shape) was
  recorded as the alternative to the docked bar; this plan keeps the bar
  because the app's lock-screen card already mirrors it and the bar's
  place is free while resting.
