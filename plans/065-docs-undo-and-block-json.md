# Plan 065: The guide says what undo covers and quotes the real dialog; the README's block contract matches the importer and the AI prompt

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` unless you were told otherwise.
>
> **Drift check (run first)**:
> `git diff --stat b15ae87..origin/main -- docs/guide.md README.md js/app.js js/block-editor.js js/profile-transfer.js`
> Re-locate every anchor by `grep`, never by line number alone.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (docs only; no `CACHE_VERSION` bump — no shell file changes)
- **Depends on**: plan 060 (soft — it rewrites the guide's § "Undo" to say
  when undo ends; land after it and keep its wording). If 060 has not
  landed, do this anyway and leave § "Undo"'s expiry sentence as it is.
- **Category**: docs
- **Planned at**: commit `b15ae87`, 2026-09-22 (tenth audit, finding 8)

## Why this matters

- **The guide teaches the belief plan 013 removed from the dialogs.** It
  quotes the profile-load confirmation as ending "No se puede deshacer.",
  but the real dialog ends with `UNDO_PROMISE` — "Podrás deshacerlo justo
  después, mientras no hagas otra cosa." — and the action does take a
  snapshot. `js/app.js`'s comment above `UNDO_PROMISE` says exactly why
  that sentence matters: whoever believes "no se puede deshacer" never
  looks for the toast. The guide also lists three undoable actions
  (clearing a day, wiping a profile, deleting a block); there are six —
  plus saving the plan (the one save that can erase logged sets), restoring
  a backup, and loading a profile (also the QR "Perfil" route).
- **The README's block contract contradicts the app's own AI prompt.** The
  README (§ "Block JSON shape") says `ex.id` "only matters for matching
  'last time' history within the same block, so it's safe to leave out".
  The objetivo joins a lift's history **by id across blocks**, and the
  in-app prompt asks the AI to keep ids "para que su historial siga
  unido"; an id left out becomes a slug of the name, so rewording the name
  cuts the history. The README calls this section the contract for "a
  training agent with commit access" publishing to `blocks/`. Two more
  lines are stale: `phase` is "per-week (`1`–`8`)" (it is `1`–`weeks`, up
  to 16, and an entry with only `r` or only `t` falls back to the
  default), and `ex.minRir` is "a whole number 0–5, or the field is
  dropped" (it is rounded and clamped to 1–5; 0 or unreadable drops it).
  And § "Tests" still describes the unit suite as arithmetic only, though
  it has booted handler tests (`bootApp()`) since plan 052.

## Current state (verify each by grep before editing)

- `docs/guide.md`:
  - Feature list, search `**Undo** on the three things that destroy data`
    (≈ line 124): "- **Undo** on the three things that destroy data:
    clearing a day, wiping a profile, deleting a block."
  - § "Two phones, one profile each", the fenced dialog (≈ line 262–266),
    last line: `Bruno no se toca. No se puede deshacer.`
  - § "Undo" (≈ line 337): "Clearing a day, wiping a profile and deleting a
    block each take a snapshot first, …"
- The truth, in code:
  - `grep -n "snapshotForUndo(" js/*.js` → six call sites: `clearDay`,
    `wipe` (`js/app.js`), `deleteBlocks`, the plan editor's save
    (`js/block-editor.js`), `restoreFromText`, `loadProfileFromText`
    (`js/profile-transfer.js`).
  - The profile-load dialog body (`js/profile-transfer.js`, search
    `'Se reemplaza ' + local.label`): `… 'no se toca' + … '. ' : '') + UNDO_PROMISE`.
  - `UNDO_PROMISE` (`js/app.js`): `'Podrás deshacerlo justo después, mientras no hagas otra cosa.'`
  - The restore dialog also ends with `UNDO_PROMISE` (search
    `UNDO_PROMISE,` in `js/profile-transfer.js`).
- `README.md`:
  - `ex.id` bullet, search `Only\n  matters for matching` or
    `safe to leave out` (≈ line 251).
  - `phase` bullet, search `per-week (\`1\`–\`8\`)` (≈ line 313).
  - Limits table row, search `| \`ex.minRir\` |` (≈ line 335).
  - § "Tests", search `the schema repair in \`migrate()\`` (≈ line 112).
- The code the README must match:
  - The objetivo joins by id across blocks: `js/app.js`, search
    `Joined by exercise id and across blocks`.
  - The AI prompt's id line: `js/app.js`, search `para que su historial siga unido`.
  - `phase` import: `js/block-editor.js`, search
    `phase[w] = (p && p.r && p.t)` — both `r` and `t` are needed, weeks
    `1..weeks`.
  - `minRir`: `js/app.js`, `EX_FIELDS` entry `key: 'minRir', lo: 0, hi: 5`,
    `accept`: `clampInt(v, 0, 5, 0)` then `n > 0 ? n : undefined`;
    `clampInt` rounds (`Math.round`).
- The docs' internal links are checked by `node test/unit.js` (search
  `docs` near the link-check section); keep every existing anchor valid.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit (includes the docs link check) | `node test/unit.js` | `0 failed` |

## Scope

**In scope**: `docs/guide.md` (the three passages above), `README.md`
(the four passages above).

**Out of scope**: any `js/` file (no code change, so no bump); the guide's
Spanish UI labels elsewhere; AGENTS.md; restructuring either document.

## Git workflow

Branch `claude/065-docs` from `origin/main`, one commit, plain-sentence
subject, your session's `Co-Authored-By:` line. No bump.

## Steps

### Step 1: The guide

1. Feature list bullet: "**Undo** on the six things that replace or
   destroy data: clearing a day, wiping a profile, deleting a block,
   saving the plan, restoring a backup and loading a profile." Keep its
   link style if it has one.
2. The dialog in § "Two phones, one profile each": replace the last line
   with `Bruno no se toca. Podrás deshacerlo justo después, mientras no hagas otra cosa.`
   (the exact `UNDO_PROMISE` text).
3. § "Undo": the first sentence lists the same six actions. Keep the rest
   (plan 060's expiry wording, if landed; "one level deep"; "doesn't
   survive a reload").

**Verify**: `grep -n "No se puede deshacer" docs/guide.md` → only lines
that describe the one dialog that still says it (deleting a retired
exercise's log from the editor — `js/app.js`'s comment above
`UNDO_PROMISE` names it); if there are none, no output. `node test/unit.js`
→ `0 failed`.

### Step 2: The README

1. `ex.id`: "optional, but **keep it stable** — the weekly objetivo joins
   a lift's history by id, across blocks, so an exercise that keeps its id
   in the next block keeps its history. If omitted it is slugged from `n`
   (de-duplicated within the block, at most 60 characters), so renaming
   the exercise later starts a new history."
2. `phase`: "per-week (`1`–`weeks`) goal text … an entry needs both `r` and
   `t`; any week left out, or with only one of the two, falls back to the
   generic RIR-based default." Keep the rest of the bullet.
3. `ex.minRir` row: "rounded to a whole number and clamped to 1–5; `0` or
   anything unreadable drops the field".
4. § "Tests": one sentence after the arithmetic list — it also boots the
   app in Node (`bootApp()` in `test/harness.js`) and presses the real
   handlers, asserting what they write.

**Verify**: `grep -n "safe to leave out\|(\`1\`–\`8\`)\|a whole number 0–5" README.md`
→ no output. `node test/unit.js` → `0 failed`.

## Test plan

No new tests: the unit suite's docs link check covers the anchors. The
two grep checks above are the done criteria.

## Done criteria

- [ ] The guide names six undoable actions in both places, and quotes the
      dialog with `UNDO_PROMISE`'s text
- [ ] The README's `ex.id`, `phase`, `minRir` and § "Tests" lines say what
      the code does (Step 2's grep → no output)
- [ ] `node test/unit.js` → `0 failed`
- [ ] Only `docs/guide.md` and `README.md` changed

## STOP conditions

- `grep -n "snapshotForUndo(" js/*.js` no longer shows exactly six call
  sites — list what it shows and adjust the count only if the new site is
  obviously a destructive action; otherwise report.
- The objetivo no longer joins by id across blocks (the search in Current
  state finds nothing).

## Maintenance notes

- A new destructive action with an undo snapshot adds itself to both
  guide lists.
- *(Executor: record deviations here.)*
