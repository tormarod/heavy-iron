# Plan 044: The Diagnóstico's effort signals read every set's RIR — the session's typical reserve, not its last set — and the verdict asks for the RIR of each set

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 18fbd92..HEAD -- js/diagnostics.js js/app.js test/unit.js docs/guide.md`
> `js/app.js` and `test/unit.js` are expected to have changed (plans 039 and
> 038 land there) — check only that the symbols this plan calls still exist
> with the signatures quoted under "Current state". If `js/diagnostics.js`
> changed, compare every excerpt against the live code before proceeding;
> if `diagPoints` no longer walks `profile.log` itself, see the first STOP
> condition — it is an adaptation, not a stop.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED — the two signals drive the `lectura`/`cambio` prose the
  Diagnóstico shows and the block review exports into the AI prompt. Every
  existing verdict case is pinned in `test/unit.js` and stays green by
  construction (the inheritance rule keeps a session typed only on its
  last set reading as before); the new behaviour is pinned by three new
  cases written to fail first.
- **Depends on**: **plan 039** (hard — it adds `legacyRir` to `js/app.js`,
  the only correct fallback for a session logged before plan 035).
  Coordinates with plan 038's PR 4, which moves `diagPoints` onto
  `sessionsOf`; this plan is written for the code before that PR and says
  what changes if it has landed.
- **Category**: bug (a reading the data model outgrew)
- **Planned at**: commit `18fbd92`, 2026-09-21

## Why this matters

Since plan 035 every set carries its own RIR. The block review reads them
per set ("RIR apuntado: 3 en 4 series, 2 en 7 series (de 11)"). The
Diagnóstico still reads **one number per session** — `getRir`, the last
working set that carries a value — and its two effort signals reason over
that number:

- `failure` (→ "Fatiga, no falta de esfuerzo · Mismo peso, vuelve a 1–2
  RIR") fires when that one number is 0;
- `easy` (→ "Falta intensidad — RIR 2+ repetido · Sube carga o reps")
  fires when it is 2 or more in two of the last three sessions.

So a session paced 3 → 2 → 1 → 0 — the shape a well-run session has, one
set to failure at the end — and a session ground out at 0, 0, 0, 0 are the
same session to this screen: both "fatigue", both told to back off to 1–2
RIR. The review, one tap away, shows them as different. And the screen's
own fallback verdict asks the lifter to "apunta el RIR de la última serie",
the narrow signal the data model replaced.

The fix is to hand the signals the session's **per-set array** and reduce
it with the median: the typical set's reserve. Three properties make that
the right reduction here:

1. **A log typed the old way reads exactly as before.** `sessionRirs`
   fills every untyped set with the reserve of the next typed one, so a
   session with only its last set typed at 0 becomes `[0, 0, 0]`, median
   0, `failure` — precisely what the one chip meant. Every existing pinned
   verdict stays green without edits.
2. **A paced session stops reading as fatigue.** `[3, 2, 1, 0]` has median
   1.5: neither `failure` nor `easy`, and the verdict falls through to the
   work-axis rows, which is where a session that did its job belongs.
3. **A session mostly held back reads as easy.** `[3, 3, 3, 0]` has median
   3: three of four sets with three in reserve is a lack of intensity,
   whatever the last set did.

It is the same array plan 038's `sessionsOf` interface guarantees for a
working set ("`sessionRirs` over the working sets, the legacy chip as the
fallback"), so when 038's PR 4 moves this screen onto that reader the
reduction stays and only the line that builds the array changes.

Vocabulary (`CONTEXT.md`): a **working set** is a set ticked done with a
weight and a rep count; a **session** is everything one lift was logged
with in one slot.

## Current state

All excerpts at `18fbd92`.

- `js/diagnostics.js` — `diagPoints` (`:73`) builds one point per session;
  `diagVerdict` (`:565`) turns a trend and the signals into prose;
  `diagRows` (`:671`) builds the signals at `:699-714`.
- `js/app.js` — `sessionRirs` (`:1731`), `rirNumber` (`:1783`),
  `rowRir` (`:1716`), `rowWorked` (`:1724`), `forcedDrop` (`:2122`),
  `median` (`:4259`), and — **once plan 039 has landed** — `legacyRir`
  (added beside `getRir`, `:1765`).
- `test/unit.js` — the `diagProbe` fixture (`:2231-2259`) and the three
  verdict cases that use it (`:2261-2275`).
- `docs/guide.md` — the Diagnóstico's verdict table (`:1149-1162`).

The point, with the one-number reading:

```js
// js/diagnostics.js:122-133 — inside diagPoints
        const worked = rows.filter(r => r && r.done && hasReps(r) && rowWeight(r) > 0);
        out.push({
          label: block.name + ' · S' + w,
          e1rm: est1RM(rowWeight(best), num(best.r)),
          weight: rowWeight(best),
          reps: num(best.r),
          vol: worked.reduce((t, r) => t + convertedSetVolume(r), 0),
          sets: worked.length,
          ts: rows.reduce((t, r) => (r && r.done && r.ts > t ? r.ts : t), 0),
          rir: getRir(profile, bId, w, s.dayId, exId),
          rows: rows.filter(r => r && r.done),
        });
```

Its header comment says what the field is:

```js
// js/diagnostics.js:63-68
/* Every session this exercise was logged in, oldest first, as one e1RM
   point each. Modelled on collectHistoryAll(), but it keeps what the charts
   have no use for and the diagnosis does: which rows the point came from
   (for rep decay and forced drops), the RIR of its last working set — the
   session's own reading, see getRir — and the timestamp, so a gap between
   sessions can be told from a gap in progress.
```

The signals:

```js
// js/diagnostics.js:699-707 — inside diagRows
      const last = points[points.length - 1];
      const recent = points.slice(-3);
      const sig = {
        /* Read through rirNumber since plans/035, so a typed '3' counts the
           same as the old '2+' chip did and a typed '0' the same as the old
           '0'. `p.rir` is the session's last working set (getRir), which is
           what "the session's RIR" has always meant on this screen. */
        easy: recent.filter(p => rirNumber(p.rir) >= 2).length >= 2,
        failure: !!last && (rirNumber(last.rir) === 0 || forcedDrop(last.rows)),
```

`p.rir` has no other reader in the repo (`grep -n "\.rir\b" js/diagnostics.js`
→ only these two lines and `:131`). The `decay` signal at `:714` reads the
rows directly and is not this plan's business (plan 041 touches it).

The verdicts that consume them, and the fallback sentence:

```js
// js/diagnostics.js:579-590
    if (sig.failure) {
      return { lectura: 'Fatiga, no falta de esfuerzo',
               cambio: 'Mismo peso, vuelve a 1–2 RIR. Apretar más es la palanca equivocada aquí.' };
    }
    if (sig.decay) { … }
    if (sig.easy) {
      return { lectura: 'Falta intensidad — RIR 2+ repetido',
               cambio: 'Sube carga o reps: te estás dejando el estímulo sin usar.' };
    }
// js/diagnostics.js:627-628
    return { lectura: 'Estancado, sin una señal clara en el registro',
             cambio: 'Apunta el RIR de la última serie unas semanas: sin eso no se puede distinguir fatiga de falta de intensidad.' };
```

The helpers in `js/app.js` this plan calls (all readable from
`js/diagnostics.js` — a symbol another split file reads lives in `app.js`,
AGENTS.md rule 2, and `sessionRirs`/`median` already do):

```js
// js/app.js:1731-1739
function sessionRirs(rows, legacy) {
  const out = (rows || []).map(rowRir);
  if (out.length && legacy != null && !out.some(v => v != null)) out[out.length - 1] = legacy;
  let carry = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] == null) out[i] = carry; else carry = out[i];
  }
  return out;
}
// js/app.js:4259-4263
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
```

Plan 039 adds, beside `getRir`:

```js
function legacyRir(profile, blockId, w, dayId, exId) {
  const slotRir = profile.rir && profile.rir[blockId] && profile.rir[blockId][slot(w, dayId)];
  return (slotRir && slotRir[exId]) || '';
}
```

The unit fixture the new cases copy — three sessions of one exercise, each
`[reps, rir]` per set, `useMap` puts the last set's value in the legacy
map instead of on the row:

```js
// test/unit.js:2261-2271
const decaySess = (first, last) => [[12, first], [10, null], [8, last]];
const easySess = last => [[12, null], [11, null], [11, last]];
const three = f => [f, f, f];
ok('easy counts a typed 3 exactly as the old 2+ chip did',
   diagProbe(three(easySess('3')), false) === 'flat | Falta intensidad — RIR 2+ repetido' &&
   diagProbe(three(easySess('2+')), true) === 'flat | Falta intensidad — RIR 2+ repetido',
   diagProbe(three(easySess('3')), false));
ok('failure fires on a 0 typed on the row and on the legacy chip alike',
   diagProbe([easySess(null), easySess(null), easySess('0')], false) === 'flat | Fatiga, no falta de esfuerzo' &&
   diagProbe([easySess(null), easySess(null), easySess('0')], true) === 'flat | Fatiga, no falta de esfuerzo',
   diagProbe([easySess(null), easySess(null), easySess('0')], false));
```

The guide's table rows this changes:

```markdown
<!-- docs/guide.md:1152, 1154, 1158 -->
| plano | RIR 0, o una bajada forzada | Fatiga, no falta de esfuerzo | Mismo peso, vuelve a 1–2 RIR. Apretar más es la palanca equivocada |
| plano | RIR 2+ repetido | Falta intensidad | Sube carga o reps: te dejas el estímulo sin usar |
| plano | ninguna | Estancado sin señal clara | Apunta el RIR de la última serie unas semanas — sin eso no se distingue fatiga de falta de intensidad |
```

Conventions: comments explain *why* and name the bug (the comment at
`js/diagnostics.js:702-705` is the one this plan rewrites); Spanish for
everything a user sees; unit assertions are `ok(name, cond, extra)` over
`call(...)` expressions; the guide documents every user-facing behaviour
and its reason.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/diagnostics.js` | exit 0 |
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed` — **read N before Step A and count in deltas** (770 at `18fbd92`; plans 038–043 are adding assertions concurrently) |
| One smoke section (optional; Playwright + server on :8765) | `node test/smoke.js --only "objetivo de peso"` | every line `PASS` |
| Bump | `bash tools/bump-cache-version.sh` | `vN -> vN+1` (`v89 -> v90` at `18fbd92`) |

Install and server one-liners are in `README.md` § "Tests". The full smoke
suite runs by itself when the pull request is opened.

## Scope

**In scope**:
- `js/diagnostics.js` — the point's `rir` field and header comment, a new
  `diagSessionRir` helper, the `easy`/`failure` lines and their comment,
  the fallback `cambio` sentence.
- `test/unit.js` — new cases beside `diagProbe`.
- `docs/guide.md` — three table cells and one paragraph after the table.
- `sw.js` — the `CACHE_VERSION` bump.
- `plans/README.md` — your status row.

**Out of scope**:
- `js/app.js` — nothing to add; `legacyRir` comes from plan 039 and
  `median`/`sessionRirs` exist.
- `js/review.js` — its per-set tally is the reading this plan matches; its
  export of `lectura`/`cambio` picks up the change through `diagRows`.
- The `decay` signal (`js/diagnostics.js:714`) — plan 041.
- The verdict *prose* beyond the one sentence named: which coaching a
  paced-but-flat session deserves ("the effort was right; change the
  stimulus") is a maintainer call recorded under Maintenance notes.
- `getRir` and its second pass — the screens that print "the session's
  RIR" on an untouched day still need it.

## Git workflow

- Branch: `claude/044-diagnostico-per-set-rir`
- One commit per step, plain-sentence messages
  (`Plan 044 Step B: the effort signals read the session's typical set`).
- Do NOT push or open a PR unless the operator instructed it. Rebase on
  `main` first (038 and 039 land in `js/app.js` and `sw.js`); take the
  higher `CACHE_VERSION` on conflict.

## Steps

### Step A: Pin the new reading with cases that fail today

In `test/unit.js`, directly after the `decay no longer blames…` assertion
(`:2272-2275`, the last user of `diagProbe`), add:

```js
/* Per set, reduced by the median — the session's typical reserve
   (plans/044). A log typed the old way, one value on the last set, still
   reads through the inheritance rule as it always did (the two cases
   above pin that); these pin what the per-set record can say that one
   number could not. */
/* Reps held at the top of the range on purpose: a set at the bottom of the
   range at 0 RIR can make the objetivo come down a rung, and the "Peso mal
   elegido" row is checked before either signal — these cases are about
   the signals, not the rule. */
const pacedSess = () => [[12, '3'], [12, '1'], [12, '0']];
ok('a session paced 3 → 1 → 0 is not fatigue: its typical set had a rep in reserve',
   diagProbe(three(pacedSess()), false) ===
     'flat | Estancado de verdad — ni la serie tope ni los kilos por serie se mueven',
   diagProbe(three(pacedSess()), false));
const groundSess = () => [[12, '0'], [11, '0'], [11, '0']];
ok('...a session ground out at 0 on every set still is',
   diagProbe(three(groundSess()), false) === 'flat | Fatiga, no falta de esfuerzo',
   diagProbe(three(groundSess()), false));
const heldSess = () => [[12, '3'], [12, '3'], [11, '0']];
ok('...and a session held back on most sets reads as lacking intensity whatever the last set did',
   diagProbe(three(heldSess()), false) === 'flat | Falta intensidad — RIR 2+ repetido',
   diagProbe(three(heldSess()), false));
```

**Verify**: `node test/unit.js` → `N passed, 2 failed` with N unchanged
from your first run. The first and third new cases both print `flat |
Fatiga, no falta de esfuerzo` (the last set's 0 is all the old reading
sees); the second (ground out) already passes. Nothing else fails.

### Step B: The point carries the per-set array; the signals read its median

In `js/diagnostics.js`:

1. Replace the header comment's clause at `:66-67` — "the RIR of its last
   working set — the session's own reading, see getRir —" — with "the RIR
   of every working set, inherited the way the objetivo reads it (see
   sessionRirs) —".

2. In `diagPoints`, replace the line `rir: getRir(profile, bId, w,
   s.dayId, exId),` (`:131`) with:

```js
          /* Per set since plans/044, and exactly the array the objetivo
             prices from: the inheritance rule in sessionRirs, with the
             legacy chip (the map only — never a row that is not a working
             set, see legacyRir) as the fallback for a session logged before
             plans/035. One number per session hid the difference between a
             session paced 3 → 2 → 1 → 0 and one ground out at 0 throughout. */
          rirs: sessionRirs(worked, rirNumber(legacyRir(profile, bId, w, s.dayId, exId))),
```

3. Directly above `function diagRows(` (`:671`), add:

```js
/* The session's typical reserve: the median of its sets' RIR, or null when
   no set carries one. The median and not the last set, because a session
   that ends at failure on purpose after three sets with reserve is not a
   session at failure; and not the mean, because one 0 among 3s should not
   drag an easy session halfway to "hard". A log typed the old way — one
   value on the last set — arrives already spread over every set by the
   inheritance rule, so its median is that value and the screen reads it
   as it always did (plans/044). */
function diagSessionRir(rirs) {
  const typed = (rirs || []).filter(v => v != null);
  return typed.length ? median(typed) : null;
}
```

4. Replace the `easy` and `failure` lines and the comment above them
   (`:702-707`) with:

```js
        /* The session's typical set (diagSessionRir — the median of the
           per-set reserves, since plans/044), not its last set: a lifter
           who paces 3 → 2 → 1 → 0 has not run the session at failure, and
           one who holds three sets at 3 has not trained hard because the
           fourth went to 0. A typed '3' still counts as the old '2+' chip
           did and a typed '0' as the old '0' (rirNumber, plans/035). */
        easy: recent.filter(p => diagSessionRir(p.rirs) >= 2).length >= 2,
        failure: !!last && (diagSessionRir(last.rirs) === 0 || forcedDrop(last.rows)),
```

5. In the fallback verdict (`:628`), replace `Apunta el RIR de la última
   serie unas semanas` with `Apunta el RIR de cada serie unas semanas`.

**Verify**: `node --check js/diagnostics.js` → exit 0. `node test/unit.js`
→ `N+3 passed, 0 failed`. The two pre-existing `diagProbe` cases still
pass unchanged — if either fails, see STOP conditions.
`grep -n "getRir" js/diagnostics.js` → no hits.
`grep -c "Apunta el RIR de cada serie" js/diagnostics.js` → `1`.

### Step C: Pin the helper on its own

In `test/unit.js`, directly after the `heldSess` assertion from Step A, add:

```js
const dsr = a => call('diagSessionRir(' + JSON.stringify(a) + ')');
ok('diagSessionRir is the median of the typed sets, null when none is typed',
   dsr([3, 2, 1, 0]) === 1.5 && dsr([3, 3, 3, 0]) === 3 && dsr([0, 0, 1]) === 0 &&
   dsr([null, null]) === null && dsr([]) === null,
   [dsr([3, 2, 1, 0]), dsr([3, 3, 3, 0]), dsr([0, 0, 1]), dsr([null, null]), dsr([])].join(','));
```

**Verify**: `node test/unit.js` → `N+4 passed, 0 failed`.

### Step D: The guide says what the screen now reads

In `docs/guide.md`, in the verdict table (`:1149-1162`):

- `:1152` — replace `RIR 0, o una bajada forzada` with `RIR 0 en la serie
  típica de la sesión, o una bajada forzada`.
- `:1154` — replace `RIR 2+ repetido` with `RIR 2+ en la serie típica, en
  dos de las últimas tres sesiones`.
- `:1158` — replace `Apunta el RIR de la última serie unas semanas` with
  `Apunta el RIR de cada serie unas semanas`.

Directly after the table's last row (`| subiendo | el músculo va bajo la
franja | … |`, `:1162`), separated by a blank line, add:

```markdown
"La serie típica" is the median of the RIR you wrote on the session's
working sets. A session paced 3 → 2 → 1 → 0 has a typical set with a rep
in reserve and is not read as fatigue; one ground out at 0 on every set
is. A session where you only wrote the last set's RIR reads exactly as it
did before this: the objetivo's inheritance rule (see [The weekly
objetivo](#the-weekly-objetivo)) gives every earlier set that value, so
its median is that value.
```

**Verify**: `grep -c "serie típica" docs/guide.md` → `3` or more;
`grep -c "última serie unas semanas" docs/guide.md` → `0`;
`node test/unit.js` → `N+4 passed, 0 failed` (the docs cross-link check
resolves the new anchor — `#the-weekly-objetivo` is an existing heading).

### Step E: Bump the shell version

`bash tools/bump-cache-version.sh` → `vN -> vN+1`.

**Verify**: `node test/unit.js` → `N+4 passed, 0 failed`. Optionally, with
a server and Playwright: `node test/smoke.js --only "objetivo de peso"` →
all `PASS` (its verdict pins are the `decay` row and the set-count case,
neither of which this plan moves).

## Test plan

- Step A: three verdict cases through `diagProbe` (paced → not fatigue;
  ground out → fatigue; held back → lacking intensity), the first and third
  written to fail at `18fbd92`. Step C: one direct case on
  `diagSessionRir`. Four new assertions.
- Existing coverage that must stay green without edits: the two
  `diagProbe` cases at `test/unit.js:2264-2271` (a typed 3 and a legacy
  `2+` read as easy; a 0 on the row and on the chip read as failure) and
  the `decay` case at `:2272-2275`; the § "diagVerdict" cases at
  `:1012-1024`.
- Verification: `node test/unit.js` → `0 failed`, four more passed than
  before Step A.

## Done criteria

- [ ] `node --check js/diagnostics.js` exits 0
- [ ] `node test/unit.js` ends `0 failed`, with four more `passed` than on `main`
- [ ] `grep -c "getRir" js/diagnostics.js` → `0`
- [ ] `grep -c "^function diagSessionRir" js/diagnostics.js` → `1`
- [ ] `grep -c "diagSessionRir(" js/diagnostics.js` → `3` (the definition and two uses)
- [ ] `grep -c "Apunta el RIR de cada serie" js/diagnostics.js` → `1`
- [ ] `grep -c "última serie unas semanas" docs/guide.md js/diagnostics.js` → `0` in each
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a version one higher than on `main`
- [ ] `git status --short` lists only `js/diagnostics.js`, `test/unit.js`,
      `docs/guide.md`, `sw.js` and `plans/README.md`
- [ ] `plans/README.md` status row for 044 updated

## STOP conditions

- **Plan 038's PR 4 has landed** — `diagPoints` calls `sessionsOf` and no
  longer walks `profile.log`. This is an adaptation, not a stop: the
  per-set array for a session `sess` is
  `sess.sets.filter(s => s.worked).map(s => s.rir)` (038's interface
  guarantees it is `sessionRirs` over the working sets with the legacy chip
  as fallback), so set `rirs:` to that expression, drop the `legacyRir`
  call, and continue. Say so in your report.
- `legacyRir` is not defined in `js/app.js` — plan 039 has not landed.
  Stop; do not substitute `getRir` (its second pass reads a reserve off a
  set that is not a working set, which is the bug 039 fixes).
- After Step B, either pre-existing `diagProbe` case fails: the inheritance
  rule did not produce the old reading — most likely `worked` in
  `diagPoints` no longer matches `rowWorked`'s filter. Report; do not
  edit the old cases.
- The code at any "Current state" location in `js/diagnostics.js` does not
  match its excerpt.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **The fallback verdict is now under-specified for a paced session.** A
  lift that is flat on both axes with sets at 3 → 2 → 1 → 0 reaches
  "Estancado de verdad" (work axis flat) or "Estancado, sin una señal
  clara" — and the second one asks the lifter to record RIR they already
  recorded. The honest next row is "the effort was right and the top set
  still did not move: change the stimulus (a set, a rep range, the
  exercise)". That is coaching content, deliberately left for the
  maintainer; if it is added, it goes between the `easy` row and the
  work-axis rows, and the guide's table gains a line.
- `diagSessionRir` is the one reduction. If a third screen wants "the
  session's RIR" (a chart tooltip, a CSV column), call it rather than
  re-derive; if it ever wants a different reduction, that is a decision to
  record, not a refactor.
- When 038's PR 4 lands after this plan, the reviewer should check that
  `rirs:` became `sess.sets.filter(s => s.worked).map(s => s.rir)` and
  that `legacyRir` disappeared from `js/diagnostics.js` with it — the
  reader now owns the fallback.
- The review's histogram (`js/review.js:118-142`) counts *own* values
  ("apuntado" = written down) and deliberately ignores inheritance. The
  Diagnóstico's signals now use the *inherited* array. Both are right for
  their question; a reader who expects the review's "3 en 3 series, 0 en
  1" to match a `failure` verdict should read the table row in the guide.
