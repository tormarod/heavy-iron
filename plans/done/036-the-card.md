# Plan 036: The card — one header row, `kg · rep · RIR` rows with a column line, no set number, the "⋯" menu, the plan text behind the name

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat efc6eca..HEAD -- index.html css/style.css js/app.js test/smoke.js docs/guide.md README.md sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition. Plans
> 033, 034 and 035 must have landed.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — rewrites the markup of `buildExCard` (`js/app.js:2761`),
  the app's hottest render path, and moves four controls the smoke suite
  locates by class; the log writes it makes are the same writes as today
  plus the per-set RIR box from 035.
- **Depends on**: 033 (the faces), 034 (the header is settled first), 035
  (the row's `rir`). Land it alone in `js/app.js`.
- **Category**: direction (plans/031, option 4 / L5, as the maintainer
  revised it: no set number, RIR per set in the row)
- **Planned at**: commit `efc6eca`, 2026-09-20

## Why this matters

The card's head is 117 px of text read once per block — the two order
arrows, the name with two badges, the alternative, a two-to-three-line
amber cue, the target and rest, a "Progreso ↗" button, a "⚙ Ajustes" line —
drawn every session above the sets, which are drawn at 40 px with a 42 px
tick, 15 px inputs (iOS zooms the page on a field under 16 px) and a
28-px-high RIR chip row under them (plans/031 § "The numbers", F3, F4, F8).

After this plan the card is the maintainer's option 4 card
(`plans/031-mockups/opcion4-sesion.png`, `tarjeta-dieta.png` for the
shape): one 44 px head row — the exercise's position in a small square,
the name in the display face with its badges, a "⋯" button — and a mono
meta line (`4 × 6–10 · desc. 2:30 · asiento 4`); the history band; a
column line `kg · rep · RIR` once per card; then one row per set with
**no set number**, three 52 px boxes (weight, reps, RIR), the ↓ at 40 px
and the ✓ at 52 px; the objetivo line as the card's only foot. The reps
box shows the objetivo's rep target for that set as its placeholder and
the RIR box the week's target RIR, the way the weight box shows the
objetivo's weight. The alternative, the cue and the machine settings live
behind the name (a disclosure); "Progreso", "mover antes / después",
"Calculadora" and "Ajustes de máquina" live in the "⋯" menu. The
per-exercise RIR chips are gone: 035 made the row the record.

## Current state

Files and their roles:

- `js/app.js` — `buildExCard` (`:2761-3163`): the head markup
  (`:2830-2864`, with `.ex-num`, `.ex-ord`, `.ex-name`, `.ex-alt`,
  `.ex-cue`, `.ex-target`, `.ex-rest`, `.ex-chart-btn`, the setup block,
  the `.ex-rir` line at `:2863`), the order arrows' handlers
  (`:2880-2892`), the setup button and box (`:2900-2930`), the RIR chips
  (`:2944-2957`), the set rows (`:2960-3050`: the row markup at
  `:2968-2974`, the placeholder logic `:2976-2992`, the input handlers,
  the tick handler `:3011-3040`, the drop rows `:3055-3120`, the drop kind
  chips `:3125-3145`); `drawCard` (`:3164`); `takeFocusMark`/`focusPathIn`
  (`:2396-2450`); `setupKey`/`expandedSetup` (`:11-12`); `openChart`
  (`js/chart.js`, called at `:2876`); `moveSessionEx` (`:1794`);
  `openCalc` (`js/calculator.js:156` wires `#calcBtn`); `targetNow` /
  `targetLine` / `targetNotes` / `TARGET_CONF_LABEL`; `weekRir`
  (`:3658`), `phaseRir` (`:1645`); `setRir`/`rowRir`/`RIR_MAX` (035).
- `css/style.css` — `.ex` (`:205-210`), `.ex-head` (`:212`), `.ex-num`/
  `.ex-ord` (`:217-232`), `.ex-body`/`.ex-name`/`.ex-alt`/`.ex-cue`
  (`:250-253`), `.ex-target`/`.ex-rest`/`.ex-chart-btn` (`:254-263`),
  `.ss`/`.badge` (`:265-275`), `.last` (`:277-294`), `.sets` (`:296`),
  `.ex-setup*` (`:305-318`), `.ex-decay`/`.ex-est*` (`:321-351`), `.ex-rir`/
  `.rir-chip` (`:406-416`), `.set-row`/`.set-n` (`:421-426`), `.fld`
  (`:428-441`), `.tick` (`:443-448`, `:499-513`), `.drop-*`
  (`:456-498`).
- `index.html` — no card markup (it is built in JS); a new `#exMenuSheet`
  goes next to `#askSheet`.
- `test/smoke.js` — `.ex-chart-btn` (`:487`), `.ex-ord` (`:2287-2325`,
  section "orden real de la sesión"), `.rir-chip` (13 mentions across
  "nota, energía y control de descarga", "objetivo de peso y diagnóstico",
  "revisión del bloque"), `.ex-setup-btn` (the machine-settings cases in
  "main session"), `.set-row` and its `input`/`.tick` everywhere (these
  selectors survive), the 032 section's 40 px floor.
- `docs/guide.md` — the session table (`:17-27`) and § "During the
  session" (`:408-537`: the arrows bullet, the RIR bullet `:471`, the
  "Ajustes, collapsed" bullet); `README.md` "What it does" (the session
  bullet naming RIR chips).

Excerpt — the head, `js/app.js:2830-2864` (abridged):

```js
  card.innerHTML =
    '<div class="ex-head">' +
      '<div class="ex-num">' +
        '<button type="button" class="ex-ord up"' + ... + '>↑</button>' +
        '<span class="ex-ord-n">' + (i + 1) + '</span>' +
        '<button type="button" class="ex-ord down"' + ... + '>↓</button>' +
      '</div>' +
      '<div class="ex-body">' +
        '<div class="ex-name"></div>' +
        (ex.alt ? '<div class="ex-alt"></div>' : '') +
        (ex.cue ? '<div class="ex-cue"></div>' : '') +
      '</div>' +
      '<div><div class="ex-target">' + n + ' × ' + esc(ex.reps) + '</div>' +
      '<div class="ex-rest">' + ... + '</div>' +
      '<button class="ex-chart-btn" type="button">Progreso ↗</button></div>' +
    '</div>' + prevTxt +
    '<div class="ex-setup">' + ... + '</div>' +
    '<div class="sets"></div>' +
    (decay ? '<div class="ex-decay"></div>' : '') +
    (est ? '<div class="ex-est ...">' ... '</div>' : '') +
    '<div class="ex-rir"><span class="ex-rir-lbl">RIR último set</span><div class="rir-chips"></div></div>' +
    (parked ? '<div class="ex-parked"></div>' : '');
```

Excerpt — the set row, `js/app.js:2968-2974`:

```js
    row.innerHTML =
      '<div class="set-n">' + (si + 1) + '</div>' +
      '<div class="fld"><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next"><u>' + esc(units()) + '</u></div>' +
      '<div class="fld"><input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next"><u>rep</u></div>' +
      '<button type="button" class="drop-add' + (drops.length ? ' on' : '') + '"' +
        (drops.length >= MAX_DROPS ? ' disabled' : '') + '>↓</button>' +
      '<button type="button" class="tick' + (r.done ? ' on' : '') + '" aria-pressed="' + (r.done ? 'true' : 'false') + '">✓</button>';
```

Excerpt — the placeholder, `js/app.js:2976-2992`:

```js
    const tgtRow = est && est.sets[si];
    const ownHint = priorWeight(profile, block.id, profile.week, day.id, ex.id, si);
    ...
    const hint = tgtRow ? loadText(tgtRow.w) : (ownHint || (priorRow ? String(priorRow.w) : ''));
    ...
    wIn.placeholder = hint || '—';
    rIn.placeholder = '—';
```

Excerpt — the grid, `css/style.css:421-424`:

```css
.set-row {
  display: grid; grid-template-columns: 26px 1fr 1fr 30px 42px;
  gap: 7px; align-items: center; padding: 5px 0;
}
```

## Steps

### Step A — The head row and the fold

**Files**: `js/app.js:2830-2930`, `css/style.css`.

**Change**: the head becomes

```html
<div class="ex-head">
  <span class="ex-pos" aria-hidden="true">N</span>
  <button type="button" class="ex-name-btn" aria-expanded="false">
    <span class="ex-name">…badges…</span>
    <span class="ex-meta">4 × 6–10 · desc. 2:30 · asiento 4</span>
  </button>
  <button type="button" class="ex-menu-btn" aria-label="Más sobre {name}: progreso, mover, ajustes de máquina">⋯</button>
</div>
<div class="ex-more" hidden>
  <div class="ex-alt"></div>      (if ex.alt)
  <div class="ex-cue"></div>      (if ex.cue)
  <label class="ex-setup-lbl">Ajustes de máquina <input class="ex-setup-in" …></label>
</div>
```

`.ex-meta` is the old `.ex-target` + `.ex-rest` text plus the setup
preview (`ex.setup` truncated at 28, as `setupBtn` did at `:2905`), one
mono line. The name button toggles `.ex-more`'s `hidden` and its own
`aria-expanded`; `expandedSetup` (`:11-12`) is reused as the "more is
open" set — rename it `expandedMore` in the same commit, keeping
`setupKey`. The setup input's handlers move unchanged (`:2915-2928`, the
`focusSetup` mark included). The `.ex-alt`/`.ex-cue` text assignments
(`:2871-2872`) move into the fold. The `.ex-pos` number is the session
position (`i + 1`) as today's `.ex-ord-n`; `aria-hidden` because the
arrows' labels already said "puesto N" and the menu's will.

CSS: `.ex-head` as a 44 px flex row; `.ex-pos` a 28 px square in
`var(--sunk)` with the display face; `.ex-name` in the display face at
24 px / 700 / line-height 1.05, `-webkit-line-clamp: 2`; the badges as 3 px
squares at 11 px; `.ex-meta` mono 12 px soft; `.ex-menu-btn` 44×44
transparent; `.ex-more` 13 px with `.ex-cue` in `var(--amber-ink)`. Delete
`.ex-num`, `.ex-ord*`, `.ex-body`, `.ex-target`, `.ex-rest`,
`.ex-chart-btn`, `.ex-setup`, `.ex-setup-btn` rules; keep `.ex-setup-box
input` as `.ex-setup-in`.

**Verify**: `node --check js/app.js`; `node test/unit.js`; open the app —
a card shows one head row, and tapping the name opens the fold.

### Step B — The "⋯" menu

**Files**: `index.html` (a new `#exMenuSheet` after `#askSheet`),
`js/app.js`.

**Change**: one shared sheet with `role="dialog"`, a title (`#exMenuT`,
the exercise name) and five rows in the `.sheet-btns` shape, each a 48 px
button with an id: `#exMenuChart` "Progreso ↗", `#exMenuUp` "Hiciste este
antes: mover al puesto N−1", `#exMenuDown` "…después: puesto N+1",
`#exMenuSetup` "Ajustes de máquina", `#exMenuCalc` "Calculadora", and a
close button. `openExMenu(ex, i, day)` (new, in `js/app.js` next to
`buildExCard`) sets the title, disables Up/Down at the ends (the arrows'
`disabled` logic at `:2831-2836`), wires the five handlers to
`openChart(ex, day.id)`, `moveSessionEx(...)` + `commit()` (`:2888-2891`),
"open the fold and mark the setup input for focus" (`:2905-2911`), and
`openCalc()` when `typeof openCalc === 'function'` (it is a split file
symbol — the guard is the rule), then `openSheet('exMenuSheet')`. Register
it with `registerSheet('exMenuSheet', { closeBtn: 'exMenuClose' })`. The
menu button's handler calls `openExMenu`. Focus returns to the "⋯" on
close (the sheet stack does that already).

**Verify**: `node test/smoke.js --only "orden real"` after Step F's
helper; by hand: ⋯ → "Progreso ↗" opens the chart; ⋯ → mover reorders;
Escape closes the menu and focus lands on the "⋯".

### Step C — The set rows: three boxes, a column line, no number

**Files**: `js/app.js:2960-3050`, `:3055-3120` (drop rows), `css/style.css`.

**Change**:

1. Before the first row, `box.appendChild(setHead)` where `setHead` is
   `<div class="set-head" aria-hidden="true"><span>kg</span><span>rep</span><span>RIR</span><span></span><span></span></div>`
   — the unit is `esc(units())` as before.
2. The row markup:

```js
    row.innerHTML =
      '<input type="text" class="w-in" inputmode="decimal" autocomplete="off" enterkeyhint="next">' +
      '<input type="text" class="r-in" inputmode="numeric" autocomplete="off" enterkeyhint="next">' +
      '<input type="text" class="rir-in" inputmode="numeric" autocomplete="off" enterkeyhint="done" maxlength="1">' +
      '<button type="button" class="drop-add…">↓</button>' +
      '<button type="button" class="tick…" aria-pressed="…">✓</button>';
```

   `const [wIn, rIn, rirIn] = row.querySelectorAll('input')` (the smoke
   suite's `.set-row input` first/nth selectors keep working: weight is
   still first, reps second). The `.fld` wrappers and `<u>` units go; the
   `.set-n` goes. Labels: the three `aria-label`s name the set and the
   exercise as today (`:2989-2990`), the third "RIR, serie N de {name}".
3. Placeholders: `wIn` as today; `rIn.placeholder = tgtRow && tgtRow.r ?
   String(tgtRow.r) : esc-free ex.reps` (the objetivo's rep target for the
   set — `est.sets[si]` carries `w` and `r`; confirm the field name in
   `targetFor`'s return, `:3963+`); `rirIn.placeholder = String(weekRir(block,
   ex, profile.week, null))` when it is a number, else `'—'` (the week's
   RIR, floored by `ex.minRir`, `:3658-3664`).
4. `rirIn.value = r.rir == null ? '' : r.rir`; `rirIn.oninput`: keep one
   digit `0–RIR_MAX` (`e.target.value.replace(/[^0-5]/g, '').slice(0, 1)`),
   write `r.rir` or delete it, `save()`, and the same `recordTargetOnStart`
   call the other two inputs make (`:2996-3005`), reading `wasSession`
   first as they do.
5. The tick handler (`:3011-3040`) is unchanged in what it writes; the
   adoption message (`:3039`) is unchanged. **The tick never adopts the
   RIR placeholder** (035 § Step H.4): a reserve nobody reported is not a
   measurement, so a blank RIR box stays blank on tick and the set reads
   as a floor, as today. Only the weight box has the adoption contract.
6. The `.set-row.done`/`.pr`/`.pr-e1rm` classes that coloured `.set-n`
   move their signal to the weight box's left edge or the tick (the
   RÉCORD colour on the tick already exists, `:504-513`); drop the
   `.set-n` rules.
7. Drop rows (`:3055-3120`) take the same five columns: `↳` goes
   (nothing marks the sub-row but its shorter boxes and the rule down the
   left, as the comment at `:450-455` wants); the third cell is an empty
   `<span>` (a drop has no RIR of its own); `.drop-x` sits in the tick
   column. The drop-kind chips (`:3125-3145`) are unchanged.
8. The RIR chip block (`:2863`, `:2944-2957`) is deleted, with
   `RIR_LABEL`'s only use; keep `RIR_OPTIONS` (035's validators and the
   review still read it).
9. CSS: `.set-head` and `.set-row` share `grid-template-columns:
   minmax(0,1fr) minmax(0,1fr) 56px 40px 52px; gap: 6px`; the inputs
   `height: 52px; min-width: 0; text-align: center; padding: 0 6px;
   font: 500 19px var(--font-mono); background: var(--sunk); border: 2px
   solid transparent; border-radius: 3px`; `.set-row.done input {
   background: var(--card); border-color: var(--line) }`; the *next* set
   (the first row not done, when the card has an `est`) gets
   `.set-row.next input, .set-row.next .tick { border-color: var(--signal) }`
   — add the class in the row loop; `.tick` 52×52 with the ember fill
   when `.on`; `.drop-add` 40×52, no border; `.drop-row input { height:
   44px; font-size: 16px }`; `.set-head span` in the display face, 11 px,
   uppercase, soft, centred.

**Verify**: `node --check js/app.js`; `node test/unit.js`; `node
test/smoke.js --only "main session" --only "weight drops"` — the row
selectors survive; the 032 section's floor (raised to 44 in Step F).

### Step D — The foot

**Files**: `js/app.js:2857-2862`, `css/style.css:330-351`.

**Change**: the objetivo line (`.ex-est`) stays the card's foot, 13 px in
`var(--signal)` / `var(--amber-ink)` for `.down`; the confidence chip
(`.ex-est-c`) and the note lines (`.ex-est-n`) stay as they are; `.ex-decay`
stays above it; `.ex-parked` stays last. Padding `4px 14px 12px`.

**Verify**: by eye against `opcion4-sesion.png`.

### Step E — `drawCard` and focus

**Files**: `js/app.js:3164-3220`, `:2396-2450`.

**Change**: nothing structural — `drawCard` swaps the card by
`data-ex` and re-applies the focus path. Check `focusPathIn` (`:2408`)
builds its path from tag names and indices, so the new third input keeps
the keyboard's place across a redraw; if it keys on `.fld`, update it.

**Verify**: type in a RIR box, tick the set with the mouse, and confirm
the keyboard focus is still in the box that had it (the
`focusPathIn`/`applyFocusPath` contract).

### Step F — The smoke suite follows the controls

**Files**: `test/smoke.js`.

**Change**: helpers next to `dismissSetup`: `openExMenu(page, index)`
(clicks the card's `.ex-menu-btn`), `moveEx(page, index, dir)` (opens the
menu, clicks `#exMenuUp`/`#exMenuDown`), `openExMore(page, index)` (clicks
`.ex-name-btn`). Then: `:487` `.ex-chart-btn` → `openExMenu` +
`#exMenuChart`; `:2287-2325` `.ex-ord.up/.down` → `moveEx`, and the two
`isDisabled` checks → the menu's buttons' `disabled`; every `.rir-chip`
case → the row's `.rir-in` (`fill('1')` where a chip `'1'` was pressed,
`fill('')` where it was cleared; a `'2+'` press becomes `fill('2')`);
`.ex-setup-btn` → `openExMore`; the 032 section: the set-row floor to
44 (`.set-row input, .tick, .drop-add` heights ≥ 44). New cases in
"nota, energía y control de descarga": the RIR box's placeholder equals
the week's RIR for the seed plan's week 1 (`'3'`); a typed `'1'` survives
a reload; a typed `'7'` is refused (the box stays empty).

**Verify**: `node test/smoke.js --only "main session" --only "orden real"
--only "nota, energía" --only "objetivo de peso" --only "revisión"
--only "weight drops" --only "accesibilidad: tama"` — all green.

### Step G — Bump and document

**Files**: `sw.js:21`, `docs/guide.md:17-27`, `:408-537`, `README.md`.

**Change**: `CACHE_VERSION` → next. The guide's session table: the three
boxes (weight, reps, RIR — the greyed number in each is what the objetivo
asks for that set, the week's RIR in the third; tick without typing and
the set takes the weight, as before), ↓, ✓, the name (tap for the
alternative, the cue and the machine settings), "⋯" (Progreso, mover,
ajustes de máquina, calculadora). § "During the session": the "order you
actually did them in" bullet now says the move is in "⋯"; the "RIR, once
per exercise" bullet becomes "RIR, per set": a digit next to the reps,
optional, the week's target as the placeholder, read by the objetivo per
set (035) and by the Diagnóstico and the review as the last set's; the
"Ajustes, collapsed" bullet: behind the name now. README "What it does":
"RIR and energy chips" → "RIR per set, energy chips".

**Verify**: `node test/unit.js` (docs cross-links).

## STOP conditions

- 035 has not landed (`grep -c "function rowRir" js/app.js` is 0): stop;
  the RIR box has nowhere to write.
- `est.sets[si]` has no rep field (the objetivo returns only weights):
  keep `ex.reps` as the reps placeholder and note it; do not invent a
  target.
- `focusPathIn` keys on `.fld`: update it in Step E before Step C's
  markup lands, or the keyboard loses its place on every tick.
- Any smoke section other than those listed in Step F locates `.ex-ord`,
  `.ex-chart-btn`, `.ex-setup-btn`, `.rir-chip` or `.set-n` (`grep -n` them
  before Step F): add it to the list.

## Test plan

- Unit: `node test/unit.js` unchanged (the card is DOM; the writes it
  makes are 035's, already covered).
- Smoke: the seven sections in Step F; `layout`.
- By hand, both themes: `opcion4-sesion.png` and `opcion4-claro.png` for
  the card; a session with a drop; a card with a long name (two lines,
  no truncation); Escape from the menu.

## Documentation

- `docs/guide.md`: Step G.
- `README.md`: one phrase.
- `plans/README.md`: the status row.

## Done criteria

- [ ] One head row; alt, cue and machine settings behind the name; the
      five actions in "⋯".
- [ ] `kg · rep · RIR` column line; rows without a set number; 52 px
      boxes at 19 px; 52 px tick; 40 px ↓; the next set marked.
- [ ] Placeholders: weight = objetivo, reps = the set's rep target, RIR =
      the week's RIR.
- [ ] The RIR box writes `row.rir` (one digit 0–5) and survives a reload.
- [ ] No RIR chips; `RIR_LABEL` gone.
- [ ] The smoke helpers in place; the seven sections green; the 032 floor
      at 44.
- [ ] `CACHE_VERSION` bumped; the PR gate is green.

## Maintenance notes

- The order arrows went from one tap to two (plans/031 § L5 lists the
  alternatives: 24 px arrows in the row, a long-press, drag). If "the
  machine was taken" turns out to be frequent, the row has 40 px to spare
  where the ↓ sits; a plan can put a 24×24 pair back without touching
  the model.
- L15 (fold a finished card to its head row) is not in this plan; it is a
  small follow-up on `drawCard` once the card shape has settled.
