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

**Landed 2026-09-22**, branch `claude/047-impl`, on top of `e9e8e7a` (no
rebase needed — `origin/main` had not moved). No deviation from the design:
`renderCache.target` and `renderCache.brake` are each a `WeakMap` keyed on
the profile object, following the history cache's own lead (plans/045),
holding a plain object keyed as before (`block.id|ex.id|dayId|week` for the
target, `block.id|week` for the brake) underneath. `targetNow`'s and
`brakeCached`'s signatures are unchanged, and `renderLogFresh` still drops
both — now to fresh `WeakMap`s — the moment the log moves.

**The two new tests, fail-before/pass-after.** Both are in `test/unit.js`
§ "render cache", right after the existing `lastTime`/`resetRenderCache()`
pair, and neither calls `resetRenderCache()` itself. Checked by reverting
Step A only (`git show HEAD:js/app.js > js/app.js` against the pre-047 tip,
i.e. the drift-check commit) and running the suite:
- Before Step A: `targetNow keys its memo by profile…` **FAILS** —
  `{"sameObject":true,"w1":42.5,"w2":42.5}`: the second profile's call
  returned the first profile's cached object outright. `brakeCached keys
  its memo by profile, block and week…` **FAILS** —
  `{"r1":false,"r2":false}`: an even stronger failure than the two-profile
  story alone — the single untyped slot still held a stale boolean left by
  an unrelated earlier test, so neither call reached the stub at all.
- After Step A: both **PASS**, and the full suite is unaffected (845 → 847,
  the two new cases, 0 failed).

**Mutation-check**, done as two separate partial reverts so each memo's key
is shown to matter on its own:
- Target only (brake left keyed): `targetNow keys its memo by profile…`
  fails (`sameObject:true`) and `brakeCached keys its memo…` still passes.
  Two other, pre-existing cases fail too — "on the deload week the rule
  returns a descarga target that is down" and "an ordinary objetivo target
  that comes down still reads as a mis-chosen weight" — which is the
  expected shape: those two tests' own `resetRenderCache()` calls were
  among the ones Step B deleted as no-longer-needed, and this mutation is
  exactly the condition ("no profile in the key") that made them needed
  before Step A.
- Brake only (target left keyed): `brakeCached keys its memo…` fails
  (`{"r1":{},"r2":{}}` — the `WeakMap` container itself, read back as if it
  were the cached value) and `targetNow keys its memo…` still passes. Two
  pre-existing brake-counting cases fail alongside it ("two brakeCached
  reads inside one draw call brakeOn once", "a resetRenderCache() in
  between makes the next brakeCached pay for brakeOn again" — both read 0
  calls, since the mutated brakeCached never falls through to `brakeOn`
  once the `WeakMap` has been assigned).

Both reverts were restored from a scratchpad copy of the post-Step-A file
before continuing; the working tree was never left in a mutated state
between checks.

**`resetRenderCache()` in `test/unit.js`: 21 real calls before this plan,
4 after.** (One more than "20" in a bare `resetRenderCache();` grep, because
one of the 21 is `call('resetRenderCache()')` — a string the harness
executes inside the vm, not a call in the outer file — plans/047's own
line-number estimates undercounted it by one for the same reason.) Kept,
both pre-dating this plan and unrelated to the target/brake keys:
- **~1007/1009 (`lastTime` probe).** Pins that `lastTime` (a `sessionsOf`
  band, not `target`/`brake`) reads the same cached set objects across two
  `resetRenderCache()` calls with nothing logged in between, and a
  different one once `logChanged()` has run. About the history cache's own
  lifetime, not about either memo this plan keys.
- **~1054/1058 (brake-counting wrapper).** Stubs `brakeOn` and counts calls
  across two `brakeCached` reads with a `resetRenderCache()` between them,
  pinning that the memo (not just its key) makes the second draw's second
  read free and the reset makes it pay again. Kept exactly per the plan.

Deleted, in two groups:
- **8 no-ops**, at the plan's own line numbers (~1304 `targetProbe`, ~1487
  `brakeProbe`, ~1739/~1752 `twoDayProbe`, ~1906/~1909 `cutHistory`,
  ~4924/~4970 `priorBlockSets`). Each calls `targetFor`/`brakeOn`/
  `exHistory`/`priorBlockSets` directly rather than through
  `targetNow`/`brakeCached`, so the reset never touched either memo; the
  comment at old ~1301–1303 claiming the reset "empties the history cache"
  was simply wrong (that cache keys on profile-object identity and these
  profiles are fresh object literals every call) and is rewritten rather
  than deleted outright, to say what actually makes the second call safe.
- **9 collision guards, made unnecessary by Step A.** At old ~1148 (diagRows
  after a hand-written log write), ~1200/~1235 (`deloadVerdict`,
  `objetivoDownVerdict`), ~2268 (`rirStarts`), ~2467 (`diagProbe`, called
  many times over), ~4397 (the history-cache section's own `targetNow`
  call), and ~4855/~4892/~4896 (the CSV/review section's block-2 fixture
  and its scoped/global `diagRows` pair). Each was removed one at a time
  against the live suite — not batched — confirming individually that no
  assertion's outcome changed before moving to the next; the cumulative
  removal was then re-run once more to rule out an interaction between
  them. Two of these (~1200, ~1235) are exactly the ones the target-only
  mutation check above turns back into failures, which is the empirical
  proof that their removal is Step A's to justify, not a coincidence.

This lands at 9, not the "11" the plan's own problem statement estimated —
written before the line-by-line audit Step B asked for. One reason: ~4397
turned out to be the *first* call anywhere in the suite with block id `A` /
exercise `bp` / day `d1` / week 5, so no prior cache entry could exist for
it to guard against regardless of Step A. The plan's STOP condition ("a
needed reset turns out to guard something other than these two memos") was
not hit — every reset removed was checked to change no assertion's outcome,
and every deletion above states which category it fell in.

**`targetProbe`/`brakeProbe` and `state.prefs.units`.** Both now set
`state.prefs.units = 'kg'` themselves at the top of the probe function,
rather than depending on whichever earlier test last touched the setup
sheet. Neither probe's assertions changed (both build profiles already
logged in kg), so this is a latent-bug fix with no visible effect on the
suite today — but it stops a future reordering of the file from making
these 19 cases flip units silently.

**Step C.** One paragraph added to `plans/done/038-session-reader.md`'s
Maintenance notes recording that candidate 3's `targetFrom` split was
re-examined and dropped.

**Verification.** `node --check js/app.js`, `node --check test/unit.js`:
clean. `node test/unit.js`: 847 passed, 0 failed (845 before this plan + 2
new). Smoke: a static server on `127.0.0.1:8795` (`python3 -m http.server`)
with Playwright's already-installed Chromium (found through this worktree's
parent `node_modules`, nested under the repo root — no new install
required), `BASE=http://127.0.0.1:8795 node test/smoke.js --only "objetivo
de peso y diagnóstico" --only "el mismo ejercicio en dos sesiones"`: 44
passed, 0 failed, 29 sections skipped by `--only`. No full `test/smoke.js`
run (not needed: this branch does not touch the shell, `sw.js`, `blocks/`
or `test/smoke.js` itself). No `CACHE_VERSION` bump, no `sw.js` edit, no
`plans/README.md` edit, no push, no PR — per the executor's instructions,
left for the orchestrator.
