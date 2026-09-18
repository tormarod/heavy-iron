# Plan 020: A second RÉCORD for a new best estimated 1RM

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1838bf1..HEAD -- js/app.js css/style.css test/unit.js test/smoke.js README.md sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. Plans 018 and 019 also edit `js/app.js` around
  `buildExCard`; land sequentially (suggested: this one before 018) and take
  the highest `CACHE_VERSION` on conflict.
- **Category**: direction
- **Planned at**: commit `1838bf1`, 2026-09-18

## Why this matters

The RÉCORD badge fires when a completed set beats the best **weight** ever
logged on that exercise. The app's whole progression model is rep-first
double progression: most weeks the weight holds and the reps climb, and
`100 × 5` becoming `100 × 10` is real strength the badge cannot see. The
estimated one-rep max (`est1RM`, Epley) that the chart, Diagnóstico and
the objetivo already use prices exactly that. After this plan the same scan
that finds the best weight also finds the best estimate, and a set that
beats the estimate without beating the weight earns an outlined
**RÉCORD 1RM** badge — the weight badge still wins when both apply, so
nothing that fires today changes, and a 20-rep back-off set can never
claim one (the estimate stops at 15 reps, as it does everywhere else).

## Current state

Files and their roles:

- `js/app.js` — `bestByExercise` (line 2362) and `bestForExercise`
  (line 2394) each walk the profile's log and return `exId → best weight`;
  `buildExCard` (line 2542) defines `isPr` (line 2552), `cardPr`
  (line 2553), records `stat.pr` (line 2560), appends the badge
  (line 2641) and classes the set row (line 2716); `drawSessionFoot`
  (line 2909) counts `stat.pr` into the footer's "N récords personales";
  `est1RM` (line 3141), `hasReps` (line 3145), `EST_MAX_REPS = 15`
  (line 3190); `drawCard` (line 2870) builds `ctx.best` with
  `bestForExercise` for a single card.
- `css/style.css` — the record look, lines 472–476.
- `test/unit.js` — `bestProbe` (lines 1317–1360) asserts the two scans
  agree and skip the drawn session.
- `test/smoke.js` — `== personal record ==` in the `main session` section
  (lines 390–397).

Excerpt — `js/app.js:2359-2411` (both scans; the inner rule is identical):

```js
function bestByExercise(profile, skipBlockId, skipSlot) {
  const best = Object.create(null);
  Object.keys(profile.log).forEach(bId => {
    ...
      Object.keys(s).forEach(exId => {
        const rows = s[exId];
        if (!Array.isArray(rows)) return;
        rows.forEach(r => {
          if (!r || !r.done) return;
          const w = num(r.w);
          if (isNaN(w)) return;
          if (!(exId in best) || w > best[exId]) best[exId] = w;
        });
      });
  ...
function bestForExercise(profile, exId, skipBlockId, skipSlot) {
  const best = Object.create(null);
  ...
      rows.forEach(r => {
        if (!r || !r.done) return;
        const w = num(r.w);
        if (isNaN(w)) return;
        if (!(exId in best) || w > best[exId]) best[exId] = w;
      });
```

Excerpt — `js/app.js:2552-2561`, `:2641`, `:2716`:

```js
  const isPr = r => r.done && !isNaN(num(r.w)) && (!(ex.id in best) || num(r.w) > best[ex.id]);
  const cardPr = rows.some(isPr);
  ...
  const stat = {
    ex: ex, el: null, rows: rows, n: n,
    done: rows.filter(r => r.done).length, tonnage: 0, pr: cardPr, lastTs: 0,
  };
...
  if (cardPr) { const s = document.createElement('span'); s.className = 'badge pr'; s.textContent = 'RÉCORD'; nameEl.appendChild(s); }
...
    row.className = 'set-row' + (r.done ? ' done' : '') + (isPr(r) ? ' pr' : '');
```

Excerpt — `js/app.js:3141-3145`, `:3190`:

```js
const est1RM = (w, r) => w * (1 + r / 30);
...
const hasReps = r => r.r !== '' && r.r != null && !isNaN(num(r.r)) && num(r.r) > 0;
...
const EST_MAX_REPS = 15;
```

These are `const`s declared later in the file than `bestByExercise`; every
call happens at render time, after the whole script has evaluated, so
referencing them from the scan is safe.

Excerpt — `css/style.css:472-476`:

```css
/* A set that beat every previous week on this exercise. The tick goes amber
   instead of signal so you can see it happen without reading anything. */
.set-row.pr .tick.on { background: var(--amber); border-color: var(--amber); color: var(--on-share); }
.set-row.pr .set-n { color: var(--amber); font-weight: 600; }
.badge.pr { background: var(--amber); color: var(--on-share); }
```

Excerpt — the unit probe's assertions that must be updated, `test/unit.js:1335-1360`:

```js
    const all = bestByExercise(profile, blockId, here);
    const one = bestForExercise(profile, a, blockId, here);
    const noSkip = bestForExercise(profile, a, blockId, 'w9-dz');
    return {
      agreesWithSkip: one[a] === all[a],
      skipped: one[a],
      unskipped: noSkip[a],
      onlyOneKey: Object.keys(one).length,
      missingIsAbsent: (a + '|' + (a in bestForExercise(profile, 'nosuchexercise', blockId, here))),
    };
...
ok('it excludes the session being drawn, exactly as the full scan does',
   bestResult.skipped === 60, 'got ' + bestResult.skipped);
ok('and includes that session when it is not the one being skipped',
   bestResult.unskipped === 80, 'got ' + bestResult.unskipped);
```

A decision to carry forward, recorded in `plans/README.md` (third audit,
item 17): the badge compares the raw `num(r.w)`, **not** `rowWeight()`,
because it is judged against the number the row shows; converting it alone
would make the badge disagree with the row it sits on. The e1RM comparison
makes the same choice.

Conventions (from `AGENTS.md`): Spanish UI text, English why-comments; no
inline styles (CSP) — the new look is a class in `css/style.css`; bump
`CACHE_VERSION`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed`, exit 0 |
| Smoke, one section | `node test/smoke.js --only "main session"` | every line `PASS`, exit 0 |
| Smoke prerequisites (once) | `npm install --no-save playwright@1.56.1 && npx playwright install chromium`, then `python3 -m http.server 8765 &` from the repo root | server on `:8765` |
| Bump | `tools/bump-cache-version.sh` | `CACHE_VERSION` incremented |

Do not run the full smoke suite or `tools/smoke-gate.sh`.

## Scope

**In scope** (the only files you may modify):
- `js/app.js` — `bestByExercise`, `bestForExercise`, one shared inner
  helper, `buildExCard` (the `isPr` block, `stat.pr`, the badge, the row
  class)
- `css/style.css` — the record block
- `test/unit.js` — `bestProbe` and its assertions
- `test/smoke.js` — the `main session` section, after `== personal record ==`
- `README.md` — two sentences (Step 5)
- `sw.js` — `CACHE_VERSION` only

**Out of scope** (do NOT touch):
- `drawSessionFoot` — it counts `stat.pr`, which now covers both kinds; the
  footer text "N récords personales" is right for both.
- `est1RM`, `hasReps`, `EST_MAX_REPS`, `rowWeight` — read only.
- `js/chart.js`, `js/diagnostics.js` — they have their own e1RM readers.
- Drops (`r.d`): a drop is lighter than the set it came off, and `isPr`
  reads `r.w` only; nothing to add.

## Git workflow

- Branch: `claude/plan-020-implementation-<6 hex chars>`.
- One commit per step. Message: one imperative sentence in prose, e.g.
  `Award a second RÉCORD for a new best estimated 1RM`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: one walk, two values

In `js/app.js`, above `bestByExercise`, add the shared rule and change both
scans to return `exId → { w, e }`:

```js
/* One rule for both scans below: the heaviest completed weight, and the
   best estimated 1RM among the sets that can honestly carry one — reps
   present and at or under EST_MAX_REPS, where Epley stops drifting. `e` is
   null until a set with reps has been logged. Raw num(r.w), not
   rowWeight(): the badge is judged against the number the row shows, the
   decision the weight badge already made (plans/README.md, third audit
   item 17). */
function noteBest(best, exId, r) {
  if (!r || !r.done) return;
  const w = num(r.w);
  if (isNaN(w)) return;
  if (!(exId in best)) best[exId] = { w: w, e: null };
  else if (w > best[exId].w) best[exId].w = w;
  if (hasReps(r) && num(r.r) <= EST_MAX_REPS) {
    const e = est1RM(w, num(r.r));
    if (best[exId].e == null || e > best[exId].e) best[exId].e = e;
  }
}
```

Then in `bestByExercise` replace the four lines from `if (!r || !r.done)
return;` through `if (!(exId in best) || w > best[exId]) best[exId] = w;`
with `noteBest(best, exId, r);`, and do the same in `bestForExercise`. Update
the comment above `bestByExercise` ("The best weight ever completed…") to
say it returns the best weight **and** the best estimated 1RM per exercise.

**Verify**: `node --check js/app.js` → exit 0. `node test/unit.js` → the
four `bestProbe` assertions that read the result as a number now **fail**
(`agreesWithSkip`, `skipped === 60`, and the two `unskipped === 80`
checks); everything else passes. That is expected until Step 4.

### Step 2: the second badge on the card

In `buildExCard`, replace the `isPr`/`cardPr` lines with:

```js
  /* `bar`, not `prior`: plan 018 declares `const prior` in this same
     function for the previous block's sets, and two consts of one name in
     one scope is the parse failure that leaves every returning phone on
     "Cargando…" (AGENTS.md). "The bar a set has to clear" is the phrase the
     comment above bestByExercise already uses. */
  const bar = best[ex.id];
  const isPr = r => r.done && !isNaN(num(r.w)) && (!bar || num(r.w) > bar.w);
  /* A new best estimated 1RM at a weight already lifted: the rep progress
     double progression is made of, which the weight badge cannot see. Only
     against an existing estimate — the first session of an exercise already
     earns the weight badge, and two badges for one first set would devalue
     both — and never past EST_MAX_REPS, where the estimate stops being one.
     The weight badge wins when both apply. */
  const isPrE = r => !isPr(r) && r.done && !!bar && bar.e != null && hasReps(r) &&
    num(r.r) <= EST_MAX_REPS && !isNaN(num(r.w)) && est1RM(num(r.w), num(r.r)) > bar.e;
  const cardPr = rows.some(isPr);
  const cardPrE = !cardPr && rows.some(isPrE);
```

Then:

- `stat`: `pr: cardPr || cardPrE,`
- the badge: after the existing `if (cardPr) { ... 'RÉCORD' ... }` add
  `else if (cardPrE) { const s = document.createElement('span'); s.className = 'badge pr-e1rm'; s.textContent = 'RÉCORD 1RM'; nameEl.appendChild(s); }`
- the row class: `' pr'` stays for `isPr(r)`; add `(isPrE(r) ? ' pr-e1rm' : '')`.

In `css/style.css`, after `.badge.pr { ... }` add:

```css
/* A set that beat the best estimated 1RM without beating the weight —
   more reps at a load already lifted. Outlined where the weight record is
   filled, so the two read as first and second rather than as equals. */
.set-row.pr-e1rm .tick.on { background: var(--card); border-color: var(--amber); color: var(--amber); }
.set-row.pr-e1rm .set-n { color: var(--amber); font-weight: 600; }
.badge.pr-e1rm { background: transparent; color: var(--amber); border: 1px solid var(--amber); }
```

**Verify**: `node --check js/app.js` → exit 0.

### Step 3: `drawCard`'s single-card context

`drawCard` (line 2870) builds `best: bestForExercise(profile, exId, ...)`;
its result now has the `{ w, e }` shape, which Step 2's `bar = best[ex.id]`
reads. No change should be needed — confirm by reading the six lines after
`const ctx = {` in `drawCard` and checking nothing indexes `best[...]` as a
number.

**Verify**: `grep -n "best\[" js/app.js` → every match is inside `noteBest`
or reads `.w`/`.e` (or is `best[ex.id]` assigned to `bar`).

### Step 4: tests

**Unit** — update `bestProbe` in `test/unit.js`. In the seeded log, add a
high-rep set that must not move the estimate, and read the new shape:

```js
    const a = day.ex[0].id, b = day.ex[1].id, c = day.ex[2].id;
    ...
    profile.log[blockId][slot(1, day.id)] = { [a]: [{ done: true, w: '60', r: '8' },
                                                    { done: true, w: '50', r: '20' }],   /* > EST_MAX_REPS: must not win (50×20 would price 83) */
                                              [b]: [{ done: true, w: '30', r: '8' }],
                                              [c]: [{ done: true, w: '30', r: '20' }] }; /* only a high-rep set: weight yes, estimate no */
    ...
    return {
      agreesWithSkip: one[a].w === all[a].w && one[a].e === all[a].e,
      skipped: one[a].w,
      skippedE: one[a].e,
      unskipped: noSkip[a].w,
      unskippedE: noSkip[a].e,
      highRepOnly: all[c] && { w: all[c].w, e: all[c].e },
      ...
```

Update the two numeric assertions to read `bestResult.skipped === 60` and
`bestResult.unskipped === 80` as before (they now read `.w`), and add:

```js
ok('the same walk carries the best estimated 1RM, Epley over the set with reps — and a 20-rep set cannot win it',
   Math.abs(bestResult.skippedE - 60 * (1 + 8 / 30)) < 1e-9, 'got ' + bestResult.skippedE);
ok('an exercise logged only past EST_MAX_REPS has a best weight and no estimate',
   bestResult.highRepOnly && bestResult.highRepOnly.w === 30 && bestResult.highRepOnly.e === null,
   JSON.stringify(bestResult.highRepOnly));
ok('and the estimate follows the drawn session in when it is not skipped',
   Math.abs(bestResult.unskippedE - 80 * (1 + 8 / 30)) < 1e-9, 'got ' + bestResult.unskippedE);
```

(The seed's first day has seven exercises, so `day.ex[2]` exists.)

**Smoke** — in `test/smoke.js`, `main session`, directly after the
`== personal record ==` block (it ends with `await page.click('#tskip');`),
add:

```js
    console.log('\n== personal record on estimated 1RM ==');
    /* Week 3, same 30 as the week-2 record but more reps: not a heavier
       weight, so no RÉCORD — but a better estimate, so the outlined one. */
    await page.locator('.wk').nth(2).click();
    await page.waitForTimeout(300);
    const first3 = page.locator('.ex').first();
    await first3.locator('.set-row').first().locator('input').first().fill('30');
    await first3.locator('.set-row').first().locator('input').nth(1).fill('12');
    await first3.locator('.set-row').first().locator('.tick').click();
    await page.waitForTimeout(200);
    ok('the e1RM badge appears when reps beat the estimate at a weight already lifted',
       await first3.locator('.badge.pr-e1rm').count() === 1);
    ok('and the weight badge does not', await first3.locator('.badge.pr').count() === 0);
    ok('the row is marked with its own class', await first3.locator('.set-row.pr-e1rm').count() === 1);
    ok('and it counts as a record in the footer', (await page.textContent('#note')).includes('récord'));
    await page.click('#tskip');
```

This relies on the state the section has built: week 1 `22,5 × 10`, week 2
set 2 `30 × 8` (the existing weight record). At week 3 the scan skips the
drawn session, so the bar is `w = 30`, `e = est1RM(30, 8) = 38`; `30 × 12`
gives `42`. If the section's earlier fills have changed, adjust the numbers
so that the new set's weight equals the prior best and its estimate exceeds
it.

**Verify**: `node test/unit.js` → `N+3 passed, 0 failed` (the three
previously failing assertions pass again, three new ones added).
`node test/smoke.js --only "main session"` → all PASS, four new lines.

### Step 5: README and cache bump

In `README.md`, section "## During the session", the bullet "**RÉCORD**
appears on an exercise…" — after "The set's tick turns amber." add:

> A second badge, **RÉCORD 1RM**, outlined rather than filled, marks a set
> that beats your best *estimated* one-rep max on that exercise without
> beating the weight — the rep progress double progression is made of. It
> only fires once there is an estimate to beat, and never on a set past 15
> reps, where the estimate stops being one. When a set does both, the weight
> badge is the one you see.

In section "## Features", the bullet "**Session feedback while you train**":
change "a **RÉCORD** badge when a set beats everything you have ever logged
on that exercise" to "a **RÉCORD** badge when a set beats everything you
have ever logged on that exercise — by weight, or by estimated 1RM".

Run `tools/bump-cache-version.sh`.

**Verify**: `grep -n "RÉCORD 1RM" README.md` → at least one line;
`git diff sw.js` → the `CACHE_VERSION` line only.

## Test plan

- Unit (Step 4): the two scans agree on both values; the estimate is Epley
  over the set with reps; a >15-rep set is ignored for the estimate; the
  drawn session is skipped for both values.
- Smoke (Step 4): the isolation case — same weight, more reps — shows the
  outlined badge and not the filled one, marks the row, counts in the
  footer. The existing weight-record assertions still pass unchanged.

## Done criteria

- [ ] `node --check js/app.js` exits 0
- [ ] `node test/unit.js` exits 0, three more passes than at the start
- [ ] `node test/smoke.js --only "main session"` exits 0, four more PASS lines
- [ ] `grep -c "noteBest(best, exId, r)" js/app.js` → `2`
- [ ] `grep -n "pr-e1rm" js/app.js css/style.css` → matches in both
- [ ] `sw.js` `CACHE_VERSION` bumped by one
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 020 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `bestByExercise`/`bestForExercise` no longer share the inner rule shown
  in "Current state" (someone already refactored them — read and report).
- `isPr` in `buildExCard` reads anything other than `best[ex.id]` as a
  number.
- `buildExCard` already declares a local named `bar` (plan 018 landed with
  a different name than planned, or something else got there first). Pick
  another name — never `prior`, which 018 uses — and say so in your report.
- Any caller other than `buildExCard` and `drawCard` indexes the result of
  the two scans (`grep -n "bestByExercise\|bestForExercise" js/*.js`
  should show only those and the definitions).
- The `main session` section's earlier fills no longer produce a week-2
  record at `30 × 8` — adjust the numbers per Step 4, but if the record
  assertions themselves fail before your change, stop.
- An assertion fails twice after a reasonable fix attempt.

## Maintenance notes

- The badge is unit-blind on purpose (raw weight, third audit item 17). If
  that decision is ever reversed for the weight badge, reverse it here in
  `noteBest` at the same time, in one place.
- `EST_MAX_REPS` is the ceiling in four readers now (chart, Diagnóstico,
  the objetivo, this scan). Keep it one constant.
- Reviewer: check the footer count and `stat.pr` treat the two kinds as one
  record, that the weight badge still wins on a set that is both, and that
  the first-ever session of an exercise earns exactly one badge.
- Follow-up recorded in `plans/README.md`: a sheet listing every exercise's
  best weight and best estimate (an all-time "Récords" view) would read
  `bestByExercise` directly; the shape this plan gives it is what that
  sheet needs.
