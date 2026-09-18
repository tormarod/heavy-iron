# Plan 016: The AI round-trip text carries what the app already knows — the user's own block in the prompt, per-exercise verdicts and RIR in the review

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1838bf1..HEAD -- js/block-editor.js js/review.js js/diagnostics.js test/unit.js README.md sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. Plan 017 edits `js/review.js` too (a different
  function, `wireReview`); land the two sequentially and take the highest
  `CACHE_VERSION` on conflict.
- **Category**: direction
- **Planned at**: commit `1838bf1`, 2026-09-18

## Why this matters

The README calls the block review's export "the feature": the user copies a
prompt, pastes it into an AI, and pastes the JSON that comes back into the
app. Today that prompt hands the AI a stranger's example block
(`blocks/ejemplo-plantilla.json`) as its only worked example, asks the user
to retype facts the app is displaying (unit, days per week, block length,
priority muscles, solo or pair), never says which unit the weights are in,
never mentions that exercises carry an `id`, and never says that a `phase`
week needs both `r` and `t` or it is silently replaced by the generic ramp.
The review text underneath it stops at muscle level: the per-exercise
verdicts the Diagnóstico screen already computes ("Peso mal elegido",
"Fatiga, no falta de esfuerzo") and the RIR chips the user tapped never
reach the model that writes the next block. After this plan the prompt
carries the user's own current block as JSON plus the facts the app holds,
and the review lists every exercise with its trend, its RIR history and its
reading — so the next block can keep the exercise ids it keeps, use the
right unit, and know which press stalled rather than only that chest went
nowhere.

This plan also closes a deferred item from plan 011: imported names were
interpolated undelimited into a document written for an LLM. Names are
delimited here.

## Current state

Files and their roles:

- `js/block-editor.js` — `buildAiPrompt()` (line 444) builds the prompt
  string; `copyBlockPrompt(noteEl)` (line 518) copies it and is wired to
  two buttons at lines 1028 (`importCopyPrompt`, the import sheet) and 1032
  (`setupCopyPrompt`, the first-run/settings sheet). `normalizeImportedBlock`
  (line 218) is the validator the prompt describes.
- `js/review.js` — `buildBlockReview(profile, block)` (line 33) gathers the
  numbers; `reviewText(r)` (line 132) renders them as the exported text;
  the `reviewPrompt` click handler (line 288) concatenates
  `await buildAiPrompt()` with `reviewText(reviewCache)`.
- `js/diagnostics.js` — `diagRows(profile, block)` (line 621) returns one
  row per exercise of the live plan with `id, name, day, sessions, trend,
  pct, change, est, gap` plus `{ lectura, cambio }` from `diagVerdict`. It
  reads the module-level `diagScope` at line 633. Its only caller today is
  `drawDiag` at line 843.
- `js/app.js` — symbols the two files above may call at runtime:
  `getProfile()`, `getBlock()`, `units()`, `soloMode()`, `dayList()`,
  `exList()`, `blockWeeks()`, `deloadWeek()`, `blockPriority()`,
  `blockSharePlan(block)` (line 4024, returns the plan exactly as
  "Descargar plan (JSON)" downloads it), `getRir(profile, blockId, w, dayId,
  exId)` (line 1552, returns `'2+' | '1' | '0' | ''`), `RIR_OPTIONS`
  (line 1549), `DEFAULT_INC` (line 90), `state.prefs.{inc,barWeight,plates}`,
  `state.setupDone` (false until first-run setup is saved, see line 203).
- `test/unit.js` — headless suite; see "Test plan".

Excerpt — the tail of `buildAiPrompt`, `js/block-editor.js:486-500`:

```js
  let example = '';
  try {
    const r = await fetch(blocksBase() + '/ejemplo-plantilla.json', { cache: 'no-store' });
    if (r.ok) example = JSON.stringify(JSON.parse(await r.text()));
  } catch (e) { /* offline: the prompt still works without the embedded example */ }
  if (example) lines.push('', 'Ejemplo de referencia (formato válido, contenido de muestra):', example);

  lines.push(
    '',
    'Ahora genera un bloque para mí según mis objetivos. Mi contexto: [tu nivel, cuántos días a la semana, material del gimnasio disponible, qué músculos priorizar, si entrenas solo o en pareja, y cuántas semanas quieres el bloque].',
    '',
    'Responde solo con el JSON.',
  );
  return lines.join('\n');
}
```

Excerpt — the `inc` and `phase` lines of the format spec, `js/block-editor.js:465` and `:481-483`:

```js
    '          "inc": número opcional, admite decimales, ' + INC_MIN + '-' + INC_MAX + ' — el escalón de peso más pequeño ...',
...
    '  "phase": { // opcional — objetivo de cada semana, clave = número de semana',
    '    "1": { "r": string corto, p.ej. RIR objetivo (máx ' + L.phaseR + ' car.), "t": texto del objetivo de esa semana (máx ' + L.phaseT + ' car.) }',
    '  }',
```

Excerpt — how the validator treats ids and phase, `js/block-editor.js:262`, `:274-277` and `:321-323`:

```js
    const dayIds = own ? new Set() : usedIds;
...
      const baseId = safeKey(txt(e.id, 60)) || (slugify(n) || ('ex-' + di + '-' + ei));
      let uniqueId = baseId, suffix = 2;
      while (dayIds.has(uniqueId)) uniqueId = baseId + '-' + (suffix++);
...
      phase[w] = (p && p.r && p.t)
        ? { r: txt(p.r, IMPORT_LIMITS.phaseR), t: txt(p.t, IMPORT_LIMITS.phaseT) }
        : generic[w];
```

Note what the first line means: on a pasted block, ids are unique across the
**whole block**, so an id repeated on two days is renamed `-2`. Do not tell
the AI to reuse one id on two days. The README's rule for "the same lift on
two days" is id **or** name (`sameLift` in `js/app.js:2016`), so the right
instruction is "keep my id for an exercise you keep; give the same lift the
same name on both days".

Excerpt — `copyBlockPrompt` and its callers, `js/block-editor.js:518-526`, `:1028`, `:1032`:

```js
async function copyBlockPrompt(noteEl) {
  setNote(noteEl, '', false);
  try {
    await copyText(await buildAiPrompt());
    setNote(noteEl, 'Prompt copiado — pégaselo a tu IA junto con tus objetivos', false);
  } catch (e) {
    setNote(noteEl, 'No se pudo copiar el prompt: ' + e.message, true);
  }
}
...
  $('importCopyPrompt').onclick = () => copyBlockPrompt($('importError'));
...
  $('setupCopyPrompt').onclick = () => copyBlockPrompt($('setupImportStatus'));
```

Excerpt — the review's prompt handler, `js/review.js:288-298`:

```js
  $('reviewPrompt').onclick = async () => {
    if (!reviewCache) return;
    setNote($('reviewStatus'), '', false);
    try {
      const prompt = await buildAiPrompt();
      await copyText(prompt + '\n\n' + reviewText(reviewCache));
```

Excerpt — the muscle rows of `reviewText`, `js/review.js:149-161` (the
section the new one goes after):

```js
  r.muscles.forEach(m => {
    const bits = [];
    ...
    L.push('- ' + m.tag + (m.priority ? ' (PRIORITARIO)' : '') + ': ' + bits.join(' · ') + '.');
  });
  const e = r.energy;
  if (e.baja.n || e.alta.n) {
```

Excerpt — `diagRows` reading the global scope, `js/diagnostics.js:621` and `:633`:

```js
function diagRows(profile, block) {
...
      const all = diagPoints(profile, ex.id, diagScope === 'all' ? '' : block.id);
```

Conventions that apply (from `AGENTS.md`):

- Spanish for every string a user sees or copies; English for code comments,
  which explain *why* in prose (often naming the bug they prevent). Match the
  existing comments in these files.
- `js/review.js` already reads `strengthRows`/`freqRows` from
  `js/diagnostics.js` and `buildAiPrompt` from `js/block-editor.js`; reading
  `diagRows`, `DIAG_TRENDS`, `DIAG_WINDOW` and `diagPct` from
  `js/diagnostics.js` is the same class of dependency. Do not add new
  top-level `const`/`let` names that already exist in any other `js/*.js`
  file (the thirteen scripts share one global scope).
- Nothing here touches `index.html` or CSS, so the CSP rules do not apply.
- **Bump `CACHE_VERSION` in `sw.js`** (Step 6) — CI fails the PR otherwise.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/block-editor.js && node --check js/review.js && node --check js/diagnostics.js` | exit 0, no output |
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed`, exit 0 |
| Bump | `tools/bump-cache-version.sh` (or `bash tools/bump-cache-version.sh` on Windows) | prints old and new version; `sw.js` line `const CACHE_VERSION = 'vNN';` incremented |

Record the `N` the unit suite prints **before** you change anything; Step 5
adds tests and the final `N` must be larger by exactly the number you add.
Do not run `node test/smoke.js` bare or `tools/smoke-gate.sh`: the full
browser suite runs once, by the PreToolUse hook, when a PR is opened.

## Scope

**In scope** (the only files you may modify):
- `js/block-editor.js` — `buildAiPrompt`, `copyBlockPrompt`, the two
  `.onclick` lines that call it
- `js/review.js` — `buildBlockReview`, `reviewText`, the `reviewPrompt`
  handler, one new helper
- `js/diagnostics.js` — `diagRows` signature only
- `test/unit.js` — new assertions
- `README.md` — two sentences (Step 6)
- `sw.js` — `CACHE_VERSION` only

**Out of scope** (do NOT touch):
- `index.html`, `css/style.css` — plan 017 adds the paste box to the review
  sheet; this plan changes text only.
- `normalizeImportedBlock` and `IMPORT_LIMITS` — the prompt must describe
  what the validator does today, not change it.
- `targetEstimate`, `diagVerdict`, `diagPoints` — read, never edit.
- `blocks/ejemplo-plantilla.json` — still the example on a first run.

## Git workflow

- Branch: `claude/plan-016-implementation-<6 hex chars>` (the repo's
  observed convention, e.g. `claude/plan-015-implementation-a8def3`).
- One commit per step or logical unit. Message style is one imperative
  sentence in plain prose, no prefix, e.g. `Let Escape close the Diagnóstico
  and Revisión sheets`. A good one here: `Hand the AI the user's own block
  and the facts the app already holds`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `diagRows` takes an explicit scope

In `js/diagnostics.js`, change the signature and the one read of the global:

```js
function diagRows(profile, block, scope) {
  /* The sheet's own toggle by default; the block review passes 'block'
     explicitly, because what it exports must not depend on whatever the
     Diagnóstico sheet happened to be showing last. */
  const useScope = scope || diagScope;
  ...
      const all = diagPoints(profile, ex.id, useScope === 'all' ? '' : block.id);
```

Leave the caller at line 843 (`diagRows(profile, block)`) unchanged — it
keeps reading the toggle.

**Verify**: `node --check js/diagnostics.js` → exit 0; `node test/unit.js` →
same `N passed, 0 failed` as before.

### Step 2: `buildAiPrompt(opts)` carries the user's own block and context

In `js/block-editor.js`:

1. Change the signature to `async function buildAiPrompt(opts)` and read
   `const withBlock = !!(opts && opts.withBlock);` at the top. Update the
   comment above the function: it now explains that, once the app is set up,
   the user's own block replaces the shipped example, so the AI sees the
   material, the names and the ids it is meant to keep.

2. Add one line to the exercise part of the format spec, directly after the
   `"n"` line:

   ```js
   '          "id": string opcional (máx 60 car.) — identificador estable del ejercicio. Si abajo te paso mi bloque actual, conserva el id de cada ejercicio que mantengas, para que su historial siga unido; un ejercicio nuevo puede ir sin id. El mismo ejercicio en dos días lleva el mismo nombre (no repitas el id en dos días: se renombraría),',
   ```

3. Prefix the `"inc"` line with the unit: replace
   `'          "inc": número opcional, admite decimales, '` with
   `'          "inc": número opcional (en ' + units() + '), admite decimales, '`.
   `units()` is defined in `js/app.js` and is callable here at runtime.

4. Append this line after the existing `"phase"` week line (the one starting
   `'    "1": { "r": string corto`):

   ```js
   '    // cada semana lleva "r" y "t" juntos: una semana con solo uno de los dos se sustituye por el objetivo genérico de la app',
   ```

5. Replace the example fetch and the context line. The shape to produce:

   ```js
   let example = '';
   /* The shipped example is for a device with nothing of its own yet. Once
      the app is set up the user's own block is the example — it is what the
      AI is being asked to write the next version of, and it carries the
      machines, the names and the ids the reply should keep. */
   if (!withBlock) {
     try {
       const r = await fetch(blocksBase() + '/ejemplo-plantilla.json', { cache: 'no-store' });
       if (r.ok) example = JSON.stringify(JSON.parse(await r.text()));
     } catch (e) { /* offline: the prompt still works without the embedded example */ }
     if (example) lines.push('', 'Ejemplo de referencia (formato válido, contenido de muestra):', example);
   }

   if (withBlock) {
     const block = getBlock();
     const days = dayList(block);
     const dl = deloadWeek(block);
     const priority = blockPriority(block);
     const p = state.prefs;
     const ctx = [
       'Entreno ' + (soloMode() ? 'solo' : 'en pareja') + '.',
       'Peso en ' + units() + '. Incremento por defecto: ' + p.inc + ' ' + units() + '. Barra: ' + p.barWeight + ' ' + units() + '. Discos por lado: ' + p.plates.join(', ') + '.',
       'Mi bloque actual, "' + block.name + '", tiene ' + days.length + (days.length === 1 ? ' día' : ' días') + ' por semana y ' +
         blockWeeks(block) + ' semanas' + (dl ? ', con descarga en la semana ' + dl : ', sin descarga') + '.',
       priority.length ? 'Músculos prioritarios: ' + priority.join(', ') + '.' : '',
     ].filter(Boolean).join(' ');
     lines.push(
       '',
       'Ahora genera el bloque siguiente para mí. Lo que la app ya sabe: ' + ctx,
       'Lo que no sé decirte desde la app: [tu nivel, tus objetivos para este bloque, y cualquier cambio de material, de días o de semanas].',
       '',
       'Mi bloque actual (JSON, en el mismo formato — es mi material, mis nombres y mis ids; conserva lo que mantengas y cambia lo que haga falta):',
       JSON.stringify(blockSharePlan(block)),
     );
   } else {
     lines.push(
       '',
       'Ahora genera un bloque para mí según mis objetivos. Mi contexto: [tu nivel, cuántos días a la semana, material del gimnasio disponible, qué músculos priorizar, si entrenas solo o en pareja, y cuántas semanas quieres el bloque].',
     );
   }
   lines.push('', 'Responde solo con el JSON.');
   return lines.join('\n');
   ```

   Everything referenced (`getBlock`, `dayList`, `deloadWeek`,
   `blockPriority`, `blockWeeks`, `soloMode`, `units`, `blockSharePlan`,
   `state`) is defined in `js/app.js` and is in scope at call time.

6. Thread the option through `copyBlockPrompt`:

   ```js
   async function copyBlockPrompt(noteEl, opts) {
     ...
       await copyText(await buildAiPrompt(opts));
   ```

   and at the two call sites:

   ```js
   $('importCopyPrompt').onclick = () => copyBlockPrompt($('importError'), { withBlock: true });
   ...
   /* On a first run there is no block of the user's own yet — only the
      shipped plan — so the prompt keeps the generic example. Reopened from
      "Ajustes" later, the block is real and goes in. */
   $('setupCopyPrompt').onclick = () => copyBlockPrompt($('setupImportStatus'), { withBlock: !!state.setupDone });
   ```

7. In `js/review.js`, the `reviewPrompt` handler: `await buildAiPrompt({ withBlock: true })`.

**Verify**: `node --check js/block-editor.js && node --check js/review.js` →
exit 0. `node test/unit.js` → still `N passed, 0 failed` (no test reads the
prompt text yet).

### Step 3: the review gathers per-exercise rows and RIR

In `js/review.js`:

1. Add a module-level cap next to `REVIEW_MAX_NOTES`:

   ```js
   /* Worst first, like the Diagnóstico sheet, so a cap drops the exercises
      that are going well — the ones the next block has least to change. */
   const REVIEW_MAX_EXERCISES = 40;
   ```

2. Add a helper that delimits a name coming from an import (closes plan
   011's deferred item):

   ```js
   /* Exercise names, day names and muscle tags arrive from imports and go
      into a document written for a language model. Delimited, so a name
      cannot read as an instruction to the model; `txt()` already collapsed
      whitespace on the way in, so the only characters to strip are the
      delimiters themselves. */
   const reviewName = s => '«' + String(s == null ? '' : s).replace(/[«»]/g, '') + '»';
   ```

3. In `buildBlockReview`, after the `notes` block and before `return`,
   gather the exercise rows:

   ```js
   /* The Diagnóstico sheet's own rows, scoped to this block whatever that
      sheet's toggle says. The verdict text is what the reader needs; `est`
      is a live object with functions behind it and stays out. */
   const exercises = diagRows(profile, block, 'block').map(x => {
     const rir = {};
     RIR_OPTIONS.forEach(k => { rir[k] = 0; });
     dayList(block).forEach(d => {
       if (!exList(d).some(e => e.id === x.id)) return;
       for (let w = 1; w <= weeks; w++) {
         const chip = getRir(profile, block.id, w, d.id, x.id);
         if (chip in rir) rir[chip]++;
       }
     });
     return { name: x.name, day: x.day, trend: x.trend, trendLabel: DIAG_TRENDS[x.trend].label,
              pct: x.pct, sessions: x.sessions, lectura: x.lectura, cambio: x.cambio, rir: rir };
   });
   ```

   and add `exercises: exercises,` to the returned object. `weeks` is the
   local computed at the top of the function.

4. In `reviewText`, after the `r.muscles.forEach(...)` loop and before
   `const e = r.energy;`, add:

   ```js
   if (r.exercises && r.exercises.length) {
     L.push('');
     L.push('### Por ejercicio');
     L.push('');
     L.push('Tendencia = pendiente del 1RM estimado por sesión, sobre las últimas ' + DIAG_WINDOW +
       ' sesiones de este bloque. La lectura y el cambio cruzan esa tendencia con el RIR marcado, las caídas de reps y las bajadas forzadas.');
     L.push('');
     r.exercises.slice(0, REVIEW_MAX_EXERCISES).forEach(x => {
       const bits = [];
       bits.push(x.trend === 'none'
         ? 'sin tendencia (' + x.sessions + (x.sessions === 1 ? ' sesión' : ' sesiones') + ')'
         : 'tendencia ' + x.trendLabel + ' ' + diagPct(x.pct) + ' por sesión sobre ' + x.sessions + ' sesiones');
       const chips = RIR_OPTIONS.filter(k => x.rir[k]).map(k => k + '×' + x.rir[k]);
       bits.push('RIR marcado: ' + (chips.length ? chips.join(', ') : 'ninguno'));
       L.push('- ' + reviewName(x.name) + ' (' + reviewName(x.day) + '): ' + bits.join(' · ') + '. ' + x.lectura + '. Cambio: ' + x.cambio);
     });
   }
   ```

5. Delimit the muscle tag in the existing muscle line: change
   `'- ' + m.tag + (m.priority ...` to `'- ' + reviewName(m.tag) + (m.priority ...`.
   Also delimit the day name in the notes lines: `n.day` →
   `reviewName(n.day)`. Leave the note text itself as it is (the user's own
   prose, already length-capped).

`diagPct` is `js/diagnostics.js:696` and formats a fraction as `+1,2 %`;
`DIAG_TRENDS[...].label` is `bajando | plano | subiendo | sin datos`.

**Verify**: `node --check js/review.js` → exit 0. `node test/unit.js` →
still passes (the existing `reviewUnitProbe` at `test/unit.js:1231-1248`
only checks tonnage arithmetic, but it exercises `buildBlockReview`, so a
thrown error here would show up as a failure there).

### Step 4: unit tests

Append a new section to `test/unit.js` **before** the final
`console.log('\n' + pass + ' passed, ' + fail + ' failed');` line. That
line sits inside an `async` function (the previous section uses `await`),
so `await call(...)` works. Pattern: `ok(name, condition, extra)` plus
`call(expr)` which evaluates `expr` in the shared app context.

```js
  console.log('\n== the round-trip text carries the app\'s own context (plans/016) ==');
  call('state = defaultState(); migrate(); state.setupDone = true; state.prefs.units = "kg";');
  const ownPrompt = await call('buildAiPrompt({ withBlock: true })');
  const ownPlan = call('JSON.stringify(blockSharePlan(getBlock()))');
  ok('with the app set up, the prompt carries the current block as JSON',
     ownPrompt.indexOf('Mi bloque actual') >= 0 && ownPrompt.indexOf(ownPlan) >= 0,
     ownPrompt.slice(-200));
  ok('and the shipped example is left out', ownPrompt.indexOf('Ejemplo de referencia') < 0);
  ok('it names the unit and the id field',
     ownPrompt.indexOf('Peso en kg') >= 0 && ownPrompt.indexOf('"id": string opcional') >= 0 && ownPrompt.indexOf('"inc": número opcional (en kg)') >= 0);
  ok('and says a phase week needs both keys', ownPrompt.indexOf('"r" y "t" juntos') >= 0);
  ok('it still asks for what only the user knows', ownPrompt.indexOf('[tu nivel') >= 0);
  const firstRunPrompt = await call('buildAiPrompt({ withBlock: false })');
  ok('on a first run the prompt has no block of its own in it',
     firstRunPrompt.indexOf('Mi bloque actual') < 0 && firstRunPrompt.indexOf('Mi contexto: [tu nivel') >= 0);

  /* Three sessions of one exercise is the minimum diagRows needs for a
     verdict; the RIR chips give the histogram something to count. */
  call(`
    (function() {
      const pr = state.profiles.hombre;
      const blockId = pr.blockOrder[0];
      const day = pr.blocks[blockId].days[0];
      const exId = day.ex[0].id;
      pr.log[blockId] = {};
      pr.rir[blockId] = {};
      for (let w = 1; w <= 4; w++) {
        pr.log[blockId][slot(w, day.id)] = { [exId]: [{ w: String(60 + w * 2.5), r: '8', done: true, ts: Date.now() - (5 - w) * 7 * 86400000 }] };
      }
      pr.rir[blockId][slot(2, day.id)] = { [exId]: '0' };
      pr.rir[blockId][slot(3, day.id)] = { [exId]: '0' };
      pr.rir[blockId][slot(4, day.id)] = { [exId]: '1' };
      day.ex[0].n = 'Press «raro» de banca';
      pr.week = 5;
      resetRenderCache();
    })()
  `);
  const review = call('reviewText(buildBlockReview(getProfile(), getBlock()))');
  ok('the review lists the exercises under the muscles', review.indexOf('### Por ejercicio') >= 0, review.slice(0, 400));
  ok('with the name delimited and the delimiters stripped from it',
     review.indexOf('- «Press raro de banca» (') >= 0, (review.match(/- «Press.*/) || [''])[0]);
  ok('a trend and a reading for an exercise with enough sessions',
     /«Press raro de banca».*tendencia (subiendo|plano|bajando) [+−]?[\d,]+ % por sesión sobre 4 sesiones/.test(review),
     (review.match(/- «Press.*/) || [''])[0]);
  ok('and the RIR chips tapped, as a histogram',
     review.indexOf('RIR marcado: 1×1, 0×2') >= 0, (review.match(/RIR marcado[^.]*/) || [''])[0]);
  ok('muscle tags are delimited too', /^- «Pecho»/m.test(review), (review.match(/^- «.*/m) || [''])[0]);

  /* The review must not inherit the Diagnóstico sheet's toggle. */
  call(`
    (function() {
      const pr = state.profiles.hombre;
      const b1 = pr.blocks[pr.blockOrder[0]];
      const b2 = JSON.parse(JSON.stringify(b1));
      b2.id = 'block-2'; b2.name = 'Bloque 2';
      pr.blocks[b2.id] = b2; pr.blockOrder.push(b2.id); pr.activeBlock = b2.id;
      const day = b2.days[0]; const exId = day.ex[0].id;
      pr.log[b2.id] = {};
      for (let w = 1; w <= 2; w++) {
        pr.log[b2.id][slot(w, day.id)] = { [exId]: [{ w: '80', r: '8', done: true, ts: Date.now() - (3 - w) * 7 * 86400000 }] };
      }
      pr.week = 3;
      diagScope = 'all';
      resetRenderCache();
    })()
  `);
  const scoped = call('diagRows(getProfile(), getBlock(), "block").find(r => r.id === getBlock().days[0].ex[0].id).sessions');
  call('resetRenderCache()');
  const global = call('diagRows(getProfile(), getBlock()).find(r => r.id === getBlock().days[0].ex[0].id).sessions');
  /* `global` is the two blocks' sessions together (4 + 2), capped by
     DIAG_WINDOW; asserted as "more than the scoped count" rather than as 6
     so a change to that window cannot fail a test about scope. */
  ok('diagRows scoped to the block counts only its own sessions while the sheet is on "Todos los bloques"',
     scoped === 2 && global > scoped, JSON.stringify({ scoped: scoped, global: global }));
  call('diagScope = "block"');
```

`diagPoints` (`js/diagnostics.js:72`) walks `profile.blockOrder`, matches
by exercise id, skips each block's deload week and has no ceiling at
`profile.week`, so the clone with the same ids contributes its sessions to
the unscoped count — that is what the assertion relies on.

If the first exercise of the seed's first day is not tagged `Pecho`, read
its `muscle` with `call('getBlock().days[0].ex[0].muscle')` and adjust the
muscle-tag assertion. If `RIR_OPTIONS` order differs from `['2+','1','0']`,
adjust the expected histogram string to that order.

**Verify**: `node test/unit.js` → `N+12 passed, 0 failed` (twelve `ok` calls
above), exit 0.

### Step 5: README

In `README.md`, section "## Importing blocks from JSON", after the sentence
ending "…(field names, limits, a worked example) to the clipboard." add:

> Once the app is set up, that prompt also carries your own current block as
> JSON — ids included, so the AI can keep the exercises it keeps — and the
> facts the app already knows: unit, default increment, bar and plates, days
> per week, block length and priority muscles. Only on a first run, before
> any setup, does it fall back to the shipped example.

In section "## The block review", after "It invents nothing; it gathers."
add:

> Under the muscle rows, the exported text lists every exercise of the plan
> with its trend, the RIR chips you tapped and the reading Diagnóstico gives
> it — so whatever writes the next block knows which press stalled, not
> only that chest went nowhere.

**Verify**: `grep -n "ids included" README.md` and
`grep -n "which press stalled" README.md` each print one line.

### Step 6: bump the cache version

Run `tools/bump-cache-version.sh`.

**Verify**: `git diff sw.js` shows exactly one changed line, the
`CACHE_VERSION` constant, incremented by one.

## Test plan

- New unit assertions (Step 4), modelled on the `estimateProbe` /
  `bestProbe` pattern already in `test/unit.js`: build state in a `call()`
  IIFE, `resetRenderCache()` before anything that reaches `targetEstimate`,
  assert with `ok(...)`.
- Cases: prompt with and without the own block; unit and id and phase text
  present; review has the exercise section, delimited names, trend text, RIR
  histogram, delimited muscle tag; `diagRows` scope override.
- No smoke change: the existing `revisión del bloque` section already clicks
  both copy buttons and asserts the status text, which is unchanged. If you
  want a browser check anyway: `node test/smoke.js --only "revisión del bloque"`.

## Done criteria

- [ ] `node --check` exits 0 on the three edited scripts
- [ ] `node test/unit.js` exits 0 with twelve more passes than before
- [ ] `grep -n "withBlock" js/block-editor.js js/review.js` shows the option at the definition, in `copyBlockPrompt`, at both `.onclick` sites and in the review handler
- [ ] `grep -n "diagScope === 'all'" js/diagnostics.js` returns no match inside `diagRows` (only `useScope === 'all'`)
- [ ] `grep -n "### Por ejercicio" js/review.js` returns one match
- [ ] `sw.js` `CACHE_VERSION` bumped by one
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 016 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `buildAiPrompt` no longer ends with the `Mi contexto: [tu nivel…` line,
  or `copyBlockPrompt` has gained parameters (drift).
- `diagRows` already takes a third parameter, or no longer reads
  `diagScope` (someone got here first — check `git log -5 -- js/diagnostics.js`).
- `blockSharePlan` is not defined in `js/app.js` or its return shape lacks
  `days`/`phase`.
- The unit probe in Step 4 throws inside `buildBlockReview` because
  `diagRows` needs a DOM object — it should not (it is pure), but if it does,
  report the stack rather than stubbing the DOM.
- A unit assertion fails twice after a reasonable fix attempt.

## Maintenance notes

- Any new field `normalizeImportedBlock` starts accepting must be added to
  the prompt's format spec in `buildAiPrompt` in the same PR — the prompt is
  the validator's public description.
- The review's per-exercise section reads `diagRows`; a change to the
  verdict matrix in `diagVerdict` changes the export. That is intended, but
  a reviewer should re-read the exported text once after such a change.
- `reviewName` delimits names with `«»`. If a future field of the export
  carries import-controlled text (a `pair` note, an `alt`), run it through
  the same helper.
- Deferred, on purpose: the prompt does not carry the previous block's
  review text when copied from the import sheet (only the review sheet
  staples the evidence); the review does not compare against the previous
  block (recorded in `plans/README.md` as a spike option).
- Plan 017 adds the paste box to the review sheet; together they close the
  loop the README describes.
