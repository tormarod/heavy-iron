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

(Filled in when the PR lands.)
