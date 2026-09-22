# Plan 072: The unit suite's doc checks say what GitHub and AGENTS.md say — headings slug with their underscores, the slot regex is watched in every file, and no comment cites a "rule (a)"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If a STOP condition occurs, stop and report — do not
> improvise. Fill in "Maintenance notes" when done; the orchestrator
> maintains `plans/README.md` — do not edit it.
>
> **One PR** (`claude/072-doc-checks`). Tests and docs only — **no**
> `CACHE_VERSION` bump; do not touch `sw.js`, `js/`, `css/`, `index.html`.
>
> **Drift check (run first)**: `git diff --stat 8ff9355..origin/main -- test/unit.js AGENTS.md`
> — plans 071 and 073 edit `test/unit.js`, and plan 073 edits AGENTS.md,
> in other sections. Re-find each excerpt below by its quoted text; a
> changed meaning is a STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (test code and one doc section)
- **Depends on**: none
- **Category**: tests / docs
- **Planned at**: commit `8ff9355`, 2026-09-23 — the follow-ups recorded
  when plans 067–070 were executed (`plans/README.md`, "Follow-ups found
  while executing 067–070")

## Why this matters

Plan 070 made AGENTS.md say exactly what each unit check covers, and found
three checks narrower than the file used to claim. This plan widens the
one that is cheap and worth it, and fixes two small inaccuracies:

1. **The heading slugger drops `_`.** The docs cross-link check
   (`test/unit.js`, "docs cross-links resolve") builds each heading's
   anchor with a slugger that deletes every underscore. GitHub keeps an
   underscore that is literal in the rendered heading (inside a code span,
   or between two letters), so a heading like `` ### `RECORD_PARTS`: … ``
   has the anchor `record_parts-…` on GitHub and `recordparts-…` in the
   test. No link could satisfy both, so AGENTS.md avoids linking any
   heading that names a constant. Today no heading or anchor in the four
   checked docs contains `_`, so fixing it changes no current result. It
   removes the trap for the next one.
2. **The slot-regex check scans four named files.** The rule is "a log key
   is read back only by `parseSlot`" (AGENTS.md § Log keys and slot
   walks). The check ("parseSlot() is the only place that runs the slot
   regex") reads `js/app.js`, `js/chart.js`, `js/diagnostics.js` and
   `js/review.js` by name. `js/block-editor.js` already walks slots
   (through `forEachSlot`, correctly) and is not scanned. A new file would
   not be scanned either. Scanning every `js/*.js` costs nothing and
   removes the need for AGENTS.md's "a new file that reads slots joins
   that list". The same section's opening, "read in four files", is stale
   too.
3. **Two places in `test/unit.js` cite "AGENTS.md rule (a)"**: a comment
   and an assertion's name. AGENTS.md numbers the split rules 1 and 2.
   Plan 071 fixes the two in `js/app.js`.

## The decisions (settled — do not re-open)

1. **The slugger follows GitHub's**: the anchor is built from the heading
   *as rendered*:
   - A code span keeps its content literally, underscores included, and
     only its backticks go.
   - Outside code spans, the emphasis markers go: `*`, `~`, and `_` when
     it opens or closes emphasis, meaning an `_` that is not between two
     letters or digits.
   - Then GitHub's rule, as the check already applies it: lowercase;
     remove every character that is not a letter, a digit, a space, `_`
     or `-`; each space becomes `-`, one for one. There is no collapsing:
     "Data & privacy" → `data--privacy`, which the section's comment
     explains.
2. **The slugger is pinned by a table of known anchors**, asserted inside
   the section, so the next edit to it cannot drift silently. Use these
   pairs exactly; they are what GitHub produces:
   | Heading text | Anchor |
   |---|---|
   | `Data & privacy` | `data--privacy` |
   | `` `wire*()` and the split recipe `` | `wire-and-the-split-recipe` |
   | `The profile's record, in one table` | `the-profiles-record-in-one-table` |
   | `` `RECORD_PARTS`: one table for the profile's record `` | `record_parts-one-table-for-the-profiles-record` |
   | `snake_case in words` | `snake_case-in-words` |
   | `_Nota_ importante` | `nota-importante` |
   | `Diagnóstico, *la* pantalla` | `diagnóstico-la-pantalla` |
3. **The slot-regex check reads every file in `js/`** (`fs.readdirSync`,
   `*.js`). `js/app.js` is allowed exactly the one occurrence inside
   `parseSlot`, as now, and every other file none. The assertion keeps its
   name. AGENTS.md's two statements of it (the checklist line "A log key,
   or a walk over a block's slots" and § Log keys and slot walks) say
   "every file in `js/`" and drop "a new file that reads slots joins that
   list". The section's opening loses its stale count: "because it is read
   in four files" becomes "because it is read outside `js/app.js`".
4. **"AGENTS.md rule (a)" → "AGENTS.md's split rule 1"**, in the comment
   and in the assertion name. The assertion name changes on purpose.
5. **Considered and not done** (record them in the PR body, not in
   AGENTS.md):
   - `SHELL`'s order. `sw.js` lists `js/app.js` before `js/data.js`,
     unlike the script tags. The order means nothing at runtime (it is a
     precache list), and matching it would itself change the shell and
     cost a bump.
   - The contrast check covering "every pair". The pairs it names are the
     ones the CSS actually puts together. "Every pair" of tokens is not a
     question the stylesheet can answer.

## Current state

`test/unit.js:5721-5728` — the section and the slugger:

```js
console.log('\n== docs cross-links resolve (README.md, docs/guide.md, AGENTS.md, plans/README.md) ==');
{
  // GitHub's own slugger drops punctuation character by character rather than
  // collapsing what is left, so "Data & privacy" loses only the "&" and keeps
  // both spaces around where it was — "data--privacy", not "data-privacy".
  // A `\s+` here would collapse that back down to one hyphen and fail a link
  // that resolves on GitHub today.
  const slug = h => h.toLowerCase().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
  const headings = file => (fs.readFileSync(path.join(ROOT, file), 'utf8').match(/^#{1,6} .+$/gm) || [])
    .map(h => slug(h.replace(/^#+ /, '')));
```

(then the loop over the four docs, and a floor assertion "the docs
cross-link loop had links to check").

`test/unit.js` — the slot-regex check, in the section `== the log key has
one reader as well as one builder (plans/009 item 4) ==` (about line
6480):

```js
  const handRolled = ['js/app.js', 'js/chart.js', 'js/diagnostics.js', 'js/review.js']
    .map(rel => [rel, (fs.readFileSync(path.join(ROOT, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').match(/\/\^w\(/g) || []).length])
    .filter(([rel, n]) => n > (rel === 'js/app.js' ? 1 : 0));
  ok('parseSlot() is the only place that runs the slot regex',
     handRolled.length === 0, JSON.stringify(handRolled));
```

At `8ff9355`, only `js/app.js` contains `/^w(` once comments are stripped
(checked over every `js/*.js`), so widening passes today.

`test/unit.js` — in the section `== Escape reaches every sheet (plans/013,
plans/009 item 1) ==` (about lines 6391-6399):

```js
  /* AGENTS.md rule (a): a symbol app.js reads stays in app.js or is stubbed
     there. …
  ok('app.js reads neither closeReview nor closeQr any more (AGENTS.md rule (a))',
```

`AGENTS.md` — the checklist line (about line 76):

```
- **A log key, or a walk over a block's slots** — `slot(week, dayId)` and
  `parseSlot` build and read it, `forEachSlot` walks it; never the regex by
  hand, never keys rebuilt week by week. Held by unit "the log key has one
  reader as well as one builder" for the four files it scans; a new file
  that reads slots joins that list.
  → [Log keys and slot walks](#log-keys-and-slot-walks)
```

and § Log keys and slot walks (about line 437):

```
One shape is worth naming here because it is read in four files: a log key is
`slot(week, dayId)` and is read back by `parseSlot`, both in `js/app.js`,
and nothing else runs the regex. `test/unit.js` ("parseSlot() is the only
place that runs the slot regex") fails if any of the four files it scans
does — `js/app.js` outside `parseSlot`, `js/chart.js`, `js/diagnostics.js`
and `js/review.js` — and a new file that reads slots joins that list.
```

**Conventions.** Test comments explain *why* (`//` or `/* */`, as the
surrounding code does). AGENTS.md keeps its voice: full sentences, the
reason with the rule. Change only the sentences named here.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit | `node test/unit.js` | `0 failed` |
| Syntax | `node --check test/unit.js` | exit 0 |
| CR check | `node -e "for (const f of ['test/unit.js','AGENTS.md']) console.log(f, (require('fs').readFileSync(f,'utf8').match(/\r/g)\|\|[]).length)"` | `0` each |

## Scope

**In scope**: `test/unit.js` (the three places above), `AGENTS.md` (the
checklist's log-key line and the first paragraph of § Log keys and slot
walks), this plan's Maintenance notes.

**Out of scope**: `js/`, `sw.js`, `test/harness.js`, `README.md`,
`docs/guide.md`, every other AGENTS.md line (plan 073 adds a checklist
line and a subsection at the same time), the contrast and script-list
checks (decision 5).

## Git workflow

`git fetch origin && git checkout -B claude/072-doc-checks --no-track origin/main`;
plain-sentence commit subjects; no bump.

## Steps

### Step 1: the slugger

Replace `slug` with one that follows decision 1, and keep the comment
about "Data & privacy", adding one sentence about code spans and
underscores. A shape that works:

```js
  const slug = h => h
    .replace(/`([^`]*)`/g, (m, code) => code.replace(/[^\p{L}\p{N}\s_-]/gu, ''))  // code: literal, `_` kept
    …emphasis outside code: remove * and ~, and _ unless between two letters/digits…
    .toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
```

Removing the other punctuation inside a code span early is fine, because
the final pass removes the same characters. The emphasis `_` rule must not
touch the code span's content. The simplest way is to split the heading
on code spans and handle the pieces separately. No lookbehind: the Safari
15 floor applies to `js/` only, but keep to it here too for one style.

Add the table of decision 2 as assertions right after `slug`'s
definition, one `ok` per row, named
`'slug: "' + text + '" → #' + anchor`.

**Verify**: `node test/unit.js` → `0 failed`, with 7 more passes than the
baseline from this step. The cross-link loop's own passes are unchanged:
compare the count of lines containing ` is a heading` before and after.

### Step 2: the slot-regex scan

Replace the four-file list with every `*.js` in `js/`
(`fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)`),
keeping the rest of the expression and the assertion as they are. Add a
floor assertion that the scan read at least 13 files, so an empty
directory read cannot pass silently. The count on `8ff9355` is 13:
`ls js/*.js | wc -l`.

**Mutation check**: add the line `const x = /^w(\d+)-(.+)$/;` to
`js/block-editor.js` (inside any function, not in a comment) → the
assertion FAILs naming `js/block-editor.js`; revert → PASS. Report it.

**Verify**: `node test/unit.js` → `0 failed`.

### Step 3: "rule (a)"

In the Escape section: the comment's "AGENTS.md rule (a):" → "AGENTS.md's
split rule 1:", and the assertion's "(AGENTS.md rule (a))" → "(AGENTS.md's
split rule 1)".

**Verify**: `grep -n "rule (a)" test/unit.js` → no match;
`node test/unit.js` → `0 failed`.

### Step 4: AGENTS.md

Per decision 3. The checklist line becomes:

```
- **A log key, or a walk over a block's slots** — `slot(week, dayId)` and
  `parseSlot` build and read it, `forEachSlot` walks it; never the regex by
  hand, never keys rebuilt week by week. Held by unit "the log key has one
  reader as well as one builder", which scans every file in `js/`.
  → [Log keys and slot walks](#log-keys-and-slot-walks)
```

In § Log keys and slot walks, the first sentence reads "One shape is worth
naming here because it is read outside `js/app.js`: …", and the check's
sentence reads "`test/unit.js` ("parseSlot() is the only place that runs
the slot regex") fails if any file in `js/` runs it outside `parseSlot`."
The rest of the paragraph (the `forEachSlot` sentence) stays word for
word.

**Verify**: `node test/unit.js` → `0 failed` (the link check still
passes); `git diff --stat` shows only `test/unit.js`, `AGENTS.md` and the
plan.

## Test plan

Steps 1–2 add assertions: the 7-row slug table and the scan's floor. Plus
the mutation check of Step 2. No harness changes.

## Done criteria

- [ ] `slug` keeps a literal `_`; the 7 table assertions pass
- [ ] the slot-regex scan reads every `js/*.js` (≥ 13), and the mutation
      check fails and passes as stated
- [ ] `grep -n "rule (a)" test/unit.js` → no match
- [ ] AGENTS.md's checklist line and § Log keys say "every file in `js/`",
      and "read in four files" is gone
- [ ] `node test/unit.js` → `0 failed`; CR check `0`; no `sw.js`/`js/`
      change

## STOP conditions

- A row of decision 2's table fails with a slugger that follows decision 1
  (the table and the rule disagree): report which row and what your
  slugger gives.
- Widening the scan fails on `origin/main` because a file other than
  `js/app.js` really does run the slot regex: report the file and line.
  Do not fix `js/`.
- The cross-link loop's pass count changes after Step 1 (a live link
  started or stopped resolving).

## Maintenance notes

- Linking to a heading that names a constant is now safe:
  `#record_parts-…` resolves in the test as it does on GitHub.
- Executed as written, no deviations. All 7 rows of decision 2's table
  passed against the code-span-aware slugger on the first run (no STOP);
  the cross-link loop's " is a heading" count held at 109 before and
  after Step 1. `js/*.js` is 13 files today, so the floor assertion in
  Step 2 (`>= 13`) is exact, not loose. The Step 2 mutation check (adding
  `const x = /^w(\d+)-(.+)$/;` inside `blockDate()` in
  `js/block-editor.js`) FAILed naming `["js/block-editor.js",1]`, then
  PASSed clean after the one-line revert (`git diff --stat
  js/block-editor.js` empty). `node test/unit.js` held at `0 failed`
  throughout: 1441 (baseline) → 1448 (Step 1, +7) → 1449 (Step 2, +1
  floor assertion) → 1449 (Step 3) → 1449 (final, Step 4 touches only
  AGENTS.md prose).
