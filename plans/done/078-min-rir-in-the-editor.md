# Plan 078: The plan editor can say which lifts never go to failure, and the default plans say it for theirs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report — do not improvise.
> Fill in "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` — do not edit it.
>
> **One PR** (`claude/078-min-rir-editor`). It changes `js/`, so it **bumps
> `CACHE_VERSION`** once, as its last commit.
>
> **Drift check (run first)**:
> `git diff --stat c82678d..origin/main -- js/block-editor.js js/data.js js/app.js blocks/hombre-bloque-1.json blocks/mujer-bloque-1.json docs/guide.md test/unit.js`
> Plans 079 and 080 may be in flight at the same time; both edit
> `js/app.js`, `docs/guide.md` and `test/unit.js`, in other places. Re-find
> each excerpt below by its quoted text rather than its line number; if
> the *meaning* of an excerpt changed, that is a STOP.

## Status

- **Priority**: P1 — the default plans' week 7 prices the lifts in question at 0 RIR (see "Why this matters")
- **Effort**: S
- **Risk**: LOW (one editor field on an existing, fully validated plan field; seed data for new installs only)
- **Depends on**: none
- **Category**: direction (a surface asymmetry with a correctness consequence)
- **Planned at**: commit `c82678d`, 2026-09-24 — picked by the maintainer from the eleventh pass (`plans/README.md`, "Eleventh pass")

## Why this matters

`ex.minRir` is the lowest reserve a lift is ever asked for, whatever the
week's goal says — "for the lifts nobody takes to failure — a squat, a
Romanian deadlift" (`weekRir`, `js/app.js`). Every path into the app
understands it: the import, the restore, `migrate()`, and the AI prompt,
which tells the AI to set it on exactly "sentadilla, peso muerto rumano,
hip thrust pesado". **The plan editor has no box for it**, and an import
always creates a *new* block, so nobody can set it on the block they are
training.

The two default plans need it most. Their week-7 goals say *"Última serie al
fallo SOLO en máquinas y aislamiento — nunca en hack ni peso muerto rumano"*
(his, `0–1 RIR`) and *"… nunca en hack, rumano ni hip thrust pesado"* (hers,
`1–2 RIR`). But their hack squat, Romanian deadlift and hip thrust carry no
`minRir`. A range reads as its hard end (`0–1 RIR` → 0), so his week-7
objetivo asks for reps to failure on every set of the two lifts the plan's
own text forbids taking to failure. `docs/guide.md` calls a target like that
"a weight you cannot make".

After this plan, the editor has a "RIR mínimo" box, and a fresh install's
default plans carry `minRir: 1` on those five exercises. An existing install
is not rewritten. The guide tells its owner to set the box, the same way it
already tells them to set `inc`.

## Current state

All excerpts are at `c82678d`.

**The field, declared once** — `js/app.js`, in `EX_FIELDS` (search
`{ key: 'minRir', lo: 0, hi: 5,`):

```js
  { key: 'minRir', lo: 0, hi: 5,
    accept(v) {
      if (v == null) return undefined;
      const n = clampInt(v, this.lo, this.hi, 0);
      return n > 0 ? n : undefined;
    },
    repair(ex) {
      if (ex.minRir == null) return;
      const n = this.accept(ex.minRir);
      if (n !== undefined) ex.minRir = n; else delete ex.minRir;
    },
    prompt() { return 'número entero opcional ' + this.lo + '-' + this.hi + ' — el RIR mínimo de ese ejercicio: nunca se le pide menos reserva que esta, aunque la semana pida menos. Ponlo (1) en los ejercicios que no se llevan al fallo — sentadilla, peso muerto rumano, hip thrust pesado — y déjalo fuera en máquinas y aislamiento'; } },
```

`clampInt` (top of `js/app.js`) is `Math.round(Number(v))` clamped, and `dflt`
when that is not finite. So `accept('')` is 0 → `undefined`, `accept('9')`
is 5, and `accept('0')` is `undefined`.

**Where the floor is applied** — `js/app.js`, `function weekRir(block, ex, w, lastRho)`:

```js
function weekRir(block, ex, w, lastRho) {
  let v = phaseRir(block, w);
  if (v == null) v = lastRho == null ? 0 : lastRho;
  const floor = num(ex && ex.minRir);
  return floor > 0 ? Math.max(v, floor) : v;
}
```

The card already shows the floor: the RIR box's grey placeholder is
`weekRir(block, ex, profile.week, null)` (search `const wkRir = phaseRir(block, profile.week) == null`).
**Nothing on the card needs to change.**

**The editor row** — `js/block-editor.js`, `function buildExRow(profile, day, ex, pos, liveCount)`.
The row's markup includes this pair of number boxes:

```js
    '<div class="pe-row">' +
      '<div><span class="pe-field-lbl">+1 serie desde sem.</span><input type="number" min="1" max="' + MAX_WEEKS + '" class="f-add"></div>' +
      '<div><span class="pe-field-lbl">Incremento de peso (' + esc(units()) + ')</span><input type="number" min="' + INC_MIN + '" max="' + INC_MAX + '" step="' + INC_STEP + '" class="f-inc"></div>' +
    '</div>' +
```

and they are bound further down:

```js
  row.querySelector('.f-add').value = ex.add || '';
  /* Clamped from 0, not from 1, so clearing the box still clears the
     field: clampInt('') is 0 raised to the low bound, so a floor of 1
     would read an empty box as "from week 1" and make `add` unremovable. */
  row.querySelector('.f-add').oninput = e => { const v = clampInt(e.target.value, 0, MAX_WEEKS, 0); if (v) ex.add = v; else delete ex.add; };
  row.querySelector('.f-inc').value = ex.inc || '';
```

`exField(key)` (used at the top of `buildExRow`: `exField(key).max`) returns
a field's `EX_FIELDS` entry. `.pe-row input[type=number]` is already styled
in `css/style.css`, so **no CSS change is needed**.

**The default plans** — `js/data.js`. His plan is `DEFAULT_DAYS_TU` and hers
is `DEFAULT_DAYS_PAREJA`. The five exercises, as they read now:

- his `hacksquat` (line 68): `{ id: 'hacksquat', muscle: 'Cuádriceps', share: 1, n: 'Sentadilla hack', alt: …, sets: 3, inc: 5, reps: '8–12', rest: …, cue: … }`
- his `rdl` (line 78): `{ id: 'rdl', muscle: 'Isquios', share: 1, n: 'Peso muerto rumano en multipower', alt: …, sets: 3, inc: 2.5, reps: '8–12', rest: 150, cue: … }`
- her `hacksquat` (line 99), her `hipthrust` (line 109: `… sets: 4, add: 5, inc: 5, reps: '8–12', …`), her `rdl` (line 110: `… sets: 4, add: 7, inc: 2.5, …`)

Their week-7 goals (line 37 his, line 53 hers) are quoted in "Why this matters".

**The published copies** — `blocks/hombre-bloque-1.json` and
`blocks/mujer-bloque-1.json` are the same plans, pretty-printed with 2
spaces, in the same key order, LF line endings. For example:

```json
          "id": "rdl",
          "muscle": "Isquios",
          "share": 1,
          "n": "Peso muerto rumano en multipower",
          "alt": "o hiperextensiones a 45°",
          "sets": 3,
          "inc": 2.5,
          "reps": "8–12",
```

`test/unit.js` § "seed plans match their published block files (plans/008
item 12)" compares `JSON.stringify(DEFAULT_DAYS_TU)` with
`JSON.stringify(hombreBlockFile.days)`. **Key order matters.**

**The docs that describe this** — `docs/guide.md`:
- the Features list, "**Plan editor**: edit exercise names, alternatives,
  cues, sets, reps, rest time, and shared/superserie flags …" (search
  `**Plan editor**`);
- § The guardrails, "**`ex.minRir` is a floor the week cannot get
  under.**" (search that text);
- § Los planes por defecto, the paragraph "**Progression.** Both week
  banners state the double-progression rule … and restrict week 7's
  to-failure sets to machines and isolation work rather than hack squats,
  RDLs and heavy hip thrusts." and, earlier in that section, "Every
  exercise in both plans declares an `inc` … Only new installs get them:
  an existing log is never rewritten, so set them yourself in **Editar
  plan** if you started before this."

**Conventions to match** (AGENTS.md):
- Every user-visible string is Spanish; code comments are English and say
  *why*, in prose.
- No `style` attribute anywhere (the CSP forbids it); classes only.
- Nothing newer than Safari 15 in `js/`.
- Anything in `index.html`, `css/` or `js/` changes → bump
  `CACHE_VERSION` with `tools/bump-cache-version.sh`.
- `.f-add` and `.f-inc` are the pattern for the new box: class names in
  lower case with an `f-` prefix, bound in `buildExRow` right after them.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/block-editor.js && node --check js/data.js && node --check js/app.js` | no output, exit 0 |
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed` (1538 passed at `c82678d`) |
| One smoke section | `node test/smoke.js --only "CSP"` | the section passes (needs `python3 -m http.server 8765` running, and Playwright — see AGENTS.md § How to verify a change) |
| Bump | `bash tools/bump-cache-version.sh` | `sw.js` `CACHE_VERSION` goes up by one |

Do **not** run the full `node test/smoke.js` or `tools/smoke-gate.sh`: the
PR hook runs it once when the PR is opened (AGENTS.md).

## Scope

**In scope** (the only files you should modify):
- `js/block-editor.js` — the box in `buildExRow`
- `js/data.js` — `minRir: 1` on the five exercises
- `blocks/hombre-bloque-1.json`, `blocks/mujer-bloque-1.json` — the same five edits
- `docs/guide.md` — the three places named above
- `test/unit.js` — new assertions (Step 4)
- `sw.js` — the version bump only (via the tool)

**Out of scope** (do NOT touch):
- `EX_FIELDS` itself, `weekRir`, `phaseRir`: the field and the rule already
  work. This plan only gives the field a box and data.
- `migrate()`: **no backfill** of `minRir` onto existing installs. "Absent"
  is also what a box cleared on purpose looks like, so a load-time
  backfill would make the field impossible to clear. The guide tells
  existing users to set it (Step 3).
- The card, the objetivo line, the AI prompt: they already read the floor.
- `README.md`: its Block JSON notes already describe `ex.minRir` correctly.
- `blocks/ejemplo-plantilla.json`: not a copy of the default plans.

## Git workflow

- Branch: `claude/078-min-rir-editor`, cut from `origin/main`
  (`git checkout -B claude/078-min-rir-editor --no-track origin/main`).
- Commits in the repo's style — a plain sentence, no prefix, e.g.
  "Plan 078: a RIR mínimo box in the plan editor", "Plan 078: the default
  plans' hack squat, RDL and hip thrust never go under 1 RIR",
  "Bump the shell to v145". End each message with the
  `Co-Authored-By` trailer the session gives you.
- The bump is its own last commit. Before pushing, compare `origin/main`'s
  `CACHE_VERSION` line with yours; if main moved past yours, rebase and
  re-run the tool.
- Open the PR only if the operator told you to. The PR hook runs the full
  browser suite.

## Steps

### Step 1: A "RIR mínimo" box in the editor row

In `js/block-editor.js`, `buildExRow`:

1. In the `pe-row` that holds `.f-add` and `.f-inc`, add a third cell after
   `.f-inc`:
   ```js
   '<div><span class="pe-field-lbl">RIR mínimo</span><input type="number" min="' + exField('minRir').lo + '" max="' + exField('minRir').hi + '" step="1" class="f-minrir"></div>' +
   ```
2. Right after the `.f-inc` binding (after its `oninput` handler's closing
   `};`), bind it through the field's own `accept`, so the editor and every
   import share one rule:
   ```js
   row.querySelector('.f-minrir').value = ex.minRir || '';
   row.querySelector('.f-minrir').oninput = e => { const v = exField('minRir').accept(e.target.value); if (v) ex.minRir = v; else delete ex.minRir; };
   ```
3. Put a short English comment above the binding. It should say why it goes
   through `accept`: one clamp for every path. It should also say why an
   empty box deletes the field: absent means "no floor", the same
   convention `.f-add` uses.

**Verify**: `node --check js/block-editor.js` → exit 0; `node test/unit.js` → `0 failed`
(the `EX_FIELDS` guard in the suite accepts the write, since `minRir` is declared).

### Step 2: The default plans declare the floor their own goals ask for

In `js/data.js`, add `minRir: 1` **immediately after the `inc` property**
of exactly these five exercise objects:
his `hacksquat` and `rdl` in `DEFAULT_DAYS_TU`; her `hacksquat`,
`hipthrust` and `rdl` in `DEFAULT_DAYS_PAREJA`.

Make the same five edits in the two JSON files: add
`"minRir": 1,` on its own line immediately after that exercise's
`"inc": …,` line, at the same indentation. That is two lines in
`blocks/hombre-bloque-1.json` and three in `blocks/mujer-bloque-1.json`.
Keep LF line endings. Use the Edit tool or node, not a Python
rewrite. `git diff --stat` must show only the added lines.

Add a one-line English comment near the top of `DEFAULT_DAYS_TU` (or next
to the first `minRir`) saying why these five: the week-7 goals say never
to failure on hack, RDL and heavy hip thrust. Do not add it to any other
exercise.

**Verify**:
- `grep -c "minRir: 1" js/data.js` → `5`
- `grep -c '"minRir": 1' blocks/hombre-bloque-1.json` → `2`; same for `blocks/mujer-bloque-1.json` → `3`
- `node test/unit.js` → `0 failed`, including the six "seed plans match their published block files" assertions

### Step 3: The guide says what the box does, and what an existing install must do

In `docs/guide.md`:

1. In the Features list's **Plan editor** item, add the new field, e.g.
   "… rest time, the lowest RIR a lift is ever asked for (**RIR mínimo**),
   and shared/superserie flags …".
2. In § The guardrails, add one sentence to the `ex.minRir` bullet: it is
   set per exercise in **Editar plan** → **RIR mínimo**. Empty means no
   floor.
3. In § Los planes por defecto:
   - In the **Progression** paragraph, add that the hack squat, the
     Romanian deadlift and her hip thrust carry a **RIR mínimo** of 1. So
     the objetivo never prices them past 1 RIR, even in the week that asks
     for 0–1.
   - Next to the existing "Only new installs get them … set them yourself
     in **Editar plan**" sentence about `inc`, say the same about the
     floor.

Write in the guide's existing voice (English prose, Spanish UI names in bold).

**Verify**: `node test/unit.js` → `0 failed` (the suite checks the guide's
internal links; a heading you did not touch cannot break them).

### Step 4: Tests

Add a section to `test/unit.js`:
`console.log('\n== "RIR mínimo" in the plan editor, and the default plans\' floors (plans/078) ==');`

Put it right after the `"Editar plan" on a booted app: send, retire, erase,
save (plans/053)` block, **inside the same enclosing block**. It needs that
block's helpers: `settled`, `seeded`, `reopen`, `planEditor` and
`pressAnswering`, defined around `test/unit.js` lines 8561-8833. Model the
presses on that section's first case (`boot.$('editPlan').onclick()`,
`boot.type(el, text)`, `pressAnswering(boot, () => boot.$('peSave').onclick(), 'askOk')`).

Cases:
1. **Set it**:
   - Boot `settled(seeded({ week: 2, day: 0 }))` and open the editor.
   - Type `'1'` into the first exercise's `.f-minrir` (row found with
     `planEditor(boot).row(0, <its name>)`).
   - Save, then `boot.clock.advance(1000)`.
   - Assert `getBlock().days[0].ex[0].minRir === 1`.
   - Assert that `reopen(boot)` reads the same.
2. **Clamp and clear**:
   - Type `'9'` → the draft holds `5`.
   - Type `'0'` → the draft has no `minRir` key.
   - Type `''` → no key.
   - Assert on `boot.call('peDraft.block.days[0].ex[0].minRir')` and on
     `'minRir' in …`.
3. **Shows what is stored**:
   - Seed the first exercise with `minRir: 2` through `seeded`'s `edit`
     callback.
   - Open the editor.
   - The box's `.value` is `2`.
4. **The default plans**, through `loadApp()`'s shared context (`call(…)`):
   - In `DEFAULT_DAYS_TU`, `hacksquat` and `rdl` have `minRir === 1`.
   - In `DEFAULT_DAYS_PAREJA`, `hacksquat`, `hipthrust` and `rdl` do.
   - No other exercise in either plan has a `minRir` key.
5. **What it buys**:
   - Build his default block (`freshBlock('block-1', 'Bloque 1', DEFAULT_DAYS_TU, DEFAULT_PHASE_TU, DEFAULT_PRIORITY_TU)`).
   - Find its `rdl`.
   - Assert `weekRir(block, rdlEx, 7, null) === 1`.
   - Assert that a machine exercise from the same block, `chestpress`,
     still gets `0` in week 7.

**Verify**: `node test/unit.js` → `0 failed`, with the new section's
assertions printed as PASS. Then prove the new tests can fail:

- Temporarily replace the `.f-minrir` `oninput` handler with
  `e => {}`. Case 1 must fail. Restore it.
- Temporarily remove one `"minRir": 1,` line from a JSON file. The
  seed-files assertion must fail. Restore it.

Record both mutation results in Maintenance notes.

### Step 5: See it in a browser

Start a server (`python3 -m http.server 8765`; in PowerShell:
`Start-Process python3 -ArgumentList '-m','http.server','8765'`). Then run:

- `node test/smoke.js --only "CSP"`. That section opens the plan editor
  and fails on any CSP violation.
- `node test/smoke.js --only "Guardar cambios"`.

**Verify**: both sections pass.

### Step 6: Bump the shell

Run `bash tools/bump-cache-version.sh` and commit `sw.js` alone as
"Bump the shell to vNNN".

**Verify**: `git diff origin/main -- sw.js` shows exactly one changed line, the
`CACHE_VERSION`; `node test/unit.js` → `0 failed`.

## Test plan

- New unit assertions: at least 8, in the section Step 4 names. They cover
  set, clamp, clear, display, the five seeded floors and the week-7 RIR on
  a seed lift versus a machine.
- Structural pattern: the plans/053 booted-editor section in
  `test/unit.js` (`planEditor`, `pressAnswering`).
- The two mutation checks in Step 4.
- Smoke: the "CSP" and "Guardar cambios" sections (Step 5). The PR hook
  runs the full suite.

## Done criteria

All must hold:

- [ ] `node --check` passes on `js/block-editor.js`, `js/data.js`, `js/app.js`
- [ ] `node test/unit.js` → `0 failed`, and the passed count is at least 1538 + 8
- [ ] `grep -c "f-minrir" js/block-editor.js` → `3` (markup, value, handler)
- [ ] `grep -c "minRir: 1" js/data.js` → `5`; the JSON files carry `2` and `3`
- [ ] `git diff --stat origin/main` lists only the in-scope files
- [ ] `sw.js`'s `CACHE_VERSION` is one above `origin/main`'s
- [ ] Maintenance notes filled in, including the two mutation results

## STOP conditions

Stop and report back — do not improvise — if:

- The `EX_FIELDS` `minRir` entry, `weekRir`, or `buildExRow`'s `.f-add` /
  `.f-inc` pair no longer match their excerpts.
- The seed-files assertions still fail after both files are edited
  (a key-order mismatch you cannot see). Do not "fix" it by reformatting
  the JSON files.
- Any existing unit assertion other than the new ones changes result.
  The seed floors should move no pinned number. If one moves, report
  which, and why.
- The CSP smoke section reports a violation. That would mean a `style`
  attribute reached the markup.
- The work seems to need a `migrate()` change or a change to `EX_FIELDS`.

## Maintenance notes

- Deviation: the comment placed above `DEFAULT_DAYS_TU` (Step 2) originally
  read "minRir: 1 on hack squat, RDL and (her) heavy hip thrust only …",
  which collided with that step's own verification,
  `grep -c "minRir: 1" js/data.js` → `5` — the comment's own text matched
  too, making it 6. Reworded to "A minRir floor of 1, on hack squat,
  RDL …" so the comment no longer contains the literal substring, and the
  grep reads 5 again.
- Deviation: the executor brief's Step 4 anchor is "before" the plans/060
  `console.log` line, but that line has its own preamble comment directly
  above it ("Deshacer used to have no end: …"). Inserting immediately
  before the `console.log` itself would have split that comment from its
  own section. Inserted this plan's whole new section immediately before
  that preamble comment instead — still directly ahead of the plans/060
  section as a unit, with no collision risk, since plans 079 and 080
  anchor at unrelated lines (plans/067 B and plans/071 B respectively).
- Mutation check 1 (Step 4): replaced the `.f-minrir` `oninput` handler
  with `e => {}`. Result: 3 of the 10 new assertions failed — both of
  case 1 ("typing "1" into the RIR mínimo box and saving sets minRir on
  the block", "...and the next open reads the same value back") and case
  2's first ("typing "9" into RIR mínimo clamps the draft to the field's
  hi bound, 5"); `node test/unit.js` read 1548 passed, 3 failed. Restored
  — back to 1551 passed, 0 failed.
- Mutation check 2 (Step 4): removed the `"minRir": 1,` line from the
  hack squat entry in `blocks/hombre-bloque-1.json`. Result:
  "blocks/hombre-bloque-1.json days match DEFAULT_DAYS_TU" (plans/008 item
  12) failed; nothing else moved. Restored — back to 1551 passed, 0
  failed.
- Nothing else deviated: no `migrate()` or `EX_FIELDS` change, no CSS
  change, no file outside the plan's declared scope.

- For the maintainer, on an **existing** install: this plan does not change
  your stored plan. Once it has shipped, open **Editar plan** on the block
  you are training and set **RIR mínimo** to 1 on the hack squat and the
  Romanian deadlift, plus her hip thrust. Do it before week 7.
- A future block written by the AI already sets `minRir` when the prompt's
  line is followed. A preview of what a pasted block changes, recorded but
  not planned in the eleventh pass, would be where a missing floor shows up.
- If a later plan adds other "advisory" exercise fields, the pattern here
  applies: a box bound through the field's own `accept`, with empty meaning
  absent.
