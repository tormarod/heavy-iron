# Plan 021: The objetivo record is written when a session starts, never by a draw — and it says what kind of target it was

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- js/app.js test/unit.js test/smoke.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/026 (soft — it is the safety net under every change to the v3 rule's neighbourhood; land 026 first if both are queued)
- **Category**: bug
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

The app keeps a per-profile map called `obj`: for every session, the objetivo
(target weights and reps) that was on the screen when that session started.
Its whole purpose, stated in the code, is to be the record of what was
*asked for* — so that later a back-off the rule asked for can be told apart
from a weight that had to come off, and the rule's own error can be measured
instead of assumed. The same comment says rebuilding the record later "would
only ever reproduce the rule, which is the one thing it must not do".

At `4f7e037` the write happens inside the card draw, for whatever week is on
screen, gated only on that slot having rows. So opening any earlier week
that was logged before v3 shipped (every pre-v3 session has no record)
writes a *reconstructed* target — and because the rule reads the live clock
for its layoff check, any week older than ten days is recorded as a
"vuelta de parón" target. The record is stamped `v: 3` and `at: Date.now()`,
indistinguishable from a genuine one. A pure render function also mutates
storage and schedules a save on read-only navigation.

After this plan: the record is written by the handlers that turn an empty
session into a started one (a tick, typing in a weight or rep box, "Rellenar
con el objetivo"), never by a draw; and it carries `kind`, `hold` and
`brake`, so a `descarga` or `vuelta` target can be told apart from an
ordinary `objetivo` when the readout is eventually built. The import
validator accepts the new fields, so a backup written after this plan
restores exactly (the invariant plans/010 established).

## Current state

Files:

- `js/app.js` — the session view. `buildExCard` (starts near line 2680)
  draws one exercise card and defines the tick and input handlers inside
  it; `recordTarget` (line 3679) writes the record; `normalizeImportedObj`
  (line 4752) validates an imported `obj` map; `$('copyPrev').onclick`
  (line 3292) is "Rellenar con el objetivo".
- `test/unit.js` — headless suite; the existing `recordTarget` assertions
  are at lines 1070–1088.
- `test/smoke.js` — browser suite; the `obj` record is asserted at lines
  1663–1667 inside the section "objetivo de peso y diagnóstico".
- `sw.js` — `CACHE_VERSION` at line 21 (`'v68'` at `4f7e037`).

The write, inside the draw — `js/app.js:2766-2770`:

```js
  const est = targetNow(profile, block, day, ex, profile.week);
  /* Kept the moment the session becomes a session — the first row with
     anything in it. Not on a bare draw: opening Thursday to look at it is
     not a session, and a record of every day anyone ever scrolled past is
     noise in the one place that is supposed to hold what was asked for. */
  if (est && rows.some(rowUsed) && recordTarget(profile, block.id, profile.week, day.id, ex.id, est)) save();
```

The comment's intent is right; the gate is wrong: "the first row with
anything in it" is true of every already-logged week, forever.

The record — `js/app.js:3679-3689`:

```js
function recordTarget(profile, blockId, week, dayId, exId, t) {
  const k = slot(week, dayId);
  const blk = profile.obj[blockId] || (profile.obj[blockId] = Object.create(null));
  const sl = blk[k] || (blk[k] = Object.create(null));
  if (sl[exId]) return false;
  sl[exId] = { v: 3, at: Date.now(), conf: t.conf,
               sets: t.sets.map(x => ({ w: x.w, r: x.r, m: x.move })) };
  return true;
}
```

`t` is the object `targetFor` returns. Beyond `conf` and `sets` it carries
`kind` (`'objetivo'` | `'descarga'` | `'vuelta'`, set at `js/app.js:3813`,
`3836`, `3850`), `hold` and `brake` (booleans, set at `js/app.js:3987`).
None of those reach the record.

The tick handler, inside `buildExCard` — `js/app.js:2946-2953`:

```js
    tick.onclick = () => {
      let adopted = '';
      if (!r.done) {
        /* Ticking a set whose weight box is still empty takes the greyed
           number showing in it — last week's weight for this same set. It
           is the common case, but it is also a guess, so it says so. */
        if ((r.w === '' || r.w == null) && hint) { r.w = hint; adopted = hint; stampRowUnit(r); }
        r.ts = Date.now();
      }
      r.done = !r.done;
```

The weight box handler, same function — `js/app.js:2940`:

```js
    wIn.oninput = e => { r.w = e.target.value.replace(/[^0-9.,]/g, ''); if (r.w !== e.target.value) e.target.value = r.w; stampRowUnit(r); save(); };
```

(`rIn.oninput`, the rep box, is on the following line; `grep -n "rIn.oninput" js/app.js` finds it.)

Inside `buildExCard`, `rows` is the live row array for this exercise and
week (`const rows = …` near the top of the function; the `stat` object at
`js/app.js:2731-2735` holds the same reference as `rows`), `est` is the
target computed for the draw, and `profile`, `block`, `day`, `ex` are all
in scope.

"Rellenar con el objetivo" — `js/app.js:3292-3318` (excerpt):

```js
$('copyPrev').onclick = () => {
  const profile = getProfile(), block = getBlock(), day = currentDay();
  …
  let written = 0, up = 0, down = 0, back = 0;
  exList(day).forEach(ex => {
    const t = targetNow(profile, block, day, ex, profile.week);
    if (!t) return;
    const to = entry(profile, block.id, profile.week, day.id, ex.id, setsFor(ex, profile.week, block));
    to.forEach((r, i) => {
      if (r.done) return;
      …
      const from = t.sets[i] || t.sets[t.sets.length - 1];
      r.w = loadText(from.w);
      stampRowUnit(r);
    });
    written++;
```

It writes weights into rows and therefore starts a session without any
tick; it must record too.

`rowUsed` — `js/app.js:1528`:

```js
const rowUsed = r => !!(r && (r.done || (r.w !== '' && r.w != null) || (r.r !== '' && r.r != null) || dropsOf(r).some(dropUsed)));
```

The import validator's kept record — `js/app.js:4776-4780`:

```js
      if (!sets.length) return;
      kept[exId] = { v: 3, at: clampInt(rec.at, 0, Number.MAX_SAFE_INTEGER, 0),
                     conf: TARGET_CONF_LABEL[rec.conf] ? rec.conf : 'baja', sets: sets };
```

`TARGET_CONF_LABEL` (`js/app.js:4045`) is a plain object literal, so the
truthy lookup accepts any inherited property name as a `conf`. The file's
own convention for this job is a membership test — `RIR_OPTIONS.indexOf` at
`js/app.js:4736`, `ENERGY_OPTIONS.indexOf` at `js/profile-transfer.js:172`.

Existing unit assertions to extend — `test/unit.js:1074-1088`:

```js
const objRecord = call(`
  (function () {
    const p = { obj: {} };
    const t = { conf: 'media', sets: [{ w: 45, r: 9, move: '\\u2191' }, { w: 42.75, r: 8, move: '' }] };
    const first = recordTarget(p, 'B', 3, 'D', 'E', t);
    const again = recordTarget(p, 'B', 3, 'D', 'E', { conf: 'alta', sets: [{ w: 99, r: 1, move: '' }] });
    const rec = p.obj.B['w3-D'].E;
    return { first: first, again: again, v: rec.v, conf: rec.conf, w: rec.sets[0].w, m: rec.sets[0].m, n: rec.sets.length };
  })()
`);
ok('the target shown is recorded once, with its moves and its confidence',
   objRecord.first === true && objRecord.v === 3 && objRecord.conf === 'media' &&
   objRecord.w === 45 && objRecord.m === '↑' && objRecord.n === 2, JSON.stringify(objRecord));
ok('and a second draw of the same session does not overwrite it',
   objRecord.again === false, JSON.stringify(objRecord));
```

`call(src)` evaluates `src` inside the shared vm context that loaded every
shell script; `ok(name, cond, extra)` is the assertion helper. The
round-trip of an `obj` record through `normalizeImportedProfile` is asserted
at `test/unit.js:1137-1149` ("a restored profile keeps the objetivo it was
shown").

The smoke assertion that pins the record shape — `test/smoke.js:1663-1667`
(it runs after the section has ticked sets, so it keeps passing once the
tick records):

```js
    ok('el objetivo que se mostró queda guardado con la sesión', await page.evaluate(() => {
      const rec = getProfile().obj['block-1']['w4-d0'].chestpress;
      return rec.v === 3 && rec.conf === 'media' && rec.sets.length === 4 &&
             rec.sets[0].w === 47.25 && rec.sets[0].m === '↑' && rec.sets[3].m === '↓';
    }));
```

Conventions that apply (from `AGENTS.md`):

- Spanish for anything a user sees; English prose comments that say *why*,
  often naming the bug they prevent. Match the tone of the excerpts above.
- No inline `style=""`, no new `<script>`; everything here is inside
  `js/app.js`.
- `CACHE_VERSION` in `sw.js` must be bumped because `js/app.js` changes.
  `tools/bump-cache-version.sh` does it (`--dry-run` shows the next
  version).
- Verification rungs: `node --check js/app.js`, then `node test/unit.js`,
  then one targeted smoke section. Do not run the full smoke suite or
  `tools/smoke-gate.sh` yourself — the PR hook runs it once.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0, no output |
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed` (356 at `4f7e037`; more after this plan) |
| One smoke section | `python3 -m http.server 8765 &` (Git Bash) then `node test/smoke.js --only "objetivo de peso"` | `… passed, 0 failed` for that section |
| Smoke prerequisites (once) | `npm install --no-save playwright@1.56.1 && npx playwright install chromium` | exit 0 |
| Bump the cache | `bash tools/bump-cache-version.sh` | prints `v68 -> v69` (or the next number) and edits `sw.js` |

## Scope

**In scope** (the only files you should modify):
- `js/app.js`
- `test/unit.js`
- `test/smoke.js`
- `sw.js` (the `CACHE_VERSION` bump only)

**Out of scope** (do NOT touch, even though they look related):
- `js/diagnostics.js`, `js/review.js` — they read the live `targetNow`
  result, never `profile.obj`; nothing here changes what they see.
- `js/profile-transfer.js` — the `obj` re-keying at line 151 calls
  `normalizeImportedObj` and needs no change for the new fields.
- The readout of `obj` (the "how accurate was the rule" screen). Not this
  plan; recorded as a direction item in `plans/README.md`.
- `targetFor` and everything it calls — this plan changes when the answer
  is *recorded*, not how it is computed.

## Git workflow

- Branch: `claude/021-record-target-on-session-start-<6 hex chars>` (the
  repo's branches are named `claude/<slug>-<hash>`).
- One commit per step, imperative single-sentence subjects like the repo's
  own: `Record the objetivo when a session starts, not when a week is drawn`.
  End each commit message with the trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the fields to the record and whitelist them on import

In `js/app.js`, change `recordTarget` (line 3679) so the stored object is:

```js
  sl[exId] = { v: 3, at: Date.now(), conf: t.conf, kind: t.kind,
               hold: !!t.hold, brake: !!t.brake,
               sets: t.sets.map(x => ({ w: x.w, r: x.r, m: x.move })) };
```

Keep `v: 3` — the shape is additive, and both suites pin `v === 3`. Add a
sentence to the comment above the function saying why `kind`/`hold`/`brake`
are kept: a `descarga` or a `vuelta` target is not a prescription the rule
can be wrong about, and the record has to be able to say which it was.

Next to `TARGET_CONF_LABEL` (line 4045) add the two option lists the
validator will use:

```js
const TARGET_CONF_OPTIONS = ['baja', 'media', 'alta'];
const TARGET_KIND_OPTIONS = ['objetivo', 'descarga', 'vuelta'];
```

In `normalizeImportedObj` (line 4752), replace the kept record with:

```js
      const rec2 = { v: 3, at: clampInt(rec.at, 0, Number.MAX_SAFE_INTEGER, 0),
                     conf: TARGET_CONF_OPTIONS.indexOf(rec.conf) >= 0 ? rec.conf : 'baja', sets: sets };
      if (TARGET_KIND_OPTIONS.indexOf(rec.kind) >= 0) rec2.kind = rec.kind;
      if (rec.hold === true) rec2.hold = true;
      if (rec.brake === true) rec2.brake = true;
      kept[exId] = rec2;
```

(Name the local whatever reads well; `rec` is already taken in that scope.)
A record written before this plan has no `kind` — it stays absent, which is
how a reader tells the two generations apart. `hold`/`brake` are stored
only when true, the same convention the log uses for `share`/`ss`/`u`.

**Verify**: `node --check js/app.js` → exit 0. `node test/unit.js` → all
existing assertions still pass (the `objRecord` probe does not read the new
fields, and the restore probe at 1137–1149 still round-trips).

### Step 2: One helper that records on the session-start event

Directly above `recordTarget` in `js/app.js`, add:

```js
/* The record is written by the handlers that can turn an empty session into
   a started one — the tick, the weight and rep boxes, and "Rellenar con el
   objetivo" — and by nothing else. It used to be written by the draw, for
   whatever week was on screen, as soon as that week had a row in it: every
   week logged before v3 got a rebuilt target the first time anyone scrolled
   past it, stamped with today's clock, so a week from two months ago was
   filed as a "vuelta de parón". `wasSession` is whether the exercise's rows
   already counted as a session when the handler began; only the transition
   from "not yet" to "yes" records, so browsing writes nothing and a session
   that already has its record keeps it. */
function recordTargetOnStart(profile, block, day, ex, rows, wasSession, est) {
  if (wasSession || !est || !rows.some(rowUsed)) return false;
  if (!recordTarget(profile, block.id, profile.week, day.id, ex.id, est)) return false;
  save();
  return true;
}
```

Then delete the draw-time write at `js/app.js:2766-2770` — keep the
`const est = targetNow(…)` line, remove the `if (est && rows.some(rowUsed)
&& recordTarget(…)) save();` line and its comment.

Wire the three handlers, all inside `buildExCard`:

- In `tick.onclick`, before any mutation, add `const wasSession =
  rows.some(rowUsed);` as the first statement; after `r.done = !r.done;`
  add `recordTargetOnStart(profile, block, day, ex, rows, wasSession, est);`.
- In `wIn.oninput` and `rIn.oninput` (`js/app.js:2940-2941`), the same
  pair: capture `wasSession` before the assignment to `r.w` / `r.r`, call
  the helper after it. These are one-liners today; turning them into a
  short block is fine.
- In the drop-set inputs `dwIn.oninput` and `drIn.oninput`
  (`js/app.js:3005-3006`, further down in the same card builder): the same
  pair. A typed drop weight makes the row "used" too (`rowUsed` counts
  `dropsOf(r).some(dropUsed)`), so a session can start there. Confirm
  `rows`, `est`, `profile`, `block`, `day` and `ex` are in scope at that
  point (they are closure variables of `buildExCard`); if the drop inputs
  are built by a separate function that does not see them, STOP.

And in `$('copyPrev').onclick` (line 3292), inside the `exList(day).forEach`
callback: capture `const wasSession = to.some(rowUsed);` right after `const
to = entry(…)`, and call `recordTargetOnStart(profile, block, day, ex, to,
wasSession, t);` right after the `to.forEach(…)` that writes the weights.
(`commit()` at the end of the handler saves anyway; the helper's own
`save()` is a harmless debounced duplicate.)

**Verify**: `node --check js/app.js` → exit 0.
`grep -n "recordTarget(" js/app.js` → exactly two lines: the `function
recordTarget(` definition and the call inside `recordTargetOnStart`. No
other caller may remain.

### Step 3: Unit assertions

In `test/unit.js`, directly after the `objRecord` block (after line 1088),
add a probe for the helper. `recordTargetOnStart` only touches
`profile.obj`, `rows` and `save()`, so it can be called directly:

```js
/* Browsing never writes: the record is made by the handler that starts the
   session, and only on the transition from "no session yet" to "session". */
const startRecord = call(`
  (function () {
    const p = { week: 2, obj: {} };
    const block = { id: 'B' }, day = { id: 'D' }, ex = { id: 'E' };
    const t = { kind: 'objetivo', conf: 'alta', hold: false, brake: true,
                sets: [{ w: 40, r: 10, move: '' }] };
    const rows = [{ w: '', r: '', done: false }];
    const before = recordTargetOnStart(p, block, day, ex, rows, false, t);   // nothing typed yet
    rows[0].w = '40';
    const browsed = recordTargetOnStart(p, block, day, ex, rows, true, t);   // rows were already a session
    const started = recordTargetOnStart(p, block, day, ex, rows, false, t);  // the transition
    const again = recordTargetOnStart(p, block, day, ex, rows, false, t);
    const rec = p.obj.B['w2-D'].E;
    return { before, browsed, started, again, kind: rec.kind, brake: rec.brake, hold: 'hold' in rec };
  })()
`);
ok('an untouched row records nothing', startRecord.before === false, JSON.stringify(startRecord));
ok('rows that were already a session record nothing (browsing a logged week)', startRecord.browsed === false, JSON.stringify(startRecord));
ok('the first row of a session records the target, with its kind and the brake', 
   startRecord.started === true && startRecord.kind === 'objetivo' && startRecord.brake === true, JSON.stringify(startRecord));
ok('hold is stored only when true', startRecord.hold === false, JSON.stringify(startRecord));
ok('and a second start of the same session does not overwrite it', startRecord.again === false, JSON.stringify(startRecord));
```

Note `save()` runs inside the vm against the harness's stub `localStorage`
— that is fine, other sections do the same.

Then add, right after it, a source-level guard so the draw can never grow
the write back:

```js
ok('no draw path calls recordTarget — only recordTargetOnStart does',
   (fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8').match(/recordTarget\(/g) || []).length === 2);
```

Then extend the restore probe at `test/unit.js:1137-1149`: give the record
it restores `kind: 'descarga', hold: true, brake: false` on the way in, and
assert the restored record has `kind === 'descarga'`, `hold === true` and
no `brake` key. Also add one negative: a record with `kind: 'anything'` and
`conf: 'constructor'` restores with no `kind` and `conf === 'baja'`.

**Verify**: `node test/unit.js` → `0 failed`, and the count is at least
363 (356 + 5 + 1 + 1 or more).

### Step 4: Smoke assertion — browsing writes nothing

In `test/smoke.js`, inside the section "objetivo de peso y diagnóstico",
after the existing record assertion at lines 1663–1667, add one case. The
section's page has `getProfile()` available in `page.evaluate`. Seed a
week that has rows but no record (the section already seeds history into
earlier weeks — use one of them), navigate to it, and assert the record
did not appear:

```js
    /* A week that was logged before the record existed gets no record from
       being looked at: a rebuilt target is the one thing the map must not
       hold. */
    ok('mirar una semana ya registrada no fabrica su objetivo', await page.evaluate(() => {
      const p = getProfile();
      const blk = p.obj['block-1'] || {};
      delete blk['w2-d0'];                       // make sure week 2 has no record
      return !(p.obj['block-1'] && p.obj['block-1']['w2-d0']);
    }));
    await page.click('#weeks button:nth-child(2)');
    await page.waitForTimeout(150);
    ok('   ni después de dibujarla', await page.evaluate(() => {
      const p = getProfile();
      return !(p.obj['block-1'] && p.obj['block-1']['w2-d0']);
    }));
    await page.click('#weeks button:nth-child(4)');   // back to the week the section works in
```

Adjust the selectors to the ones the section already uses to switch weeks
(`grep -n "#weeks" test/smoke.js` shows the pattern); the week the section
leaves the page on must be the one the following assertions expect.

**Verify**: with a static server on `:8765`, `node test/smoke.js --only
"objetivo de peso"` → that section reports `0 failed`, including the new
two assertions and the existing "queda guardado" one.

### Step 5: Bump the cache version

`bash tools/bump-cache-version.sh` → `sw.js` line 21 moves from `'v68'` to
the next number.

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → a version higher than v68.
`node test/unit.js` → `0 failed` (the harness asserts nothing about the
version number, but it re-reads `sw.js`).

## Test plan

- New unit assertions (Step 3): helper transitions (5), the source-level
  guard (1), the restore round-trip of the new fields (2+).
- New smoke assertions (Step 4): browsing an already-logged week writes no
  record, before and after the draw.
- Existing assertions that must keep passing: `objRecord` (unit 1084–1088),
  "a restored profile keeps the objetivo it was shown" (unit 1148), "el
  objetivo que se mostró queda guardado con la sesión" (smoke 1663).
- Pattern to follow: the `objRecord` probe (`call(\`(function () { … })()\`)`
  returning a plain object, then `ok(...)` lines with `JSON.stringify` as
  the diagnostic).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --check js/app.js` exits 0
- [ ] `node test/unit.js` exits 0 with `0 failed` and at least 363 passed
- [ ] `grep -c "recordTarget(" js/app.js` prints `2`
- [ ] `grep -n "recordTargetOnStart(" js/app.js` shows the definition plus six call sites (tick, `wIn.oninput`, `rIn.oninput`, `dwIn.oninput`, `drIn.oninput`, `copyPrev`)
- [ ] `grep -n "TARGET_CONF_LABEL\[rec.conf\]" js/app.js` prints nothing
- [ ] `node test/smoke.js --only "objetivo de peso"` reports `0 failed`
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a version above v68
- [ ] `git status --short` lists only `js/app.js`, `test/unit.js`, `test/smoke.js`, `sw.js`
- [ ] `plans/README.md` status row for 021 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" do not match the live code at the cited
  lines (allow for a few lines of drift; a different *shape* is a stop).
- `grep -n "recordTarget(" js/app.js` at `4f7e037` shows more than the two
  sites this plan names (definition + the draw-time call) — another caller
  exists that this plan did not account for.
- The smoke section "objetivo de peso y diagnóstico" fails on the existing
  "queda guardado" assertion after Step 2 — that means the section asserts
  the record before it ticks a set, and the plan's premise about the
  section's order is wrong.
- A step's verification fails twice after a reasonable fix attempt.
- `rIn.oninput` does not exist as a one-line handler next to `wIn.oninput`.

## Maintenance notes

- Records written between v3 shipping (2026-09-18) and this plan landing may
  be reconstructions: they have no `kind` and an `at` from that window.
  Nothing can tell them apart from genuine ones; a future readout should
  treat records without `kind` as lower-trust. Do not try to purge them.
- If a new handler ever starts a session another way (a bulk "mark all
  done", an import that writes rows into the current week), it must call
  `recordTargetOnStart` with the pre-mutation `wasSession`. The
  source-level unit guard (Step 3) catches a *draw* calling `recordTarget`
  again; it does not catch a missing handler.
- The `obj` readout (direction item in `plans/README.md`) now has `kind`,
  `hold` and `brake` to filter on. Plan 025 removes the dead `'obj'` entry
  from `installBlockData`; the block share still does not carry `obj`, by
  decision.
- Reviewer: check that `wasSession` is captured *before* the first
  assignment in each handler — capturing it after makes every tick a
  "start" and the record is written once per exercise per week regardless,
  which is the old behaviour by another route.
