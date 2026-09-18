# Plan 026: The unit suite pins the v3 rule's trend term, its untested branches and the `obj` import validator — mutation-checked

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- test/unit.js js/app.js`
> This plan edits only `test/unit.js`, but it asserts behaviour of
> `js/app.js`. If `js/app.js` changed since `4f7e037`, read the "Current
> state" excerpts against the live code; a moved line is fine, a changed
> formula is a STOP.

## Status

- **Priority**: P1 (the verification baseline every other v3 plan leans on — land it first)
- **Effort**: M
- **Risk**: LOW (additive tests; no shell file changes, no `CACHE_VERSION` bump)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

Peso objetivo v3 (`js/app.js:3391-4064`) is ~670 lines that read months of
log and decide every set's weight and reps. It shipped with fifteen
end-to-end cases (`test/unit.js:811-1044`), which is good coverage of the
*decision* branches — and none of the part that decides how much a session
is worth. Verified by mutation against a scratch copy of the repo at
`4f7e037`: with `theilSen` stubbed to `return 0`, all 356 assertions pass;
with `MAX_SLOPE` changed from `0.03` to `0.5`, all 356 pass. Only an absurd
positive slope (`return 1e9`) trips one case, and only through the clamp.
Seven helpers (`theilSen`, `median`, `levelOf`, `capSeq`, `loadLadder`,
`weekRir`, `exSession`) have no direct assertion; `normalizeImportedObj` —
the one v3 function that takes untrusted bytes — has zero direct tests;
and one section heading in the suite prints with no assertions under it.

Plans 021 and 025 change code next to the rule. This plan is the safety
net they need, and its done criteria are mutation-shaped: the new
assertions must *fail* when the trend term is broken.

## Current state

Files:

- `js/app.js` — the rule. Read-only for this plan.
- `test/unit.js` — the suite: `ok(name, cond, extra)` helper (line 87),
  `call(src)` evaluates `src` in the vm context that loaded every shell
  script (defined near line 170; `app` is the context), `targetProbe`
  harness (826–873), the fifteen cases (874–1032), `normalizeImportedLog`
  section (1251–1290), the misplaced heading (2142).

The trend term — `js/app.js:3880-3890`:

```js
  const oneRep = 1 / (EPLEY_A + r1Last + rhoLast);
  let g;
  if (hold || brake) g = 0;
  else if (sessions.length <= LEARNING_SESSIONS) g = oneRep;
  else {
    const pts = seq.slice(-TREND_SESSIONS)
      .map((s, i) => [i, s]).filter(p => !p[1].cens).map(p => [p[0], p[1].C]);
    g = pts.length >= TREND_MIN_POINTS
      ? Math.max(oneRep, Math.min(theilSen(pts) / level, MAX_SLOPE))
      : oneRep;
  }
```

Constants (`js/app.js:3423-3480`): `EPLEY_A = 30`, `EST_MAX_REPS = 15`,
`CENSOR_REPS = 12`, `LEVEL_SESSIONS = 3`, `TREND_SESSIONS = 6`,
`TREND_MIN_POINTS = 3`, `MAX_SLOPE = 0.03`, `LEARNING_SESSIONS = 3`,
`GAP_DAYS = 10`, `DECLINE_DROP = 0.05`, `PSI_PRIOR = 0.97`, `PSI_MIN = 0.8`.

Why a one-rep-per-session climb cannot test the trend: the capacity of a
session is `C = w × (1 + (r + ρ) / 30)`, so adding one rep per session at
one weight gives a slope of `w/30` per session and `slope / level =
1 / (30 + r + ρ)` — which is `oneRep` exactly. The trend only shows when
the climb is *steeper* than one rep per session, and then `MAX_SLOPE`
usually binds. Assert on `t.g` (set at `js/app.js:3989`: `t.g = g`), not on
the rep count, which the `floor` in `repsAt` hides.

`theilSen` and `median` — `js/app.js:3507-3527`:

```js
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function theilSen(pts) {
  const slopes = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j][0] !== pts[i][0]) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    }
  }
  return slopes.length ? median(slopes) : 0;
}
```

The harness — `test/unit.js:826-873` (excerpt):

```js
const targetProbe = `
  (function (sessions, opts) {
    opts = opts || {};
    const DAY = 86400000, T0 = Date.UTC(2026, 0, 5);
    const week = opts.week || sessions.length + 1;
    const phase = {};
    for (let i = 1; i <= week + 4; i++) phase[i] = { r: (opts.rirWeek != null ? opts.rirWeek : 2) + ' RIR' };
    const ex = { id: 'E', n: 'x', sets: opts.sets || 3, reps: opts.range || '10–15', inc: opts.inc || 2.5 };
    …
    const profile = { log: { B: {} }, rir: { B: {} }, obj: {}, variants: {},
                      blocks: { B: block }, blockOrder: ['B'] };
    let lastDay = 0;
    sessions.forEach(function (s, i) {
      const d = s.day != null ? s.day : i * 7;
      lastDay = d;
      profile.log.B['w' + (i + 1) + '-D'] = { E: s.sets.map(function (p) {
        return { w: String(p[0]), r: String(p[1]), done: true, ts: T0 + d * DAY };
      }) };
      if (s.rir) profile.rir.B['w' + (i + 1) + '-D'] = { E: s.rir };
    });
    const now = T0 + (opts.now != null ? opts.now : lastDay + 7) * DAY;
    resetRenderCache();
    const t = targetFor(profile, block, block.days[0], ex, week, now, !!opts.brake);
    if (!t) return null;
    return {
      kind: t.kind, conf: t.conf, dir: t.dir, notes: t.notes.join(','),
      show: t.sets.map(function (x) {
        return String(Math.round(x.w * 100) / 100).replace('.', ',') + '×' + x.r + x.move;
      }).join(' · '),
      line: targetLine(t), says: targetNotes(t).join(' | '),
      phi: t.phi ? t.phi.map(function (v) { return v.toFixed(3); }).join(' ') : '',
    };
  })
`;
const target = (sessions, opts) => call(targetProbe)(sessions, opts);
```

Every phase week gets `'<n> RIR'`, so `weekRir`'s prose fallback
(`js/app.js:3545-3550`: a phase with no number → `lastRho`) is unreachable
from the harness today. The block has one day, so `exHistory`'s
same-lift-two-days branch (`js/app.js:3721-3733`, `splitDays`/`ownDay`)
is reachable only from `test/smoke.js:2442-2452`.

Segment restart after a layoff — `js/app.js:3862-3868`:

```js
  let start = 0;
  for (let i = 1; i < sessions.length; i++) {
    const a = sessions[i - 1].ts, b = sessions[i].ts;
    if (a && b && b - a > GAP_DAYS * DAY_MS) start = i;
  }
  const seq = capSeq(sessions.slice(start));
  const lv = levelOf(seq);
```

`t.level = level` is set at `js/app.js:3988`.

The `PSI_MIN` floor — `js/app.js:3917-3920`:

```js
  const phi = [1];
  for (let k = 1; k < n; k++) {
    let psi = obs[k] ? median(obs[k]) : allObs.length ? median(allObs) : PSI_PRIOR;
    if (upper[k]) psi = Math.min.apply(null, [psi].concat(upper[k]));
    phi.push(phi[k - 1] * Math.min(1, Math.max(PSI_MIN, psi)));
  }
```

The three-rung cap — `js/app.js:3970-3976` (`for (let s = 0; r < lo && s <
3; s++)`).

`normalizeImportedObj` — `js/app.js:4752-4784`: slots capped at
`LOG_LIMITS.slots`, `week` must be an integer in `1..MAX_WEEKS`, day id
through `dayMap`, exercise id through `exMap[dayId]`, `rec.sets` must be an
array (capped at `LOG_LIMITS.rows`), `w` via `clampNum(x.w, 0, 9999, 0)`,
`r` via `clampInt(x.r, 0, 999, 0)`, `m` kept only if `'↑'` or `'↓'`, `at`
clamped, `conf` defaulting to `'baja'`. Its twins have a section at
`test/unit.js:1251` whose probe builds `rawBlock`, runs
`normalizeImportedBlock`, then feeds a good and a bad map — copy that shape.

The misplaced heading — `test/unit.js:2142-2143`:

```js
console.log('\n== requestWakeLock: one rest, one lock — skipped mid-request, doubled up, or re-acquired (plans/008 item 15, …) ==');
console.log('\n== the log key has one reader as well as one builder (plans/009 item 4) ==');
```

The wake-lock assertions actually start around line 2300 (`const makeLock =
…`), under the heading `== "borrar registro" reaches a week past the cap ==`.

Conventions: assertion names in the suite's voice (a sentence a reader
can act on), `JSON.stringify(t)` as the diagnostic, sections introduced by
`console.log('\n== … ==')`, a comment above each case saying what it pins
and why. `test/unit.js` is outside the `CACHE_VERSION` gate — no bump.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check test/unit.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| Mutation check (scratch copy, see Step 7) | `node "$SCR/mut/test/unit.js" \| tail -1` | `… 1 failed` or more |

## Scope

**In scope**: `test/unit.js` only.

**Out of scope**: `js/app.js` and every other file. If a new assertion
reveals a real defect in the rule, pin the *current* behaviour with a
comment saying so and report it — do not fix the rule here.

## Git workflow

- Branch: `claude/026-pin-the-v3-rule-<6 hex chars>`.
- One commit per step group, e.g. `Pin the v3 trend term on t.g so a broken theilSen fails the suite`, trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Expose `g`, `level` and `rirWeek` from the probe

In `targetProbe`'s return object add `g: t.g, level: t.level, rirWeek:
t.rirWeek, sessions: t.sessions`. Also let a session carry an explicit
unit and let `opts` override the phase text: in the row builder, `return {
w: String(p[0]), r: String(p[1]), done: true, ts: …, u: p[2] === 'lb' ?
'lb' : undefined }` (delete the key when undefined so the row matches what
the app writes), and after the phase loop, `if (opts.phase) for (const k in
phase) phase[k] = opts.phase;`. Both are additive; existing cases pass
`[w, r]` pairs and no `opts.phase`.

**Verify**: `node test/unit.js` → still `356 passed, 0 failed`.

### Step 2: Three cases on the trend term (T16–T18)

Append after T15 (after line 1032), before the "a censored session can
never be read as a decline" line:

```js
/* T16 — a climb steeper than one rep a session: the trend is real and
   MAX_SLOPE binds. Asserted on g itself, because the floor in repsAt hides
   a difference of a third of a rep. This is the one assertion that fails
   when theilSen is broken (a stub returning 0 makes g fall to oneRep). */
t = target([
  { sets: [[40, 4], [40, 4], [40, 4]], rir: '1' },
  { sets: [[40, 6], [40, 6], [40, 6]], rir: '1' },
  { sets: [[40, 8], [40, 8], [40, 8]], rir: '1' },
  { sets: [[40, 10], [40, 10], [40, 10]], rir: '1' },
  { sets: [[40, 12], [40, 12], [40, 12]], rir: '1' },
], { range: '6–15', inc: 2.5, sets: 3, rirWeek: 1 });
ok('T16 a steep climb reads as a trend and is clamped at MAX_SLOPE',
   t && Math.abs(t.g - 0.03) < 1e-9, JSON.stringify(t));

/* T17 — one rep a session is, by construction, exactly oneRep: the slope
   of C = w(1 + (r+ρ)/30) over the level is 1/(30 + r + ρ). */
t = target([
  { sets: [[40, 6], [40, 6]], rir: '1' },
  { sets: [[40, 7], [40, 7]], rir: '1' },
  { sets: [[40, 8], [40, 8]], rir: '1' },
  { sets: [[40, 9], [40, 9]], rir: '1' },
  { sets: [[40, 10], [40, 10]], rir: '1' },
], { range: '6–15', inc: 2.5, sets: 2, rirWeek: 1 });
ok('T17 a one-rep-a-session climb is priced at exactly one more rep',
   t && Math.abs(t.g - 1 / (30 + 10 + 1)) < 1e-9, JSON.stringify(t));

/* T18 — a falling trend is discarded: the floor is still one more rep. */
t = target([
  { sets: [[40, 12], [40, 12]], rir: '1' },
  { sets: [[40, 11], [40, 11]], rir: '1' },
  { sets: [[40, 10], [40, 10]], rir: '1' },
  { sets: [[40, 9], [40, 9]], rir: '1' },
  { sets: [[40, 10], [40, 10]], rir: '1' },
], { range: '6–15', inc: 2.5, sets: 2, rirWeek: 1 });
ok('T18 a falling trend never prices less than one more rep',
   t && Math.abs(t.g - 1 / (30 + 10 + 1)) < 1e-9, JSON.stringify(t));
```

Read each `t` once with `console.log` while writing, and confirm T16's
sessions are all uncensored (reps below 12, below the range top, RIR
given) — `t.conf === 'alta'` is the tell. If T18's last session reads as
a decline (`hold`), `g` will be `0`; if so, raise its last session to
`[40, 11]` so it is within 5 % of the best of the three before it.

**Verify**: `node test/unit.js` → `359 passed, 0 failed`.

### Step 3: Direct assertions on the arithmetic helpers

After T18 add:

```js
ok('theilSen of nothing, or of one point, is a flat line', call('theilSen([])') === 0 && call('theilSen([[0, 5]])') === 0);
/* [0,1] and [0,2] share an x and are skipped; the two remaining pairs give
   slopes (3-1)/1 = 2 and (3-2)/1 = 1, whose median is 1.5. */
ok('theilSen skips pairs with the same x rather than dividing by zero',
   call('theilSen([[0, 1], [0, 2], [1, 3]])') === 1.5);
/* Six pairwise slopes: 1, 1, 10, 1, 14.5, 28 → sorted 1, 1, 1, 10, 14.5, 28
   → even-length median (1 + 10) / 2 = 5.5. A least-squares line through the
   same points would be steered by the outlier; the median is not. */
ok('theilSen is the median of the pairwise slopes, not a least-squares fit',
   call('theilSen([[0, 0], [1, 1], [2, 2], [3, 30]])') === 5.5);
```

Both expected values were computed by hand above; re-derive them yourself
before pinning (a wrong expectation pins a wrong number). Then:

```js
ok('median of an odd and an even list', call('median([3, 1, 2])') === 2 && call('median([4, 1, 3, 2])') === 2.5);
ok('loadLadder dedupes to float tolerance and sorts',
   JSON.stringify(call('loadLadder([{ sets: [{ w: 45 }, { w: 40 }] }, { sets: [{ w: 45.0000000001 }, { w: 42.5 }] }])')) === '[40,42.5,45]');
ok('nextLoad takes the first rung within one and a half steps, else the step',
   call('nextLoad([40, 41, 45], 40, 2.5)') === 41 && call('nextLoad([40, 45], 40, 2.5)') === 42.5);
ok('prevLoad mirrors it', call('prevLoad([35, 39, 40], 40, 2.5)') === 39 && call('prevLoad([30, 40], 40, 2.5)') === 37.5);
```

**Verify**: `node test/unit.js` → `0 failed`, 7 more.

### Step 4: The unreached `targetFor` branches

Append, still in the fifteen-cases section:

- **Prose phase → `lastRho`**: `target([...3 sessions..., rir: '2+'], {
  phase: { r: 'Semana de técnica' } })` → `t.rirWeek === 2` (the `2+`
  chip reads as 2, `RIR_VALUE` at `js/app.js:1595`); the same with `rir:
  '0'` → `t.rirWeek === 0`. And with `minRir: 1` on the exercise and a
  prose phase → `t.rirWeek === 1`.
- **Segment restart**: six sessions where sessions 1–3 are strong
  (`[50, 10]`), then a `day` gap of 20 between session 3 and 4, then
  sessions 4–6 weaker (`[45, 10]`) — and ask for the target with
  `opts.now` seven days after session 6 (so the last gap is not a layoff).
  Assert `t.level` equals the capacity of a 45 kg session, not 50
  (`Math.abs(t.level - 45 * (1 + 11 / 30)) < 1e-6` with RIR 1).
- **`PSI_MIN` floor**: four sessions of `[[40, 12], [40, 2]]` on `'6–15'`
  with RIR `'1'` — the second set collapses, ratio ≈ 0.63 < 0.8 → the
  `phi` string's second value is `'0.800'`.
- **Three-rung cap**: two sessions `[[100, 4], [100, 3], [100, 3]]` and
  `[[100, 4], [100, 3], [100, 2]]` on `'10–15'`, `inc: 3`, `sets: 3`,
  `rirWeek: 1` → every set moved `'↓'` and the first set's weight is `91`
  (three rungs of 3 below 100, no ladder rungs in between). Pin the reps
  as they come out; if plan 025 has landed, also assert `t.notes` contains
  `'floor'`, otherwise assert it does not (and leave a comment naming 025).
- **`vuelta` for a set the plan gained since**: three sessions of two sets,
  then `opts.now` 20 days later with `sets: 3` → three target sets, the
  third at the last session's last weight and `r === lo`.
- **Bad range → `null`**: `target([...], { range: '15–10' })` → `null`;
  `range: 'AMRAP'` → `null`.

**Verify**: `node test/unit.js` → `0 failed`, ≥ 8 more.

### Step 5: Same lift on two days — headless

Directly after the fifteen-cases section, add a probe that calls
`exHistory` on a two-day block (the harness is one-day by construction):
block `B` with days `D1` and `D2` both holding exercise `E`; log `w1-D1`
and `w1-D2` and `w2-D1`, `w2-D2` with distinguishable weights; assert
`exHistory(profile, block, ex, 'D1', 3)` returns only the `D1` sessions
(check `.dayId`), and `exHistory(profile, block, ex, 'D2', 3)` only `D2`;
then a second profile where the previous block `A` (in `blockOrder` before
`B`) has `E` on one day only — assert its sessions are included for either
day of `B` (the day split applies inside the block being trained only, per
the comment at `js/app.js:3712-3720`). Call `resetRenderCache()` first, as
the harness does.

**Verify**: `node test/unit.js` → `0 failed`, 3 more.

### Step 6: `normalizeImportedObj` gets its own section

After the `normalizeImportedLog / normalizeImportedRir` section (after line
1290), add `== normalizeImportedObj (plans/026) ==` with one probe built
like `logProbe`: a `rawBlock`, `normalized = normalizeImportedBlock(rawBlock)`,
`dayId`/`exId` from it, then:

- a good record `{ 'w1-<dayId>': { [exId]: { v: 3, at: 1, conf: 'media',
  sets: [{ w: 45, r: 9, m: '↑' }] } } }` round-trips (`w === 45`, `m ===
  '↑'`, `conf === 'media'`);
- `'w0-…'` and `'w17-…'` keys are dropped;
- a day id the block does not have is dropped;
- an exercise id the day does not have is dropped;
- `sets: 'nope'` is dropped; `sets: []` is dropped;
- `w: 99999` clamps to `9999`, `r: -5` to `0`, `m: 'x'` to `''`;
- `conf: 'nonsense'` becomes `'baja'`;
- `at: 'yesterday'` becomes `0`.

**Only if `grep -n "TARGET_CONF_OPTIONS" js/app.js` finds it** (plan 021
or 025 has landed): also assert `conf: 'constructor'` becomes `'baja'`,
`kind: 'descarga'` round-trips, `kind: 'x'` is dropped, `hold: true`
round-trips and `hold: 'yes'` is dropped. At `4f7e037` the validator
accepts `'constructor'` through a truthy lookup on a plain object — that
is a known finding those plans fix, not something to pin here; a
`'constructor'` assertion written before they land fails on purpose and
would send you to a STOP condition.

**Verify**: `node test/unit.js` → `0 failed`, ≥ 10 more.

### Step 7: Move the orphaned heading

Cut `test/unit.js:2142` (the `requestWakeLock…` heading) and paste it
immediately above the first line of the wake-lock block (`const makeLock =
…`, around line 2300 — confirm with `grep -n "makeLock" test/unit.js`),
inside the same `{ … }` block if the assertions are in one.

**Verify**: `node test/unit.js 2>&1 | grep -A1 "requestWakeLock"` shows an
assertion line (`PASS  …`) directly under the heading, not another
heading.

### Step 8: Mutation check — the done criterion that proves the point

In a scratch directory outside the repo (never inside it), copy the files
the suite loads and break the rule two ways, then confirm the suite notices:

```bash
SCR="${TMPDIR:-/tmp}/heavy-iron-mut"; rm -rf "$SCR"; mkdir -p "$SCR"
cp -r js test blocks index.html sw.js manifest.webmanifest "$SCR/"
sed -i 's/^function theilSen(pts) {/function theilSen(pts) { return 0; \/\/ MUTANT/' "$SCR/js/app.js"
node "$SCR/test/unit.js" | tail -1          # expected: "… 1 failed" or more (T16)
cp js/app.js "$SCR/js/app.js"
sed -i 's/^const MAX_SLOPE = 0.03;/const MAX_SLOPE = 0.5;/' "$SCR/js/app.js"
node "$SCR/test/unit.js" | tail -1          # expected: "… 1 failed" or more (T16)
cp js/app.js "$SCR/js/app.js"
sed -i 's/^const PSI_MIN = 0.8;/const PSI_MIN = 0.5;/' "$SCR/js/app.js"
node "$SCR/test/unit.js" | tail -1          # expected: "… 1 failed" or more (Step 4)
rm -rf "$SCR"
```

(`PSI_MIN` is declared on one line with `PSI_PRIOR` at `js/app.js:3480`
— adjust the `sed` to that line's exact text.)

**Verify**: each of the three runs reports at least one failure; the
repo's own `node test/unit.js` reports `0 failed`.

## Test plan

This plan *is* the test plan. Counts: Step 2 (3), Step 3 (7), Step 4 (≥8),
Step 5 (3), Step 6 (≥10) — at least 31 new assertions, all in
`test/unit.js`, all following the fifteen-cases and `logProbe` patterns.

## Done criteria

- [ ] `node --check test/unit.js` exits 0
- [ ] `node test/unit.js` exits 0 with `0 failed` and ≥ 387 passed
- [ ] With `theilSen` stubbed to return 0 in a scratch copy, the suite reports ≥ 1 failure
- [ ] With `MAX_SLOPE = 0.5` in a scratch copy, the suite reports ≥ 1 failure
- [ ] With `PSI_MIN = 0.5` in a scratch copy, the suite reports ≥ 1 failure
- [ ] `grep -c "normalizeImportedObj" test/unit.js` ≥ 3
- [ ] `node test/unit.js 2>&1 | grep -A1 "== requestWakeLock"` shows a `PASS` line under the heading
- [ ] `git status --short` lists only `test/unit.js`
- [ ] `plans/README.md` status row for 026 updated

## STOP conditions

- The trend-term excerpt at `js/app.js:3880-3890` no longer has the
  `Math.max(oneRep, Math.min(theilSen(pts) / level, MAX_SLOPE))` shape.
- `targetFor` no longer sets `t.g`, `t.level`, `t.rirWeek` (grep
  `t.g = g` in `js/app.js`).
- T16 does not yield `g === 0.03` at `4f7e037` after checking all five
  sessions are uncensored — the arithmetic in "Current state" was
  reproduced; if it does not reproduce, the rule changed underneath.
  Report the observed `t` rather than adjusting the expectation.
- A new case reveals a defect in the rule (an `NaN`, a negative weight, a
  target above any weight in the history for a falling trend). Pin the
  current output with a `/* PINNED — see report */` comment and report.

## Maintenance notes

- Every future change to `targetFor` should keep the mutation check in
  Step 8 green in spirit: if a constant is added, add a case that fails
  when it is set to something absurd.
- T16's expectation is `MAX_SLOPE` itself; changing the constant changes
  T16 on purpose.
- The `u` and `opts.phase` harness extensions are for plans 025 (converted
  rows) and this plan; keep the two-element `[w, r]` form working.
- If `test/unit.js` ever grows a `--only`, these sections are the first
  to benefit; until then the suite is sub-second.
