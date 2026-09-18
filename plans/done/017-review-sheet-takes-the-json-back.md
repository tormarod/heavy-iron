# Plan 017: The review sheet takes the JSON back — paste the AI's block where the prompt was copied

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1838bf1..HEAD -- index.html js/review.js test/smoke.js README.md sw.js`
> On any in-scope change, compare the "Current state" excerpts below against
> the live code before proceeding; a mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. Plan 016 edits `js/review.js` too (different
  functions); land sequentially and take the highest `CACHE_VERSION` on
  conflict.
- **Category**: direction
- **Planned at**: commit `1838bf1`, 2026-09-18

## Why this matters

The review sheet is where the user copies the prompt that asks an AI for
the next block. Its own text then says: go and paste the JSON that comes
back "en Importar JSON" — close this sheet, open the block bar, open another
sheet, paste there. On a phone, switching between the AI's chat app and this
one, that is the step where the loop breaks. After this plan the review
sheet has a text box under its buttons: paste the JSON there, tap
**Importar el bloque siguiente**, and it lands as a new block through the
same validator and installer the import sheet uses. Nothing gets a looser
import by arriving here.

One hazard is specific to this sheet. `+ Nuevo bloque` opens the review
first and, when the review closes, resumes by asking for a name and
copying the old plan. If the user imports the next block *from that
review*, that continuation must be dropped — or the app would ask them to
name a second, empty block right after installing the real one.

## Current state

Files and their roles:

- `index.html` — `#reviewSheet` (lines 383–400) holds the review's markup.
- `js/review.js` — `wireReview()` (line 273) wires the three buttons;
  `openReview(afterClose)` (line 259) stores the continuation in the
  module-level `let reviewAfterClose` (line 190); `closeReview()`
  (line 265) runs it.
- `js/block-editor.js` — read only: `normalizeImportedBlock(raw)` (line 218)
  throws an `Error` with a Spanish message on a bad block;
  `installImportedBlock(normalized)` (line 366) files a validated block as
  a **new** block of the current profile, makes it active, and calls
  `commit()`. `applyImportedBlock` (line 378) is the import sheet's wrapper
  and is **not** reusable here: it writes its error to `$('importError')`
  and calls `closeSheet('importSheet')`, neither of which is this sheet.
- `js/app.js` — `$()`, `setNote(el, text, isError)`, `mark(msg)`,
  `flushSave()`, `getProfile()`.
- `css/style.css:568` — `.sheet-box textarea { ... }` already styles any
  textarea inside a sheet. No new CSS is needed.
- `test/smoke.js` — section `'revisión del bloque'` (line 2687) covers this
  sheet; see "Test plan".

Excerpt — `index.html:383-400`:

```html
  <!-- what the block actually did, and the brief for the next one -->
  <div class="sheet" id="reviewSheet">
    <div class="sheet-box" role="dialog" aria-modal="true" aria-labelledby="reviewTitle">
      <div class="sheet-t" id="reviewTitle">Revisión del bloque</div>
      <p class="sheet-d">Lo que de verdad hizo este bloque: fuerza por músculo, sesiones a las que llegaste y series que hiciste frente a las previstas. Todo sale de lo que ya tienes registrado.</p>
      <p class="sheet-d" id="reviewSub"></p>
      <div id="reviewHost"></div>
      <div class="sheet-hr"></div>
      <p class="sheet-d">Cópiate el prompt con esta revisión dentro y pásaselo a tu IA: el bloque que te devuelva estará escrito contra lo que pasó, no contra lo que recuerdes. Pega el JSON en "Importar JSON".</p>
      <div class="sheet-btns">
        <button class="sm key" id="reviewPrompt">Copiar prompt con la revisión</button>
        <button class="sm" id="reviewCopy">Copiar solo la revisión</button>
        <button class="sm" id="reviewDownload">Descargar (.txt)</button>
        <button class="sm" id="reviewClose">Cerrar</button>
      </div>
      <div id="reviewStatus" class="status u-status-left"></div>
    </div>
  </div>
```

Excerpt — `js/review.js:187-197` and `:259-271`:

```js
let reviewCache = null;
/* Set when the review was opened mid-flow by "+ Nuevo bloque": closing the
   sheet resumes creating the block instead of leaving you on a dead end. */
let reviewAfterClose = null;
...
function openReview(afterClose) {
  reviewAfterClose = typeof afterClose === 'function' ? afterClose : null;
  drawReview();
  openSheet('reviewSheet');
}

function closeReview() {
  closeSheet('reviewSheet');
  const next = reviewAfterClose;
  reviewAfterClose = null;
  if (next) next();
}
```

Excerpt — `js/block-editor.js:366-390`:

```js
function installImportedBlock(normalized, log, rir, order) {
  const profile = getProfile();
  const block = blockFromNormalized(normalized);
  profile.blocks[block.id] = block;
  profile.blockOrder.push(block.id);
  profile.activeBlock = block.id;
  profile.week = 1; profile.day = 0;
  installBlockData(profile, block.id, { log: log, rir: rir, order: order });
  commit();
  return block.id;
}

function applyImportedBlock(raw, sourceLabel) {
  let normalized;
  try {
    normalized = normalizeImportedBlock(raw);
  } catch (e) {
    setNote($('importError'), e.message, true);
    return;
  }
  installImportedBlock(normalized);
  closeSheet('importSheet');
  flushSave();
  mark('Bloque "' + normalized.name + '" importado' + (sourceLabel ? ' (' + sourceLabel + ')' : '') + ' en ' + getProfile().label);
}
```

Excerpt — the import sheet's own paste handler, the pattern to mirror,
`js/block-editor.js:1017-1022`:

```js
  $('importFromText').onclick = () => {
    setNote($('importError'), '', false);
    let raw;
    try { raw = JSON.parse($('importBlob').value); } catch (e) { setNote($('importError'), 'Eso no es JSON válido.', true); return; }
    applyImportedBlock(raw, 'texto pegado');
  };
```

Conventions that apply (from `AGENTS.md`):

- Spanish for every user-visible string; English comments explaining why.
- **CSP**: no inline `style="..."` attributes and no inline scripts in
  `index.html`. Use existing classes.
- `js/review.js` may read `normalizeImportedBlock` and
  `installImportedBlock` from `js/block-editor.js` (that file is precached
  in every deployed shell, so it is treated like `js/app.js`; `review.js`
  already reads `buildAiPrompt` from it).
- **Bump `CACHE_VERSION` in `sw.js`** — `index.html` and `js/` change.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/review.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed`, exit 0 (unchanged count) |
| Smoke, one section | `node test/smoke.js --only "revisión del bloque"` | every line `PASS`, exit 0 |
| Smoke prerequisites (once) | `npm install --no-save playwright@1.56.1 && npx playwright install chromium`, then `python3 -m http.server 8765 &` from the repo root | server answers on `:8765` |
| Bump | `tools/bump-cache-version.sh` | `CACHE_VERSION` incremented |

Do not run `node test/smoke.js` bare or `tools/smoke-gate.sh`; the full
suite runs once by the PR hook.

## Scope

**In scope** (the only files you may modify):
- `index.html` — inside `#reviewSheet` only
- `js/review.js` — `openReview`, `wireReview`
- `test/smoke.js` — section `'revisión del bloque'`
- `README.md` — one paragraph (Step 4)
- `sw.js` — `CACHE_VERSION` only

**Out of scope** (do NOT touch):
- `js/block-editor.js` — reuse its functions; do not edit them.
- `css/style.css` — the sheet textarea rule already applies.
- The import sheet (`#importSheet`) and its buttons.
- `newBlock()` — the continuation hazard is handled on the review side.

## Git workflow

- Branch: `claude/plan-017-implementation-<6 hex chars>`.
- One commit per step. Message: one imperative sentence in prose, e.g.
  `Let the review sheet take the next block's JSON back`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: the markup

In `index.html`, inside `#reviewSheet`, replace the paragraph that ends
`Pega el JSON en "Importar JSON".</p>` and the button row after it with:

```html
      <p class="sheet-d">Cópiate el prompt con esta revisión dentro y pásaselo a tu IA: el bloque que te devuelva estará escrito contra lo que pasó, no contra lo que recuerdes. Pega aquí el JSON que te devuelva y entra como bloque nuevo, sin tocar este.</p>
      <div class="sheet-btns">
        <button class="sm key" id="reviewPrompt">Copiar prompt con la revisión</button>
        <button class="sm" id="reviewCopy">Copiar solo la revisión</button>
        <button class="sm" id="reviewDownload">Descargar (.txt)</button>
      </div>
      <textarea id="reviewBlob" spellcheck="false" aria-label="JSON del bloque siguiente" placeholder='{"name":"Bloque 2","days":[...],"phase":{...}}'></textarea>
      <div class="sheet-btns">
        <button class="sm" id="reviewImport">Importar el bloque siguiente</button>
        <button class="sm" id="reviewClose">Cerrar</button>
      </div>
      <div id="reviewStatus" class="status u-status-left"></div>
```

Keep `#reviewStatus` as the last child, exactly where it is now.

**Verify**: `grep -c 'id="reviewBlob"\|id="reviewImport"\|id="reviewClose"' index.html`
→ `3`; `grep -c 'Importar JSON' index.html` → one fewer than before (the
review's mention is gone; the import sheet's own title remains).

### Step 2: the handler

In `js/review.js`:

1. In `openReview`, before `drawReview();`, add `$('reviewBlob').value = '';`
   so a sheet reopened later does not show a stale paste.

2. In `wireReview()`, after the `reviewDownload` handler, add:

   ```js
     /* The return leg of the loop the prompt button opens. The JSON the AI
        hands back lands here, on the sheet where the prompt was copied,
        instead of a trip through "Importar JSON" — the same validator and
        the same installer as that sheet, so arriving here is not a way to
        get a looser import. applyImportedBlock is not reused on purpose: it
        reports into the import sheet's own note and closes that sheet,
        neither of which is up. */
     $('reviewImport').onclick = () => {
       setNote($('reviewStatus'), '', false);
       let raw;
       try { raw = JSON.parse($('reviewBlob').value); } catch (e) { setNote($('reviewStatus'), 'Eso no es JSON válido.', true); return; }
       let normalized;
       try { normalized = normalizeImportedBlock(raw); } catch (e) { setNote($('reviewStatus'), e.message, true); return; }
       /* Opened from "+ Nuevo bloque", closing this sheet resumes creating a
          block by copying the old plan. The block just pasted IS the next
          block, so that continuation is dropped before the sheet closes —
          or the user is asked to name a second, empty one on top of it. */
       reviewAfterClose = null;
       installImportedBlock(normalized);
       $('reviewBlob').value = '';
       closeReview();
       flushSave();
       mark('Bloque "' + normalized.name + '" importado desde la revisión en ' + getProfile().label);
     };
   ```

**Verify**: `node --check js/review.js` → exit 0. `node test/unit.js` →
unchanged count, 0 failed (the harness loads `review.js` and calls
`wireReview()` against inert DOM stubs; a typo in an id would not throw
there, so the browser check in Step 3 is the real gate).

### Step 3: smoke assertions

Edit section `'revisión del bloque'` in `test/smoke.js`. Read the whole
section first (lines 2687–2795). Insert the two blocks below **after** the
existing "Declining goes straight to naming it" block (which ends with
`await page.click('#askCancel'); await page.waitForTimeout(300);`) and
**before** the comment `/* A block with nothing logged has nothing to review`.
The order matters: the earlier tests in the section assume `Bloque 1` is
still the active block with sets in it, and the last test resets the log
and only checks for the empty state.

```js
    /* The return leg, from the flow that needs it most: "+ Nuevo bloque"
       offers the review, the review takes the JSON back, and the
       continuation that would have asked to name a copied block is
       dropped — the pasted block is the next block. */
    const nextBlock = JSON.stringify({ name: 'Bloque siguiente', days: [{ name: 'Día A', ex: [{ n: 'Press banca', reps: '6–10', sets: 3 }] }] });
    await page.click('#blockbar button:has-text("+ Nuevo bloque")');
    await page.waitForTimeout(300);
    await page.click('#askOk');
    await page.waitForTimeout(400);
    ok('the review is up again from "+ Nuevo bloque"', await page.locator('#reviewSheet.up').count() === 1);
    await page.fill('#reviewBlob', 'esto no es json');
    await page.click('#reviewImport');
    await page.waitForTimeout(200);
    ok('a paste that is not JSON is refused on the sheet itself',
       (await page.locator('#reviewStatus').textContent()).includes('JSON') &&
       await page.locator('#reviewSheet.up').count() === 1,
       await page.locator('#reviewStatus').textContent());
    await page.fill('#reviewBlob', '{"name":"Sin días"}');
    await page.click('#reviewImport');
    await page.waitForTimeout(200);
    ok('and so is a block the validator rejects, with its own message',
       (await page.locator('#reviewStatus').textContent()).includes('days'),
       await page.locator('#reviewStatus').textContent());
    await page.fill('#reviewBlob', nextBlock);
    await page.click('#reviewImport');
    await page.waitForTimeout(500);
    ok('pasting the next block on the review installs it and closes the sheet',
       await page.locator('#reviewSheet.up').count() === 0);
    ok('without asking to name a second block afterwards',
       await page.locator('#askSheet.up').count() === 0);
    ok('it is the active block now',
       (await page.textContent('#title')).includes('Bloque siguiente'), await page.textContent('#title'));
    ok('as a new block beside the old one, not on top of it',
       await page.evaluate(() => getProfile().blockOrder.length) === 2 &&
       await page.evaluate(() => getProfile().blocks[getProfile().blockOrder[0]].name) === 'Bloque 1');
    ok('the old block keeps its log',
       await page.evaluate(() => Object.keys(getProfile().log['block-1'] || {}).length) === 7);
```

The `'Sin días'` case relies on `normalizeImportedBlock` throwing
`Falta "days" (al menos un día de entrenamiento).` for a block with no
`days` — see `js/block-editor.js:237`. If that message has changed, assert
on whatever it now says.

**Verify**: `node test/smoke.js --only "revisión del bloque"` → every
assertion `PASS`, including the existing ones, exit 0. If the last existing
test ("an empty block says there is nothing to review yet") fails after your
insertion, you inserted in the wrong place — it must run after yours, and it
reloads the page itself.

### Step 4: README and cache bump

In `README.md`, section "## The block review", the paragraph beginning
"**The export is the feature.**": replace

> paste the JSON that comes back into **Importar JSON**, and the next block

with

> paste the JSON that comes back into the box under those buttons — it lands
> as a new block, through the same checks **Importar JSON** runs — and the
> next block

Run `tools/bump-cache-version.sh`.

**Verify**: `grep -n "box under those buttons" README.md` → one line;
`git diff sw.js` → exactly the `CACHE_VERSION` line.

## Test plan

- Smoke (Step 3), in the existing `'revisión del bloque'` section, modelled
  on its own earlier assertions: three refusal/success cases and the
  continuation-dropped case.
- No unit change: the handler is DOM wiring, which `AGENTS.md` places on the
  smoke side of the line.
- Verification: `node test/smoke.js --only "revisión del bloque"` → all
  PASS, including nine new assertions.

## Done criteria

- [ ] `node --check js/review.js` exits 0
- [ ] `node test/unit.js` exits 0, count unchanged
- [ ] `node test/smoke.js --only "revisión del bloque"` exits 0 with nine more PASS lines than before
- [ ] `grep -n 'Importar JSON' index.html` no longer matches inside `#reviewSheet`
- [ ] `grep -n "reviewAfterClose = null" js/review.js` shows two matches (the existing one in `closeReview` and the new one in the import handler)
- [ ] `sw.js` `CACHE_VERSION` bumped by one
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 017 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `reviewAfterClose` is no longer a module-level `let` in `js/review.js`,
  or `closeReview` no longer runs it (the continuation hazard would then
  live somewhere else).
- `installImportedBlock` has changed signature or no longer calls `commit()`.
- The smoke section cannot find `#blockbar button:has-text("Revisión")` or
  `has-text("+ Nuevo bloque")` — the block bar was redrawn differently.
- After Step 3 the "+ Nuevo bloque" flow shows `#askSheet.up` after the
  import: the continuation fired. Do not add a second guard; report which
  code path re-set `reviewAfterClose`.
- A smoke assertion fails twice after a reasonable fix attempt.

## Maintenance notes

- Two entry points now install a pasted block: `applyImportedBlock` (import
  sheet) and this handler. Both must stay one line of validation
  (`normalizeImportedBlock`) plus one line of install
  (`installImportedBlock`). If a third arrives, factor a shared
  `installPastedBlock(raw, noteEl)` in `js/block-editor.js` rather than
  copying the pattern again.
- Anyone changing `newBlock()`'s review-first flow must keep the review
  handler's `reviewAfterClose = null` in mind: the review can now end a
  block's life by importing the next one.
- Reviewer: check the CSP console in the smoke run — the new textarea must
  pick up `.sheet-box textarea` with no inline style.
- Plan 016 makes the prompt and the review text richer; this plan is the
  return leg. Neither depends on the other.
