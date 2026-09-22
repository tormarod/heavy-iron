# Plan 055: One table for what a plan exercise may hold — `EX_FIELDS` — and your own backup gives back exactly what you typed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8142e33..HEAD -- js/app.js js/block-editor.js js/profile-transfer.js index.html test/unit.js test/smoke.js docs/guide.md`
> Plans 052 (test harness), 053 (plan draft: `js/block-editor.js`'s editor
> state and save) and 054 (deload) may land first. 053 touches the same
> file as Steps C and D; rebase over it. Re-locate every function below by
> grep.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED. `migrate()` runs on every load, and `normalizeImportedBlock`
  is the untrusted-input seam, so the equivalence check (Step F) is
  mandatory.
- **Category**: architecture and correctness — candidate 4 of the second
  architecture review (2026-09-22), settled with the maintainer the same
  day.
- **Planned at**: commit `8142e33`, 2026-09-22

## Why this matters

A plan exercise can carry 17 fields: `id`, `n`, `reps`, `sets`, `rest`,
`alt`, `cue`, `setup`, `add`, `inc`, `minRir`, `share`, `ss`, `muscle`,
`pattern`, `type` and `off`. Their rules are written out separately in
five places, and the copies have drifted:

- **`normalizeImportedBlock`** (js/block-editor.js ~251+, the exercise map
  ~290–350):
  - text caps from `IMPORT_LIMITS` (app ~3287: `exName` 120, `alt` 200,
    `cue` 400, `reps` 40) and `SETUP_LIMIT` 200;
  - `sets` 1–12, default 3; `rest` 0–900, default 90;
  - `add` must be an integer ≥ 1 and is rejected loudly otherwise;
  - `inc` goes through `clampNum`, and `minRir` is clamped 0–5 (absent at
    0);
  - `share`/`ss` become `1`;
  - `muscle`/`pattern`/`type` are `safeKey(txt(…, 40))`;
  - `off` is kept on the own path only.
- **`migrate()`** (app ~898–919) repairs `sets`, `rest`, `reps`, `muscle`
  (with a `MUSCLE_BY_ID` fallback), `pattern`, `type`, `inc`, `minRir` and
  `setup`. It **doesn't** repair `n`'s length, `alt`, `cue`, `add`,
  `share` or `ss`.
- **The editor** (`buildExRow` ~932, `syncDraftFromForm` ~1083) caps
  **none** of the text: not the name, alternative, cue or reps, nor the
  day name, pair note or block name (index.html ~407).
- **The AI prompt** (block-editor.js ~515–531) describes the fields in
  hand-written Spanish.

The second review verified the consequence: **the app's own restore
truncates text the editor let you type.** A 147-character name comes back
as 120 with a different slug, a 450-character cue as 400, a 90-character
day name as 80, and long reps are trimmed. That breaks plan 010's promise
that a backup restores exactly as it was.

The plates preference has the same kind of drift: its rule is written in
`migrate()` (~app 899–905 at `ff50c05`; grep `plates`) and again in
`setupSave` (~1690).

## The decisions (settled 2026-09-22 — do not re-open)

1. **`EX_FIELDS`**, a table in `js/app.js` next to `IMPORT_LIMITS`
   (split rule 2: `js/block-editor.js` reads it). One entry per field,
   declaring:
   - its default, if any;
   - its `repair` for `migrate`;
   - its `accept` for import, with strict and own variants, and reject vs
     clamp (`add` rejects);
   - its editor cap, for text fields;
   - its prompt line.

   `migrate`, `normalizeImportedBlock`'s exercise map, the editor's caps
   and the AI prompt's field list all loop over it.
2. **Days and blocks get no table.** The day name, pair note, block name
   and phase texts get their editor caps straight from `IMPORT_LIMITS`.
3. **The own path accepts longer text.** A restored backup or loaded
   profile file uses a flat, generous text bound of 2,000 characters per
   field (a new `OWN_TEXT_LIMIT` or similar), following the
   `OWN_LIMITS` pattern from the restore-limits fix (#143/#146).
   - The strict path (share, paste, QR, the AI round trip) keeps today's
     caps.
   - The editor caps new text at the strict limits, so anything typed from
     now on fits everywhere.
   - Text saved before this plan, of any length up to the flat bound,
     restores exactly.
   - The flat bound, not "2× the strict limit", is deliberate: the editor
     never capped text, so existing text can be any length.
4. **`migrate` repairs every field from the table**, including those it
   skips today: `add` (an integer from 1 to the block's weeks, dropped if
   invalid), the text fields (capped at the own bound) and the flags (`1`
   or absent). Only corrupt or hand-edited storage changes.
5. **The prompt is generated from the table**, and its text is
   byte-identical to today's for the current fields. A unit test pins
   that.
6. **A guard test**, the same pattern as the row codec's scan (test/unit.js,
   grep `every row field the code writes`): it fails when code in `js/`
   (comments stripped) writes an exercise field the table doesn't declare.
   That means `ex.<field> =` and `delete ex.<field>`, plus the keys the
   block normalizer puts on its output exercise.
7. **One shared `cleanPlates()`** for the plates preference, used by both
   `migrate` and `setupSave`.

## Steps

**A. `EX_FIELDS`** and a small applier or two, e.g.
`repairExercise(ex, block)` and `acceptExercise(raw, { own, weeks })`.
Keep every existing comment's reasoning, moved onto the entries. That
includes `add` being rejected rather than clamped, `minRir` as an advisory
floor, `setup`, and the free-form tags.

**B. `migrate()`** loops over the table (decision 4).
`normalizeImportedBlock`'s exercise map loops over it too, with the own
bound (decision 3). Keep the id and name rules (`safeKey`, slugs, uniqueness,
own-path naming of blank exercises), which are about identity, not field
values, where they are.

**C. The editor** caps each text input at the strict limit, with a
`maxlength` attribute plus a clamp in `syncDraftFromForm` or `oninput`.
That covers exercise text from the table, and day, block and phase text
from `IMPORT_LIMITS`. A paste longer than the cap is cut at the cap. Add a
unit test on the clamp, and a smoke assertion that the name input carries
`maxlength`.

**D. The prompt** field list comes from the table, and its text is
byte-identical (decision 5).

**E. `cleanPlates()`** (decision 7) and the guard test (decision 6).

**F. Equivalence (mandatory, throwaway).** In two vm contexts (the way
`test/unit.js`'s `loadApp` builds one), run `origin/main` and the branch.
Compare `migrate()` on random and hostile stored states, and
`normalizeImportedBlock` on the strict and own paths over own-data,
hostile (`{toString:null}`, `__proto__`, junk in every field) and
at/under/over-limit blocks. Compare outputs and thrown messages. The only
allowed differences are:
- own-path text between the strict cap and the flat bound, which is now
  kept whole;
- `migrate`'s new repairs on corrupt fields (decision 4).

Record the counts and show at least three deliberate breaks are caught.
Also check that an own backup containing text up to the bound now
round-trips exactly.

**G. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for "Guardar cambios", the plan-editor
  sections, "profile import hardening" and the AI round-trip section
  (`--list`).
- `docs/guide.md`: say the editor's fields have a length limit, if the
  guide describes those fields. Otherwise nothing.

## STOP conditions

- The equivalence check finds a difference outside decision 3's kept text
  and decision 4's repairs.
- The prompt text changes for any current field.
- A field's rule differs between two of today's places in a way neither
  decision names. Report it, and don't pick one silently.

## Maintenance notes

**Drift.** Clean at the start: nothing in the drift check's files had
changed since `8142e33`. main then moved while this was in progress, and
the branch was rebased over each: #152 and #155 (plan 052, test-only),
#153 (the Diagnóstico's rows into `app.js`), #154 (plan 053, one
`peDraft`), #156 ("Enviar a…" refused onto a day that already holds the
lift), #157 (plan 054) and #158 (plan 056). The conflicts were the
`plans/README.md` rows (all kept) and the plan editor's save gate, where
053's `peDraft.block` and this plan's rename to `ex` both stand. Step C's
unit test reads the draft through `peDraft.block`. 054 changed the
prompt's sentence about the deload, not its field list.

**The table.** `EX_FIELDS` in `js/app.js`, after `safeKey`, beside
`IMPORT_LIMITS` and `OWN_TEXT_LIMIT` (2000). "cut" is `txt()` at that
length on the import and a plain slice in `migrate()`.

| Field | Default | `repair` (migrate) | `accept`: paste / restore | Editor | Prompt |
|---|---|---|---|---|---|
| `id` | — | identity code in `migrate()` | identity code in the importer | — | yes |
| `n` | `''` | always a string: cut at 2000; not text → what `txt()` reads | cut at 120 / 2000; a blank one refused / named (identity) | 120 | yes |
| `sets` | 3 | clamp 1–12 | clamp 1–12 | number box | yes |
| `rest` | 90 | clamp 0–900 | clamp 0–900 | number box | yes |
| `reps` | `10–15` | cut at 2000; not text → `txt()`; empty or missing → default | cut at 40, blank **rejects** / cut at 2000, blank → default | 40 | yes |
| `alt` | absent | cut at 2000; truthy non-text → `txt()`; falsy non-text dropped | truthy → cut at 200 / 2000 | 200 | yes |
| `cue` | absent | as `alt` | truthy → cut at 400 / 2000 | 400 | yes |
| `setup` | absent | `txt()` at 200, blank dropped (unchanged) | truthy → cut at 200, both paths | 200 | yes |
| `add` | absent | whole weeks ≥ 1, held to the block, else dropped (new) | same, else **rejects** | number box | yes |
| `inc` | absent | clampNum 0.25–50 step 0.25, kept when > 0 | same | number box | yes |
| `minRir` | absent | clamp 0–5, kept when > 0 | same | — | yes |
| `share`, `ss` | absent | 1 or absent (new) | truthy → 1 | checkbox | yes |
| `muscle` | `MUSCLE_BY_ID` backfill | blank → backfill; else `safeKey(txt())` at 40 or dropped | `safeKey(txt())` at 40 | 40 | yes |
| `pattern`, `type` | absent | `safeKey(txt())` at 40 or dropped | same | 40 | yes |
| `off` | absent | 1 or absent (new) | dropped / truthy → 1 | "Retirar" | no |

**Every disagreement between today's places, and how it was settled.**
1. *Text length.* The importer cut at `IMPORT_LIMITS`; the editor and
   `migrate()` had no cap. Decision 3 (a restore takes 2000), decision 4
   (`migrate()` cuts at 2000) and Step C (the editor stops at the strict
   length).
2. *`add`.* The import rejects a non-integer and holds one to the block;
   `migrate()` never looked; the editor rounds (`clampInt`) and holds to
   `MAX_WEEKS`, then the block on save. Decisions 1 and 4 settle the import
   and `migrate()`. The editor's rounding is not a table rule (the table
   has no editor rule for numbers), so it is untouched.
3. *The flags.* The import writes `1`, the editor `1` or nothing,
   `newExercise()` writes `share: 0, ss: 0`, and `migrate()` never looked.
   Decision 4 makes them `1` or absent, and that is the one change the
   app's own data sees: `newExercise()`'s zeros go on the next load. Two
   smoke fixtures put a retired exercise back with `off: 0`; they now
   delete the flag, as "Restaurar" does.
4. *A whitespace-only rep range.* `migrate()` treats it as present; the
   import and the editor's save gate treat it as blank. No decision names
   it, so each keeps its rule: `migrate()` defaults only a missing or empty
   one.
5. *Spacing.* The import's `txt()` collapses and trims; the editor stores
   what was typed. Decision 4 says "capped", so the new text repairs only
   cut, and the import keeps `txt()`. A text cut at 2000 by the load can
   end in a space the next restore trims: `txt()`'s old habit.
6. *The machine settings and the tags.* Every place already held them to
   200 and 40, so decision 3's flat bound is read as covering the fields
   the editor never capped, and they keep one length on every path. This
   is an interpretation of "per field", not a choice between two places.
   A break that gives `setup` the bound is caught.
7. *Empty `alt`/`cue`.* The import drops a falsy one (and can itself write
   `''`); `newExercise()` stores `''`. `migrate()` keeps `''`.
8. *Plates.* `migrate()` and Ajustes had the same rule and different
   answers for an empty result. Decision 7: one `cleanPlates()`, and each
   caller keeps its own answer.
9. Left as they were, being editor-only or identity: the editor's `inc`
   fallback (`INC_MIN`, the import's is `0`), its tags stored without
   `safeKey` (every reader applies it), and the id's 60-character cap,
   which only the importer applies.

**Equivalence (Step F).** Last run against `origin/main` at `f9252fd`,
and before that at `74a657c` and `6bda878`, with the same outcome.
Five shells booted with `test/harness.js`'s `bootApp()`, pointed at main,
the branch, and a reference: main with decision 3 and decision 4 patched
in as text, written from the decisions rather than from the branch
(`2000` as a literal), plus the reference with each decision alone to
attribute differences. Outputs were compared as JSON text, key order
included, and thrown messages too. The branch equals the reference on
every input.

There were **6,750 comparisons, with 0 unexplained**:
- `migrate()`: 60 own states, 75 hostile ones (15 throw in the identity
  code on both sides), 60 damaged, 120 twice-migrated, 200 plate lists;
  10,988 exercises in all.
- `normalizeImportedBlock`, strict and own: 181 own blocks, 239 hostile,
  197 damaged, 3 published, and 1,980 limit blocks per path (every text
  field at 0 to 2600 around each cap in four spellings, `add` at 22 values
  in three lengths, every junk value in every field).
- The restore as `restoreFromText` runs it: 195 backups;
  `normalizeImportedProfile` alone, 390 profiles.
- `buildAiPrompt`: 120 prompts, byte for byte.
- "Guardar" in Ajustes, pressed: 150 plate lists.

main and the branch differed on 1,601: 1,241 by decision 3 and 360 by
decision 4. Storage the app wrote with text inside the paste limits is
identical, 120 of 120; `newExercise()`'s blocks change at 593 paths, every
one a `share`/`ss` of `0` going. 60 own backups with text up to the bound
came back exact, 14,640 text fields.

Fourteen deliberate breaks, all caught (20 seeds, 5,246 comparisons each,
unexplained differences):

| Break | Caught |
|---|---|
| `OWN_TEXT_LIMIT` 1999 | 414 |
| the name keeps 120 on a restore | 410 |
| the day name keeps 80 on a restore | 225 |
| `add` held to `MAX_WEEKS` | 40 |
| a false flag kept | 118 |
| `alt` and `cue` swap places | 329 |
| stored text rewritten, not cut | 178 |
| `setup` gets the flat bound | 99 |
| a blank-looking range defaulted | 157 |
| a blank tag kept as `''` | 225 |
| `cleanPlates` keeps repeats | 138 |
| the prompt lists `cue` first | 246 |
| the prompt says 121 | 246 |
| `alt: 0` becomes `'0'` | 36 |

**Deviations.**
- The table is in the importer's key order except `reps`, which sits after
  `sets` and `rest`: `migrate()` appends a missing field where its repair
  reaches it, and always filled those three in that order. The importer
  writes the id, the name and the rep range first itself.
- `EX_PROMPT_ORDER` is a second list, since the prompt's order is neither;
  a unit test holds it to the table.
- The editor cuts on input (`typedText`), not in `syncDraftFromForm`: a
  save would otherwise cut old text nobody touched. The block name's
  `maxlength` is set in `wireBlockEditor`, from `IMPORT_LIMITS`, rather
  than in `index.html`. Phase texts have no box.
- `syncDraftFromForm`'s exercise is `ex` now, the name the guard reads.
- `newExercise()` still writes its zeros (plan 010 asked to leave it);
  `migrate()` drops them.
- A stored exercise with a `{toString: null}` name and no usable id still
  throws in `migrate()`'s slug, identity code left where it is; main
  throws the same.
- The prompt's `id` line keeps its literal 60, as the importer does.

**Tests.** 26 unit assertions, 1134 → 1160 (one is the index's link to
this file): the table's shape and prompt order, the guard (code scan,
the importer's output on both paths, `newExercise()`), decision 3 on both
paths, decision 4's repairs, `cleanPlates`, a backup of long text through
`restoreFromText`, the editor's boxes and "Guardar cambios" through
`bootApp()`, the prompt pin in both units, and Ajustes' "Guardar". Seven
breaks of the code each fail the test meant to catch them. The main
session's smoke gains two: the name box's `maxlength`, and a longer value
cut at it.

**Verification.**
- `node --check` passes on every `js/*.js`, `sw.js` and `test/*.js`.
- `node test/unit.js`: 1160 passed, 0 failed, and each commit passes on
  its own.
- `BASE=http://127.0.0.1:8803 node test/smoke.js --only "main session"
  --only "Guardar cambios" --only "volumen del bloque" --only "profile
  import hardening" --only "revisión del bloque"`: 292 passed, 0 failed,
  on `f9252fd`. The one full run (`test/smoke.js` was edited): 586
  passed, 0 failed, on `6bda878`, before #156–#158.
- `CACHE_VERSION` is not bumped; that is the orchestrator's step. The
  equivalence harness is throwaway and not committed.
