# Plan 070: AGENTS.md opens with the checklist an agent needs before it changes code, and says each rule once

> **Executor instructions**: Follow this plan step by step. If a STOP
> condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md`.
>
> **One PR** (`claude/070-agents-md`). Docs only — **no** `CACHE_VERSION`
> bump; do not touch `sw.js`, `js/`, `css/`, `index.html`.
>
> **Drift check (run first)**: `git diff --stat c9114bc..origin/main -- AGENTS.md`
> — AGENTS.md changes with other PRs (plan 068 edits its "Spanish only"
> bullet). Work from `origin/main` as it is when you start, and rebase
> before pushing.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW for the code (nothing parses AGENTS.md except the unit
  suite's link check), MED for the reader: a rule lost here is a rule the
  next agent does not know. The inventory in Step 1 is what controls that.
- **Depends on**: land **after** plans 067, 068 and 069 have merged
  (068 edits AGENTS.md; the others may add to it).
- **Category**: docs
- **Planned at**: commit `c9114bc`, 2026-09-22 — the tenth audit's
  recorded follow-up "AGENTS.md has grown to 421 lines"

## Why this matters

`AGENTS.md` is the briefing every agent session reads before it touches
this repo. It has grown from 136 lines (commit `856fee1`) to about 440, and
its shape now works against its purpose:

- the "Constraints that are decisions, not gaps" section holds one
  **96-line bullet** that carries the `wire*()` rule, the split recipe,
  rules 1 and 2, the id rule, the pre-split exception and the mixed-shell
  history — and the next bullet ("Spanish for everything a user sees")
  reads as its tail;
- "Untrusted input" is a single ~42-line paragraph carrying about eight
  separate rules (`IMPORT_LIMITS`, `OWN_LIMITS`/`PROFILE_LIMITS`,
  `OWN_TEXT_LIMIT`, `EX_FIELDS`, `RECORD_PARTS.accept`,
  `NON_RECORD_FIELDS`/`BACKUP_FIELDS`, own-property keys, migrate's
  block-id rules);
- "Where things live" opens "see README … this file is the briefing" and
  then holds the most-used coding rules in the file (`slot`/`parseSlot`,
  `forEachSlot`, `RECORD_PARTS`, `sessionsOf`, frozen cached answers,
  `save('view')`/`save(here)`, legacy `rir`, `variants`);
- `RECORD_PARTS` is explained twice, and "`wireBlockEditor()` is unguarded"
  is said twice.

The cost is concrete: the id rule was written down, and nine unguarded ids
in four files still slipped past review until a test caught them (plan
058). Most rules are enforced by `test/unit.js` now, so the prose's job is
to help an agent find the rule **before** it writes code. A checklist on
top does that; the reference sections below keep the reasons.

## The decisions (settled — do not re-open)

1. **No rule is dropped and no rule changes meaning.** Every "must", "do
   not", "never", "always", every named test, constant, file and plan
   reference that states a rule survives. History that *justifies* a rule
   (the incident, the commit, the plan number) stays — condensed to a
   clause where it was a paragraph, never removed outright. History that
   justifies nothing may be cut.
2. **A checklist first**, right after the intro: one line per kind of
   change an agent makes, saying what else must change with it and which
   test or CI job holds it. It points to the section with the reasons.
3. **Each rule is stated once in this file.** Say it once and point to it.
   Duplication with `README.md` is fine where an agent needs the thing on
   hand (the Playwright install recipe, the verification rungs).
4. **Structure** (headings may be worded better, but keep this order):
   1. intro (what the app is, why this file exists — keep, tighten);
   2. **Before you change anything** — the checklist;
   3. **Constraints that are decisions** — no build step, Safari 15, no
      modules, then subsections for: the script list; `wire*()` and the
      split recipe; the two split rules; ids read outside `app.js`; the
      pre-split exception; mixed shells and `js/boot-guard.js`;
      Spanish/English split of text;
   4. **The release rule**; 5. **How to verify a change** (rungs, the
      hook, the harness's loaders, testing policy); 6. **Untrusted
      input** — as bullets, one rule each; 7. **The data model's rules** —
      the ones now under "Where things live": slots, `forEachSlot`,
      `RECORD_PARTS`, `sessionsOf` and its cache, `save` scopes, legacy
      `rir`, `variants`, `EX_FIELDS`; 8. **The CSP**; 9. **Comment
      style**; 10. **Documented limits**; 11. **Where things live** — the
      short pointer to `README.md` and the guide/README split.
5. **No new policy.** The file "transcribes what is already true
   elsewhere"; if you find a rule in the code or tests that AGENTS.md does
   not mention, list it in the PR body — do not add it.

## Current state

Read `AGENTS.md` on `origin/main` in full before starting (≈ 440 lines).
Its headings today: `## Constraints that are decisions, not gaps`,
`## The release rule`, `## How to verify a change`, `## Untrusted input`,
`## The CSP`, `## Comment style`, `## Documented limits — settled
decisions, not bugs`, `## Where things live`.

The unit suite's only coupling to this file is the docs cross-link check
(`test/unit.js`, search `docs cross-links resolve`): AGENTS.md has no
markdown links today; if you add any (e.g. `[the release rule](#the-release-rule)`),
they must resolve.

The code facts the checklist points at, all current:

| Change | What moves with it | Held by |
|---|---|---|
| a new `js/` file | `<script>` tag before `js/app.js`; `SHELL` in `sw.js`; `SHELL_SCRIPTS` in `test/harness.js`; guarded `wire*()` call; README layout row; this file's list | unit: "the four script lists agree"; CI `cache-version` step 2 |
| an id new to `index.html` read outside `app.js` | a null guard | unit: the id-dating section (plans/058) |
| a symbol `app.js` reads from a split file | stays in `app.js` or is stubbed | unit: the split-rules section |
| `index.html`, `css/` or `js/` | `CACHE_VERSION` bump (`tools/bump-cache-version.sh`) | CI `cache-version`; `pages.yml` guard (plan 061) |
| syntax | Safari 15 floor | unit: "shipped scripts parse on Safari 15" (plan 059) |
| a style | a class in `css/style.css`, never inline; tokens `--edge`/`--line`/`--amber-ink` | CSP; unit: contrast section |
| a part of the profile's record | one `RECORD_PARTS` entry (+ `NON_RECORD_FIELDS`) | unit: record-parts guards |
| an exercise field | one `EX_FIELDS` entry | unit: exercise-field guard |
| a reader of logged sets | `sessionsOf`; a write through `save()`/`commit()` | unit: the save-scope list |
| input from outside | a `normalizeImported*` + `esc`; `IMPORT_LIMITS`/`OWN_LIMITS`/`PROFILE_LIMITS` | unit: import cases |
| a destructive action | `snapshotForUndo` before its writes, no `await` between (plan 060) | unit: plan 060's undo cases |
| a user-visible behaviour | `docs/guide.md` | review |

Verify each row against the code before you write it (grep the named
test sections); a row you cannot confirm is left out and listed in the
PR body.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit (link check) | `node test/unit.js` | `0 failed` |
| Length | `wc -l AGENTS.md` | report before/after |

## Scope

**In scope**: `AGENTS.md`; this plan's Maintenance notes.
**Out of scope**: every other file. No code, no README/guide edits (list
anything in them that contradicts AGENTS.md in the PR body instead).

## Git workflow

`git checkout -B claude/070-agents-md --no-track origin/main`;
plain-sentence commit subjects with your `Co-Authored-By:` line; no bump.

## Steps

### Step 1: The inventory (before editing anything)

Go through `AGENTS.md` paragraph by paragraph and write, in a scratch file
outside the repo, one line per rule: a short statement, and the line
range it comes from. Include every named test, constant, file and plan
reference that states or justifies a rule. This is the contract for Steps
2–3; it goes in the PR body as a table (rule → old lines → new section).

### Step 2: Rewrite

Write the new `AGENTS.md` per decisions 2–4. Keep the repo's prose voice
(it explains *why*, in full sentences — see "Comment style" in the file
itself). Condense history per decision 1. Use subsection headings (`###`)
inside long sections so each rule has a place to be found.

### Step 3: Check the inventory against the result

For every line of the Step 1 inventory, find its statement in the new
file; tick it and note the new section. A rule you cannot find is a STOP.
Search both files for every backticked identifier
(`grep -o '\`[^\`]*\`' AGENTS.md | sort -u`) and confirm none disappeared
unless it was part of history that justifies nothing (list those).

**Verify**: `node test/unit.js` → `0 failed`; `git diff --stat` shows only
`AGENTS.md` (and the plan's notes).

## Test plan

The inventory table (every rule mapped), the backticked-identifier diff,
and the unit suite's link check.

## Done criteria

- [ ] The file opens (after the intro) with the checklist
- [ ] No section repeats a rule another section states
- [ ] The PR body has the full inventory table and the identifier diff
- [ ] `node test/unit.js` → `0 failed`; only `AGENTS.md` changed

## STOP conditions

- A rule in the inventory has no home in the new structure.
- Two statements of the "same" rule turn out to differ in substance —
  report both; do not pick one.
- The file you start from has changed since this plan (another PR
  edited it) in a way that adds a rule — include it, and say so.

## Maintenance notes

- A new rule goes in its section **and** gets a checklist line if it is
  something an agent must do when making a kind of change.
- The checklist's pointers are markdown links, so the unit suite's "docs
  cross-links resolve" section fails on a heading renamed under them.
  Keep `_` out of a heading that a link targets: that section's slugger
  strips `_` and GitHub's keeps it, so no anchor could satisfy both. This
  is why the `RECORD_PARTS` and `EX_FIELDS` subsections are named in
  words.
- Executor, 2026-09-23 (branch `claude/070-agents-md`, from `360b611`):
  - Drift since `c9114bc`: only 068 B's "Spanish only" clause (`bd1059b`),
    a rule added. It is kept word for word under Documented limits (third
    STOP condition: included, and reported in the PR).
  - The table's "a destructive action → `snapshotForUndo` before its
    writes, no `await` between" row is left out and listed in the PR. It
    could not be confirmed, and decision 5 bars it anyway. AGENTS.md never
    stated the rule. It lives in `js/app.js`'s comment above `undoArmed`
    and in plan 060's Maintenance notes. Plan 060's unit cases test
    undo's expiry only through "Borrar este día", and nothing tests a new
    destructive action's shape.
  - The "reader of logged sets" row names what the tests hold: the
    history-cache section pins every `save('view')` and scoped save and
    freezes the answers. Reading through `sessionsOf` has no source
    guard, so that half says "review".
  - Rows beyond the table, each an existing rule of this file with its
    test checked: rule 2, folded into the symbol row; "a log key, or a
    walk over a block's slots" (unit "the log key has one reader as well
    as one builder"); "anything a user sees" and "a code comment"
    (review).
  - `wireBlockEditor()`'s missing guard is stated once, in the pre-split
    exception. The ids subsection links to it for the consequence (a
    throw there takes `load()` with it). The second `SHELL_SCRIPTS`
    sentence under How to verify is folded into the split recipe.
  - Length 440 → 587 lines. The growth is the checklist (73 lines) and
    17 new headings; the prose is within a few lines of its old length.
    116 of the old file's 132 prose sentences survive word for word
    (whitespace collapsed). The other 16 were re-cut for the new headings
    or links (four only by a bullet marker or a heading now beside them),
    and the PR lists each.
