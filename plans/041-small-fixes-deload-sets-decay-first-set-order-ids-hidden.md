# Plan 041: Four small correctness fixes — a one-set exercise on the deload week, the rep-decay line's "first set", prototype names in the session order, and the four elements that ship `hidden` but are driven by inline `display`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3913b8f..HEAD -- js/app.js js/diagnostics.js test/unit.js`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — each step is a few lines with its own assertion; the
  `hidden` step is a visibility mechanism swap that the existing smoke
  sections already observe through `isVisible()` and computed style.
- **Depends on**: none. Land after 039 and 040 (all three edit `js/app.js`
  and bump `sw.js`; take the higher version on conflict).
- **Category**: bug
- **Planned at**: commit `3913b8f`, 2026-09-21

## Why this matters

Four defects, each certain, each small, none worth a plan of its own —
bundled the way plans 006 and 013 were:

- **A.** `setsFor` on the deload week computes `Math.max(2, Math.ceil(n /
  2))`, so an exercise planned at **one** set draws **two** on the deload
  week — the only week in the block where it asks for more work, against a
  banner that says "Mitad de series". It also inflates the progress bar's
  denominator and the planned count the volume sheet compares against.
- **B.** The rep-decay line has three ideas of "the first set": `repDecay`
  measures from the first row *with a rep count*, `decayLine` reads the RIR
  off row 0, and the Diagnóstico reads it off the first *done* row. Tick
  set 1 without typing reps (which the tick contract allows) and type reps
  on 2–4: the card measures the drop from set 2 but quotes set 1's empty
  RIR box, printing "¿primera serie al fallo?" beside a set whose RIR the
  lifter did write.
- **C.** `orderedEx` looks the session order's ids up in a plain `{}`, and
  `migrate()`'s repair of `profile.order` filters for strings but not
  through `safeKey` (unlike every exercise id twenty lines above). A
  `toString` in the array resolves to `Object.prototype.toString` — truthy
  — and a *function* is pushed into the session's exercise list; the day
  then draws a nameless zero-set card `drawCard` can never find again. Only
  hand-edited storage reaches it (every import re-keys the order), which
  is why this is a hardening fix and not a P1.
- **D.** `#beyond`, `#ordNote`, `#deloadCheck` and `#brakeNote` ship with
  the `hidden` attribute in `index.html` and are then shown and hidden by
  writing `el.style.display` — against the rule the code states at
  `js/app.js:920` and that every other `hidden`-shipping element follows.
  Each is permanently `[hidden]` in the DOM while visibly on screen, so a
  reader, a future CSS `display` rule, or a `locator('#x[hidden]')` (the
  idiom `test/smoke.js:3964` uses for `#weekPanel`) gets the wrong answer.

Plus one comment: `js/diagnostics.js:8` still says the screen crosses
trends with "the RIR chip", a control plan 036 removed. It rides here
because a comment change in `js/` costs a `CACHE_VERSION` bump anyway.

## Current state

All excerpts at `3913b8f`.

```js
// js/app.js:1550-1555
function setsFor(ex, w, block) {
  let n = ex.sets;
  if (ex.add && w >= ex.add) n += 1;
  if (block && deloadAt(block, w)) n = Math.max(2, Math.ceil(n / 2));
  return n;
}
```
This is the only site of that formula (`grep -n "Math.ceil(n / 2)" js/*.js`
→ one hit). `ex.sets` is clamped to 1–12 in `migrate()` (`:465`) and the
plan editor (`js/block-editor.js:888`). Existing pins:
`test/unit.js:1635-1639` assert `sets: 4` → 3 with `add`, and → 2 on a
hand-written "Descarga" week.

```js
// js/app.js:1611-1618
function repDecay(rows) {
  const withReps = (rows || []).filter(r => r && r.r !== '' && r.r != null && !isNaN(num(r.r)));
  if (withReps.length < 2) return 0;
  const first = num(withReps[0].r);
  const drop = first - num(withReps[withReps.length - 1].r);
  const floor = Math.max(DECAY_MIN_REPS, DECAY_MIN_SHARE * first);
  return drop >= floor ? drop : 0;
}
// js/app.js:1632-1640
function decayLine(rows) {
  const drop = repDecay(rows);
  if (!drop) return '';
  const head = '⚠ caída de ' + drop + ' reps';
  const first = rowRir((rows || [])[0]);
  if (first == null) return head + ': ¿primera serie al fallo?';
  if (first >= 2) return head + ' con la primera serie holgada (RIR ' + first + '): ¿descansos cortos?';
  return head + ': primera serie a ' + first + ' RIR — las de después se vacían';
}
```

```js
// js/diagnostics.js:132 — inside the per-session map; `rows` is the slot's raw array
          rows: rows.filter(r => r && r.done),
// js/diagnostics.js:714
        decay: !!last && repDecay(last.rows) >= 3 && !(rowRir(last.rows[0]) >= 2),
```

```js
// js/app.js:1966-1976
function orderedEx(profile, block, w, day) {
  const plan = exList(day);
  const ids = getOrder(profile, block.id, w, day.id);
  if (!ids) return plan;
  const byId = {};
  plan.forEach(ex => { byId[ex.id] = ex; });
  const out = [];
  ids.forEach(id => { const ex = byId[id]; if (ex && out.indexOf(ex) < 0) out.push(ex); });
  plan.forEach(ex => { if (out.indexOf(ex) < 0) out.push(ex); });
  return out;
}
// js/app.js:397 — inside migrate()'s repair of profile.order
        blk[k] = ids.filter(id => typeof id === 'string' && id && !seen.has(id) && seen.add(id)).slice(0, ORDER_LIMIT);
```
The repo's standard for a map keyed by an untrusted id is
`Object.create(null)` (`rowsFor` `:1574`, `bestByExercise`, `recordTarget`,
`importIdMaps`) with `safeKey` (`:2672`) as the second line. An existing
test at `test/unit.js:660-684` sets an order containing `'__proto__'` and
asserts the *import* path re-keys it; it does not exercise `orderedEx` or
`migrate()` and is unaffected by this plan.

```html
<!-- index.html:86-89, 97 -->
    <p class="deload-check" id="deloadCheck" hidden></p>
    <p class="brake-note" id="brakeNote" hidden></p>
    <div class="bar"><i id="barfill" class="u-bar-empty"></i></div>
    <div class="ord-note" id="ordNote" hidden></div>
    …
      <p class="ex-parked" id="beyond" hidden></p>
```
```js
// js/app.js:3207 — inside drawApp
  $('beyond').style.display = stranded ? 'block' : 'none';
// js/app.js:3888 — inside drawOrderNote
  host.style.display = changed ? 'flex' : 'none';
// js/app.js:3995, 3999, 4006 — inside drawDeloadCheck
  if (!dl || profile.week !== dl + 1) { el.style.display = 'none'; return; }
  if (!d) { el.style.display = 'none'; return; }
  el.style.display = 'block';
// js/app.js:4017, 4020 — inside drawBrakeNote
  if (!brakeCached(profile, block, profile.week, Date.now())) { el.style.display = 'none'; return; }
  el.style.display = 'block';
```
The rule, stated at `js/app.js:920-923`: "`.hidden`, not `.style.display`:
the markup ships with the `hidden` attribute (plans/008 item 22 — no
inline `style=""` left in index.html), and clearing an inline style would
leave that attribute in charge." `css/style.css:381` already carries
`.ord-note[hidden] { display: none; }` (the `.ord-note` base rule is
`display: flex`, which would otherwise beat the UA's `[hidden]`);
`.deload-check`, `.brake-note` and `.ex-parked` set no `display`, so the
attribute works on them unaided. `grep -c "style\.display" js/app.js` → 17
at `3913b8f`. The smoke suite reads these four elements only through
`isVisible()` (`test/smoke.js:583-604, 1947, 2502, 2542`) and one
`getComputedStyle(...).display === 'none'` (`:3010`) — both true under the
attribute.

```js
// js/diagnostics.js:6-9
   This screen fits a line through the estimated 1RM of every exercise in
   the current plan at once and sorts them worst first, then crosses each
   trend with the signals the log already carries — the RIR chip, the
   rep-decay flag, forced drops, the timestamps on every ticked row, the
```

Conventions: comments explain *why* and name the bug; unit tests are
`call(...)` expressions asserted with `ok(name, cond, extra)`, fixtures
built inside a self-invoking function (see `orderRekey`,
`test/unit.js:660`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js && node --check js/diagnostics.js` | exit 0 |
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed` — **read N before Step A and count in deltas**: it printed 760 at `3913b8f` with this plan's index row in place, and plan 038 is adding assertions concurrently |
| Smoke sections for Step D (optional; Playwright + server on :8765) | `node test/smoke.js --only "main session" --only "orden real" --only "nota, energía" --only "objetivo de peso"` | every line `PASS` |
| Bump | `bash tools/bump-cache-version.sh` | `vN -> vN+1` |

Install and server one-liners are in `README.md` § "Tests". The full
smoke suite runs by itself when the pull request is opened.

## Scope

**In scope**:
- `js/app.js` — `setsFor`, a new `decayRows` helper, `repDecay`,
  `decayLine`, `orderedEx`, the `profile.order` filter in `migrate()`, and
  the seven `style.display` writes named above.
- `js/diagnostics.js` — line 714 and the comment at line 8.
- `test/unit.js` — new assertions.
- `sw.js` — the `CACHE_VERSION` bump.
- `plans/README.md` — your status row.

**Out of scope**:
- `css/style.css` — no rule change is needed (see Current state); do not
  add `[hidden]` overrides speculatively.
- `index.html` — the four elements already ship `hidden`.
- The other ten `style.display` writes in `js/app.js` (`:913, 916,
  1128-1131, 1174, 2556, 2574`) and those in other files: their elements
  do not ship `hidden`, so the rule does not apply to them.
- The `r-in` class on the rep box (written at `js/app.js:3512, 3640`, read
  by nothing) — recorded as trivia in the index; leave it.

## Git workflow

- Branch: `claude/041-small-fixes`
- One commit per step, plain-sentence messages
  (`Plan 041 Step A: a one-set exercise stays at one set on the deload week`).
- Do NOT push or open a PR unless the operator instructed it. Rebase on
  `main` first and take the higher `CACHE_VERSION` on conflict.

## Steps

### Step A: A one-set exercise never gains a set on the deload week

Tests first. In `test/unit.js`, after the `ok(` at `:1637-1639` ("and a
hand-written "Descarga" phase halves its week as well"), add:

```js
ok('a one-set exercise stays at one set on the deload week — the floor of two never exceeds the week\'s own count (plans/041)',
   call(`setsFor({ sets: 1 }, 8, { deload: 8, weeks: 8, phase: {} })`) === 1 &&
   call(`setsFor({ sets: 2 }, 8, { deload: 8, weeks: 8, phase: {} })`) === 2 &&
   call(`setsFor({ sets: 3 }, 8, { deload: 8, weeks: 8, phase: {} })`) === 2,
   [1, 2, 3].map(n => call(`setsFor({ sets: ${n} }, 8, { deload: 8, weeks: 8, phase: {} })`)).join(','));
```

`node test/unit.js` → `N passed, 1 failed`, printing `2,2,2` (N is whatever
your first run printed; every count below is a delta from it).

Then in `js/app.js:1553` replace the deload line with:

```js
  /* Half the sets, floored at two so a deload still has a pair to compare
     — but never MORE than the week's own count: a one-set finisher used to
     draw two rows on the one week that asks for less (plans/041). */
  if (block && deloadAt(block, w)) n = Math.min(n, Math.max(2, Math.ceil(n / 2)));
```

**Verify**: `node --check js/app.js` → exit 0; `node test/unit.js` → `N+1
passed, 0 failed`.

### Step B: One list of rows for the decay, read by all three readers

Tests first. In `test/unit.js`, find the section that asserts `decayLine`
(grep `decayLine(`); after its last `ok(`, add:

```js
const decayFirst = call(`decayLine([{ w: '60', r: '', done: true }, { w: '60', r: '12', done: true, rir: '3' },
                                    { w: '60', r: '9', done: true }, { w: '60', r: '8', done: true }])`);
ok('the decay line quotes the RIR of the set the drop was measured FROM — the first set with reps, not row 0 (plans/041)',
   decayFirst.includes('RIR 3') && call(`repDecay([{ r: '' }, { r: '12' }, { r: '9' }, { r: '8' }])`) === 4, decayFirst);
```

`node test/unit.js` → `N+1 passed, 1 failed`, printing `⚠ caída de 4
reps: ¿primera serie al fallo?`.

Then in `js/app.js`, directly above `repDecay` (`:1611`), add:

```js
/* The rows the decay is measured over: the ones with a rep count. One
   list, read by repDecay for the numbers and by decayLine and the
   Diagnóstico for which set is "the first" — three readers that each
   picked their own first set disagreed on a session whose first row was
   ticked without reps, which the tick contract allows (plans/041). */
const decayRows = rows => (rows || []).filter(r => r && r.r !== '' && r.r != null && !isNaN(num(r.r)));
```

In `repDecay`, replace the `const withReps = …` line with
`const withReps = decayRows(rows);`. In `decayLine`, replace
`const first = rowRir((rows || [])[0]);` with
`const first = rowRir(decayRows(rows)[0]);`. In `js/diagnostics.js:714`,
replace `rowRir(last.rows[0])` with `rowRir(decayRows(last.rows)[0])`
(`decayRows` lives in `js/app.js`, which is where a symbol another split
file reads must live — `AGENTS.md`, rule 2; `repDecay` and `rowRir` on the
same line already cross that boundary).

**Verify**: `node --check js/app.js && node --check js/diagnostics.js` →
exit 0; `node test/unit.js` → `N+2 passed, 0 failed`.

### Step C: The session order cannot smuggle a prototype name past `orderedEx`

Tests first. In `test/unit.js`, after the `orderRekey` block's second
`ok(` (`:683-684`), add:

```js
/* Only a hand-edited localStorage can put a prototype name into
   profile.order — every import re-keys it — but migrate()'s whole brief is
   to survive exactly that, and orderedEx used to push
   Object.prototype.toString into the session as if it were an exercise
   (plans/041). */
const orderProto = call(`
  (function () {
    state = defaultState(); migrate();
    const profile = state.profiles.hombre;
    const block = profile.blocks[profile.blockOrder[0]];
    const day = block.days[0];
    const plan = exList(day).map(function (e) { return e.id; });
    profile.order[block.id] = {};
    profile.order[block.id][slot(1, day.id)] = ['toString', plan[1], plan[0]];
    const drawn = orderedEx(profile, block, 1, day).map(function (e) { return e && typeof e === 'object' ? e.id : typeof e; });
    migrate();
    const kept = profile.order[block.id][slot(1, day.id)].join(',');
    return { drawn: drawn.join(','), kept: kept, want: plan[1] + ',' + plan[0], n: plan.length };
  })()
`);
ok('orderedEx never draws a prototype member as an exercise', !orderProto.drawn.split(',').includes('function') &&
   orderProto.drawn.split(',').length === orderProto.n, orderProto.drawn);
ok('...and migrate() drops the name from the recorded order, as it does from every exercise id',
   orderProto.kept === orderProto.want, orderProto.kept + ' vs ' + orderProto.want);
```

`node test/unit.js` → `N+2 passed, 2 failed`.

Then in `js/app.js`: in `orderedEx` replace `const byId = {};` with
`const byId = Object.create(null);   /* no prototype, so a recorded id can only ever match the plan (plans/041) */`,
and in `migrate()`'s order repair (`:397`) replace `typeof id === 'string'
&& id &&` with `typeof id === 'string' && safeKey(id) &&`.

**Verify**: `node --check js/app.js` → exit 0; `node test/unit.js` → `N+4
passed, 0 failed`.

### Step D: The four notes are shown and hidden by the attribute they ship with

In `js/app.js`, replace the seven writes:

- `:3207` → `$('beyond').hidden = !stranded;`
- `:3888` → `host.hidden = !changed;`
- `:3995` → `if (!dl || profile.week !== dl + 1) { el.hidden = true; return; }`
- `:3999` → `if (!d) { el.hidden = true; return; }`
- `:4006` → `el.hidden = false;`
- `:4017` → `if (!brakeCached(profile, block, profile.week, Date.now())) { el.hidden = true; return; }`
- `:4020` → `el.hidden = false;`

Above the first one (`:3207`) add:

```js
  /* .hidden, not .style.display, on all four notes in this file — see the
     rule at openAsk: they ship with the attribute, and an inline display
     over it left every one permanently [hidden] in the DOM while visibly
     on screen (plans/041). */
```

**Verify**: `node --check js/app.js` → exit 0; `grep -c "style\.display"
js/app.js` → `10`; `node test/unit.js` → `N+4 passed, 0 failed`. With a
server and Playwright: `node test/smoke.js --only "main session" --only
"orden real" --only "nota, energía" --only "objetivo de peso"` → every
line `PASS` (these four sections assert the four elements' visibility).

### Step E: The Diagnóstico's header comment names what is there

In `js/diagnostics.js:8`, replace `the RIR chip` with `the RIR written on
each set`.

**Verify**: `grep -c "RIR chip" js/diagnostics.js` → `0`;
`node --check js/diagnostics.js` → exit 0.

### Step F: Bump the shell version

`bash tools/bump-cache-version.sh` → `vN -> vN+1`.

**Verify**: `node test/unit.js` → `N+4 passed, 0 failed`.

## Test plan

- Step A: one assertion (three `setsFor` values). Step B: one assertion
  (`decayLine` + `repDecay`). Step C: two assertions (`orderedEx`,
  `migrate()`). Four new; all in `test/unit.js`; each written to fail at
  `3913b8f` first.
- Step D is pinned by the existing smoke sections named in its Verify.
- Verification: `node test/unit.js` → `0 failed`, four more passed than
  before Step A.

## Done criteria

- [ ] `node --check js/app.js && node --check js/diagnostics.js` exit 0
- [ ] `node test/unit.js` ends `0 failed`, with four more `passed` than on `main`
- [ ] `grep -c "Math.min(n, Math.max(2, Math.ceil(n / 2)))" js/app.js` → `1`
- [ ] `grep -c "^const decayRows" js/app.js` → `1`; `grep -c "decayRows(" js/diagnostics.js` → `1`
- [ ] `grep -c "const byId = Object.create(null)" js/app.js` → `1`
- [ ] `grep -c "style\.display" js/app.js` → `10`
- [ ] `grep -c "RIR chip" js/diagnostics.js` → `0`
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a version one higher than on `main`
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 041 updated

## STOP conditions

- `grep -n "Math.ceil(n / 2)" js/*.js` returns more than one site — the
  formula has grown a twin; report before editing either.
- The `decayLine` section in `test/unit.js` cannot be found (grep
  `decayLine(` returns nothing).
- After Step D, any of the four smoke sections fails on an assertion that
  names `#beyond`, `#ordNote`, `#deloadCheck` or `#brakeNote`.
- The code at any "Current state" location does not match its excerpt.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If `setsFor`'s deload rule is ever given a second site (the target rule
  prices `ceil(n/2)` sets *through* `setsFor` today — see the comment at
  `test/unit.js:1633`), the `Math.min` clamp must travel with it.
- `decayRows` is now the one definition of "the sets the decay is about".
  A fourth reader (a review line, a CSV column) should call it rather than
  re-filter.
- Reviewer: Step D changes no pixels; if a screenshot diff shows one of
  the four notes moved, a CSS `display` rule is now winning over the
  attribute and needs a `[hidden] { display: none }` override like
  `.ord-note`'s.
