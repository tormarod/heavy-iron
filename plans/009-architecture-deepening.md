# 009 — Architecture deepening: seven shallow seams, ranked

Generated 2026-09-18 against commit `6def9fc` (the merge of PR #76), from an
architecture walk that used the `/codebase-design` vocabulary: a **module** is
anything with an interface and an implementation; its **interface** is
everything a caller must know (signature, ordering, invariants, required
globals), not just the type-level surface; a module is **deep** when a lot of
behaviour sits behind a small interface and **shallow** when the interface is
nearly as complex as the implementation. The aim of every item is **locality**
(bugs, change and tests concentrate in one place) and **leverage** (one
implementation pays back across N callers). Every claim below was verified by
reading the cited code; item 1 was reproduced.

> **Executor instructions**: work one item per pull request, in the order of
> the table. Run every verification command and confirm the result before
> the next step. If a **STOP if** condition occurs, stop and report — do not
> improvise. When an item lands, update the status in the table below *and*
> the row for 009 in `plans/README.md`.
>
> **Drift check (run first, per item)**: `git diff --stat 6def9fc..HEAD -- <the item's files>`.
> If an in-scope file changed since this plan was written, compare the cited
> lines against the live code before proceeding; on a mismatch, grep for the
> function named and re-anchor, or treat it as a STOP.

Health baseline at `6def9fc`: `node --check` clean on all thirteen scripts,
`node test/unit.js` 177/177.

## What this plan does not do

These are settled in `AGENTS.md` and `plans/008` and are not reopened here:

- No build step, no bundler, no ES modules. Thirteen `<script>` tags, one
  global scope, fixed order.
- The five `app.js` seams of plans/008 item 13 and its two rules: **(a)** a
  symbol `app.js` itself reads stays in `app.js` or is stubbed there;
  **(b)** a symbol another split file reads stays in `app.js` outright.
  **No item below moves a symbol out of `app.js`.** Where an item adds a
  function, it adds it *to* `app.js`, because a split file will read it.
- The incremental `drawCard` of item 14. Item 7 here is its residue only.
- The log's on-disk shape. `'w' + w + '-' + dayId` and the four maps' nesting
  stay exactly as they are; item 2 changes who *knows* the shape, not the
  shape.

## Execution order

Items in one tier are independent unless a **Depends on** line says
otherwise. Items 1–5 each touch `js/`, so each bumps `CACHE_VERSION` in
`sw.js` (currently `v55`, line 21; CI enforces it). Land them sequentially —
they will all conflict on that one line, and 2 → 5 → 4 also share code.

| # | Title | Strength | Effort | Risk | Depends on | Status |
|---|-------|----------|--------|------|------------|--------|
| 1 | Deepen the sheet module (fixes: Escape dead on two sheets) | Strong | S | LOW | — | TODO |
| 2 | Collapse the three set-volume implementations | Strong | S | LOW | — | TODO |
| 3 | Pin the shell list and the storage key with two unit assertions | Worth exploring | S | LOW | — | TODO |
| 4 | Give the log a module: `parseSlot` and `forEachSlot` | Strong | M | MED | — | TODO |
| 5 | One write path for imported rows; name the persist-and-redraw pair | Worth exploring | S | LOW | 4 | TODO |
| 6 | One entry point per accepted import shape; write down the rule-(a) exception | Worth exploring | M | MED | 5 | TODO |
| 7 | Put `drawCard`'s positional contract in its interface | Speculative | S | LOW | deferred — see trigger | DEFERRED |
| 8 | Re-anchor the four drifted line references in `AGENTS.md` | housekeeping | XS | — | fold into item 1's PR | TODO |

---

## 1. Deepen the sheet module

**Strength: Strong · Effort S · Risk LOW · fixes a live, user-visible bug**

### Evidence

- `js/app.js:1938` — `SHEET_IDS` lists nine ids: `setupSheet, sheet,
  planSheet, blocksSheet, importSheet, chartSheet, calcSheet, volumeSheet,
  qrSheet`.
- `index.html` has twelve elements with a `…Sheet` id. `diagSheet` and
  `reviewSheet` are not in `SHEET_IDS`, yet both open through `openSheet`
  (`js/diagnostics.js:905`, `js/review.js:279`).
- `js/app.js:1959-1969` — the only `Escape` handler filters `SHEET_IDS` for
  the open one. **Escape therefore does nothing on the diagnostics sheet or
  the block-review sheet.** Neither file has its own `keydown` handler
  (grep: none). Reproduced by reading; the smoke suite presses Escape at
  `test/smoke.js:644, 947, 974, 984, 2813`, none of them on these two sheets,
  which is why it shipped.
- `js/app.js:1965-1968` — closing with teardown is an if-chain: `planSheet →
  closePlanEditor`, `setupSheet → closeSetup`, `qrSheet → closeQr`.
  `closeReview` (`js/review.js:282-287`) is a fourth teardown (it runs
  `reviewAfterClose`) with no branch; registering `reviewSheet` in the array
  alone would make Escape skip that callback.
- `js/app.js:1939, 1942, 1956` — `sheetReturn` is a single slot, not a
  stack. `qrSheet` opens on top of `sheet` (`js/qr-transfer.js:302`; the
  comment at `:1935-1937` acknowledges nesting). Opening `qrSheet` overwrites
  the element that opened `sheet`; `closeQr` restores it and nulls the slot;
  closing `sheet` afterwards returns focus nowhere.
- Eight copies of the same two lines of backdrop-click and close-button
  wiring: `js/block-editor.js:968-970` and `:979-981`, `js/calculator.js:154-155`,
  `js/chart.js:271-272`, `js/diagnostics.js:910-911`,
  `js/profile-transfer.js:407-409`, `js/review.js:290-291`,
  `js/volume-sheet.js:227-228`.

**The interface as it really is:** call `openSheet(id)`/`closeSheet(id)`,
*and* add the id to `SHEET_IDS` at the right index, *and* add a branch to the
Escape if-chain if closing needs teardown, *and* copy the backdrop/close
pair, *and* never open one sheet over another except the one case the
comment blesses. Four of those five are unwritten. Deletion test:
`openSheet`/`closeSheet` earn their keep (focus-return would reappear at
eleven callers) but they are under-deep: they hide focus return and nothing
else.

### Design

One registration per sheet, made from the file's own `wire*()` (so
AGENTS.md's "DOM wiring stays in the file's `wire*()`" rule holds), and a
stack inside `app.js`:

```js
/* ---------- sheets ---------- */
const sheets = Object.create(null);   // id -> { onClose }
const sheetStack = [];                // [{ id, returnTo }], bottom to top

/* Each file registers its sheet from its own wire*(). `closeBtn` and the
   backdrop click are wired here so the pair exists once; `onClose` is the
   teardown Escape must run instead of a bare closeSheet (closePlanEditor,
   closeSetup, closeQr, closeReview). */
function registerSheet(id, opts) {
  const o = opts || {};
  sheets[id] = { onClose: o.onClose || null };
  const close = () => (o.onClose ? o.onClose() : closeSheet(id));
  if (o.closeBtn) $(o.closeBtn).onclick = close;
  $(id).addEventListener('click', e => { if (e.target.id === id) close(); });
}

function openSheet(id) {
  sheetStack.push({ id: id, returnTo: document.activeElement });
  /* …existing body… */
}

function closeSheet(id) {
  $(id).classList.remove('up');
  const i = sheetStack.map(s => s.id).lastIndexOf(id);
  const entry = i < 0 ? null : sheetStack.splice(i, 1)[0];
  const back = entry && entry.returnTo;
  if (back && back.isConnected && back.focus) back.focus();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (askResolve) { closeAsk($('askInput').hidden ? false : null); return; }
  const top = sheetStack[sheetStack.length - 1];
  if (!top) return;
  const reg = sheets[top.id];
  if (reg && reg.onClose) reg.onClose(); else closeSheet(top.id);
});
```

`SHEET_IDS` and the if-chain are deleted. A sheet that is opened without
having been registered (a precache hole where the split file is missing —
AGENTS.md's stuck-shell scenario) still opens and still closes on Escape
with the default `closeSheet`; `openSheet` must not require registration.
Nothing new is read by `app.js` from a split file, so rule (a) is
untouched.

### Steps

1. In `js/app.js`, replace the sheets section (`:1931-1969`) with the
   design above. Keep the two existing comments (keyboard usability;
   `isConnected` reasoning at `:1952-1954`). Verify: `node --check js/app.js`.
2. In each of the eight `wire*()` functions, replace the backdrop/close pair
   with one call. The teardown ones:
   - `js/block-editor.js` — `registerSheet('planSheet', { onClose: closePlanEditor })`
     (its close button is already wired to `closePlanEditor`; check `:940-941`
     and drop the duplicate), `registerSheet('blocksSheet', { closeBtn: 'blkClose' })`,
     `registerSheet('importSheet', { closeBtn: 'importClose' })`.
   - `js/review.js:290-291` — `registerSheet('reviewSheet', { onClose: closeReview })`
     (close button and backdrop both already call `closeReview`; `registerSheet`
     wires them, delete the two lines).
   - `js/qr-transfer.js` — `registerSheet('qrSheet', { onClose: closeQr })`;
     check how its close button is wired today (`:310-313` and the wire
     function) and route it through `onClose`.
   - `js/app.js` setup sheet — `registerSheet('setupSheet', { onClose: closeSetup })`
     next to where `closeSetup` is wired (`:1063-1071`).
   - The plain ones: `calcSheet`/`calcClose`, `chartSheet`/`chartClose`,
     `diagSheet`/`diagClose`, `volumeSheet`/`volumeClose`, `sheet`/`bClose`.
   Verify: `node --check` on each file; `node test/unit.js` (the harness
   runs the `wire*()` tail against its inert DOM stub at `test/unit.js:26-37`;
   if `registerSheet` throws there because `addEventListener` is missing on
   the stub, extend the stub, not the function).
3. Add the unit assertion that makes the original bug impossible to ship
   again: read `index.html`, collect every `id="…"` on an element with
   `class="sheet"` (confirm the class name in `css/style.css`; `askSheet` is
   the `ask` dialog and is excluded by name), and assert that after
   `loadApp()` every one of them is a key of `sheets`. If the harness does
   not reach the `wire*()` tail (check whether `load()` runs in `loadApp()`),
   assert against the set of `registerSheet('…')` literals grepped from
   `js/*.js` instead — the point is one place that fails when a sheet is
   added without registering.
4. Smoke, targeted: in the `'objetivo de peso y diagnóstico'` section (`test/smoke.js:1547`)
   open Diagnóstico, press Escape, assert the sheet is down; same in
   `'revisión del bloque'` (`:2666`) and assert the after-close callback
   still ran where it is exercised. Add one nested case in `'main session'`
   near `:2813`: open the backup sheet, open QR over it, Escape twice, assert
   focus is back on the footer button that opened the backup sheet.
   Verify: `node test/smoke.js --only "diagnóstico" --only "revisión" --only "main session"`.
5. Bump `CACHE_VERSION` to `v56`. Fold item 8 into this PR.

### STOP if

- Any sheet is opened by something other than `openSheet` (grep
  `classList.add('up')`): it would bypass the stack. At `6def9fc` there is
  none outside `openSheet`.
- `closeSetup` or `closeQr` is called from a path that never opened the
  sheet, so the stack lookup finds nothing — the design tolerates it (no
  entry → no focus return), but check `:1063` and `:1071` both being
  reachable from one open.

---

## 2. Collapse the three set-volume implementations

**Strength: Strong · Effort S · Risk LOW**

### Evidence

- `js/app.js:1626-1630` — `setVolume(r)`: ticked set × reps, plus
  `dropVolume`, raw weights.
- `js/diagnostics.js:64-74` — `diagSetVolume` and `js/review.js:35-45` —
  `reviewSetVolume` are **byte-identical** (`diff` after renaming: no
  output). Each reads weights through `rowWeight`/`convertWeight` so a block
  that changed unit mid-way does not sum kg and lb.
- Three comment paragraphs explain the same rule: `js/app.js:3529-3533`,
  `js/diagnostics.js:60-63` (and again at `:115-116`), `js/review.js:27-34`.
- `js/app.js:3534` — `blockTonnageByWeek(profile, block, volumeOf)` already
  takes the choice as a parameter. `js/review.js:53` passes
  `reviewSetVolume`; `js/volume-sheet.js:87` passes nothing (raw, correct
  for the session view); `js/diagnostics.js:125` does not use it at all and
  reduces with its own copy.
- `test/unit.js:841-848` already asserts the raw/converted distinction
  through `blockTonnageByWeek` — the test surface exists.

Deletion test: the two copies fail it outright. Delete them and nothing
reappears; the parameter at `:3534` was the seam and two of three callers
walked past it. Rule (b) pins the arithmetic in `app.js` (block-editor,
diagnostics, review, volume-sheet all read it); this item deletes copies,
it does not move the original.

### Design

```js
/* Kilos moved by one logged set … (existing comment, plus the one
   paragraph about units that today lives in three files):
   `converted` reads each weight through rowWeight/convertWeight, for a
   view that spans sessions which may have been logged in different
   units — the block review and diagnostics. The session view and the
   volume dashboard show one session in the unit it was logged in and
   pass nothing. */
function setVolume(r, converted) { … }
const setVolumeConverted = r => setVolume(r, true);
```

`dropVolume` gets the same flag, because the copies convert drop weights
too (confirm by reading `:64-74` before touching anything).

### Steps

1. Read the two copies against `setVolume`+`dropVolume` and list every line
   that differs (expected: only the weight reads). Fold the difference into
   `app.js` as the `converted` flag. Verify: `node --check js/app.js`.
2. Delete `diagSetVolume` and `reviewSetVolume`; replace their call sites
   (`js/diagnostics.js:125`, `js/review.js:53, 109`) with
   `setVolumeConverted`. Delete the three explanatory paragraphs and leave
   one, on `setVolume`. Update `js/app.js:3529-3533` to point at the flag.
3. `test/unit.js:841-848`: rename `reviewSetVolume` → `setVolumeConverted`.
   Add one assertion that `setVolume(r)` and `setVolume(r, true)` agree on a
   row logged in the current unit and differ on a row logged in the other,
   with a drop on it — the drop path is the one the copies could have
   diverged on. Verify: `node test/unit.js`.
4. Smoke, targeted: `node test/smoke.js --only "revisión" --only "diagnóstico" --only "volumen"`.
5. Bump `CACHE_VERSION`.

### STOP if

- The two copies turn out **not** to be identical to each other after all
  at HEAD (they are at `6def9fc`), or differ from `setVolume` in anything
  other than the weight read — then there is a third rule nobody wrote
  down; find it before collapsing.

---

## 3. Pin the shell list and the storage key with two unit assertions

**Strength: Worth exploring · Effort S · Risk LOW · no `CACHE_VERSION` bump (test-only)**

### Evidence

- The shell file list exists in five places: `index.html:24-36` (script
  tags), `sw.js:32-57` (`SHELL`), `test/unit.js:64-68` (`loadApp()`),
  `AGENTS.md:24-36`, the README layout table.
- `.github/workflows/test.yml:92-102` checks exactly one relation: every
  `js/*.js` and `css/*.css` is named in `SHELL`. **Nothing checks that
  `index.html`'s script order equals `loadApp()`'s order**, and order is the
  property AGENTS.md's whole "no modules" section exists to protect.
- `js/theme-init.js:19` — `localStorage.getItem('heavy-iron-v1')`: the
  storage key as a literal, in the one file that by design may share nothing
  with `app.js` (`STORAGE_KEY`, `js/app.js:1`). The comment at `:17-18` says
  a renamed key "silently brings back the flash … with nothing to catch the
  drift." This is the catch.

Deletion test does not apply to a checklist; the duplication fails it
(four of the five lists reappear as a hand-maintained edit list in
`AGENTS.md:68-73`).

### Design

Two assertions in `test/unit.js`, next to `loadApp()` so the list is
adjacent to the check:

1. Parse `index.html` for every `<script src="…">` in document order (the
   `<head>` one first). Assert it equals the `loadApp()` array exactly.
   Assert the same set (order-insensitive) equals `SHELL ∩ js/` in `sw.js`,
   by regex on the `const SHELL = [` block the CI step already parses.
2. Regex the literal out of `js/theme-init.js` and assert it equals
   `STORAGE_KEY` read from the vm context after `loadApp()`.

### Steps

1. Hoist the `loadApp()` file list to a named constant so the assertion can
   reference it. Add the two assertions. Verify: `node test/unit.js` passes
   at 179/179; then temporarily swap two entries in `index.html` and confirm
   it fails; revert.
2. Note in `AGENTS.md`'s "No modules" section, one sentence: the script
   order is asserted by `test/unit.js`, so a new file goes in
   `index.html` and `loadApp()` in the same position or the unit suite fails.

### STOP if

- `index.html` gains a script tag that is intentionally not in `loadApp()`
  (a vendor script, an inline-only loader). At `6def9fc` the thirteen tags
  and the thirteen entries match one to one; if they stop matching on
  purpose, make the exclusion explicit in the assertion rather than
  loosening it.

---

## 4. Give the log a module: `parseSlot` and `forEachSlot`

**Strength: Strong · Effort M · Risk MED · the most locality to gain in the repo**

### Evidence

- `js/app.js:103` — `const slot = (w, dayId) => 'w' + w + '-' + dayId`.
  Building a key is centralised: 38 call sites in `app.js`, 2 in `chart.js`.
- Reading one back is not. Eleven hand-rolled parses of the same regex, in
  five files, three of them split files:
  `js/app.js:1678` (`weeksBeyondEnd`), `:3540` (`blockTonnageByWeek`),
  `:4070` (`normalizeImportedLog`), `:4113` (`normalizeImportedRir`),
  `:4140` (`normalizeImportedOrder`); `js/chart.js:95`;
  `js/diagnostics.js:99, 177, 366`; `js/review.js:101, 118`.
- `js/app.js:1691-1694` (`purgeExLog`), `:1699-1702` (`purgeDayLog`),
  `:1710-1717` (`purgeSessionMeta`), `:1722-1730` (`purgeRir`),
  `:1748-1766` (`moveExKeyed`) — five walks that loop `w = 1..MAX_WEEKS`
  (`:399`, 16) reconstructing every *possible* key instead of iterating the
  keys that *exist*. Sixteen lookups per call for an eight-week block, and
  silently blind to any key above 16 (a hand-edited or older backup).
- `:1710` can iterate `[notes, energy, order]` as a set because they are
  `blockId → slotKey → value`; `rir` is `blockId → slotKey → exId → value`
  and needs `purgeRir` on its own (`:1719-1721` explains this). The
  "parallel maps" of plans/002 are parallel in three of four cases, and the
  fourth breaks every loop that treats them uniformly.

Deletion test: a log module earns its keep loudly — delete it and eleven
regexes plus five near-identical walks reappear across five files.

### Design

Added to `app.js` next to `slot` (rule (b): `chart.js`, `diagnostics.js`
and `review.js` read it, so it cannot live anywhere else):

```js
/* The mirror of slot(): the one place that knows the key's shape. Every
   reader that used to run /^w(\d+)-(.+)$/ by hand calls this instead, so the
   shape can change in two lines rather than eleven regexes in five files. */
function parseSlot(k) {
  const m = /^w(\d+)-(.+)$/.exec(k);
  return m ? { week: +m[1], dayId: m[2] } : null;
}

/* Walk the slots that exist in one block of one of the four maps, in no
   particular order. `fn(key, week, dayId, value)`; `filter` narrows by
   dayId and/or week. Iterating the keys that are there, rather than
   rebuilding every possible one up to MAX_WEEKS, is what lets purge mean
   "all of it" for a block longer than the cap ever allowed. */
function forEachSlot(map, blockId, fn, filter) { … }
```

Then: the five purge/move walks become `forEachSlot(profile.log, blockId,
…, { dayId })`, with `rir`'s extra level handled in `purgeRir` as today
(the module knows the shape; it does not flatten it). The eleven regex
sites call `parseSlot`. `weeksBeyondEnd` and `blockTonnageByWeek` iterate
with `forEachSlot`.

Not in scope: changing the key format, restructuring `rir`, a migration.

### Steps

1. Add `parseSlot` and `forEachSlot` with unit tests first: round trip with
   `slot`; a non-matching key returns `null`; `forEachSlot` with a `dayId`
   filter visits exactly the matching keys including one at `w17`. Verify:
   `node test/unit.js`.
2. Replace the five walks (`:1691-1766`). Add a unit test that
   `purgeDayLog` on a block holding a `w17-d1` key removes it — this is an
   intended behaviour change from "silently left behind" and the test
   documents it. The existing `'block delete purges rir/notes/energy/order'`
   smoke section (`test/smoke.js:1477`) is the outer gate.
3. Replace the eleven regex sites, one file per commit inside the PR:
   `app.js`, then `chart.js`, `diagnostics.js`, `review.js`. After each:
   `node --check`, `node test/unit.js`.
4. Smoke, targeted: `--only "block delete" --only "el mismo ejercicio" --only "revisión" --only "índice de fuerza" --only "frecuencia"`.
5. Bump `CACHE_VERSION`. Add `parseSlot`/`forEachSlot` to AGENTS.md's
   "Untrusted input" neighbour paragraph or a new one-liner under "Where
   things live": *the log key shape is known by `slot`/`parseSlot` only*.

### STOP if

- Any reader depends on the *order* the `1..MAX_WEEKS` loop produced
  (`forEachSlot` walks `Object.keys`, insertion order). `moveExKeyed`
  concatenates arrays per week, not across weeks, so it should not; confirm
  by reading `:1748-1766` before replacing it.
- A regex site parses something that is *not* a slot key (check each of the
  eleven; `normalizeImported*` at `:4070-4140` parse the *sender's* keys,
  which are the same shape by construction — `blockShareLog` at `:3912`
  builds them with `slot`).

---

## 5. One write path for imported rows; name the persist-and-redraw pair

**Strength: Worth exploring · Effort S · Risk LOW · Depends on: 4**

### Evidence

- `js/app.js:1399-1570` — a complete accessor vocabulary for the parallel
  maps: `getRir/setRir` (`:1399, 1565`), `getNote/setNoteText` (`:1443, 1448`),
  `getEnergy/setEnergy` (`:1473, 1478`), `getOrder/setOrder` (`:1511, 1517`),
  `rowsFor/entry` (`:1318, 1334`). Each enforces something: `ORDER_LIMIT`
  at `:1521`, delete-on-empty at `:1455, 1484, 1523`, `Object.create(null)`
  at `:1329`.
- Both import paths write straight past it, whole maps at a time:
  `js/block-editor.js:338-340` (`profile.log[block.id] = log; …rir…; …order…`)
  and `js/profile-transfer.js:131-162` (`p.log[bk] = …`, `p.rir[bk]`,
  `p.notes[bk]`, `p.energy[bk]`). Safe today only because the
  `normalizeImported*` functions re-implement the guards on their side; the
  invariant that the two write vocabularies agree is enforced nowhere.
- `save(); render();` appears fifteen times across `js/app.js`,
  `js/block-editor.js`, `js/profile-transfer.js` (grep). Forget `save()` and
  the change is on screen and not on disk (plan 006 fix 1 was exactly this
  bug, three times); forget `render()` and the reverse. Nothing names the
  pair.

Deletion test: the accessors earn their keep. The friction is that they
are optional.

### Design

In `app.js`, in the log module item 4 created:

```js
/* The one way imported rows reach a profile. Both import paths (a pasted
   or scanned block, a restored profile) used to assign the four maps by
   hand, each relying on normalizeImported* having already applied the
   guards the accessors apply — two write vocabularies that had to agree
   by convention. Now there is one. */
function installBlockData(profile, blockId, data /* {log, rir, order, notes, energy}, each optional */) { … }

/* Persist and redraw, as one word, so a mutation that must do both cannot
   forget half. Navigation-only changes still call render() alone. */
function commit() { save(); render(); }
```

`installBlockData` does the assignment in one place, with `safeKey` on
`blockId` and the same `Object.create(null)` discipline `rowsFor` uses.

### Steps

1. Add `installBlockData` with a unit test: install `{log, rir}` for a block
   id and read back through `rowsFor`/`getRir`; install with `blockId
   === '__proto__'` and assert nothing is written (the plans/008 item 2
   class of bug).
2. Replace `js/block-editor.js:338-340` and `js/profile-transfer.js:131-162`'s
   assignments with one call each. Verify: `node test/unit.js`;
   `node test/smoke.js --only "profile import" --only "main session"`.
3. Replace the fifteen `save(); render();` sites with `commit()`. This is
   mechanical; do it in its own commit so the diff is reviewable as a
   rename. Leave `stopRest(); save(); render();` as `stopRest(); commit();`.
4. Bump `CACHE_VERSION`.

### STOP if

- A `save(); render();` site has something *between* the two calls, or
  relies on `render()` throwing into recovery before `save()` ran (`:2208`
  area) — read each of the fifteen before replacing.

---

## 6. One entry point per accepted import shape; write down the rule-(a) exception

**Strength: Worth exploring · Effort M · Risk MED · Depends on: 5**

### Evidence

- The import vocabulary has three owners chosen by where the *screen* went,
  not by what the vocabulary is:

  | Symbol | Defined in | Read from |
  |---|---|---|
  | `normalizeImportedBlock` | `js/block-editor.js:218` | `js/app.js:985`, block-editor, profile-transfer, qr-transfer |
  | `importIdMaps`, `normalizeImportedLog/Rir/Order` | `js/app.js:4045, 4064, 4107, 4134` | app, `js/profile-transfer.js:131-137`, `js/qr-transfer.js:537-538` |
  | `normalizeImportedProfile`, `ownGet` | `js/profile-transfer.js:71, 75` | profile-transfer |
  | `txt`, `safeKey`, `IMPORT_LIMITS`, `LOG_LIMITS` | `js/app.js:2056, 2073, 2054, 3864` | five files |
  | `buildAiPrompt` | `js/block-editor.js:411` | block-editor, `js/review.js:310` |

- **The ordering contract lives in prose** (`js/app.js:4030-4044`): call
  `normalizeImportedBlock` first and *keep its return value* because it
  renames ids; then `importIdMaps(raw, normalized)`; then each
  `normalizeImported{Log,Rir,Order}(rawMap, rawBlock, normalized)`.
  `js/qr-transfer.js:531-538` and `js/profile-transfer.js:128-140` each
  re-implement the sequence.
- **Two tolerated violations of AGENTS.md's split rules.** Rule (a): `js/app.js:985`
  reads `normalizeImportedBlock` from `block-editor.js` with no stub. Rule
  (b): `js/review.js:310` reads `buildAiPrompt` from `block-editor.js`, a
  split file reading a split file. Both are tolerated because
  `wireBlockEditor()` and `wireProfileTransfer()` are called **unguarded**
  (`js/app.js:4231, 4248`; the comment at `:4232-4235` says the other seven
  are guarded "because these seven files are newer") — i.e. `data.js`,
  `block-editor.js` and `profile-transfer.js` are treated as part of the
  original shell. **AGENTS.md's rules do not say so.**

Deletion test: the family earns its keep emphatically (four caller files,
security-critical). It has no seam.

### Design

Two changes, one of them to prose:

1. `AGENTS.md`, under the two split rules: *"`js/data.js`, `js/block-editor.js`
   and `js/profile-transfer.js` predate the split and are precached in
   every deployed shell, so rules (a) and (b) treat a symbol defined in them
   as if it were in `app.js`. That is why their `wire*()` calls are
   unguarded."* One sentence; it records what the code already assumes.
2. In `app.js`, beside `importIdMaps` (rule (b): two split files read it):

```js
/* The whole accept sequence for a block that arrives with its rows — a
   scanned QR, a restored profile's block. Callers used to run the four
   steps themselves, in the order the comment above describes; a caller
   that forgot to keep the *normalized* block re-keyed rows to ids that no
   longer existed. Throws with a Spanish message on refusal, like
   normalizeImportedBlock does. */
function acceptBlockWithLog(rawBlock, rawMaps /* {log, rir, order} */) {
  const block = normalizeImportedBlock(rawBlock);
  return {
    block: block,
    log:   rawMaps.log   ? normalizeImportedLog(rawMaps.log, rawBlock, block)     : null,
    rir:   rawMaps.rir   ? normalizeImportedRir(rawMaps.rir, rawBlock, block)     : null,
    order: rawMaps.order ? normalizeImportedOrder(rawMaps.order, rawBlock, block) : null,
  };
}
```

`acceptBlock(raw)` is just `normalizeImportedBlock` and needs no alias.
`normalizeImportedProfile` stays in `profile-transfer.js` (one caller) and
calls `acceptBlockWithLog` per block. The result feeds
`installBlockData` from item 5, so an import is: accept → install → commit.

Not in scope: moving `normalizeImportedBlock` or `buildAiPrompt`. The
AGENTS.md sentence makes their current homes legal; moving them is a
separate judgement.

### Steps

1. Write the AGENTS.md sentence. No code, no bump; can go in item 1's PR.
2. Add `acceptBlockWithLog` with a unit test that mirrors the existing
   `normalizeImportedLog` tests through the new entry point: a block whose
   duplicate exercise id gets renamed, rows keyed by the sender's id, assert
   the rows land under the renamed id (the "first occurrence wins" rule at
   `:4038-4044`).
3. Replace the sequence at `js/qr-transfer.js:531-538` and
   `js/profile-transfer.js:128-140` with one call each. Keep each caller's
   own error message wrapping (`profile-transfer` prefixes the block name).
   Verify: `node test/unit.js`; `node test/smoke.js --only "profile import" --only "main session"`.
4. Bump `CACHE_VERSION`.

### STOP if

- `normalizeImportedProfile` needs the raw *and* normalized maps for
  something other than the three `normalizeImported*` calls (read
  `:71-162` fully) — then the entry point's return shape is wrong, not the
  caller.

---

## 7. Put `drawCard`'s positional contract in its interface

**Strength: Speculative · Effort S · Risk LOW · DEFERRED**

### Evidence

- `js/app.js:2415` — `buildExCard(ctx, ex, i)` writes `dayCards[i] = stat`
  as a side effect, by index. `drawCard` (`:2698-2755`) passes
  `sessionEx[i]` and `i` so the write replaces rather than appends, which is
  what keeps `drawSessionFoot`'s sum (`:2763-2769`) from double-counting.
  Verified correct at `6def9fc`.
- What a caller must know that the signature does not say: build `ctx`
  with exactly `{profile, block, day, days, sessionEx, best}` (`:2738-2741`),
  where `best` comes from `bestForExercise` for one card but
  `bestByExercise` for the full draw; pass an `i` that is the exercise's
  index in both `sessionEx` and `dayCards`; call `resetRenderCache()` first
  (`:2730`); then update the three things the comment at `:2708-2716`
  lists. Item 14 wrote (the last) down. The others are not written.

Deletion test: `drawCard` earns its keep — it *is* item 14. The residue is
one documented-only invariant with one caller and a smoke gate.

### Trigger

Do this the day a **second** card-local redraw path is added (a handler
that wants to redraw one card without going through `drawCard`). Until
then, one caller plus the `'main session'` smoke section is enough, and
the change is churn in the file the last two audits spent most of their
time in.

### Design, when triggered

`buildExCard` returns `stat` and stops writing `dayCards`; `drawApp`'s
loop and `drawCard` store it. `resetRenderCache()` moves inside
`buildExCard`'s callers' one shared entry. No new public name.

---

## 8. Re-anchor the four drifted line references in `AGENTS.md`

**housekeeping · fold into item 1's PR · no bump**

`AGENTS.md`'s stated purpose (`:7-11`) is that a session "stops re-deriving
the same handful of invariants." Four of its pointers moved when the five
seams were cut and were not re-anchored:

| AGENTS.md says | At `6def9fc` |
|---|---|
| `wire*()` tail at `js/app.js:5437` | `js/app.js:4231` |
| `IMPORT_LIMITS` at `js/app.js:2284` | `js/app.js:2054` |
| `esc` at `js/app.js:32` | `js/app.js:35` |
| `normalizeImported*` reference impl at `js/block-editor.js:207` | `js/block-editor.js:218` |

Also re-check the README "Project layout (~line 1599)" pointer. Prefer
naming the function over the line where a grep target exists — the
document already says "grep for if they drift" elsewhere.

---

## Cross-check against plans/008

| 008 item | Relation to this plan |
|---|---|
| 13 (split app.js) | Rules (a)/(b) constrain every item here; item 6 writes down the exception the split already relies on. Nothing is moved out of `app.js`. |
| 14 (drawCard) | Done; item 7 is its residue and is deferred behind a trigger. |
| 5 (SHELL check in CI) | Item 3 closes the other half: order, and the storage-key literal. |
| 4 (profile-restore validation) | Item 6's entry point is the seam that item 4 made shared; it changes call shape, not validation. |
| 2 (`__proto__` ids) | Item 5's `installBlockData` gets a unit test for the same class of key. |
| 21 (test-suite structure, bullet 2 open) | Unchanged. Items 1 and 3 add unit assertions, per AGENTS.md's "prefer that side of the line". |

## What was checked and is not friction

Recorded so the next review does not re-walk it:

- **Recovery is local.** `frozen` is declared and read only in `app.js`
  (`:442, 505, 559, 1112`); `showRecovery` (`:1111`) is called from five
  `app.js` sites and nowhere else. Deep and local; nothing to do.
- **Storage is behind one seam.** `localStorage` is touched at six sites,
  all in `app.js` (`:117, 130, 510, 626, 1167, 1187`), all behind
  `readRaw`/`writeState`/`logBytes`/`showRecovery`. `writeState`
  (`:504-520`) hides `frozen`, `held`, `pruneLog`, the quota toast and the
  status line behind one call. The single exception is `theme-init.js:19`,
  which item 3 pins.
- **`test/unit.js` reaches past no interface** because there is none to
  reach past: `vm.runInContext` over one global scope (`test/unit.js:80`)
  is the honest consequence of thirteen scripts sharing a scope. The gap is
  not the harness; it is the four assertions items 1 and 3 add.
