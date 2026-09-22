# Plan 047: The objetivo's two render memos are keyed by what they depend on; the rule's tests stop leaning on resets

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e9e8e7a..HEAD -- js/app.js js/diagnostics.js test/unit.js test/smoke.js`
> Plan 046 (`RECORD_PARTS`) may land first. It does not touch the functions
> below; any change to `renderCache`, `renderLogFresh`, `brakeCached`,
> `targetNow`, `targetFor`, `brakeOn` or `exHistory` means comparing them
> against "Current state" before proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW. No visible change. Two memo keys gain what they were
  missing, and the tests are cleaned up.
- **Category**: architecture — what remains of candidate 3 of the
  architecture review of 2026-09-21, settled with the maintainer on
  2026-09-22.
- **Planned at**: commit `e9e8e7a`, 2026-09-22

## Why this matters, and what is deliberately not done

Candidate 3 proposed splitting the objetivo rule into a pure
`targetFrom(sessions, …)` with history-gathering behind it. **That split
is dropped.** Plans 038 and 045 already absorbed its value:
- `targetFor` takes the clock and the brake as arguments.
- Its only history read is one `exHistory` call, which is cached and
  emptied by the log itself.
- `targetNow` is its only app caller.

A sessions-in probe would also skip the code the rule tests most need to
cover: legacy RIR, per-set inheritance and lb rows, which live in
`readSession` and `ruleSession`. A future review should not re-propose the
split. `units()` inside `ruleSession` also stays, because the session
cache's key includes the unit.

What does remain is two memos in `renderCache` whose keys are missing what
they depend on (at `e9e8e7a`):

- **`renderCache.target`** (`targetNow`, ~app:3383–3392) is keyed
  `block.id|ex.id|dayId|week`, **with no profile**. Both default profiles
  use `block-1`, so two profiles can collide.
- **`renderCache.brake`** (`brakeCached`, ~app:3375–3378) is **one slot
  with no key**. The first profile, block and week to ask fill it for
  everyone who asks after.

The app cannot hit either today, because `drawApp` resets `renderCache` on
every draw, including after a profile switch. The unit tests do hit them:
11 `resetRenderCache()` calls exist only to clear these memos between tests
that build a new `defaultState()` profile with the same ids. Anything that
calls `targetNow` outside a draw inherits the trap.

The rule's tests also carry leftovers:
- 8 `resetRenderCache()` calls that do nothing, because they come before
  `targetFor`, `exHistory`, `brakeOn` or `priorBlockSets` on a brand-new
  profile, which the history cache already treats as fresh. They are at
  unit.js ~1304, ~1487, ~1739, ~1752, ~1906, ~1909, ~4924 and ~4970.
- A stale comment at ~1301–1303 claiming the reset empties the history
  cache.
- `targetProbe` and `brakeProbe` inheriting `state.prefs.units` from
  whichever test ran before them.

## Steps

**A. Key the two memos.**
- `renderCache.target` must distinguish profiles. Use a `WeakMap` from the
  profile object to its own map, or another key that is stable for a
  profile object. Profile objects have no id, and the history cache
  already keys on object identity (plan 045), so follow its lead.
- `renderCache.brake` becomes keyed by profile, block id and week.
- Keep `renderLogFresh`'s rule that both are dropped when the log moves.
- Keep `targetNow`'s and `brakeCached`'s signatures.
- Explain in a comment why the profile is in the key, even though a draw
  only ever sees one profile.

**B. Tests.**
- Add a unit test that, **without any `resetRenderCache()`**, asks
  `targetNow` for two profiles built with the same block, day and exercise
  ids but different logs, and gets each profile's own answer. Do the same
  for the brake, with two blocks and two weeks. Both must fail on
  `e9e8e7a`'s code; check that.
- Delete the 8 no-op resets and fix the stale comment.
- Then delete each of the 11 needed resets that Step A makes unnecessary.
  Keep each one that still guards something, with a one-line comment
  saying what. The brake counting wrapper (~1054/1058) and the `lastTime`
  probe (~1007/1009) are deliberate. Report the before and after counts.
- `targetProbe` and `brakeProbe` set `state.prefs.units = 'kg'` themselves.

**C. Plan 038's record.** Add one line to
`plans/done/038-session-reader.md`'s Maintenance notes: candidate 3's
`targetFrom` split was absorbed by 038 and 045 and dropped (see plan 047),
so it is not re-proposed.

**D. Verify.**
- Run `node --check` on each touched file and `node test/unit.js`.
- Mutation-check: undo Step A's profile key, and the new test must fail;
  undo the brake key, and its test must fail.
- If a smoke section drives the objetivo line outside a draw (smoke.js
  ~1955, ~2042, ~2708), run it with `--only`.

## STOP conditions

- Any existing assertion changes outcome.
- A needed reset turns out to guard something other than these two memos.
  Report what it guards rather than deleting it.

## Maintenance notes

(Filled in when the PR lands.)
