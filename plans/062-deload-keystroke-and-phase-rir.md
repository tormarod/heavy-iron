# Plan 062: Typing a week count keeps the deload, and a phase label's RIR reads the way people write it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` unless you were told otherwise.
>
> **Two independent steps, A and B — one PR each** (branches
> `claude/062-a`, `claude/062-b`), both bump `CACHE_VERSION`. Read the
> whole plan, execute only the step you were given.
>
> **Drift check (run first)**:
> `git diff --stat b15ae87..origin/main -- js/block-editor.js js/app.js test/unit.js docs/guide.md README.md sw.js`
> Re-locate every anchor by `grep`, never by line number alone.

## Status

- **Priority**: P1 (A), P1 (B)
- **Effort**: S each
- **Risk**: LOW (A); LOW–MED (B changes the objetivo's number for labels
  that are read differently — by design, and no seed label moves)
- **Depends on**: **plan 059 must be merged before B** (B must not use a
  regex lookbehind; 059's unit check enforces that).
- **Category**: bug
- **Planned at**: commit `b15ae87`, 2026-09-22 (tenth audit, findings 4 and 5)

## Why this matters

**A — the deload disappears while you type.** In **Editar plan**, the
weeks box's `oninput` runs on every keystroke and writes the deload
select's value back into the draft. Changing an 8-week block (deload in
week 8) to 10 by typing "1" then "0" passes through `weeks = 1`; the
deload list for a 1-week block has no week 8, so it falls to "Sin
descarga", and that `0` is written into `block.deload`. On save the week-8
"Descarga" phase text is replaced by the generic 0–1 RIR text: the
planned deload became the block's hardest week. The objetivo prices it
that way, the week strip and the review lose the deload. The only sign is
the select quietly changing beside the box. (Reproduced with `bootApp`:
saved block `weeks: 10, deload: 0`, `deloadWeeks: []`.) The browser suite
missed it because Playwright's `fill` sends one event, not one per key.

**B — `phaseRir` became too strict in plan 058.** A week's RIR
prescription is read out of the free-text phase label (`phase[w].r`).
Plan 058 (commit `98602ad`/`a31bffa`, earlier on 2026-09-22) correctly
stopped reading "any digit anywhere" ("Descarga 60%" was read as 60 RIR),
but now only a number *immediately* next to "RIR" counts. Labels people —
and the app's own AI prompt — actually write now read as "no
prescription", so `weekRir` falls back to the last session's reserve and
the planned RIR ramp is ignored:

| Label | before 058 | now | should be |
|---|---|---|---|
| `RIR: 2` | 2 | **null** | 2 |
| `RIR (2)` | 2 | **null** | 2 |
| `RIR ~2` | 2 | **null** | 2 |
| `RIR objetivo 2` | 2 | **null** | 2 |
| `RIR: 1-2` | 1 | **null** | 1 |
| `2-3 reps en reserva` | 2 | **null** | 2 |
| `1,5 RIR` | 5 | **5** | null (a decimal is not a whole-number RIR) |
| `Semana 3 RIR 2` | 3 | **3** | 2 |
| `sufrir 2` | 2 | **2** | null ("rir" inside a word) |

The AI prompt that writes these labels says, word for word, that `r` is
`"string corto, p.ej. RIR objetivo"` (`js/block-editor.js`, search
`RIR objetivo`). Every seed label in `js/data.js` and `blocks/*.json` is
one of `"0–1 RIR"`, `"1 RIR"`, `"1–2 RIR"`, `"2 RIR"`, `"2–3 RIR"`,
`"3 RIR"`, `"3–4 RIR"`, `"4 RIR"`, `"Descarga"` or a long sentence with no
digit, so no seed number moves.

## Current state

### A

`js/block-editor.js`, search `$('peWeeks').oninput` (≈ line 1396):

```js
$('peWeeks').oninput = () => {
  const block = peDraft.block;
  block.weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, 8);
  if (deloadWeek(block) > block.weeks) block.deload = 0;
  renderDeloadOptions();
  block.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
};
$('peWeeks').onchange = () => renderPlanEditor();

$('peDeload').onchange = () => {
  peDraft.block.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
  renderPlanEditor();
};
```

(The `if (deloadWeek(block) > block.weeks)` line is dead: `deloadWeek`
already returns 0 for a deload past `weeks` — see `js/app.js`,
`const deloadWeek = block => …`.)

`renderDeloadOptions()` (same file, search `function renderDeloadOptions`)
rebuilds the select for the weeks typed so far and selects
`deloadWeek(peDraft.block)` when it fits, else `0`:

```js
const weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, blockWeeks(peDraft.block));
const current = deloadWeek(peDraft.block);
…
sel.value = String(current >= 1 && current <= weeks ? current : 0);
```

`syncDraftFromForm()` (search `function syncDraftFromForm`) is what the
save reads, and it reads the **select**:

```js
block.weeks = clampInt($('peWeeks').value, 1, MAX_WEEKS, blockWeeks(block));
block.deload = clampInt($('peDeload').value, 0, MAX_WEEKS, 0);
if (block.deload > block.weeks) block.deload = 0;
```

So the fix is only that `oninput` must stop *writing* `block.deload`;
the select keeps reflecting the stored deload whenever the typed weeks
reach it, and the save still reads the select. A block genuinely
shortened below its deload saves with `deload: 0`, exactly as today.

### B

`js/app.js`, search `function phaseRir` (≈ line 2411), with its long
comment above it (keep the comment's content; update it for the new rule):

```js
function phaseRir(block, w) {
  const r = String((block && block.phase && block.phase[w] && block.phase[w].r) || '');
  const before = r.match(/(\d+)(?:\s*[-–—−]\s*(\d+))?\s*RIR/i);
  const after = r.match(/RIR\s*(\d+)(?:\s*[-–—−]\s*(\d+))?/i);
  const near = !before ? after : !after ? before : (before.index <= after.index ? before : after);
  if (!near) return null;
  const v = Math.min(num(near[1]), num(near[2] != null ? near[2] : near[1]));
  return v > RIR_MAX ? null : v;
}
```

`RIR_MAX` is 5. Readers: `weekRir` (search `function weekRir`), the RIR
box placeholder, `recordTarget` (stores the value as `obj.rir`). The
tests: `test/unit.js`, section
`phaseRir: the number before or after "RIR" wins, not the lowest digit anywhere`
(≈ line 4931), 14 fixed cases, then a 2,000-label seeded fuzz
(`phaseRirFuzzProbe`, ≈ line 4975) asserting the result is always `null`
or an integer in `[0, RIR_MAX]`.

**Constraint from plan 059**: no regex lookbehind (`(?<=`, `(?<!`) — the
app must parse on Safari 15. Use a consumed prefix group or a check on
the character before the match index instead (examples below).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check js/app.js` / `node --check js/block-editor.js` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| One smoke section | `node test/smoke.js --only "<name>"` | PASS (server on :8765 — AGENTS.md) |
| Bump | `bash tools/bump-cache-version.sh` | old → new |

## Scope

**In scope**: A — `js/block-editor.js` (`$('peWeeks').oninput` only),
`test/unit.js`, `sw.js` (bump). B — `js/app.js` (`phaseRir` and its
comment only), `test/unit.js`, `docs/guide.md` (one short paragraph),
`sw.js` (bump).

**Out of scope**: `renderDeloadOptions`, `syncDraftFromForm`, the phase
text regeneration; `weekRir`, `recordTarget`, `deloadWeeks`; the AI
prompt text; `RIR_MAX`. All 14 existing `phaseRir` cases keep their
expected values, unchanged.

## Git workflow

Branch per step from `origin/main`
(`git checkout -B claude/062-a --no-track origin/main`), plain-sentence
commit subjects, your session's `Co-Authored-By:` line, bump last.

## Steps

### Step A: The weeks box stops writing the deload

1. Replace the `oninput` body with: set `peDraft.block.weeks` from the box
   (as today) and call `renderDeloadOptions()`. Delete the two lines that
   write `block.deload`. Update the comment above it to say why (typing
   "10" passes through "1", and the deload list for one week has no week
   8; the save reads the select, so the draft's deload is left alone until
   a real choice is made — plans/062).
2. Add a booted unit case in `test/unit.js`, inside the async block, near
   the other booted plan-editor cases (search `planEditor(boot)` for the
   editor helper; `peSaveBoot` further up is top-level, outside the async
   block, and is not the pattern). Boot with `settled(seeded({ week: 2, day: 0 }))` — the
   helpers defined at the top of the async block (`const seeded = (at, edit) => …`,
   ≈ line 7095) — and first assert `boot.call('deloadWeek(getBlock())') === 8`
   (if it is not, give the fixture an 8-week block with `deload: 8` through
   `seeded`'s `edit` argument),
   open the editor (`boot.$('editPlan').onclick()`), then:
   `boot.type(boot.$('peWeeks'), '1'); boot.type(boot.$('peWeeks'), '10'); boot.fire(boot.$('peWeeks'), 'change');`
   press save with `pressAnswering(boot, () => boot.$('peSave').onclick(), 'askOk')`,
   advance the clock 1000, and assert on `boot.call(...)`:
   `getBlock().weeks === 10`, `getBlock().deload === 8`,
   `JSON.stringify(deloadWeeks(getBlock())) === '[8]'`.
   Name it `'typing 10 into an 8-week block\'s weeks box, one key at a time, keeps the week-8 deload (plans/062)'`.
3. A second case: type `'6'` (shorter than the deload), change, save →
   `deload === 0`, `weeks === 6` — the genuine shortening still clears it.

**Verify**: `node --check js/block-editor.js`; `node test/unit.js` →
`0 failed`. Mutation: restore the old `block.deload = …` line → case 1
FAILs; revert. The smoke step that fills `#peWeeks` (≈ line 655 of
`test/smoke.js`, under the `== block length + deload ==` heading) lives
inside the large `main session` section, which runs far longer than one
section; running it is optional — the hook runs it when the PR opens.
Bump, PR.

### Step B: `phaseRir` reads the labels in the table

Rewrite `phaseRir` so that every label in the "should be" column above,
and every one of the 14 existing test labels, returns what the table and
the existing tests say. The rule, in words (put this in the comment):

1. A **RIR marker** is `RIR` as a whole token (not inside a word:
   "sufrir" does not count; "RIR2" and "2RIR" do), or the phrase
   `reps en reserva` / `repeticiones en reserva`.
2. A **number** is one or two whole numbers joined by a dash (the existing
   dash class `[-–—−]`; a range reads its lower end). A number that is
   part of a decimal (`1,5`, `0.5`) is not a number: the candidate is
   refused, not rounded.
3. A number counts **after** `RIR` when only whitespace, one of `: = ~ ≈ (`,
   and/or the word `objetivo` stand between them ("RIR: 2", "RIR (2)",
   "RIR objetivo 2", "RIR objetivo: 1-2").
4. A number counts **before** a marker when only whitespace stands between
   them ("2 RIR", "2-3 RIR", "2-3 reps en reserva") — unless the text
   right before that number is a week word (`semana`, `sem`, `week`,
   optionally followed by `.`, then whitespace). In "Semana 3 RIR 2" the
   `3` sits right after "Semana " and is refused, so the `2` after "RIR"
   wins. In "Sem. 3 · 2 RIR" the number next to "RIR" is the `2`, which
   sits after "· ", so it counts.
5. If both a before- and an after-number exist, the first in the label
   wins (today's rule); rule 4 has already removed the week number.
6. Result above `RIR_MAX` → `null` (today's rule).

Implementation hints (no lookbehind):
- For "not inside a word" before `RIR`: match `(^|[^a-záéíóúñü])RIR` and
  add the prefix group's length to the index; after `RIR`: a lookahead
  `(?![a-záéíóúñü])` is fine (lookahead is supported).
- For "not part of a decimal" before the number: capture the preceding
  character with `(^|[^\d.,])` and check; after it: lookahead `(?![.,]\d)`.
- For the week word: test `text.slice(0, numberIndex)` against
  `/\b(?:semana|sem|week)\.?\s*$/i`.
- It is fine — clearer, even — to find candidates with `exec` loops and
  plain `if`s rather than one regex.

Tests, in the existing `phaseRir` section of `test/unit.js`:
- Keep all 14 existing cases unchanged.
- Add one case per row of the table above (9 cases), plus: `"RIR2"` → 2,
  `"2RIR"` → 2, `"RIR 0.5"` → null, `"Sem. 3 · 2 RIR"` → 2,
  `"2 RIR, semana 3"` → 2, `"RIR 10"` → null (above `RIR_MAX`),
  `"semana3 RIR 2"` → 2 (a week word needs no space before its number),
  `"Top set + 2 back-offs, 1 RIR"` → 1 (already exists — do not duplicate).
  Name them `phaseRir: "<label>" → <value> (plans/062)`.
- The fuzz (`phaseRirFuzzProbe`) keeps its assertion unchanged (always
  `null` or an integer in `[0, RIR_MAX]`). Add the fragments `':'`, `'('`,
  `'objetivo'`, `','`, `'.'`, `'reps en reserva'`, `'semana'`, `'sufrir'`
  to its `words` list — that changes which labels it generates, which is
  the point; the property it asserts does not change.
- A seed check: for every phase label in `js/data.js`'s blocks, in
  every `blocks/*.json`, **and in `genericPhase(weeks, deload)` for every
  `weeks` 1–16 and every `deload` 0–`weeks`** (the generic ramp every new
  or edited block gets — `GENERIC_RAMP`/`DELOAD_PHASE` in `js/app.js`),
  `phaseRir` returns the same value as the function at `b15ae87`. The old
  function calls `num()` and reads `RIR_MAX`, so evaluate it **inside the
  app context under another name**, not in a fresh `vm` context: paste its
  body into the test as a string literal labelled
  `/* phaseRir as of b15ae87, before plans/062 */`, rename it
  `phaseRirOld`, and `call(...)` a function expression that defines and
  returns it. Name:
  `'no seed, published or generic label reads a different RIR than before plans/062'`.

Guide: in `docs/guide.md`, find where the week's RIR / the phase text is
explained (search `RIR` near "phase" or "Semana" in the objetivo chapter;
if you cannot find a natural home in 5 minutes, add it under the
"weekly objetivo" section) and add two or three sentences: the week's RIR
is read from its label — `2 RIR`, `RIR 2`, `RIR: 1-2`, `RIR objetivo 2`,
`2-3 reps en reserva` all work; a range reads its lower end; a decimal or
a number above 5 is not read, and the week then keeps the reserve the
last session was left at.

**Verify**: `node --check js/app.js`; `grep -n "(?<" js/app.js` → no
output; `node test/unit.js` → `0 failed` with the new cases. Mutations:
drop the week-word check → `"Semana 3 RIR 2"` FAILs; drop the whole-token
check → `"sufrir 2"` FAILs; revert. Bump, PR.

## Test plan

A: two booted cases + one mutation + the editor's smoke section. B: 15
new fixed cases, the unchanged 14, the fuzz, the seed-equivalence case,
two mutations.

## Done criteria

- [ ] A: the `$('peWeeks').oninput` handler no longer mentions the
      deload: `sed -n "/\$('peWeeks').oninput/,/^  };/p" js/block-editor.js | grep -c deload`
      → `0`
- [ ] B: every label in the table and the extra list returns the value
      given; `grep -n "(?<" js/*.js` → no output
- [ ] `node test/unit.js` → `0 failed`
- [ ] Each PR bumps `CACHE_VERSION` above `origin/main`'s; only in-scope
      files changed

## STOP conditions

- A: `renderDeloadOptions` or `syncDraftFromForm` no longer look like the
  excerpts (someone changed how the save reads the deload).
- B: any seed, `blocks/*.json` or `genericPhase` label changes value (the
  seed check fails) — report the label; do not adjust the rule to fit it
  silently.
- B: a row of the table cannot be satisfied without breaking one of the
  14 existing cases — report both labels.
- B: plan 059 is not merged yet (`grep -n "parse on Safari 15" test/unit.js`
  finds nothing): do not start B. Its checks (`grep -n "(?<" js/*.js` → no
  output) cannot pass until 059 has removed the one lookbehind already on
  `main`.

## Maintenance notes

- The table in B is the contract. A new label shape people use should be
  added to it as a case before the rule changes.
- `recordTarget` stores the value as `obj.rir`, which the record's own
  `accept` bounds at `RIR_MAX`; that stays true because rule 6 is kept.
- *(Executor: record deviations here.)*
