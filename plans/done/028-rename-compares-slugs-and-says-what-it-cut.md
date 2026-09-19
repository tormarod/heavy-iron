# Plan 028: A rename that only changes case, accents or punctuation does not cut the objetivo history, and a real rename says so when the plan is saved

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- js/app.js js/block-editor.js test/unit.js test/smoke.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW-MED (a looser rename test; the design decision is recorded below)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

When a plan-editor save changes an exercise's name, v3 records a "variant"
boundary dated today: everything logged before it is treated as a different
lift and stops feeding that exercise's objetivo. That is the right call for
"Elevaciones laterales en polea" → "Elevaciones en Y en polea cruzada". It
is the wrong call for "Press banca" → "Press Banca" or "Pajaros" →
"Pájaros", and at `4f7e037` those record a rename too: `recordVariant`
compares the two names with `===` after `txt()`, which only trims and
collapses whitespace. Fixing a typo silently discards months of target
history; the objetivo line disappears from the card; and the status line
says "Plan actualizado — el registro se mantiene", which is true of the
log rows and misleading about the rule.

**Decision (2026-09-19, maintainer)**: compare slugs, and name the
consequence in the status line. No confirm dialog. (The dialog variant —
"es otro ejercicio / solo cambié el nombre" — is recorded in
`plans/README.md` as a direction item and is not part of this plan.)

## Current state

Files:

- `js/app.js` — `recordVariant` (3656), `slugify` (2224), `txt` (near
  2239), `variantSince` (3598), `exHistory`'s cut (3742).
- `js/block-editor.js` — the save handler `$('peSave').onclick` (1110);
  the rename detection (1142–1155); the status line (1160).
- `test/unit.js` — "el objetivo guardado, las variantes y minRir"
  (1044–1196), with the `recordVariant` assertions at 1092–1106.
- `sw.js` — `CACHE_VERSION` at line 21.

`recordVariant` — `js/app.js:3656-3669`:

```js
function recordVariant(profile, exId, oldName, newName, ts) {
  const from = txt(oldName, IMPORT_LIMITS.exName) || '';
  const to = txt(newName, IMPORT_LIMITS.exName) || '';
  if (!to || from === to) return;
  const id = safeKey(exId);
  if (!id) return;
  if (!profile.variants) profile.variants = {};
  const list = profile.variants[id] || (profile.variants[id] = []);
  /* The variant that was running until today, dated only if this is the
     first rename we ever saw — after that its own `since` is already on
     file. Without it the cut would be "since the rename", with everything
     before it kept, which is the opposite of what a rename means. */
  if (!list.length && from) list.push({ n: from, since: '1970-01-01' });
  list.push({ n: to, since: isoDay(ts || Date.now()) });
  profile.variants[id] = list.slice(-VARIANT_LIMIT);
}
```

It returns nothing; the caller cannot tell whether a rename was recorded.

`slugify` — `js/app.js:2224-2227`:

```js
function slugify(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}
```

Strips accents, lowercases, collapses every run of non-alphanumerics to
one hyphen. `slugify('Press Banca') === slugify('press  banca')`,
`slugify('Pájaros') === slugify('Pajaros')`,
`slugify('Press (inclinado)') === slugify('Press inclinado')`. Two
genuinely different names — "Press banca" vs "Press inclinado" — still
differ.

The caller — `js/block-editor.js:1142-1161`:

```js
    /* An exercise whose NAME changed is a different lift from today on —
       "Elevaciones laterales en polea" became "Elevaciones en Y en polea
       cruzada" and the two are not on the same loads. Recorded here
       because this is the last moment the old name still exists: the log
       keeps no copy of it, so once the draft lands the only way to know
       where one variant ended is the date written now. See recordVariant
       and variantSince in js/app.js. */
    const liveBlock = profile.blocks[peDraftBlock.id];
    if (liveBlock) {
      const wasNamed = Object.create(null);
      (liveBlock.days || []).forEach(d => (d.ex || []).forEach(e => { if (e && e.id) wasNamed[e.id] = e.n; }));
      peDraftBlock.days.forEach(d => d.ex.forEach(e => {
        if (e && e.id && wasNamed[e.id] != null) recordVariant(profile, e.id, wasNamed[e.id], e.n);
      }));
    }
    profile.blocks[peDraftBlock.id] = peDraftBlock;
    peDraftBlock = null; peDraftPurge = []; peDraftOriginalDay = new Map();
    commit();
    closeSheet('planSheet');
    mark('Plan actualizado — el registro se mantiene');
```

`mark(text, isError)` sets the status line (`#status`). Earlier in the
same handler `snapshotForUndo('Plan actualizado.')` (line 1118) covers the
mistake for one action.

Existing assertions — `test/unit.js:1092-1106` (excerpt):

```js
const variants = call(`
  (function () {
    const p = { variants: {} };
    recordVariant(p, 'lat1', 'Elevaciones laterales en polea', 'Elevaciones en Y en polea cruzada', Date.UTC(2026, 6, 1));
    recordVariant(p, 'lat1', 'Elevaciones en Y en polea cruzada', 'Elevaciones en Y', Date.UTC(2026, 7, 3));
    recordVariant(p, 'lat1', 'Elevaciones en Y', 'Elevaciones en Y', Date.UTC(2026, 8, 1));
    return { list: p.variants.lat1, since: variantSince(p, 'lat1') };
  })()
`);
ok('the first rename records the name that was running before it, undated', …);
ok('every rename after it carries the day it happened', …);
ok('a save that changed no name records nothing', variants.list.length === 3, JSON.stringify(variants.list));
ok('and the cut is the last one', variants.since === Date.parse('2026-08-03T00:00:00Z'), String(variants.since));
```

Conventions: Spanish status text (short, no exclamation, the app's voice:
"Plan actualizado — el registro se mantiene"); English why-comments; a
`js/` change bumps `CACHE_VERSION`; rungs 1–2 after each step.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js && node --check js/block-editor.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| One smoke section (optional) | server on `:8765`, `node test/smoke.js --only "Guardar cambios"` | `0 failed` |
| Bump | `bash tools/bump-cache-version.sh` | next version in `sw.js` |

## Scope

**In scope**: `js/app.js` (`recordVariant`), `js/block-editor.js` (the save handler's rename loop and status line), `test/unit.js`, optionally `test/smoke.js`, `sw.js` (bump only).

**Out of scope**:
- A confirm dialog, or any way to declare "same lift" — decision above.
- `seedLateralVariants`, `variantSince`, `exHistory` — the cut mechanism
  stays as it is.
- Drawing the variant boundary on the chart (direction item).
- The `since` day granularity (recorded as not worth the shape change).

## Git workflow

- Branch: `claude/028-rename-compares-slugs-<6 hex chars>`.
- Commits: `Ignore case, accent and punctuation edits when recording a rename`, `Say in the status line that a renamed exercise's objetivo starts over`. Trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Compare slugs, and return whether a rename was recorded

In `recordVariant`:

```js
function recordVariant(profile, exId, oldName, newName, ts) {
  const from = txt(oldName, IMPORT_LIMITS.exName) || '';
  const to = txt(newName, IMPORT_LIMITS.exName) || '';
  /* Compared as slugs: a rename is the only evidence the lift changed, and
     fixing a capital, an accent or a bracket is not a rename — it used to
     cut months of history for "Pajaros" → "Pájaros". slugify strips exactly
     those and nothing a person would call a different name. */
  if (!to || slugify(from) === slugify(to)) return false;
  const id = safeKey(exId);
  if (!id) return false;
  …
  profile.variants[id] = list.slice(-VARIANT_LIMIT);
  return true;
}
```

Keep the stored names as `txt()`'d strings (not slugs). Update the
function's doc comment above it (`js/app.js:3641-3655`) to say the
comparison is by slug and why.

**Verify**: `node --check js/app.js`. `node test/unit.js` → `0 failed`
(the existing four assertions hold: the two real renames still record, the
identical name still does not).

### Step 2: Count the renames and say so

In `js/block-editor.js`, in the rename loop, collect the count:

```js
    let renamed = 0;
    if (liveBlock) {
      …
      peDraftBlock.days.forEach(d => d.ex.forEach(e => {
        if (e && e.id && wasNamed[e.id] != null && recordVariant(profile, e.id, wasNamed[e.id], e.n)) renamed++;
      }));
    }
```

and change the status line to name the consequence when it applies:

```js
    mark('Plan actualizado — el registro se mantiene' +
      (renamed ? ' · ' + renamed + (renamed === 1 ? ' ejercicio renombrado: su objetivo empieza de cero desde hoy'
                                                  : ' ejercicios renombrados: su objetivo empieza de cero desde hoy') : ''));
```

Add a sentence to the comment above the loop: the log is kept, the target
history is not, and the line has to say the second part or the user's
next session shows no objetivo with no explanation.

**Verify**: `node --check js/block-editor.js`. `node test/unit.js` → `0 failed`.

### Step 3: Unit assertions

In `test/unit.js`, after the `variants` assertions (after line 1106), add:

```js
/* A rename is a different lift; a spelling fix is not. */
const renameEdits = call(`
  (function () {
    const p = { variants: {} };
    const a = recordVariant(p, 'E', 'Press banca', 'Press Banca', Date.UTC(2026, 8, 1));
    const b = recordVariant(p, 'E', 'Pajaros', 'Pájaros', Date.UTC(2026, 8, 1));
    const c = recordVariant(p, 'E', 'Press (inclinado)', 'Press inclinado', Date.UTC(2026, 8, 1));
    const d = recordVariant(p, 'E', 'Press banca', 'Press inclinado', Date.UTC(2026, 8, 1));
    return { a, b, c, d, n: (p.variants.E || []).length };
  })()
`);
ok('a case-only edit records no rename', renameEdits.a === false, JSON.stringify(renameEdits));
ok('an accent-only edit records no rename', renameEdits.b === false, JSON.stringify(renameEdits));
ok('a punctuation-only edit records no rename', renameEdits.c === false, JSON.stringify(renameEdits));
ok('a real rename still records, and returns true so the save can say so',
   renameEdits.d === true && renameEdits.n === 2, JSON.stringify(renameEdits));
```

The status line needs the DOM, so pin it at source level:

```js
ok('the plan-editor save names a rename\'s consequence in its status line',
   /renombrad/.test(fs.readFileSync(path.join(ROOT, 'js/block-editor.js'), 'utf8')));
```

**Verify**: `node test/unit.js` → `0 failed`, 5 more. With Step 1 stashed,
the first three fail.

### Step 4 (optional): Smoke — the status text after a rename

If the environment allows, find the plan-editor smoke section (`node
test/smoke.js --list` → the one containing "Guardar cambios"), read how it
renames an exercise, and after a save that changed a name assert
`(await page.textContent('#status')).includes('renombrado')`; after a
save that only changed capitalisation, assert it does not. Only if the
section already edits names; do not build a new section for it.

**Verify**: `node test/smoke.js --only "Guardar cambios"` → `0 failed`.

### Step 5: Bump the cache version

`bash tools/bump-cache-version.sh`.

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → bumped.

## Test plan

- New unit assertions (Step 3): three non-renames, one real rename with
  the boolean, one source-level status check.
- Existing to keep green: the four `recordVariant` assertions (1101–1106),
  "a variant change cuts the sessions logged before it out of the history"
  (1127), the lateral-raise seed (1191–1193), the restore round-trip of
  `variants` (1150).

## Done criteria

- [ ] `grep -n "slugify(from) === slugify(to)" js/app.js` prints one line
- [ ] `grep -n "return true;" js/app.js` includes a line inside `recordVariant` (check with `sed -n '/^function recordVariant/,/^}/p' js/app.js`)
- [ ] `grep -c "renombrad" js/block-editor.js` ≥ 1
- [ ] `node --check` exits 0 on both `js/` files
- [ ] `node test/unit.js` exits 0 with `0 failed` and ≥ 5 more assertions
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a bumped version
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 028 updated

## STOP conditions

- `recordVariant` at `4f7e037` already returns a value or already compares
  slugs (someone got there first) — re-anchor and do only what is missing.
- `slugify` has changed so that it no longer strips accents (`grep -n
  "normalize('NFD')" js/app.js` empty) — the comparison would then be
  weaker than this plan assumes; report.
- The status line at `js/block-editor.js:1160` has been reworded or moved
  out of `peSave`.

## Maintenance notes

- The rename test is now "different slug". Two names that slug the same
  but mean different lifts ("Press 1" vs "Press 2"? — no, digits survive)
  are hard to construct; the realistic false negative is a name that
  differs only in a non-Latin character, which the seed plans never use.
- If a "same lift, new name" dialog is ever built (direction item), it
  replaces the count in Step 2, not `recordVariant`'s comparison.
- `recordVariant`'s boolean is read only by the save handler; the import
  path (`normalizeImportedProfile`) sanitizes `variants` without calling
  it.
- Reviewer: check the Spanish reads naturally in both singular and plural
  and stays under the status line's width on a 375 px phone (the line
  wraps; it just must not run to three lines).
