# Plan 077: The app's own backup and profile file come back exactly as the app wrote them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If a STOP condition occurs, stop and report — do not
> improvise. Fill in "Maintenance notes" when done; the orchestrator
> maintains `plans/README.md` — do not edit it.
>
> **One PR** (`claude/077-own-round-trip`). It changes `js/`, so it
> **bumps `CACHE_VERSION`** once, as its last commit.
>
> **Drift check (run first)**: `git diff --stat dfa29a9..origin/main -- js/app.js js/profile-transfer.js test/unit.js AGENTS.md`
> — plans 074–076 run at the same time. 076 edits `undoLast` in
> `js/app.js`, far from here, and all of them edit `test/unit.js` and
> AGENTS.md in other places. Re-find each excerpt by its quoted text; a
> changed meaning is a STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW–MED (the restore and profile-file paths; the strict import
  path is only touched by decision 3)
- **Depends on**: none
- **Category**: bug (data fidelity) / tests
- **Planned at**: commit `dfa29a9`, 2026-09-23 — the maintainer asked for
  the topics plan 073 had set aside to be done after all

## Why this matters

A backup ("Guardar copia") and a profile file are the app's own data coming
back (AGENTS.md § Untrusted input, "The app's own files"). Restored into a
phone that holds the very same data, they should change nothing. They do
change it. Probed at `dfa29a9` by booting the app, writing its own backup
and profile files, restoring each into a boot of the same data, and
diffing what `save()` wrote before and after:

| Field | Before (as the app wrote it) | After a restore | Why |
|---|---|---|---|
| `profiles.hombre.theme` | `"hombre"` | `"azul"` | the importer maps a legacy accent name to its new one (`accentOf`); `migrate()` keeps it |
| `profiles.mujer.theme` | `"mujer"` | `"verde"` | the same |
| a seed exercise's `alt` | `""` | absent | the importer's `accept` drops an empty optional text; `migrate()`'s `repair` keeps it |
| a row with drops and no chosen kind: `dk` | absent | `"drop"` | the importer writes the default kind; every reader defaults it anyway (`dropKind`) |

None of these loses information: legacy accent names are valid stored
values (`legacyAccent`, and CSS has both `#app.profile-hombre` and
`#app.profile-azul`), an empty alt reads as no alt, and an absent `dk`
reads as `'drop'`. But the round trip is not an identity. So nothing can
simply assert "a restore of our own backup gives back what we had". Plan
073's tests had to compare a note and a set count instead, because of
exactly this. And a comment in `normalizeImportedProfile` claims "the same
rule migrate() applies" about the accent, which is not true.

## The decisions (settled — do not re-open)

1. **The principle: on the own path, what the app wrote comes back as it
   wrote it.** The importer may still *refuse* or *cap* (the limits of
   plans/010 and 055). It no longer *rewrites* a value that `migrate()`
   would keep as it is. The direction is always toward what the app
   stores: nobody's storage changes on load. Where the importer and
   `migrate()`'s repair disagree about a value the app's own writers
   produce, the importer's own path takes the repair's answer.
2. **The accent**: `normalizeImportedProfile` keeps a theme that is in
   `ACCENTS` or is a known legacy name (`legacyAccent(p.theme)` non-empty)
   exactly as it is. Anything else gets `accentOf(p)`'s default, as now.
   The comment is corrected: it names the one real difference left, an
   unknown theme's default (`'azul'` here, the seed's by place in
   `migrate()`), which only a file the app did not write can reach.
3. **The drop kind**: the `dk` entry of `ROW_FIELDS` (`js/app.js`) keeps a
   drop kind only when the row states a valid one (`DROP_KINDS`), and
   leaves it absent otherwise. Every reader already reads an absent kind
   as `'drop'` (`dropKind`). This touches every import path, since
   `rowFromImport` is shared, and it means the same thing on each. The
   existing assertion "...an unknown drop kind is a plain drop"
   (`test/unit.js`, the row codec section) pins the old default. It is
   updated to assert the *reading* (`dropKind(row) === 'drop'`) and that
   no `dk` is stored. Name this in the PR body.
4. **Optional text on the own path**: for every `EX_FIELDS` field whose
   `repair` is `repairOptionalText`, the `accept` returns, when
   `ctx.own`, what the repair would leave: a string is cut at the own
   limit and otherwise kept as typed, empty string included; anything
   else as today. The strict path (a pasted or scanned block from outside)
   keeps `txt()` and drops empties, as today.
5. **Found by the tests, not by this table.** The table is what a probe
   of the seed and a small hand-built state found. The round-trip tests
   of Step 1 use a richer state. Each further divergence they show is
   converged by decision 1, and listed in the PR body with the field and
   the fix. If a divergence is not a pure representation difference (the
   importer drops or changes information the app wrote, or a limit the
   app's own writers can exceed), STOP: that is plans/010's promise
   broken, and the fix is a decision.
6. **Plan 073's two workarounds are tightened**. Its "Cargar copia" and
   profile-file cases compare a note and a set count after "OK", and now
   compare the whole saved copy, deep-equal to the source's.
7. **AGENTS.md**: the bullet "**The app's own files.**" in § Untrusted
   input gains one sentence. What the app wrote comes back as it wrote it
   (decision 1), held by the round-trip test (name it).

## Current state

`js/profile-transfer.js`, the end of `normalizeImportedProfile` (about
line 255):

```js
  p.label = txt(p.label, 80);
  /* accentOf already encodes "in ACCENTS, or a known legacy value, or the
     default" — the same rule migrate() applies to a stored profile's theme. */
  p.theme = accentOf(p);
```

`js/app.js` — the accent tables and `accentOf` (search `const ACCENTS`):

```js
const ACCENTS = ['azul', 'verde'];
const LEGACY_ACCENT = { hombre: 'azul', mujer: 'verde' };
const legacyAccent = t => typeof t === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_ACCENT, t) ? LEGACY_ACCENT[t] : '';
…
function accentOf(profile) {
  return legacyAccent(profile.theme) || (ACCENTS.indexOf(profile.theme) >= 0 ? profile.theme : 'azul');
}
```

and `migrate()`'s rule (inside the profile loop):
`if (ACCENTS.indexOf(profile.theme) < 0 && !legacyAccent(profile.theme)) profile.theme = seed.theme;`.
The seed profiles in `js/data.js` carry `theme: 'hombre'` and
`theme: 'mujer'`, so every phone set up from the seed stores the legacy
names.

`js/app.js` — `EX_FIELDS`' optional text entries (search `key: 'alt'`):

```js
  { key: 'alt', max: IMPORT_LIMITS.alt, ownMax: OWN_TEXT_LIMIT,
    accept(v, ctx) { return v ? txt(v, exMax(this, ctx.own)) : undefined; },
    repair(ex) { repairOptionalText(ex, this.key, this.ownMax); },
    … },
  { key: 'cue', max: IMPORT_LIMITS.cue, ownMax: OWN_TEXT_LIMIT,
    accept(v, ctx) { return v ? txt(v, exMax(this, ctx.own)) : undefined; },
    repair(ex) { repairOptionalText(ex, this.key, this.ownMax); },
    … },
```

`repairOptionalText` (search it): "absent stays absent, text is cut as
above, and a value that is not text becomes what a restore would make of
it". `storedText(v, max)` cuts a string at `max` and never rewrites it.
`txt(v, max)` collapses whitespace and trims, then cuts. Check every
`EX_FIELDS` entry that uses `repairOptionalText`, not just these two.

`js/app.js` — the `dk` entry of `ROW_FIELDS` (search `key: 'dk'`):

```js
  { key: 'dk', col: 'tipo_bajada',
    /* Only where there is something for it to describe. */
    send: r => (dropsOf(r).some(dropUsed) ? dropKind(r) : undefined),
    accept: (raw, row) => (row.d ? (DROP_KINDS.indexOf(raw.dk) >= 0 ? raw.dk : 'drop') : undefined),
    cell: r => (dropsOf(r).some(dropUsed) ? DROP_LABEL[dropKind(r)] : '') },
```

The app writes `dk` only when the lifter picks a kind (the drop row's kind
buttons: `r.dk = k`). Adding a drop leaves it absent. `dropKind` reads
`r.dk` if valid, else `'drop'`.

How existing tests build the inputs:
- a backup's text:
  `boot.call("JSON.stringify({ app: STORAGE_KEY, v: 1, saved: new Date().toISOString(), data: state }, null, 2)")`;
- a profile file's text: `boot.call("profileExportPayload('hombre')")`;
- answering a dialog: `pressAnswering(boot, press, 'askOk')` (plan 053
  section), or `boot.call('closeAsk(true)')`.

Plan 073's section is `== "Deshacer" on every action that offers it,
through its real button (plans/073) ==`. Its restore and profile-file
cases hold the workaround (see its plan's Maintenance notes,
`plans/done/073-deshacer-tested-everywhere.md`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check js/app.js js/profile-transfer.js` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| Bump (last commit) | `bash tools/bump-cache-version.sh` | `sw.js` one version up |
| CR check | `node -e "for (const f of ['js/app.js','js/profile-transfer.js','test/unit.js','AGENTS.md']) console.log(f, (require('fs').readFileSync(f,'utf8').match(/\r/g)\|\|[]).length)"` | `0` each |

## Scope

**In scope**: `js/profile-transfer.js` (`normalizeImportedProfile`'s
accent line and comment), `js/app.js` (the `dk` entry of `ROW_FIELDS`;
the `accept` of `EX_FIELDS`' optional text fields, plus whatever decision
5 finds in `EX_FIELDS`/`ROW_FIELDS`), `test/unit.js` (the new section,
decision 3's assertion, decision 6's two cases), `AGENTS.md` (one
sentence), `sw.js` (the bump, through the tool), this plan's Maintenance
notes.

**Out of scope**: `migrate()` and every `repair` (the direction is toward
what the app stores, so storage never changes on load); `js/data.js` (the
seed keeps its legacy names and its empty `alt`); the strict import's
behaviour beyond decision 3; `undoLast` (plan 076); every other AGENTS.md
line.

## Git workflow

`git fetch origin && git checkout -B claude/077-own-round-trip --no-track origin/main`;
plain-sentence commit subjects; the bump is the last commit.

## Steps

### Step 1: the round-trip tests first, failing

A new section in the booted area of `test/unit.js`, right after the plan
073 section (and before `== adoptStored migrates before it commits
(plans/067 B) ==`), headed
`console.log('\n== the app\'s own backup and profile file come back as the app wrote them (plans/077) ==');`.

Compare with a deep-equal that ignores key order. Write a small
`canon(v)` that sorts object keys recursively before `JSON.stringify`,
because the importer may build an object's keys in a different order.
Cases:
1. **The seed**: boot a first-run state (with `setupDone: true`), and
   `advance(1000)` so it saves. Take its backup and restore it into a
   second boot holding the same saved state. `canon(saved before)` equals
   `canon(saved after)`. Then, for each profile key, the same with that
   profile's file through `loadProfileFromText`.
2. **A lived-in state**, built through the app's own handlers where they
   are cheap, and by the same writes the handlers make where not (say
   which in a comment):
   - ticks with weights and reps on two lifts, and a RIR digit;
   - a drop with no chosen kind, and one with a kind chosen through its
     button;
   - a note, an energy, and a session order;
   - "Empezar sesión" (objetivo records), if it is reachable in the
     harness; skip it with a comment if not;
   - a rename in the plan editor (a variant), and an exercise with an
     empty `alt`;
   - a second block ("+ Nuevo bloque");
   - a preference changed through "Ajustes";
   - legacy accent names, as the seed has them.
   Then the same backup and profile-file round trips as case 1.

Run them before any code change. They FAIL with the table's
differences, and perhaps more. Record every difference in your notes:
this is decision 5's list.

**Verify**: the new assertions FAIL on `origin/main`'s code, naming the
differing fields. Nothing else changed.

### Step 2: converge

Apply decisions 2, 3 and 4, then decision 5 for anything else Step 1
listed. The comments say why: the app's own file comes back as the app
wrote it (plans/077).

**Verify**: `node --check js/app.js js/profile-transfer.js`;
`node test/unit.js` → `0 failed`, the new section passing. The only
existing assertion that changes is decision 3's. Any other existing test
that now fails is a STOP.

### Step 3: plan 073's two cases

Tighten them per decision 6.

**Verify**: `node test/unit.js` → `0 failed`.

### Step 4: mutation checks (report each)

- restore `p.theme = accentOf(p);` → the round trips FAIL on `theme`.
  Revert;
- restore the `'drop'` default in `dk`'s accept → they FAIL on `dk`.
  Revert;
- restore `txt()` on the own path for `alt` → they FAIL on `alt`. Revert.

### Step 5: AGENTS.md

Decision 7's sentence. **Verify**: `node test/unit.js` → `0 failed`.

### Step 6: the bump

`bash tools/bump-cache-version.sh`, committed last. Rebase and re-bump at
push time if `origin/main` moved.

## Test plan

Steps 1, 3 and 4: the round trips of the seed and of a lived-in state,
through both own files; plan 073's two cases tightened; decision 3's
assertion updated; three mutation checks.

## Done criteria

- [ ] a restore of the app's own backup, and a load of each own profile
      file, into the same data, leaves the saved copy deep-equal (key
      order aside), for the seed and for the lived-in state
- [ ] `normalizeImportedProfile` keeps legacy and current accent names;
      its comment is true
- [ ] `dk` is stored only when stated and valid; the row codec assertion
      is updated as decision 3 says
- [ ] optional text comes back as written on the own path; the strict
      path is unchanged
- [ ] plan 073's two cases compare the whole saved copy
- [ ] `node test/unit.js` → `0 failed`; CR check `0`; one bump, last

## STOP conditions

- A divergence the round trips find loses or changes information the app
  wrote (decision 5).
- An existing test other than decision 3's fails after Step 2.
- Converging a divergence would need a change to `migrate()` or to a
  `repair` (the direction is wrong for this plan).
- Building a lived-in state needs a change to `test/harness.js`.

## Maintenance notes

- A new field the app writes gets its round trip for free: the test
  compares whole saved copies. A field whose importer rewrites what the
  app wrote fails it.
- **What the round trips found, and the fix for each** (the seed and a
  lived-in phone, each through its backup and both profile files):
  1. `theme`: a legacy accent name renamed. Decision 2.
  2. An exercise's empty `alt` or `cue` dropped (the seed's leg press,
     `newExercise()`). Decision 4: `acceptOptionalText` keeps any string
     on the own path.
  3. `dk: 'drop'` written on a row with drops and no chosen kind.
     Decision 3; the row codec's "...an unknown drop kind is a plain drop"
     now asserts no `dk` is stored and `dropKind` reads `'drop'`.
  4. The objetivo record's `hold: false` and `brake: false`, and a
     descarga's `rir: null`, dropped: `recordTarget` writes all three.
     Converging it failed "...with the false brake left off rather than
     stored", so the executor stopped (decision 5). **Orchestrator's
     decision**: converge toward storage. The record's `accept` keeps both
     flags as booleans and `rir: null`, and that assertion is rewritten as
     "...with its false brake kept as stored" (key present, value false).
  5. Text typed through the app's own boxes and tidied by `txt()`: an
     exercise's name and rep range, a day's name, a pair note's line
     break, a new block's name with a blank end, a label's double space;
     and a cleared pair note (`''`) dropped. **Orchestrator's decision**:
     decision 4 extends to every text field `migrate()` keeps as stored —
     `EX_FIELDS`' `n` and `reps` (`acceptText`), `normalizeImportedBlock`'s
     own branch (block name, day names, pair notes, phase texts), the label
     in `normalizeImportedProfile` and the `notes` part's `accept`. That
     extends this plan's Scope to `js/block-editor.js` (the own branch
     only) and to `normalizeImportedProfile`'s label. A paste is unchanged.
- **Left as they were, on purpose**: the machine settings and the three
  tags, whose repair tidies them on every load, so the import's `txt()`
  already gives `migrate()`'s answer (the lived-in phone types them with
  spaces, and they round-trip); a variant's name, since `clean()` serves
  the repair and the import alike; ids and `createdAt`.
- **What no box can store untidy**: the session note, which `setNoteText`
  tidies, and a phase text, which no box writes. The round trips cannot
  see either, so case 3 of the new section reads the rule straight off
  both paths for every text field.
- **Not converged, reported**: an exercise saved with no name
  (`emptyBlock()`'s starting exercise) still comes back named "Ejercicio
  N" on the own path, where `migrate()` keeps `''`. plans/010 decided it
  and "...which comes back with a name to show" pins it, so converging it
  would change an existing test. AGENTS.md's sentence names it.
- **Known and not done** (orchestrator: planned separately): a set's
  weight and reps are cut at 12 characters on every import
  (`LOG_LIMITS.val`) and their boxes have no `maxlength`; the objetivo
  record's weight is clamped at 9999. Older and the same kind (plans/055):
  a block's or day's name and a pair note past `OWN_TEXT_LIMIT` are cut by
  a restore, where `migrate()` keeps them whole.
- **Deviations**: `canon`/`differing` sit with the booted helpers after
  `reopen`, since plan 073's two cases use them too. The lived-in phone
  also starts a session in the deload week, which is what found
  `rir: null`. "Guardar" in Ajustes gives both profiles the current accent
  names, so the legacy ones are written back directly, with a comment. The
  comment on section 7's `restoreGaps` said the import drops `alt: ''`;
  corrected. Mutation checks: the plan's three, one per convergence after
  them, and two for the review's refinement below.
- **Review of #191, one line but for the pair note**: the own path kept a
  line break a file carries in any text field, and the dialogs quote a
  label, a block's, a day's and an exercise's name in bodies with
  `white-space: pre-line`. So a line break now survives only in the pair
  note, whose textarea is the one box that stores them. `storedLine`
  (beside `storedText`, `js/app.js`) turns each run of `\r`/`\n` into one
  space for the label, the block's and the days' names, an exercise's `n`,
  `reps`, `alt` and `cue`, the phase texts and the `notes` accept. Nothing
  the app writes changes. Case 3 expects one line but for the pair note,
  case 4 reads a crafted profile file through `loadProfileFromText`, and
  the lived-in phone's pair note is named after its round trips.
- **Look closely**: `storedLine` breaks at `\r` and `\n`, as the review
  set it. U+2028 and U+2029, which `txt()`'s `\s` used to collapse and a
  browser may also break a line at, pass through. A single-line box keeps
  one that is pasted in, so turning it into a space would make that round
  trip inexact; left for a decision.
