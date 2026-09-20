# Plan 035: RIR per set — the row carries it, the objetivo prices every set on its own RIR, the signals and exports follow, and the input's contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat efc6eca..HEAD -- js/app.js js/diagnostics.js js/review.js js/qr-transfer.js js/profile-transfer.js js/block-editor.js test/unit.js test/smoke.js docs/guide.md AGENTS.md sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED — a data-model change (the record moves from a parallel
  map onto the log row, with a one-time fold) and a change to what the
  objetivo rule reads per set. Every rule change is covered by the unit
  suite, which already pins the v3 rule with mutation checks (plans 021,
  025, 026); the plan is written so that a log with no per-set values
  reads **exactly** as before, which the existing sections prove. The
  visible UI does not change in this plan: the chip stays as the writer
  for one more plan, and 036 draws the per-set box to the contract in
  Step H.
- **Depends on**: none (independent of 032–034; it edits none of the
  screen). **036 depends on it.** Land it alone in `js/app.js`: it touches
  `exSession`, `targetFor` and the validators plan 025 last fixed.
- **Category**: direction — a feature the maintainer decided to add. The
  sixth pass (plans/030 § "Considered and rejected") recorded per-set RIR
  as "a data-model change to the `rir` map with every reader in tow …
  recorded, not weighed"; this plan takes it, readers included.
- **Planned at**: commit `efc6eca`, 2026-09-20

## Why this matters

RIR is recorded once per exercise per session — "one chip per exercise
per session, not per set (mid-set entry is too much friction)"
(`js/app.js:1612-1620`) — in a parallel map `profile.rir[blockId][slot][exId]`
holding `'2+' | '1' | '0'`, and every reader treats that one value as the
RIR of **every** set of the session:

- `exSession` (`:3675-3699`) computes one `rho` for the session and prices
  every set's capacity with it (`capOf(w, n, rho)`), and censors every set
  on it (`cens: … raw === '2+' || raw == null …`).
- `targetFor` (`:3963-4130`) reads `rhoLast = last.rho` into the one-rep
  gain (`oneRep`, `:4037`), the same-weight floor (`:4102`), the
  `moreRir` note (`:4120`) and the week's fallback RIR (`weekRir`,
  `:3658`).
- The between-set decay `phi[k]` (`:4056-4070`) is a ratio of capacities
  that were all priced on the same RIR — so a session that ran 3 → 2 →
  1 → 0 RIR down its four sets, which is what a well-paced session looks
  like, reads as a lifter who lost far more capacity between sets than
  they did.
- The Diagnóstico's two effort signals (`js/diagnostics.js:701-702`), the
  review's tally (`js/review.js:118-128`) and its AI document line
  (`:198-199`), and the CSV's `rir` column (`js/app.js:5043-5047`, the
  same value on every row of the exercise) all read the one chip.

The maintainer has decided the app records RIR **per set**, typed in a box
next to the reps (option 4's card, `plans/031-mockups/opcion4-sesion.png`:
`kg · rep · RIR`, the week's target RIR as the greyed placeholder). This
plan makes that true end to end:

1. The record moves onto the log row — `{ w, r, done, ts, u, d, dk }` gains
   `rir` — where it travels with every purge, move, share, backup and
   import the row already survives.
2. The objetivo prices every set on its **own** RIR, censors per set, and
   applies the week's stricter-RIR discount per set; the decay term
   `phi[k]` becomes an honest measure of fatigue for a paced session; the
   level's first-set reading is un-censored by a typed first set.
3. The rep-decay line on the card stops guessing when the first set's RIR
   was typed; the Diagnóstico's `decay` signal stops blaming a first set
   the lifter marked easy.
4. The review tallies sets, not sessions; the CSV prints the row's own
   value; a share carries it on the row and still emits the old map for an
   old receiver.
5. The input's contract is fixed here (Step H) so that 036 only draws it:
   one digit 0–5, the week's RIR as placeholder, **never adopted by the
   tick** — an RIR nobody typed is not a measurement.

A log with no per-set values reads exactly as it does today: the
inheritance rule in Step C is the old "one chip for the whole session"
semantics, applied set by set.

## Current state

Files and their roles:

- `js/app.js` — the RIR section (`:1612-1656`: `RIR_OPTIONS`, `RIR_LABEL`,
  `getRir`, `RIR_VALUE`, `rirNumber`, `phaseRir`), `setRir` (`:1805-1811`),
  `purgeRir` (`:1978-1986`), `moveExRir` (`:2043-2045`), `installBlockData`
  (`:146-156`, the map list), `migrate` (`:321-505`, the `rir` map repair at
  `:339`), the chip rendering in `buildExCard` (`:2863`, `:2944-2957`),
  the rep-decay line (`repDecay` `:1585-1597`, its text at `:2866`), the
  constants and their comments (`:3504-3600`, the censoring note at
  `:3546-3560`), `rhoOf` (`:3603`), `capOf`/`repsAt` (`:3607-3612`),
  `weekRir` (`:3658-3664`), `exSession` (`:3675-3699`), `exHistory`
  (`:3850`), `loadLadder` (`:3912`), `capSeq`/`declineAt`/`levelOf`
  (`:3937-3957`), `targetFor` (`:3963-4130`), `brakeOn` (`:4139`),
  `targetNotes` (`:4160`+, the `moreRir` text), `recordTargetOnStart`/
  `recordTarget` (`:3809-3837`), `LOG_LIMITS` (`:4636`), `normalizeImportedLog`
  (`:4852-4894`), `normalizeImportedRir` (`:4896-4924`), `normalizeImportedObj`
  (`:4926-4970`), `blockShareLog`/`blockShareRir` (`:4676`, `:4716`),
  `buildCsv` (`:5013`, the header `:5020`, the RIR column `:5043-5047`, the
  row `:5066`), `setSummary` (`:1899`), `copyPrev` (`:3401`),
  `stampRowUnit` (`:548`, the pattern for a row field written on input).
- `js/diagnostics.js` — `rir: getRir(…)` per session (`:130`), `diagVerdict`
  (`:562-660`: the `failure`, `decay` and `easy` rows at `:578-590`), the
  signals (`:699-712`), the copy at `:587` and `:627`.
- `js/review.js` — the tally (`:118-128`), the AI document lines
  (`:191`, `:198-199`).
- `js/qr-transfer.js` — the `blocklog` payload (`:437`), the receiver
  (`:551`, `:574`). `js/profile-transfer.js` — `normalizeImportedProfile`
  (`:75`; the `rir` map at `:153-154`; the map list at `:205`).
  `js/block-editor.js` — `deleteBlocks`' map list (`:83`),
  `installImportedBlock` (`:378-385`).
- `test/unit.js` — 143 mentions of `rir`; the v3 rule sections from plans
  021, 025 and 026 (search `== ` headings for "objetivo", "v3", "rung",
  "layoff", "brake"); the validator, purge, move and share round-trip
  sections. `test/smoke.js` — 13 mentions, the chips clicked by
  `.rir-chip` (036 changes those).
- `AGENTS.md` § "Where things live" — the per-profile map list.
- `docs/guide.md` — the session table row (`:26`), the bullet "RIR, once
  per exercise" (`:471-479`), and § "The weekly objetivo" (`:585-842`),
  which states the rule in prose: the chip as optional with the
  prescription standing in (`:596`), "What a set is worth — and when it is
  only a floor" (`:615-643`), "One decision per set" with the
  stricter-RIR discount (`:684-720`, `:706`), "The guardrails" (`:802-842`,
  the range-reads-as-its-hard-end rule at `:813-818`).

Excerpt — the model and its readers, `js/app.js:1621-1635`:

```js
const RIR_OPTIONS = ['2+', '1', '0'];
const RIR_LABEL = { '2+': '2+ RIR', '1': '1 RIR', '0': '0 RIR (al fallo)' };

function getRir(profile, blockId, w, dayId, exId) {
  const slotRir = profile.rir[blockId] && profile.rir[blockId][slot(w, dayId)];
  return (slotRir && slotRir[exId]) || '';
}
...
const RIR_VALUE = { '2+': 2, '1': 1, '0': 0 };
const rirNumber = v => (Object.prototype.hasOwnProperty.call(RIR_VALUE, v) ? RIR_VALUE[v] : null);
```

Excerpt — one rho for the session, `js/app.js:3603-3612` and `:3675-3699`:

```js
const rhoOf = raw => { const v = rirNumber(raw); return v == null ? 0 : v; };
const capOf = (w, r, rho) => w * (1 + (r + rho) / EPLEY_A);
const repsAt = (w, cap, rirWeek) => Math.floor(EPLEY_A * (cap / w - 1) - rirWeek + WEIGHT_EPS);
...
function exSession(profile, blockId, week, dayId, exId, lo, hi) {
  ...
  const work = rows.filter(r => r && r.done && rowWeight(r) > 0 && num(r.r) > 0);
  if (!work.length) return null;
  const raw = getRir(profile, blockId, week, dayId, exId) || null;
  const rho = rhoOf(raw);
  const stamps = work.map(r => +r.ts).filter(t => t > 0);
  return {
    blockId: blockId, week: week, dayId: dayId, rir: raw, rho: rho,
    ts: stamps.length ? median(stamps) : 0,
    sets: work.map(r => {
      const w = rowWeight(r), n = num(r.r);
      return { w: w, r: n, e: capOf(w, n, rho), conv: rowUnit(r) !== units(),
               cens: n >= hi || raw === '2+' || raw == null || n > CENSOR_REPS };
    }),
  };
}
```

Excerpt — where the rule reads it, `js/app.js:4032-4037`, `:4056-4070`,
`:4100-4103`, `:4120`:

```js
  const r1Last = last.sets[0].r, rhoLast = last.rho;
  const rirWeek = weekRir(block, ex, week, rhoLast);
  ...
  const oneRep = 1 / (EPLEY_A + r1Last + rhoLast);
  ...
  const obs = {}, upper = {}, allObs = [];
  sessions.slice(-TREND_SESSIONS).forEach(s => {
    for (let k = 1; k < s.sets.length; k++) {
      const a = s.sets[k - 1], b = s.sets[k];
      if (b.cens) continue;
      const ratio = b.e / a.e;
      if (a.cens) (upper[k] = upper[k] || []).push(ratio);
      else { (obs[k] = obs[k] || []).push(ratio); allObs.push(ratio); }
    }
  });
  ...
      if (L && sameLoad(W, L.w)) r = Math.max(r, L.r - Math.max(0, rirWeek - rhoLast));
  ...
  if (rirWeek > rhoLast) notes.push('moreRir');
```

Excerpt — the level reads the first set, `js/app.js:3937-3939`:

```js
function capSeq(sessions) {
  return sessions.map(s => ({ C: s.sets[0].e, cens: s.sets[0].cens }));
}
```

Excerpt — the record, `js/app.js:3827-3835`:

```js
  sl[exId] = { v: 3, at: Date.now(), conf: t.conf, kind: t.kind,
               hold: !!t.hold, brake: !!t.brake,
               sets: t.sets.map(x => ({ w: x.w, r: x.r, m: x.move })) };
```

Excerpt — the Diagnóstico's signals, `js/diagnostics.js:699-703`:

```js
      const sig = {
        easy: recent.filter(p => p.rir === '2+').length >= 2,
        failure: !!last && (last.rir === '0' || forcedDrop(last.rows)),
        decay: !!last && repDecay(last.rows) >= 3,
```

Excerpt — the row validator, `js/app.js:4875-4879`:

```js
      const rows = slotLog[rawExId].slice(0, LOG_LIMITS.rows).map(r => {
        if (!r || typeof r !== 'object' || Array.isArray(r)) return { w: '', r: '', done: false };
        const row = { w: txt(r.w, LOG_LIMITS.val), r: txt(r.r, LOG_LIMITS.val), done: !!r.done };
        if (Number.isFinite(+r.ts) && +r.ts > 0) row.ts = +r.ts;
```

## Steps

### Step A — The row field and its readers

**Files**: `js/app.js:1612-1656`, `:1805-1811`.

**Change**:

1. Constants: `RIR_MAX = 5`. A row's `rir` is a string of one digit
   `'0'..'5'` or absent — the same shape as `r.r` (a string from an
   input, `num()` to read), so `txt()` and `num()` already handle it. Six
   is not a value: past five reps in reserve the number says "easy", which
   `'5'` already says.
2. `rowRir(r)`: the digit as a number, or `null` when absent, empty or
   not a digit.
3. `rirNumber(v)`: accept a digit string `/^[0-5]$/` (→ its number) as
   well as the three legacy chip values (mapping unchanged). Everything
   that compares a raw value goes through it from now on; the only
   remaining string comparisons are in `normalizeImportedRir` (the legacy
   map) and the review's buckets.
4. `sessionRirs(rows)` — the per-set reading with the **inheritance
   rule**: for each working row, its own `rowRir`; a row without one takes
   the value of the nearest **later** row that has one; rows after the last
   typed value get `null`. A set done before a set typed at N RIR had at
   least N in reserve, so pricing it at N under-reads it — the safe
   direction (the censoring note, `:3546-3560`) — and it is exactly what
   the old chip did to every set. A session with no typed value at all
   is all `null`, which is today's "no chip".
5. `getRir(profile, blockId, w, dayId, exId)` becomes the **exercise-level
   compatibility reader**: the `rir` of the last *working* row that has
   one (walk the rows backwards), else the legacy map value, else `''`.
   It returns the digit string or the legacy chip string; callers take a
   number through `rirNumber`. The Diagnóstico and the review keep their
   "the last set" meaning through it.
6. `setRir(...)` (`:1805`): writes onto the row — the last done row of the
   exercise-session, else the last row; `val` is normalised through
   `rirNumber` and stored as its digit (`'2+'` → `'2'`); an empty `val`
   deletes `r.rir`. The map is **never written again**. Rewrite the
   section comment (`:1612-1620`) for the new model: per set, on the row,
   the chip as the fallback for one plan, the inheritance rule and why.

**Verify**: `node --check js/app.js`; `node test/unit.js` — expect the
sections that assert the map is written to fail now (Step I rewrites
them); note which.

### Step B — The fold: chip → row, on load and on import

**Files**: `js/app.js:321-505` (`migrate`), `:146-156` (`installBlockData`).

**Change**: `foldRirMap(profile, blockId)` in `js/app.js` (a symbol both
`migrate` and `installBlockData` read, so it lives here by the split
rules): walk `profile.rir[blockId]` with `forEachSlot`; for each
`[exId, chip]` find `profile.log[blockId][key][exId]`; if it is an array,
take the last done row, else the last row; if that row has no `rir`, set
`row.rir = String(rirNumber(chip))` when `rirNumber(chip) != null`. Leave
the map entry in place (it is the fallback and costs nothing).
Idempotent: a row with `rir` is never overwritten. Skip a malformed
entry rather than throw, like the other repairs. Call it from `migrate`
after the map repair at `:339` for every block, and from
`installBlockData` after the maps are installed (an old phone's QR still
sends the map, `js/qr-transfer.js:437`).

**Verify**: Step I's fold assertions.

### Step C — The objetivo prices every set on its own RIR

**Files**: `js/app.js:3603`, `:3675-3699`, `:3963-4130`, `:3546-3560`.

**Change**:

1. `exSession`: `const rirs = sessionRirs(work);` then per set `k`:
   `rho_k = rirs[k] == null ? 0 : rirs[k]`, `e: capOf(w, n, rho_k)`,
   `cens: n >= hi || n > CENSOR_REPS || rirs[k] == null || rirs[k] >= 2`,
   and keep `rir: rirs[k]` and `rho: rho_k` **on the set**. The session
   keeps `rir`/`rho` as the **last working set's** values (what
   `rhoLast` and the Diagnóstico mean by "the session's RIR"). A session
   whose rows have no `rir` gives every set `null` → rho 0 and censored —
   which is today's reading when there is no chip; a session whose only
   typed value is on the last set gives every set that value — today's
   reading of a chip. So the existing rule sections in `test/unit.js`
   must pass **unchanged** after this step; that is the check that the
   inheritance rule is the old rule.
2. `targetFor`: `rhoLast` stays `last.rho` (the last set's). `oneRep`
   (`:4037`) reads the **first** set: `1 / (EPLEY_A + r1Last +
   last.sets[0].rho)` — it is the first set's rep-equivalent, and the
   last set's RIR was only ever used because it was the only one. The
   same-weight floor (`:4102`) uses the set's own rho: `r = Math.max(r,
   L.r - Math.max(0, rirWeek - L.rho))` — a set that was done at 3 RIR
   last week and is asked for 2 this week gives up nothing, whichever
   the last set did. The `moreRir` note (`:4120`) stays on `rhoLast`: the
   line says what this week asks of the session, and the last set is what
   the person remembers. `weekRir`'s fallback (`:3658-3664`) stays
   `rhoLast`.
3. `phi[k]` (`:4056-4070`): **no code change** — the per-set `e` flows
   through the ratios. Add to its comment what per-set values buy: a
   session run 3 → 2 → 1 → 0 RIR used to read as a 15 % capacity drop by
   set four and now reads as the true fatigue between sets, because each
   `e` is priced at its own reserve; and `upper[k]` (a censored set
   bounding the drop out of it) now applies per set rather than to the
   whole session.
4. `capSeq`/`levelOf` (`:3937-3957`): no code change; note in the comment
   that `sets[0].cens` is now the first set's own state — a typed 0 or 1
   on the first set makes it a reading (the level can move on it), a
   typed 2+ or nothing keeps it a floor — and that `conf`
   (`targetFor`, `:3972-3974`, the count of un-censored first sets) is
   what the person gains by typing the first set's RIR: the confidence
   chip climbs from `baja` to `alta` on the sets that matter most.
5. `recordTarget` (`:3827-3835`): store the week's RIR the target was
   solved for, `rir: t.rirWeek` (a number or `null`), beside `conf` and
   `kind`. The `obj` readout the fifth audit spiked (plans/README.md,
   carried "fifth") needs asked-versus-done RIR to say whether the rule
   was right; without it the record cannot tell a set that missed its
   reps at 0 RIR from one that stopped at 3.
6. The censoring comment (`:3546-3560`) and the section comment
   (`:3504-3535`, "the RIR chip is optional with the week's own
   prescription standing in"): rewrite for per-set values.

**Verify**: `node test/unit.js` — every existing objetivo section passes
with no expected number changed; Step I's per-set cases pass.

### Step D — The rep-decay line stops guessing

**Files**: `js/app.js:1585-1597`, `:2866`.

**Change**: `repDecay(rows)` is unchanged (the drop between the first and
last working set). The text at `:2866` reads the first set's typed RIR
(`rowRir(rows[0])`, own value only — not inherited): `0` → `'⚠ caída de N
reps: primera serie a 0 RIR — las de después se vacían'`; `1` → the same
without the "al fallo" claim; `≥ 2` → `'⚠ caída de N reps con la primera
serie holgada (RIR K): ¿descansos cortos?'`; `null` → today's question
`'¿primera serie al fallo?'`. The flag's job — naming what the decay term
cannot — is unchanged; the person now answers the question by typing.

**Verify**: Step I's text assertions (the line is built from a pure
function of `rows` — factor `decayLine(rows)` out of `buildExCard` so the
unit suite can call it).

### Step E — The Diagnóstico's signals, per set

**Files**: `js/diagnostics.js:130`, `:578-590`, `:699-703`, `:587`, `:627`.

**Change**:

1. `easy`: `recent.filter(p => rirNumber(p.rir) != null && rirNumber(p.rir)
   >= 2).length >= 2` — `p.rir` is the session's last-set value through
   `getRir`, so the meaning holds ("2+ repeated").
2. `failure`: `!!last && (rirNumber(last.rir) === 0 || forcedDrop(last.rows))`.
3. `decay`: `!!last && repDecay(last.rows) >= 3 && !(rowRir(last.rows[0])
   >= 2)` — a first set the lifter typed as 2 or more in reserve is not
   "primera serie al fallo"; the verdict then falls through to the
   work-axis rows (`:598-620`), which is where a session that drains
   without a hard first set belongs ("Se te vacían las series de después.
   Empieza más ligero, o quita una serie…").
4. The copy: `:587` "RIR 2+ repetido" stays; `:627` "Marca el RIR unas
   semanas" → "Apunta el RIR de la última serie unas semanas" (036 makes it
   a box next to the reps).

**Verify**: `node --check js/diagnostics.js`; `node test/unit.js` — the
Diagnóstico sections pass; Step I adds the digit and the `decay` cases.

### Step F — The review tallies sets

**Files**: `js/review.js:118-128`, `:191`, `:198-199`.

**Change**: the per-exercise tally counts **working sets with a typed
RIR** in the block, bucketed `'2+'` (≥ 2), `'1'`, `'0'` through
`rirNumber`, plus `n` (working sets in the block) — read from the rows
(`profile.log`), not from `getRir`. The line (`:198-199`): `'RIR
apuntado: 2+ en 6 series, 1 en 4, 0 en 2 (de 24)'`, or `'RIR apuntado:
ninguno'`. The sentence at `:191` ("cruzan esa tendencia con el RIR
marcado") → "con el RIR apuntado por serie". The review's own copy in
`index.html` (`#reviewSheet`) does not name RIR; check with `grep -n
"RIR" index.html`.

**Verify**: `node --check js/review.js`; Step I's tally case. The unit
suite pins the old line at `test/unit.js:3207` (`review.indexOf('RIR
marcado: 1×1, 0×2') >= 0`): rewrite that pin to the new sentence for the
same fixture (it counts sets now, so the numbers change with the fixture's
rows — derive them, do not guess). `node test/smoke.js --only "revisión
del bloque"` afterwards.

### Step G — Validators, shares, CSV, the record's validator

**Files**: `js/app.js:4852-4894`, `:4896-4924`, `:4926-4970`, `:4676`,
`:4716`, `:5013-5070`; `js/qr-transfer.js:437`, `:551-574`;
`js/profile-transfer.js:153-154`.

**Change**:

1. `normalizeImportedLog`: after `ts`, `if (/^[0-5]$/.test(String(r.rir)))
   row.rir = String(r.rir);` — anything else is dropped, never coerced (a
   `'2+'` on a row is not a row value; the map carries those).
2. `normalizeImportedRir`: unchanged — it validates the legacy map an old
   phone still sends; Step B's fold runs after `installBlockData`.
3. `normalizeImportedObj` (`:4926`): its `keep` object (`:4957-4961`:
   `{ v, at, conf, sets }` plus `kind`/`hold`/`brake` when present) gains
   `if (Number.isInteger(rec.rir) && rec.rir >= 0 && rec.rir <= RIR_MAX)
   keep.rir = rec.rir;` — dropped otherwise, like `kind`.
4. `blockShareRir` (`:4716`): emit the map **derived from the rows** —
   per exercise-session, `getRir`'s last-set value mapped to a chip
   (`0 → '0'`, `1 → '1'`, `≥ 2 → '2+'`) — so an old receiver still gets
   its chip. `blockShareLog` (`:4676`): confirm rows are copied whole; if it
   whitelists fields, add `rir`.
5. `buildCsv` (`:5043-5047`, `:5066`): the `rir` column becomes the row's
   **own typed** value (`r.rir` or `''`), not inherited — the CSV is the
   record as typed; rewrite the comment. The header (`:5020`) is
   unchanged, so a spreadsheet built on it keeps working; the guide's CSV
   note says the column is per set from now on.
6. `js/profile-transfer.js:153-154`: unchanged (the map is still valid
   input; the rows come through `normalizeImportedLog`).

**Verify**: `node test/unit.js` — the validator, share round-trip and CSV
sections, with Step I's additions.

### Step H — The input's contract (drawn by 036)

**Files**: this plan (the contract); `js/app.js:2944-2957` for the interim.

**Change**, for the interim: the chip handler calls `setRir` as today and
reads `getRir` for its pressed state — nothing else. If no set is done,
the chip writes onto the last row; say so in the handler comment.

**The contract 036 implements**, written here because it is logic, not
layout:

1. One box per set, third in the row after weight and reps,
   `inputmode="numeric"`, `maxlength="1"`, `enterkeyhint="done"`; accepts
   one digit `0`–`5` (`e.target.value.replace(/[^0-5]/g, '').slice(0, 1)`),
   anything else is refused as typed.
2. The placeholder is the **week's target RIR for this exercise** —
   `weekRir(block, ex, week, null)` (`:3658`, floored by `ex.minRir`) — as
   a digit, or `'—'` when the phase has no number (a deload). It is the
   same number `targetFor` solved the reps for (`rirWeek`), so the three
   agree by construction: the placeholder, the objetivo line and the
   record.
3. Typing writes `r.rir` on the row at once, `save()`s, and counts as
   starting the session exactly as the weight and rep boxes do
   (`recordTargetOnStart` with `wasSession` read **before** the write,
   `:2996-3005`). Clearing the box deletes `r.rir`.
4. **The tick never adopts the RIR placeholder.** The weight box's
   contract ("tick without typing takes the greyed number", `:3021-3024`)
   does not extend to RIR: a reserve nobody reported is not a measurement,
   and adopting it would un-censor every set of every session — the
   opposite of the censoring rule's safe direction. A set left blank
   stays blank and reads as a floor, as today.
5. "Rellenar con el objetivo" (`copyPrev`, `:3401`) writes weights only.
6. The history bands (`setSummary`, `:1899`) do not print RIR; leave them
   (an option for later: `60×10@2`).
7. Keyboard order weight → reps → RIR → next row; `focusPathIn` keeps the
   place across a redraw (036 checks it keys on tag and index).

**Verify**: `node test/smoke.js --only "nota, energía"` and `--only
"objetivo de peso"` — the sections that press `.rir-chip` still pass, and
a reload keeps the pressed chip (the value now lives on the row).

### Step I — Tests

**Files**: `test/unit.js`, `test/smoke.js`.

**Change**, unit (`== RIR per set (plans/035) ==`):

- `rirNumber('3') === 3`, `rirNumber('2+') === 2`, `rirNumber('x') === null`,
  `rirNumber('6') === null`.
- `sessionRirs`: `[null, null, '1', null]` typed → `[1, 1, 1, null]`;
  nothing typed → all `null`; `['3', null, null, '0']` → `[3, 0, 0, 0]`.
- `setRir` writes `rir` onto the last done row and not into the map; an
  empty value deletes it.
- `getRir` returns the last working row's digit; falls back to the map;
  `''` when neither.
- `foldRirMap`: a `'2+'` chip lands on the last done row as `'2'`; a row
  that already has `rir` is left alone; a second run changes nothing;
  `installBlockData` with a `rir` map folds it.
- `exSession`: sets typed `'3','2','1','0'` → `rho` per set 3/2/1/0, only
  the first two censored (`>= 2`); a session with only the last set at
  `'1'` prices every set at rho 1 and censors none by RIR (the old chip
  reading); no values → all censored, rho 0.
- `targetFor`: (a) a session 60×10@3 · 60×9@2 · 60×8@1 · 60×8@0 has a
  `phi[3]` above the same session read with one rho of 0 (the per-set
  reading sees less fatigue); (b) the same-weight floor: a set done at 3
  RIR asked for 2 this week keeps its reps even when the last set was at
  0; (c) `oneRep` uses the first set's rho (mutation check: swap it back to
  `rhoLast` and one assertion fails); (d) every pre-existing objetivo
  assertion unchanged.
- `capSeq`/`levelOf`: a first set typed `'1'` un-censors the level; typed
  `'2'` keeps it a floor; `conf` climbs with typed first sets.
- `recordTarget` stores `rir`; `normalizeImportedObj` keeps `3`, drops
  `'x'` and `9`.
- `decayLine`: the four texts for first-set RIR 0 / 1 / 3 / none.
- Diagnóstico signals: `easy` counts a `'3'` row like a `'2+'` chip;
  `failure` fires on `'0'` either way; `decay` does not fire when the
  first set is typed `'2'` and does when it is `'0'` or blank.
- The review tally counts sets and prints `(de N)`.
- `normalizeImportedLog` keeps `'4'`, drops `'2+'`, `'7'`, `7`, `''`.
- `buildCsv` prints the row's own `rir` per set and `''` where nothing was
  typed; a folded legacy chip appears on its last row only.
- The share round-trip carries `rir` on the rows and `blockShareRir` emits
  a map derived from them.

Smoke: none new here — the chips are unchanged and the existing sections
that press them are the regression check; 036 adds the box cases (the
placeholder equals the week's RIR; a typed `'1'` survives a reload; `'7'`
is refused; **ticking a set leaves the RIR box empty**).

**Verify**: `node test/unit.js` — the new section prints its assertions;
the count of `passed` grows by at least 30 with 0 failed, and no existing
objetivo expectation was edited (`git diff test/unit.js` shows additions
only, apart from the sections Step A broke on purpose).

### Step J — Bump and document

**Files**: `sw.js:21`, `AGENTS.md`, `docs/guide.md:471-479`, `:585-842`,
the CSV note in `docs/guide.md` (search `nota` / `energia` columns).

**Change**: `CACHE_VERSION` → next. AGENTS.md "Where things live": the
map list sentence gains "`rir` is legacy since plan 035: read as a
fallback, never written; the record is `row.rir` on the log row, so it
travels with every purge, move and share the row does". The guide:

- `:471-479` ("RIR, once per exercise"): one sentence now — the value is
  stored per set from this release, and the chip writes it onto the last
  set (036 rewrites the bullet for the box).
- § "The weekly objetivo": `:596` ("the RIR chip is optional with the
  week's own prescription standing in") → the RIR typed per set, optional,
  the prescription standing in; § "What a set is worth — and when it is
  only a floor" (`:615-643`): a set is a floor when it ended at the top of
  the range, ran past twelve reps, was typed at 2 or more in reserve, or
  has nothing typed — and a set with nothing typed takes the reserve of
  the next set that has one, which is what the old chip did to every set;
  a new short paragraph on what typing the **first** set's RIR buys (the
  level reads it, the confidence chip climbs) and what pacing a session
  down its sets now reads as (fatigue measured honestly); § "One decision
  per set" (`:706`): the stricter-RIR discount is per set; § "The
  guardrails" (`:808`, `:813-818`): unchanged in substance, "chip" → "the
  RIR you typed". § "The block review" (`:1261`, "the RIR chips you
  tapped") → "the RIR you typed on each set". The CSV note (`:471-479`
  says the value "shows up as its own column"): the `rir` column is the
  set's own typed value, blank where nothing was typed; older rows carry
  the chip on the session's last set.

**Verify**: `node test/unit.js` (docs cross-links).

## STOP conditions

- An existing objetivo assertion in `test/unit.js` changes its expected
  number after Step C: the inheritance rule is not reproducing the old
  reading; find the case before continuing — a log with no per-set values
  must read exactly as before.
- `blockShareLog` whitelists row fields and the list is mirrored by a
  validator: add `rir` to both and report the pair.
- `migrate` has a version gate that would skip the fold on
  already-migrated data: put the fold in the "always" branch — it is
  idempotent and cheap, and the fallback read means a skipped fold is not
  data loss.
- `js/qr-transfer.js`'s receiver has its own row whitelist: add `rir`
  there and report.
- A test other than `test/unit.js:3207` pins the `RIR marcado` text
  (`grep -n "RIR marcado" test/`): update that pin in Step F as well
  rather than keeping the old line anywhere.

## Test plan

- Unit: Step I, plus every existing section (`node test/unit.js` must
  stay at 0 failed throughout, and the objetivo sections unedited).
- Smoke: `nota, energía y control de descarga`, `objetivo de peso y
  diagnóstico`, `revisión del bloque`, `block delete purges
  rir/notes/energy/order` (rows purge with the log; the map purge is
  unchanged).

## Documentation

- AGENTS.md: the map list sentence.
- `docs/guide.md`: Step J; 036 rewrites the session bullet for the box.
- `plans/README.md`: the status row.

## Done criteria

- [ ] `row.rir` is the record: written by `setRir`, read by `rowRir` /
      `sessionRirs` / `getRir`, folded from the map on load and on
      import, validated on import, carried by shares, printed per set in
      the CSV, kept in the objetivo record with the week's RIR.
- [ ] `exSession` prices and censors per set with the inheritance rule;
      `oneRep` and the same-weight floor read the set's own rho; `phi[k]`
      and the level read per-set capacities with no code change.
- [ ] A log with no per-set values reads exactly as before — every
      pre-existing objetivo assertion unchanged.
- [ ] The rep-decay line states what the first set's RIR says; the
      Diagnóstico's `decay` signal does not blame a first set typed easy.
- [ ] The review tallies sets; the document line says so.
- [ ] The map is never written; `getRir` is the fallback reader.
- [ ] The input contract in Step H is what 036 implements, including
      "the tick never adopts the RIR".
- [ ] Unit section green (≥ 30 assertions); the four smoke sections green.
- [ ] `CACHE_VERSION` bumped; the PR gate is green.

## Maintenance notes

- Two things the per-set values make possible and this plan does not do,
  because each needs a decision about the rule rather than a reader: the
  decay term could weight a set's ratio by how far its typed RIR sits
  from the week's target (a set held back on purpose is not fatigue), and
  the `obj` readout (the fifth-audit spike) can now compare asked and done
  RIR per set. Both are one plan each once a block of per-set data exists
  to test them on.
- `RIR_OPTIONS` and `RIR_LABEL` stay until 036 removes the chip; after
  036 they serve only `normalizeImportedRir`, `blockShareRir`'s legacy map
  and the review's buckets.
