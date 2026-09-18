# Plan 018: The first week of a new block starts from what the previous block ended on

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

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — edits `buildExCard`, the app's hottest render path, and
  `copyPrev`, which writes to the log.
- **Depends on**: none. Plans 019 and 020 also edit `js/app.js` near
  `buildExCard`; land this one **last** of the three (largest change) and
  take the highest `CACHE_VERSION` on conflict.
- **Category**: direction
- **Planned at**: commit `1838bf1`, 2026-09-18

## Why this matters

Every block starts at week 1 with nothing behind it. The greyed placeholder
in the weight box walks this block's own earlier weeks (`priorWeight`), the
weekly objetivo reads this block's own history (`targetEstimate` via
`lastTimeCached`), and **Copiar pesos de la semana anterior** refuses
outright on week 1. So the first session of every block — the one both
lifters hit every eight weeks — asks for eight weeks of accumulated loads to
be retyped from memory, or by paging back through the old block. The log of
the block it was copied from is one step back in `profile.blockOrder`, and
the app already reads across blocks for the RÉCORD badge and the chart's
"Todos los bloques".

After this plan, on a session with no earlier history in its own block, the
card shows a third band — `BLOQUE 1 · SEM. 7` with the sets — and the weight
boxes carry that week's numbers as the greyed hint; ticking an empty box
adopts it and the status line names the block it came from; and **Copiar
pesos** on week 1 copies those numbers across. It is a **hint**, never a
target: the objetivo line stays silent on week 1, nothing is written until
the user ticks or copies, and the source block's deload week is skipped
(it is ~60 % of the working weight by design).

## Current state

Files and their roles:

- `js/app.js` — `priorWeight` (line 2415), `renderCache`/`resetRenderCache`
  (lines 2431–2437), `lastTime` (line 1983), `lastTimeOtherDay`,
  `liftSlots(block, ex)` (line 2027, returns `[{ dayId, dayIdx, exId }]`
  for every day of a block that plans the same lift — by id, then by name),
  `buildExCard` (line 2542) with the `band()` helper (line 2577), the set
  row loop with the placeholder (line 2729) and the tick handler
  (line 2739), `copyPrev` (line 3053), `blockWeeks`/`deloadWeek`
  (lines 465–470), `entry`, `setsFor`, `stampRowUnit`, `commit`, `mark`.
- `css/style.css` — `.last` bands (lines 277–293).
- `test/unit.js` — headless suite (`ok`/`call` pattern, see "Test plan").
- `test/smoke.js` — browser suite; `answerDialog(page, accept, text)`
  helper at line 74 answers the in-app `ask`/`askText` dialogs.

Excerpt — `js/app.js:2412-2437`:

```js
/* What you put on the bar for this set last time round, used as the greyed
   placeholder in the empty weight box. Walks back week by week and falls
   back to the last set of that week when the plan has since grown. */
function priorWeight(profile, blockId, w, dayId, exId, idx) {
  for (let k = w - 1; k >= 1; k--) {
    const s = profile.log[blockId] && profile.log[blockId][slot(k, dayId)];
    const rows = s && s[exId];
    if (!Array.isArray(rows) || !rows.length) continue;
    const r = rows[idx] || rows[rows.length - 1];
    if (r && r.w !== '' && r.w != null) return String(r.w);
  }
  return '';
}

/* Everything below is a pure function of (profile, block, week, day) and is
   asked for the same answer several times inside one render — ... */
let renderCache = null;

function resetRenderCache() {
  renderCache = { lastTime: Object.create(null), liftSlots: Object.create(null), slug: Object.create(null) };
}
```

Excerpt — the bands in `buildExCard`, `js/app.js:2575-2581`:

```js
  const prev = lastTimeCached(profile, block.id, day.id, ex.id, profile.week);
  ...
  const other = lastTimeOtherDay(profile, block, day, ex, profile.week);
  const band = (cls, tag, sets) => '<div class="last' + cls + '"><span class="tag">' + esc(tag) +
    '</span><span><b>' + sets.map(s => esc(setSummary(s))).join('</b> · <b>') + '</b></span></div>';
  const prevTxt =
    (prev ? band('', 'Sem. ' + prev.week, prev.sets) : '') +
    (other ? band(' other', 'Sem. ' + other.week + ' · ' + dayTag(block, other.dayId), other.sets) : '');
```

Excerpt — the placeholder and the tick's adoption, `js/app.js:2729-2733` and `:2739-2763`:

```js
    const [wIn, rIn] = row.querySelectorAll('input');
    const hint = priorWeight(profile, block.id, profile.week, day.id, ex.id, si);
    wIn.value = r.w; rIn.value = r.r;
    wIn.placeholder = hint || '—';
...
    tick.onclick = () => {
      let adopted = '';
      if (!r.done) {
        if ((r.w === '' || r.w == null) && hint) { r.w = hint; adopted = hint; stampRowUnit(r); }
        r.ts = Date.now();
      }
      ...
      save(); drawCard(ex.id);
      if (adopted) mark('Serie ' + (si + 1) + ' anotada con ' + adopted + ' ' + units() + ' (lo de la semana anterior) — cámbialo si no fue eso');
    };
```

Excerpt — the head of `copyPrev`, `js/app.js:3053-3056`:

```js
$('copyPrev').onclick = () => {
  const profile = getProfile(), block = getBlock(), day = currentDay();
  const src = profile.log[block.id] && profile.log[block.id][slot(profile.week - 1, day.id)];
  if (profile.week === 1 || !src) { mark('No hay nada registrado en la semana ' + (profile.week - 1) + ' para este día'); return; }
```

Excerpt — `dayTag`'s truncation, the pattern for a long block name in a tag,
`js/app.js:2047-2049`:

```js
  return name.length > 14 ? name.slice(0, 13).replace(/[\s+/-]+$/, '') + '…' : name;
```

Excerpt — `css/style.css:286-293`:

```css
/* The same lift on another day of the block, stacked under this session's
   own history. ... */
.last + .last { border-top: 0; padding-top: 0; }
.last.other .tag { color: var(--soft); font-weight: 700; }
```

Excerpt — `newBlock` keeps the exercise ids, `js/block-editor.js:183-189`:

```js
  const id = 'block-' + Date.now();
  const clone = JSON.parse(JSON.stringify(current));
  clone.id = id;
  clone.name = name;
  clone.createdAt = new Date().toISOString();
  clone.days = dayList(clone).map(d => { d.ex = exList(d); return d; });
```

Documented contract to honour (README, "During the session"): *"The greyed
number in it is what you lifted on that same set the last week you logged
it. Tick a set without typing anything and it takes that number, telling
you so in the status line."* This plan extends "last week" to "the last
time, which may be in the block before" — it does not change what a
placeholder means. Also (README, "The weekly objetivo"): *"The objetivo is
a line you read, never a number that gets logged for you."* Nothing here
touches the objetivo.

Conventions (from `AGENTS.md`): Spanish UI strings, English why-comments;
no inline styles (CSP) — new looks go in `css/style.css`; `esc()` on
anything stamped into `innerHTML` (the `band()` helper already does);
bump `CACHE_VERSION`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed`, exit 0 |
| Smoke, one section | `node test/smoke.js --only "primera semana de un bloque nuevo"` | every line `PASS`, exit 0 |
| Smoke, regression | `node test/smoke.js --only "main session"` | every line `PASS` |
| Smoke prerequisites (once) | `npm install --no-save playwright@1.56.1 && npx playwright install chromium`, then `python3 -m http.server 8765 &` from the repo root | server on `:8765` |
| Section list | `node test/smoke.js --list` | prints the section names, yours included |
| Bump | `tools/bump-cache-version.sh` | `CACHE_VERSION` incremented |

Do not run the full smoke suite or `tools/smoke-gate.sh`.

## Scope

**In scope** (the only files you may modify):
- `js/app.js` — one new function beside `priorWeight`; `resetRenderCache`;
  `buildExCard` (bands, hint, tick message); `copyPrev`
- `css/style.css` — the `.last` block
- `test/unit.js` — new section
- `test/smoke.js` — one new section
- `README.md` — two sentences (Step 5)
- `sw.js` — `CACHE_VERSION` only

**Out of scope** (do NOT touch):
- `targetEstimate`, `lastTime`, `lastTimeCached`, `lastTimeOtherDay` — the
  objetivo and the two existing bands keep their block-scoped meaning.
- `js/block-editor.js` `newBlock` — the new block is still a plain copy; the
  hint is read at render time, not written at creation.
- Unit conversion of the hint (`rowWeight`) — the placeholder is the number
  as typed, the same rule it has inside a block. If the previous block was
  logged in the other unit, the number still shows as typed.
- `js/chart.js`, `js/diagnostics.js`.

## Git workflow

- Branch: `claude/plan-018-implementation-<6 hex chars>`.
- One commit per step. Message: one imperative sentence in prose, e.g.
  `Show the previous block's last weights on the first week of a new one`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `priorBlockSets` — the previous block's last logged session for a lift

In `js/app.js`, directly after `priorWeight`, add:

```js
/* ---------- the block before this one ----------
   Every block starts at week 1 with nothing behind it: priorWeight walks
   this block's own weeks, targetEstimate reads this block's own history
   and copyPrev refuses on week 1 — so the first session of every block
   asked for eight weeks of loads to be retyped from memory. The log of the
   block this one was copied from is one step back in blockOrder.

   This reads it as a HINT only: a greyed placeholder and a labelled band,
   never a target, never a write. The deload week is skipped — it is ~60 %
   of the working weight by design, and it is usually the last week logged.
   The same lift is matched the way the chart's "Todos los bloques" matches
   it, by id and then by name (liftSlots), so a block that arrived as JSON
   with its own ids still finds the machine by its name. Newest earlier
   block first; within it, the latest week with a ticked set. */
function priorBlockSets(profile, block, ex) {
  const order = profile.blockOrder || [];
  let at = order.indexOf(block.id);
  if (at < 0) at = order.length;
  for (let b = at - 1; b >= 0; b--) {
    const prev = profile.blocks[order[b]];
    if (!prev || !profile.log[prev.id]) continue;
    const slots = liftSlots(prev, ex);
    if (!slots.length) continue;
    const dl = deloadWeek(prev);
    for (let w = blockWeeks(prev); w >= 1; w--) {
      if (w === dl) continue;
      for (let i = 0; i < slots.length; i++) {
        const s = profile.log[prev.id][slot(w, slots[i].dayId)];
        const arr = s && s[slots[i].exId];
        if (!Array.isArray(arr)) continue;
        const done = arr.filter(x => x && x.done && x.w !== '' && x.w != null);
        if (done.length) return { block: prev, week: w, dayId: slots[i].dayId, sets: done };
      }
    }
  }
  return null;
}

/* Once per card, not once per set row: the walk above visits every earlier
   block, and buildExCard asks for the hint on every row. Held in
   renderCache like lastTime is. */
function priorBlockSetsCached(profile, block, ex) {
  const key = block.id + '|' + ex.id;
  const c = renderCache && renderCache.priorBlock;
  if (c && key in c) return c[key];
  const v = priorBlockSets(profile, block, ex);
  if (c) c[key] = v;
  return v;
}
```

And in `resetRenderCache`, add the fourth map:

```js
  renderCache = { lastTime: Object.create(null), liftSlots: Object.create(null), slug: Object.create(null), priorBlock: Object.create(null) };
```

`liftSlots` is defined later in the file (line 2027) as a plain function
declaration; it is hoisted, so calling it from here is fine.

**Verify**: `node --check js/app.js` → exit 0; `node test/unit.js` → same
count as before, 0 failed.

### Step 2: the band and the hint on the card

In `buildExCard`:

1. After `const other = lastTimeOtherDay(...)` add:

   ```js
     /* Only when this block has nothing of its own to show for this lift —
        neither this session's earlier weeks nor another day's. The block
        before is older than either, and would only muddy a card that
        already has a history. */
     const prior = (!prev && !other) ? priorBlockSetsCached(profile, block, ex) : null;
     const priorTag = prior
       ? (prior.block.name.length > 14 ? prior.block.name.slice(0, 13).replace(/[\s+/-]+$/, '') + '…' : prior.block.name) + ' · Sem. ' + prior.week
       : '';
   ```

2. Extend `prevTxt` with a third band:

   ```js
     const prevTxt =
       (prev ? band('', 'Sem. ' + prev.week, prev.sets) : '') +
       (other ? band(' other', 'Sem. ' + other.week + ' · ' + dayTag(block, other.dayId), other.sets) : '') +
       (prior ? band(' prior', priorTag, prior.sets) : '');
   ```

3. In the set-row loop, replace the single `hint` line with:

   ```js
       const ownHint = priorWeight(profile, block.id, profile.week, day.id, ex.id, si);
       /* No earlier week in this block: the previous block's last logged
          session, same set index, last set when the plan has since grown —
          the same fallback priorWeight applies within a block. */
       const priorRow = (!ownHint && prior) ? (prior.sets[si] || prior.sets[prior.sets.length - 1]) : null;
       const hint = ownHint || (priorRow ? String(priorRow.w) : '');
       const hintFrom = ownHint ? 'la semana anterior' : (priorRow ? '"' + prior.block.name + '", semana ' + prior.week : '');
   ```

4. In the tick handler's final `mark(...)`, replace `(lo de la semana
   anterior)` with `(lo de ' + hintFrom + ')`.

In `css/style.css`, extend the dimmed-tag rule so the new band reads like
the "other day" one, and update its comment:

```css
/* The same lift on another day of the block — or, on a block with nothing
   logged yet, in the block before — stacked under this session's own
   history. ... */
.last + .last { border-top: 0; padding-top: 0; }
.last.other .tag, .last.prior .tag { color: var(--soft); font-weight: 700; }
```

**Verify**: `node --check js/app.js` → exit 0; `node test/unit.js` → 0
failed; `node test/smoke.js --only "main session"` → all PASS (the existing
placeholder and adopt assertions at lines 383–388 still hold: inside a
block, `ownHint` wins and the message still says `la semana anterior`).

### Step 3: `copyPrev` on week 1

Replace the head of the handler (the `src` line and the `if (profile.week
=== 1 || !src)` line) with:

```js
  /* Week 1 has no week before it in this block. The block before this one
     does — the same source the placeholder reads — so the button copies
     that across instead of refusing. No objetivo on top of it: the
     estimate needs a week of THIS block to price a step, and a deload as
     last week would price it wrong anyway. Plain copy, as the message says. */
  if (profile.week === 1) {
    let copied = 0;
    const names = new Set();
    exList(day).forEach(ex => {
      const prior = priorBlockSetsCached(profile, block, ex);
      if (!prior) return;
      const to = entry(profile, block.id, 1, day.id, ex.id, setsFor(ex, 1, block));
      to.forEach((r, i) => {
        if (r.done) return;
        const from = prior.sets[i] || prior.sets[prior.sets.length - 1];
        r.w = String(from.w);
        stampRowUnit(r);
      });
      copied++;
      names.add(prior.block.name);
    });
    if (!copied) { mark('No hay nada registrado antes de este bloque para los ejercicios de este día'); return; }
    commit();
    mark('Pesos copiados de ' + (names.size === 1 ? '"' + [...names][0] + '"' : 'bloques anteriores') + ' en ' + copied +
      (copied === 1 ? ' ejercicio' : ' ejercicios') + ' — tal cual, sin subir: el objetivo empieza cuando este bloque tenga una semana registrada');
    return;
  }
  const src = profile.log[block.id] && profile.log[block.id][slot(profile.week - 1, day.id)];
  if (!src) { mark('No hay nada registrado en la semana ' + (profile.week - 1) + ' para este día'); return; }
```

`priorBlockSetsCached` is safe here: `render()` ran before the click and
`resetRenderCache()` runs at the start of every `drawApp`, so the cache is
that of the current draw; `commit()` redraws afterwards.

**Verify**: `node --check js/app.js` → exit 0; `node test/unit.js` → 0 failed.

### Step 4: tests

**Unit** — append a section to `test/unit.js` before the final summary line
(`console.log('\n' + pass + ' passed, ...`). Pattern: `ok(name, cond,
extra)` and `call(expr)`.

```js
  console.log('\n== priorBlockSets: the block before this one, last logged week, deload skipped (plans/018) ==');
  const priorProbe = call(`
    (function() {
      state = defaultState(); migrate();
      const pr = state.profiles.hombre;
      const b1 = pr.blocks[pr.blockOrder[0]];      /* 8 weeks, deload on 8 */
      const day = b1.days[0];
      const ex = day.ex[0];
      pr.log[b1.id] = {};
      pr.log[b1.id][slot(6, day.id)] = { [ex.id]: [{ w: '60', r: '8', done: true }, { w: '60', r: '8', done: true }] };
      pr.log[b1.id][slot(7, day.id)] = { [ex.id]: [{ w: '65', r: '8', done: true }, { w: '65', r: '7', done: true }] };
      pr.log[b1.id][slot(8, day.id)] = { [ex.id]: [{ w: '40', r: '8', done: true }] };   /* the deload */
      /* A second block, a copy with the same ids — what "+ Nuevo bloque" makes. */
      const b2 = JSON.parse(JSON.stringify(b1)); b2.id = 'block-2'; b2.name = 'Bloque 2';
      pr.blocks[b2.id] = b2; pr.blockOrder.push(b2.id); pr.activeBlock = b2.id;
      /* A third, arrived as JSON: fresh ids, same name. */
      const b3 = JSON.parse(JSON.stringify(b1)); b3.id = 'block-3'; b3.name = 'Bloque 3';
      b3.days.forEach(d => d.ex.forEach(e => { e.id = 'imp-' + e.id; }));
      pr.blocks[b3.id] = b3; pr.blockOrder.push(b3.id);
      resetRenderCache();
      const fromCopy = priorBlockSets(pr, b2, b2.days[0].ex[0]);
      const fromJson = priorBlockSets(pr, b3, b3.days[0].ex[0]);
      const unknown = priorBlockSets(pr, b2, { id: 'nope', n: 'Nada de esto' });
      const first = priorBlockSets(pr, b1, ex);
      /* Only the deload logged: nothing usable. */
      delete pr.log[b1.id][slot(6, day.id)]; delete pr.log[b1.id][slot(7, day.id)];
      const onlyDeload = priorBlockSets(pr, b2, b2.days[0].ex[0]);
      return {
        copy: fromCopy && { block: fromCopy.block.id, week: fromCopy.week, w: fromCopy.sets.map(s => s.w).join('/') },
        json: fromJson && { block: fromJson.block.id, week: fromJson.week },
        unknown: unknown, first: first, onlyDeload: onlyDeload,
      };
    })()
  `);
  ok('a copied block reads the previous block\'s last non-deload week',
     priorProbe.copy && priorProbe.copy.block === 'block-1' && priorProbe.copy.week === 7 && priorProbe.copy.w === '65/65',
     JSON.stringify(priorProbe.copy));
  ok('a block that arrived as JSON with its own ids still finds the lift by name',
     priorProbe.json && priorProbe.json.block === 'block-1' && priorProbe.json.week === 7, JSON.stringify(priorProbe.json));
  ok('a lift the earlier blocks never planned gets nothing', priorProbe.unknown === null);
  ok('the first block of a profile has nothing before it', priorProbe.first === null);
  ok('a previous block whose only logged week is the deload is not used', priorProbe.onlyDeload === null);
```

**Smoke** — add a new section to `test/smoke.js`, placed directly after the
`'revisión del bloque'` section (before `// ---------- keeping the log on
the device ----------`). Read `answerDialog` (line 74) first: it accepts or
cancels the in-app dialog, typing `text` into `#askInput` when given. Model
the seeding on the review section's `page.evaluate` block.

```js
  // ---------- the first week of a new block sees the block before it ----------
  await section('primera semana de un bloque nuevo', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await dismissSetup(page);
    await page.waitForTimeout(700);

    /* Seven working weeks of one exercise, plus the deload at 40 — which
       must be the one week the hint does NOT come from. */
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('heavy-iron-v1'));
      const pr = s.profiles.hombre;
      const one = (w, r) => [{ w: String(w), r: String(r), done: true, ts: Date.now() }, { w: String(w), r: String(r - 1), done: true, ts: Date.now() }];
      pr.log['block-1'] = {};
      for (let i = 0; i < 7; i++) pr.log['block-1']['w' + (i + 1) + '-d0'] = { chestpress: one(60 + i * 2.5, 8) };
      pr.log['block-1']['w8-d0'] = { chestpress: one(40, 8) };
      pr.week = 8; pr.day = 0;
      localStorage.setItem('heavy-iron-v1', JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.click('#blockbar button:has-text("+ Nuevo bloque")');
    await page.waitForTimeout(300);
    await answerDialog(page, false);            /* "Crear sin repasar" */
    await page.waitForTimeout(300);
    await answerDialog(page, true, 'Bloque 2'); /* the name prompt */
    await page.waitForTimeout(500);
    ok('the new block opens on week 1', (await page.textContent('#title')).includes('Bloque 2'));

    const card = page.locator('.ex').first();
    const wIn = card.locator('.set-row').first().locator('input').first();
    ok('week 1 of the new block shows the previous block\'s last working week as the hint',
       await wIn.getAttribute('placeholder') === '75', 'got ' + await wIn.getAttribute('placeholder'));
    ok('under a band that names the block and the week it came from',
       (await card.locator('.last.prior .tag').textContent()).includes('Bloque 1') &&
       (await card.locator('.last.prior .tag').textContent()).includes('Sem. 7'),
       await card.locator('.last.prior').textContent());
    ok('the deload week was skipped', !(await card.locator('.last.prior').textContent()).includes('40'));
    ok('an exercise the old block never logged gets no band and no hint',
       await page.locator('.ex').nth(1).locator('.last.prior').count() === 0 &&
       await page.locator('.ex').nth(1).locator('.set-row').first().locator('input').first().getAttribute('placeholder') === '—');

    await card.locator('.set-row').first().locator('.tick').click();
    await page.waitForTimeout(300);
    ok('ticking the empty box adopts the hint', await wIn.inputValue() === '75');
    ok('and the status line says which block it came from',
       (await page.textContent('#status')).includes('"Bloque 1", semana 7'), await page.textContent('#status'));
    await page.click('#tskip');

    await page.click('#copyPrev');
    await page.waitForTimeout(400);
    ok('"Copiar pesos" on week 1 copies the previous block\'s numbers across',
       await card.locator('.set-row').nth(1).locator('input').first().inputValue() === '75');
    ok('and says so, with no increment applied',
       (await page.textContent('#status')).includes('"Bloque 1"') && (await page.textContent('#status')).includes('sin subir'),
       await page.textContent('#status'));
    ok('the objetivo line stays silent on week 1', await card.locator('.ex-est').count() === 0);
    await ctx.close();
  });
```

`chestpress` is the first exercise of the seed's first day (`js/data.js`);
`.ex` nth(1) is the second, which the seeding above never logs. If
`dismissSetup` is not the helper name in your checkout, use whatever the
review section calls right after `page.goto`.

**Verify**: `node test/unit.js` → `N+5 passed, 0 failed`.
`node test/smoke.js --list` → your section listed.
`node test/smoke.js --only "primera semana de un bloque nuevo"` → all PASS.
`node test/smoke.js --only "main session"` → all PASS.

### Step 5: README and cache bump

In `README.md`, section "## During the session", the bullet "**The weight
box already knows what you did last time.**" — after "…change it if the
weight was different." add:

> On the first week of a new block, where there is no last week yet, it
> shows what you lifted on that exercise in the block before — the last week
> you logged it, skipping the deload — under a band that names that block
> and week, and **Copiar pesos** copies those numbers across as they were,
> with no increment: there is no week in this block to earn one from yet.

In section "## Using it", the sentence "When the block ends, **+ Nuevo
bloque** starts the next one from a copy of the plan and leaves this one's
history where it is." — append: "Its first week already shows the loads the
old one ended on."

Run `tools/bump-cache-version.sh`.

**Verify**: `grep -n "skipping the deload" README.md` → one line;
`git diff sw.js` → the `CACHE_VERSION` line only.

## Test plan

- Unit (Step 4): five cases on `priorBlockSets` — copied block, JSON block
  matched by name, unknown lift, first block, deload-only source.
- Smoke (Step 4): one new section covering the band, the hint, the deload
  skip, the no-history card, the adopt message, `copyPrev` on week 1, and
  the objetivo staying silent. Regression: `main session` still passes its
  in-block placeholder assertions.

## Done criteria

- [ ] `node --check js/app.js` exits 0
- [ ] `node test/unit.js` exits 0, five more passes
- [ ] `node test/smoke.js --only "primera semana de un bloque nuevo"` exits 0
- [ ] `node test/smoke.js --only "main session"` exits 0
- [ ] `grep -n "priorBlock:" js/app.js` shows the new `renderCache` key
- [ ] `grep -n "lo de ' + hintFrom" js/app.js` shows the tick message reads the source
- [ ] `grep -c "last.prior" css/style.css` ≥ 1
- [ ] `sw.js` `CACHE_VERSION` bumped by one
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 018 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `liftSlots` no longer takes `(block, ex)` or no longer matches by name
  through `sameLift`.
- `renderCache` is no longer a plain object reset by `resetRenderCache()` at
  the start of a draw (the per-card cache would then be wrong).
- The `band()` helper or the `prevTxt` concatenation in `buildExCard` has
  been restructured (plans 019/020 landed differently than expected —
  re-read the live code and report the shape before editing).
- `buildExCard` already declares a local named `prior` (plan 020 names its
  card-level best `bar` precisely to leave `prior` free; if something else
  took it, rename yours `priorSets` throughout Step 2 and say so). Two
  `const`s of one name in one function is a parse failure that takes the
  whole shell down.
- `copyPrev` no longer bails with `profile.week === 1 || !src`.
- The `main session` smoke section fails on its placeholder/adopt
  assertions after Step 2: `ownHint` precedence is wrong. Do not weaken the
  assertions.
- A smoke assertion fails twice after a reasonable fix attempt.

## Maintenance notes

- The hint is deliberately blind to units: it shows the number as typed,
  like every session-view reader (see the comment by `rowWeight` in
  `js/app.js`). A previous block logged in lb under a kg setting shows lb
  numbers. Recorded, not fixed here; the same decision the session card
  makes.
- The objetivo on week 1 is still silent. Reading the previous block into
  `targetEstimate` is a separate decision (the previous block's last week
  is often the deload, and its phase table differs); do not extend
  `lastTimeCached` to earlier blocks without a plan.
- Reviewer: check that `prior` is only computed when both `prev` and
  `other` are null, and that `priorWeight` (this block) still wins the
  placeholder whenever it has an answer.
- If `newBlock` ever stops cloning exercise ids, the by-name fallback in
  `liftSlots` is what keeps this working — keep it.
- Follow-up recorded in `plans/README.md`: the "Todos los bloques" chart and
  Diagnóstico match lifts the same way; a shared `matchLiftAcrossBlocks`
  would let all three agree.
