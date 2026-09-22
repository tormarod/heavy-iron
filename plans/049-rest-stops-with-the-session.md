# Plan 049: The draw ends a rest when the session on screen changes — eight hand-written `stopRest()` calls go

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e9e8e7a..HEAD -- js/app.js js/block-editor.js js/rest-timer.js test/unit.js test/smoke.js docs/guide.md`
> Plans 046, 047 and 048 may land first. None of them touches navigation or
> the rest timer. Re-locate the `stopRest()` calls listed below by grep
> rather than by line number.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW. One small, intended visible change (Step C).
- **Category**: architecture — candidate 6 of the architecture review of
  2026-09-21, reframed and settled with the maintainer on 2026-09-22.
- **Planned at**: commit `e9e8e7a`, 2026-09-22

## Why this matters, and what is deliberately not done

The review proposed replacing the rest timer's five stubs in `js/app.js`
(~2819–2834) with event hooks (`onSessionLeave`, `onDraw`, `onPrefsSaved`)
that `js/rest-timer.js` subscribes to. **That is dropped.** Every hook
would have one subscriber, which makes it a hypothetical seam. The stubs
do the one job they exist for, protecting a cached shell that lacks
`js/rest-timer.js`, and each has one or two honest call sites. They stay,
along with `openChart`'s.

The real friction is `stopRest()` being called **by hand at eight places
that all mean "the session on screen changed"**. At `e9e8e7a` they are:
- the profile switcher, app ~2863
- week ◀ and ▶, ~3047 and ~3048
- the week list, ~3059
- the day tabs, ~3078
- the day tabs' keyboard handler, ~3104
- the block selector, block-editor.js ~44
- deleting the active block, block-editor.js ~87

Every new navigation control has to remember the call. Plan 037 added
several. Two paths that also change the session on screen never call it:
**undo**, and **adopting another tab's write**. Each of these leaves a
countdown running for a set nobody can see.

## The decisions (settled 2026-09-22 — do not re-open)

1. **No event hooks.** The stubs stay as they are.
2. **The draw notices.** `drawApp` remembers the session it last drew:
   the active profile's key, its active block id, its week and its day.
   When that changes, it calls `stopRest()`. Every navigation already ends
   in `commit('view')`, and the draw is the one place that sees every way
   of leaving a session, including future ones. The first draw after load
   has nothing to compare against and stops nothing.
3. **The eight hand-written calls go.** These calls stay, because they
   mean something else:
   - the tick on an exercise with no rest time (~3907);
   - `showRecovery` (~1374), which is not a draw;
   - the timer's own internal calls in `js/rest-timer.js`.
4. **Accepted behaviour change:** undo and adopting another tab's write now
   end a running rest when they change the session on screen. The guide
   says so (Step C).

## Steps

**A.** In `drawApp`, compare the drawn session's key with the last one and
call `stopRest()` when they differ. The comment says why the draw owns
this. The recovery path needs no special case, since it stops the rest
itself. Put the key comparison in a small pure helper if that makes it
testable, e.g. `sessionOnScreen(state)` returning the key string.

**B.** Delete the eight calls. Keep their `commit('view')` calls.

**C.** In `docs/guide.md`, in the rest-timer paragraph at ~478–488 or the
bar paragraph at ~55, add one sentence in the guide's voice: moving to
another day, week, block or profile ends the rest, and so does undoing
back to a different session.

**D. Tests.**
- Unit: the key helper changes exactly when the profile, block, week or
  day does, and not on a redraw of the same session.
- Smoke, if a section drives navigation during a rest (grep smoke.js for
  `stopRest`, `tnext` and `rest`): the existing assertions must still hold.
  If one covers "switching day ends the rest", it must pass unchanged.
- Add one smoke assertion that undo back to a different day ends a running
  rest. Only do this if an existing section already starts a rest and uses
  undo; otherwise say so and skip it.

**E. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for the rest-timer, bar and navigation
  sections (`--list` to find them).

## STOP conditions

- Any existing assertion changes outcome, apart from the undo behaviour in
  decision 4.
- A draw changes the session on screen while a rest should survive it. For
  example, a path where the day changes but the same set is still in
  front of the lifter.

## Maintenance notes

**Landed 2026-09-22**, branch `claude/049-impl`, on top of `e9e8e7a` (no
rebase needed — main had not moved). No deviation from the design: no event
hooks, the five stubs untouched, all eight calls removed with their
`commit('view')`/`commit()` kept.

- `sessionOnScreen(state)` (`js/app.js`, just above `drawApp`) is the pure
  key helper Step A suggested — `activeProfile|block.id|slot(week, dayId)`.
  `drawApp` compares it against `lastSessionOnScreen` (module-level, `null`
  until the first draw) right after `drawnSlot` is set, since both need the
  same clamped `profile.week`/`profile.day`. A test wants the same key
  drawApp would compute: call `sessionOnScreen(state)` directly, not
  `drawnSlot` (a different bookkeeping variable, for `pruneLog`).
- The eight removed calls: profile switcher, week ◀/▶, the week list, the
  day tabs, the day tabs' keyboard handler (all `js/app.js`), the block
  selector and deleting the active block (both `js/block-editor.js`). Kept:
  the no-rest-time tick (`js/app.js` ~3934) and `showRecovery` (~1374) — both
  name something other than "the session on screen changed" — and
  `js/rest-timer.js`'s own internal calls.
- Two comments (`js/app.js` and `js/rest-timer.js`, both at the "the rest
  timer lives in js/rest-timer.js" / "Unlike the calculator" paragraph) said
  stopRest was called "from every navigation/profile/week/day button" — now
  stale, since the callers are drawApp and the tick handler. Reworded to
  name drawApp and this plan; not asked for by the plan text, but the two
  paragraphs directly describe the mechanism this PR changes.
- Smoke: no section starts a rest and then uses undo, so Step D's
  conditional new assertion (undo across a different day ending a running
  rest) was skipped, per the plan's own "otherwise say so and skip it." The
  existing undo coverage (`test/smoke.js`, "main session", clearDay + undo)
  never changes day/week/profile, so it would not have exercised the new
  behaviour anyway. Nobody has smoke coverage of the silent two-tab adopt
  path stopping a rest either (`test/smoke.js`'s "dos pestañas" section only
  drives the conflict-toast branch); decision 4 covers it, Step D does not
  ask for a test of it, so none was added.
- **`CACHE_VERSION` is not bumped and `sw.js` is untouched**, even though
  `js/app.js`, `js/block-editor.js` and `js/rest-timer.js` all changed:
  left for whoever integrates this branch (possibly alongside 046-048), one
  bump via `tools/bump-cache-version.sh` for however many of these land
  together — the `cache-version` CI job will fail until that happens.
