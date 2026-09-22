# Plan 054: The deload week, read one way — `deloadWeeks(block)` for every screen, spans for "¿funcionó la descarga?", and "sin descarga" is not a deload

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8142e33..HEAD -- js/app.js js/volume-sheet.js js/block-editor.js js/review.js test/unit.js test/smoke.js docs/guide.md`
> Plans 052 (test harness) and 053 (plan draft) may land first. 053 edits
> `js/block-editor.js`'s editor, including the deload field reads at ~672
> and ~1216, which stay field reads. Re-locate every call below by grep.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW–MED. There are several small intended visible changes,
  listed under decision 5.
- **Category**: architecture and correctness — candidate 5 of the second
  architecture review (2026-09-22), settled with the maintainer the same
  day.
- **Planned at**: commit `8142e33`, 2026-09-22
- **Glossary**: `CONTEXT.md` — **deload week** (now with the "sin
  descarga" exception) and **deload span** (new).

## Why this matters

CONTEXT.md defines a deload week as the block's `deload` field **or** a
week whose goal says "Descarga". Plan 038 made every reader of sets use
that definition (`deloadAt`, app.js ~5148), and `setsFor` halves such a
week's sets. **Seven readers still ask the field alone** (`deloadWeek`),
at `8142e33`:

| Reader | Where |
|---|---|
| the week strip's DL chip | `renderNav`, app.js ~3403 |
| the banner's deload style | app.js ~3850 |
| "¿funcionó la descarga?" | `deloadCheck` ~4829, `drawDeloadCheck` ~4850 (also read by review.js ~171) |
| the volume "typical" | `volumeWeeksInPlay`, app.js ~5997 |
| the volume trend's deload column | volume-sheet.js ~171 |
| the AI prompt | block-editor.js ~569 |

The second review verified the result. A week 3 with "Descarga" in its goal
and the field at 0:
- **follows the rule:** its sets are halved (4→2), and the objetivo gives
  a descarga target;
- **still treated as a normal week:** the volume "typical" counts it, the
  week gets no DL chip, and no "¿funcionó la descarga?" line appears.

The guide (docs/guide.md ~1383–1389, ~1050) says the volume view already
treats it as the deload.

Separately, `deloadAt`'s text match is `/descarga/i` anywhere in the goal.
So "Sin descarga, apretar" counts as a deload and halves that week's sets
today.

## The decisions (settled 2026-09-22 — do not re-open)

1. **`deloadWeeks(block)`** returns the sorted list of every deload week
   (field ∪ phase text, within the block's weeks), and `deloadAt(block, w)`
   is that list's membership test. `deloadWeek(block)` stays **only** as
   the editor's accessor for the field (block-editor.js ~672, ~1216, and
   the field's own normalisation). A unit guard fails if anything else
   reads it: scan `js/`, comments stripped, allowing `app.js`'s own
   definitions and the editor's field code.
2. **Deload spans.** Consecutive deload weeks are one deload span.
   - `deloadCheck` returns one result per span that has both a week before
     it and a week after it inside the block, comparing the week before
     the span with the week after it, as today's arithmetic does for one
     week.
   - `drawDeloadCheck` shows the line on the week after a span.
   - The block review (review.js) carries every span. Keep today's output
     shape for a single span where the review's text depends on it, and
     say how multiple spans read.
3. **"Sin descarga" is not a deload.** The text match excludes a
   "descarga" preceded by a negation ("sin", "no"; case-insensitive, with
   whitespace in between). It still matches "Descarga", "Semana de
   descarga" and "descarga activa". Pin both directions in unit tests.
4. **Every screen asks `deloadWeeks` / `deloadAt`:** the DL chip, the
   banner, the volume "typical" and trend column, and the AI prompt, which
   lists every deload week ("descarga en la semana 4", "descarga en las
   semanas 4 y 8").
5. **Intended visible changes**, each covered by a unit test and, where
   cheap, a smoke assertion:
   - a phase-text deload gets the DL chip, the banner style, the volume
     exclusion and the "¿funcionó?" line;
   - a goal saying "sin descarga" no longer halves sets;
   - the prompt names every deload week.

   The guide gains one sentence at the deload paragraph (docs/guide.md
   ~228): writing "Descarga" in a week's goal makes it a deload on every
   screen, and "sin descarga" doesn't. The volume paragraph's existing
   claim becomes true, so check its wording.

## Steps

**A.** Add `deloadWeeks` next to `deloadAt` in `js/app.js` (split rule 2:
volume-sheet.js and block-editor.js read it), with the negation rule
(decision 3). Unit-test it: field only, phase text only, both on the same
week, consecutive weeks, the negations, and weeks beyond the block's end
(not listed).

**B.** Switch the seven readers (decision 4). `volumeWeeksInPlay` skips
every deload week.

**C.** Spans in `deloadCheck` and `drawDeloadCheck`, plus the review
(decision 2). Unit-test a single span (the same result as today for a
field deload), two separate spans, a two-week span, and a span at the
block's start or end (no check).

**D.** The guard test (decision 1) and the guide sentence (decision 5).

**E. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for the deload, volume and review sections
  (`--list`).
- A throwaway check that on blocks where the only deload is the field
  (the common case) every output is identical to `origin/main`: DL chip
  week, banner, volume weeks, `deloadCheck`, review, prompt text. Report
  the count.

## STOP conditions

- A block whose only deload is the field produces any different output.
- An existing assertion changes outcome other than through decision 5.

## Maintenance notes

(Filled in when the PR lands.)
