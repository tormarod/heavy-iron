# Plan 011: Every cross-session reader converts kg/lb per row, and the CSV is safe to open in a spreadsheet

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6def9fc..HEAD -- js/chart.js js/volume-sheet.js js/review.js js/diagnostics.js js/app.js test/unit.js sw.js README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none. **Overlap**: `plans/009-architecture-deepening.md`
  item 2 also collapses the three set-volume copies, as a `converted` flag
  on `setVolume` plus `const setVolumeConverted = r => setVolume(r, true)`.
  If it has landed, skip Step 1 and use `setVolumeConverted` wherever this
  plan says `convertedSetVolume`.
- **Category**: bug + security (export boundary)
- **Planned at**: commit `6def9fc`, 2026-09-18

## Why this matters

Every logged set is stamped with its unit when it was not kg (`r.u === 'lb'`),
and the helpers `rowUnit`, `rowWeight`, `convertWeight` exist so a screen
that draws one line through many sessions can convert instead of blending.
The last audit (plans/008 item 9) wired that into Diagnóstico and the block
review, and scoped itself to those two. Three readers were left out and
still read `num(r.w)` raw:

- the per-exercise **progress chart** (`js/chart.js`), including the
  "todos los bloques" view, while labelling the axis "en kg";
- the **tonnage tile** on the volume dashboard (`js/volume-sheet.js`),
  which sums two units into one number and prints it through `fmtKg`;
- the **CSV export** (`js/app.js`), which puts the current unit in the
  header and raw mixed numbers under it.

After a mid-block unit switch, or a profile restored from a partner who
lifts in the other unit, the chart draws a 2.2× step that never happened.

Two neighbours ride along because they touch the same lines:

- `diagSetVolume` (`js/diagnostics.js:64`) and `reviewSetVolume`
  (`js/review.js:35`) are byte-identical copies of the unit-converting
  volume rule; the tonnage tile needs a third caller. One shared function
  in `js/app.js` replaces both.
- `csvCell` does not guard against spreadsheet formula interpretation. Block,
  day, exercise and profile names come from imports and can start with
  `=`, `+`, `-` or `@`; the export is explicitly meant to travel ("a coach's
  inbox", per its own comment). Prefixing such cells is the standard fix.

## Current state

- `js/app.js:424-435` — the unit helpers:
```js
const LB_PER_KG = 1 / 0.45359237;
function convertWeight(v, fromUnit, toUnit) {
  if (!isFinite(v) || fromUnit === toUnit) return v;
  return fromUnit === 'kg' ? v * LB_PER_KG : v / LB_PER_KG;
}
const rowUnit = r => (r && r.u === 'lb') ? 'lb' : 'kg';
function rowWeight(r, toUnit) {
  return convertWeight(num(r && r.w), rowUnit(r), toUnit || units());
}
```
- `js/app.js:1626-1630` — `setVolume(r)`, the *raw* rule the session view
  uses on purpose (do not change it):
```js
function setVolume(r) {
  if (!r || !r.done) return 0;
  const w = num(r.w), reps = num(r.r);
  return ((isNaN(w) || isNaN(reps)) ? 0 : w * reps) + dropVolume(r);
}
```
- `js/app.js:1635` — `const fmtKg = n => Math.round(n).toLocaleString('es-ES') + ' ' + units();`
- `js/app.js:3534-3535` — `blockTonnageByWeek(profile, block, volumeOf)` with
  `const vol = volumeOf || setVolume;` — already takes the converter as a parameter.
- `js/review.js:35-45` — `reviewSetVolume(r)`; `js/diagnostics.js:64-74` —
  `diagSetVolume(r)`. `diff` of the two bodies shows only the function name
  differs. `js/review.js:53` passes `reviewSetVolume` into `blockTonnageByWeek`.
- `js/volume-sheet.js:87` — `const byWeek = blockTonnageByWeek(profile, block);`
  (no converter → raw).
- `js/chart.js:25-35` — `bestSet` compares `num(r.w)` / `est1RM(num(r.w), num(r.r))`;
  `:37-49` `collectHistory`, `:56-73` `collectHistoryDays`, `:93-112`
  `collectHistoryAll` each filter with
  `r.done && r.w !== '' && r.w != null && !isNaN(num(r.w))` and push
  `weight: num(best.w)`. `:216-217` and `:246-247` label the series with
  `units()`.
- `js/app.js:4163-4166` — `csvCell`:
```js
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
```
- `js/app.js:4169` — header row includes `units()` as the weight column
  name; `:4205-4207` pushes `r.w` raw and the drops as `d.w + 'x' + d.r`.
- `test/unit.js:801-830` — `== unit-stamped rows: diagnostics and the review
  convert instead of blending kg/lb (plans/008 item 9) ==` — the fixture
  pattern to reuse: week 1 logged `{ w: '100', r: '5', done: true }`, week 2
  `{ w: '220.462262185', r: '5', done: true, u: 'lb' }`, then assert the
  reader returns `[100, 100]` in kg.

Conventions: AGENTS.md rule "a symbol another split file reads stays in
`app.js` outright" — so the shared volume function goes in `js/app.js`, not
in one of the split files. Comments explain *why*. Strings shown to users
are Spanish.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `for f in js/*.js sw.js test/*.js; do node --check "$f"; done` | exit 0 |
| Unit tests | `node test/unit.js` | `N passed, 0 failed` (177 at `6def9fc`) |
| One smoke section | `BASE=http://127.0.0.1:8765 node test/smoke.js --only "<substring>"` | `… passed, 0 failed` |

Smoke prerequisites (once): `npm install --no-save playwright@1.56.1 && npx playwright install chromium`, then `python3 -m http.server 8765 &`.

## Scope

**In scope**:
- `js/app.js` — add `convertedSetVolume` next to `setVolume`; `csvCell`, `buildCsv`
- `js/chart.js` — read weights through `rowWeight`
- `js/volume-sheet.js` — pass the converter
- `js/review.js`, `js/diagnostics.js` — delete the local copies, call the shared one
- `test/unit.js` — new assertions
- `sw.js` — `CACHE_VERSION` bump
- `README.md` — only if it documents the CSV column list (check with `grep -n "perfil" README.md`); update the column names to match

**Out of scope**:
- `setVolume` itself and every session-view reader (the card, the footer
  totals, the previous-week line) — the session view shows numbers as typed,
  by design (see the comment above `rowWeight`).
- `targetEstimate` / `copyPrev` — same reason; they read one session's own
  history.
- The unit switch in Ajustes, `stampRowUnit`, `migrate()`.

## Git workflow

- Branch: `claude/011-units-everywhere-and-csv-boundary`
- Commit per step; one imperative sentence per message.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: One shared converting volume function

In `js/app.js`, directly after `setVolume` (line ~1630), add:

```js
/* setVolume with every weight read through rowWeight(): a block trained
   partly in kg and partly in lb — a mid-block unit switch, or a backup
   restored from a partner on the other unit — would otherwise be summed in
   two units at once. Used by every screen that adds up more than one
   session (diagnostics, the block review, the tonnage tile); the session
   view keeps setVolume, raw, on purpose — see rowWeight's comment. A drop
   shares its row's unit stamp; drops have none of their own. Lived as two
   identical copies in js/diagnostics.js and js/review.js until plans/011. */
function convertedSetVolume(r) {
  if (!r || !r.done) return 0;
  const toUnit = units();
  const from = rowUnit(r);
  const w = convertWeight(num(r.w), from, toUnit), reps = num(r.r);
  const dropsVol = dropsOf(r).filter(dropUsed).reduce((t, d) => {
    const dw = convertWeight(num(d.w), from, toUnit), dr = num(d.r);
    return t + ((isNaN(dw) || isNaN(dr)) ? 0 : dw * dr);
  }, 0);
  return ((isNaN(w) || isNaN(reps)) ? 0 : w * reps) + dropsVol;
}
```

Then delete `reviewSetVolume` from `js/review.js` (lines 28-45, the comment
and the function) and `diagSetVolume` from `js/diagnostics.js` (the
equivalent block ending at line 74), and replace every call:
`grep -n "reviewSetVolume\|diagSetVolume" js/*.js` lists them; each becomes
`convertedSetVolume`. Keep a one-line comment at each former definition
site pointing at `convertedSetVolume` in `js/app.js`.

**Verify**: `grep -n "reviewSetVolume\|diagSetVolume" js/*.js` → 0 matches.
`node test/unit.js` → the plans/008 item 9 section still passes.

### Step 2: The tonnage tile converts

In `js/volume-sheet.js:87`:
`const byWeek = blockTonnageByWeek(profile, block, convertedSetVolume);`
with a short comment: the tile adds up every week of the block, so it is a
cross-session reader like the review, not like the card.

**Verify**: `node --check js/volume-sheet.js` → exit 0.

### Step 3: The chart converts

In `js/chart.js`:
- `bestSet`: compare `est1RM(rowWeight(r), num(r.r))` and `rowWeight(r) > rowWeight(best)`.
- In `collectHistory`, `collectHistoryDays`, `collectHistoryAll`: the filter
  becomes `r && r.done && r.w !== '' && r.w != null && !isNaN(rowWeight(r))`
  and the pushed value `weight: rowWeight(best)`.

Add one comment at `bestSet` explaining that the chart is a line through
many sessions and therefore converts, unlike the card. The axis labels at
`:216-217` and `:246-247` already say `units()`, which is now true.

Check the e1RM path: `e1rmValue(p)` (grep it in `js/chart.js`) reads
`p.weight`, which is now converted; no change needed there.

**Verify**: `node --check js/chart.js` → exit 0.

### Step 4: The CSV states the unit per row and guards formula cells

In `js/app.js`:

- `csvCell`: before the quoting rule, guard formula-leading text:
```js
function csvCell(v) {
  let s = String(v == null ? '' : v);
  /* A cell starting with = + - @ (or a tab/CR) is a formula to Excel,
     LibreOffice and Sheets. Names in this file come from imported blocks
     and profile files, so the file that travels to a coach must not be
     able to carry one. A leading apostrophe is the conventional way to say
     "text" — spreadsheets hide it. Logged numbers never start with these. */
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
```
- Header (`:4169`): replace `units()` with `'peso'` and insert `'unidad'`
  directly after it.
- Row (`:4205-4207`): after `r.w`, push `rowUnit(r)`. Keep `r.w` and the
  drops as typed (the unit column says what they are in). Add a comment:
  the row keeps the number as typed so it matches the card; the new column
  is what makes two units in one file readable.

If `README.md` lists the CSV columns (check `grep -n "perfil" README.md`),
update that list to add `unidad` and rename the weight column.

**Verify**: `node --check js/app.js` → exit 0.

### Step 5: Tests

Extend the `== unit-stamped rows …` section in `test/unit.js` (after line
~830, before the next `console.log('\n== `) with probes modelled on
`diagUnitProbe`:

1. `collectHistory(profile, blockId, day.id, exId, 8, 'weight')` on the
   kg/lb fixture → `points.map(p => Math.round(p.weight*100)/100)` equals
   `[100, 100]`.
2. `blockTonnageByWeek(profile, block, convertedSetVolume)` on the same
   fixture → weeks 1 and 2 both `500` (100 × 5), and with `setVolume` the
   raw week 2 is `≈ 1102.3` (documents why the converter matters).
3. `convertedSetVolume({ w: '220.462262185', r: '5', done: true, u: 'lb' })`
   with `state.prefs.units = 'kg'` → `≈ 500`.
4. `csvCell('=SUM(A1)')` → `"'=SUM(A1)"`; `csvCell('-5')` → `"'-5"`;
   `csvCell('60')` → `'60'`; `csvCell('a;b')` → `'"a;b"'`.
5. `buildCsv()` header (first line, after the BOM) contains `,peso,unidad,`.

Restore `state.prefs.units` to `'kg'` at the end, as the existing probes do.

**Verify**: `node test/unit.js` → `N passed, 0 failed`, N ≥ 185.

### Step 6: Bump the cache version

`sw.js`: `CACHE_VERSION` `'v55'` → `'v56'` (or one higher than `main`).

### Step 7: Targeted browser check

`BASE=http://127.0.0.1:8765 node test/smoke.js --only "volumen"` and
`--only "progreso"` (or whichever section names `grep -n "await section('" test/smoke.js`
shows for the volume sheet and the chart).

**Verify**: `… passed, 0 failed` for each.

## Test plan

See Step 5. Existing gates: the plans/008 item 9 section (`test/unit.js:801`),
`== diagnostics statistics ==`, and the smoke sections for the chart and
the volume sheet.

## Done criteria

- [ ] `for f in js/*.js sw.js test/*.js; do node --check "$f"; done` exits 0
- [ ] `node test/unit.js` → `0 failed`, N ≥ 185
- [ ] `grep -n "reviewSetVolume\|diagSetVolume" js/` → 0 matches
- [ ] `grep -c "rowWeight" js/chart.js` → ≥ 4
- [ ] `grep -n "convertedSetVolume" js/volume-sheet.js js/review.js js/diagnostics.js` → 3 files match
- [ ] `grep -n "'unidad'" js/app.js` → 1 match
- [ ] `sw.js` `CACHE_VERSION` differs from `main`
- [ ] `git status` shows only in-scope files

## STOP conditions

- `rowWeight` / `rowUnit` / `convertWeight` are not at `js/app.js:424-435`
  or have a different signature.
- `diff <(sed -n 64,74p js/diagnostics.js) <(sed -n 35,45p js/review.js)`
  shows more than the function-name line differing — the two copies have
  diverged and someone must decide which is right.
- A chart smoke section fails after Step 3 on something other than a
  numeric label.
- The README documents a CSV consumer that depends on the exact column
  order (a script, a sheet template). Report before changing the header.

## Maintenance notes

- Three volume functions remain by design: `setVolume` (raw, session
  view), `convertedSetVolume` (cross-session), and `dropVolume` (used by
  `setVolume`). A future bodyweight/assisted-exercise feature (see
  plans/README.md direction notes) will touch `convertedSetVolume` and the
  chart filter's `> 0` assumptions; this plan does not add any.
- Reviewer: check that no session-view reader (`buildExCard`,
  `drawApp`'s footer totals, `targetEstimate`) started calling `rowWeight`.
- Deferred: the review prompt text (`js/review.js:149-201`) interpolates
  imported names into a document meant for an LLM without delimiting them;
  recorded in plans/README.md as a small follow-up.
