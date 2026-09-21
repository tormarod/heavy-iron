# Plan 045: The history cache — `sessionsOf` answers once per question, and the write that changes the log is what empties it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` and record anything that deviated under
> "Maintenance notes".
>
> **Drift check (run first)**:
> `git diff --stat f37f3ae..HEAD -- js/app.js js/diagnostics.js js/block-editor.js js/profile-transfer.js js/qr-transfer.js test/unit.js`
> On any in-scope change, re-run the mutation audit below (Step 1) against
> the live code before proceeding: a new path that writes `log`, `rir`, a
> block's plan or `blockOrder`, or a new reader that writes onto what
> `sessionsOf` returns, is a STOP condition until this plan is updated.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — a stale history is a wrong objetivo on screen, and a
  cache is exactly how one gets there. Mitigated by making the safe
  answer the default (a write that says nothing empties everything), by
  pinning every narrower claim in `test/unit.js`, and by a unit case per
  kind of write.
- **Depends on**: plans/038 PR 3 (the rule reads its history through
  `sessionsOf`) — merged. **Unblocks** plans/038 PR 6 (the card bands).
- **Category**: perf / architecture — "candidate 3" of the architecture
  review of 2026-09-21, brought forward by plans/038's cost measurement
  and the maintainer's decision of 2026-09-21: *cache first*.
- **Numbering**: written as "039" in the request; 039–043 were already
  taken by the eighth audit and 044 by the Diagnóstico RIR plan, so this is 045.
- **Planned at**: commit `f37f3ae`, 2026-09-21
- **Glossary**: `CONTEXT.md` — session, working set, lift, deload week,
  stranded week.

## Why this matters

Plans/038 decision 14 measured the card bands (`lastTime`,
`priorBlockSets`) through `sessionsOf` at 14.8 ms per day drawn on a
13 824-row profile, against 0.21 ms today with early exits — well over its
STOP condition 3. The maintainer's decision (038, Maintenance notes,
"Decided 2026-09-21: cache first"): no early exit and no newest-first
variant; a history cache lands first, so one read serves every draw, and
it is "invalidated by the log itself, not by whoever remembers to reset
it".

The existing per-draw cache is the counter-example. `renderCache` was
reset by `drawApp`, *kept* by `drawCard` on the strength of a page of
prose arguing that a tick could not reach any entry in it, and reset again
at the top of `diagRows`, because the Diagnóstico's entries *could* see
the tick (plans/027). Every one of those is somebody remembering.

## Current state (at `f37f3ae`)

- `sessionsOf(profile, q)` walks the log on every call; no cache.
- `exHistory` = `sessionsOf` + `ruleSession` per session; the rule, the
  brake (every exercise of the block, once per draw) and
  `diagLevelTrend` read it through `exHistoryCached`, which is
  `renderCache.history`, a per-draw map.
- `renderCache` also holds `lastTime`, `priorBlock`, `target`, `brake`
  (log facts) and `liftSlots`, `slug` (plan facts). `drawApp` resets it;
  `drawCard` keeps it (the invariant prose at `drawCard`); `diagRows`
  resets it.
- `save()` is the debounced write every persistent change calls;
  `commit()` is `save(); render();`.

## Design

### Where the cache sits

In front of `sessionsOf`, not beside it: `sessionsOf` validates the query
and hands it to `historyRead`; the walk itself is `readSessions`. Every
reader — the rule today, the Diagnóstico, the charts and the bands as
plans/038 moves them — gets the cache without asking for it.

Answers are filed per **profile object** (a `WeakMap`), under a canonical
key of the question: `weeks`, the lift (`id`, or `like`'s id + slug — the
two things `sameLift` matches on), `day`, the resolved **block list**
(`q.blocks` or a copy of `blockOrder`), the cut-off and `skipDeload`.

### What invalidates it — "by the write"

The narrowest reliable point is `save()`: it is called synchronously by
every path that changes the log, the legacy RIR map or the plan, because a
change that does not call it is lost on reload — the discipline already
exists and is already enforced by review (plan 006 fix 1 was that bug).
`save(scope)` calls `logChanged(scope)` *before* the debounce, so the very
next draw — the tick's own `drawCard` — reads after the write.

Three claims, the default the safe one:

| Call | Means | Effect |
|---|---|---|
| `save()` / `commit()` | anything may have changed | every answer for every profile goes (`logGen`) |
| `save('view')` / `commit('view')` | nothing a session reads changed | nothing goes |
| `save(here)` in `buildExCard` | only this lift's rows in this slot | only answers whose question can see that slot go (`historySees`) |

A claim narrower than the write is a stale objetivo; a wider one only
costs a cold read. So forgetting is slow, never wrong, and every narrow
claim is listed in a unit test (see Step 5) so a new one is a reviewed
edit.

What needs no call at all, because it is caught structurally:

- **A swapped state or profile** (restore, profile import, QR profile,
  undo, another tab's write adopted, `load`): new objects, new
  `WeakMap` slot.
- **The unit**: part of each profile's cache; a switch starts over. (The
  setup sheet also calls `save()`.)
- **A block added to `blockOrder`**: the block list is in the key.
- **A rename** (`profile.variants`): not read by `sessionsOf`; the rule's
  projection is keyed on the cut (see below).

Why not a structural token of the log (a hash, a row count): every card
write is an in-place edit of a row object — `r.w`, `r.done`, `r.rir` —
and no token cheaper than the walk itself sees one.

### Cut-offs are slices

A question with `before: { block, week }` is answered as a prefix of the
same question without a cut-off over the blocks up to that one
(`readSessions` returns oldest first, block by block, week by week). Both
are filed. That does two things:

- A **change of week** is warm: every card and the whole brake ask again
  with a new cut-off, and each is a slice of an answer already held.
- A **tick** in the week being trained drops the uncut answer for that
  lift (it can see the week) and keeps every slice that stops before it —
  the brake's and every other card's, and this card's own objetivo
  history. This is the invariant `drawCard`'s prose used to argue; now it
  is `historySees` comparing the write against the question's own cut-off.

### Frozen answers

Every caller gets the same arrays, so they are frozen: the session list,
each session, its `sets`, each set, its `drops`, each drop
(`freezeHistory`, shape-aware — a recursive freeze cost ~40 % of a cold
draw, this ~8 %). Writes are silently dropped in these sloppy-mode
scripts; the unit suite passes unchanged with `'use strict'` on every
shell script, i.e. nothing in the app writes onto an answer today.

### The rule's projection rides on the answer

With the read cached, `ruleSession` over every session is most of what
the brake costs (measured: 9.9 ms of a warm draw). `exHistory` files its
result beside the `sessionsOf` answer it was built from
(`historyDerived`), keyed on everything else it reads: rep range, the
split-day filter, the variant cut (`variantSince`) and the unit. It dies
with the answer. Its result is frozen too.

### What happens to `renderCache`

- `history` and `exHistoryCached` are **retired**: `targetFor`, `brakeOn`
  and `diagLevelTrend` call `exHistory`.
- The **log facts** it still holds (`lastTime`, `priorBlock`, `target`,
  `brake`) are dropped the moment the log moves (`renderLogFresh` compares
  `logSeq`, which every non-`'view'` change bumps). Rebuilding them after a
  tick is cheap because the history under them survived.
- The **plan facts** (`liftSlots`, `slug`) stay per draw.
- `drawCard`'s invariant prose is replaced by a short note saying why no
  argument is needed; its `if (!renderCache) resetRenderCache();` stays
  (pinned by plans/027's source test).
- `diagRows` no longer resets anything.

`lastTime` and `priorBlock` leave `renderCache` in plans/038 PR 6 when
they move onto `sessionsOf`.

## The mutation audit

Every path that writes `profile.log`, `profile.rir`, a block's plan
(`profile.blocks`), `profile.blockOrder` or `state.prefs.units`, and how
each invalidates. "broad" = `save()`/`commit()` with no claim.

| Path | Writes | Invalidates by |
|---|---|---|
| card weight / rep / RIR boxes, tick, drop add / edit / remove, drop kind (`buildExCard`) | rows of one lift in one slot; `dropLegacyRir` | `save(here)` — scoped |
| tick's `recordTargetOnStart` | `obj` | `save('view')` (the rows were claimed by the handler's own save) |
| `ex.setup` box | plan field no session reads | `save('view')` |
| `copyPrev` | rows (+ `entry` padding), `obj` | `commit()` broad |
| `clearDay` | log + rir + meta of one slot | `commit()` broad |
| `wipe` | `log = {}`, `rir = {}` … | `commit()` broad |
| plan editor save: `moveExLog`/`moveExRir`, `purgeExLog`/`purgeDayLog`, `recordVariant`, the block replaced | log, rir, plan, variants | `commit()` broad |
| `deleteBlocks` | blocks, all maps, `blockOrder` | `commit()` broad (and the block list is in the key) |
| `newBlock`, `installImportedBlock` (file, paste, QR) + `installBlockData` → `foldRirMap` | blocks, `blockOrder`, log, rir | `commit()` broad |
| setup sheet | units, blocks, `log = {}` | `save()` broad; units in the cache |
| `restoreFromText` | `state = data`; `migrate` | new objects; `commit()` |
| `loadProfileFromText` (file, QR "perfil") | `state.profiles[k] = incoming`; `migrate` | new object; `commit()` |
| `undoLast` | `state = restored`; `migrate` | new objects; `save()` |
| another tab (`storage` event) | `state = next`; `migrate` | new objects (no save, correctly) |
| `load` | `state = parsed`; `migrate` (`foldRirMap`) | new objects |
| week / day / profile / block pickers, day-tab arrows | `profile.week/day`, `activeProfile/activeBlock` | `commit('view')` |
| session order ("⋯" arrows, "Volver al orden") | `profile.order` | `commit('view')` |
| energy chips, session note | `energy`, `notes` | `save('view')` |
| theme, persistence ask, backup nag, rest-timer prefs, `closeSetup` | prefs | `save()` broad — left as is: rare, and wider is only slower |
| `drawApp` (`entry` padding, `delete days[0].off`, week/day clamp) | unticked rows; `off` | none needed: no session reads an unticked row or `off` |
| `writeState` → `pruneLog` | trailing unused rows, empty containers | none needed: an unused row is not ticked, and indices of ticked rows do not move |
| `recordVariant` | `variants` | none needed for `sessionsOf`; the rule's projection is keyed on the cut |

Nothing in `js/chart.js`, `js/review.js`, `js/diagnostics.js`,
`js/volume-sheet.js` or `js/calculator.js` writes any of these.

## Steps

### Step 1: The audit
Re-run the audit above against the live code (`grep -n "\.log\b\|\.rir\b\|blockOrder\|prefs\.units *=\|state *= " js/*.js`
and every `save(`/`commit(` site). Any writer not in the table is a STOP.

### Step 2: The cache (`js/app.js`, "the history cache", after `readSession`)
`sessionsOf` → `historyRead` → `readSessions`; `logChanged`,
`historySees`, `historyKey`, `historyEntry`, `historyDerived`,
`freezeHistory`; `save(scope)` and `commit(scope)`.

### Step 3: The writes claim what they wrote
`save(here)` in `buildExCard`'s nine row handlers; `'view'` at the sites
in the audit table.

### Step 4: Retire the per-draw history
Remove `renderCache.history` and `exHistoryCached`; add `renderLogFresh`;
`exHistory` files its projection with `historyDerived`; rewrite the
`drawCard` note; drop the reset in `diagRows` (`js/diagnostics.js`).

### Step 5: Tests (`test/unit.js`, "the history cache", after the `sessionsOf` section)
- same question twice → same arrays; a new cut-off is a slice
- a caller cannot poison an answer (sessions and `exHistory`)
- tick: `sessionsOf`, `exHistory` and `targetNow` (inside a kept render
  cache) read it at once; another lift's and the pre-week history are
  kept (same reference)
- typed weight; typed RIR with the legacy map dropped, on an earlier week
- broad writes: a written slot (copyPrev + tick), clearDay, purge, move,
  the plan's set count, the deload week, a new block (no save — the key),
  a deleted block, wipe
- a unit switch (no save), a restored/imported profile (no save), undo, a
  rename
- `'view'` saves and commits keep every answer
- the list of `'view'` claims and scoped saves is exactly the audited one
- plans/027's "Diagnóstico reads a tick" case now ticks through the card's
  `save(here)` instead of relying on `diagRows`' reset

### Step 6: AGENTS.md
One paragraph under the `sessionsOf` note: answers are frozen, `save()`
empties the cache, the two narrower claims are pinned.

No `CACHE_VERSION` bump in this plan's commits: the orchestrator bumps
it when opening the PR.

## Verification

```
node --check js/app.js && node --check js/diagnostics.js && node --check js/block-editor.js
node test/unit.js                  # 788 passed (778 before, 9 new, and the index link check for this file)
node test/smoke.js --only "main session" --only "weight drops" --only "objetivo de peso" \
  --only "dos sesiones" --only "nota, energía" --only "primera semana"
```

## Done criteria

- Every existing unit assertion passes unchanged in outcome; the one
  edited case (plans/027's) asserts the same thing through the real save.
- A warm draw, a change of week and a tick each cost well under the
  plans/038 baseline (Maintenance notes).
- `grep -n "exHistoryCached\|renderCache.history" js/` is empty.

## STOP conditions

- A path writes `log`, `rir`, a block's plan or `blockOrder` and neither
  calls `save()`/`commit()` without a claim nor replaces the profile
  object — before the next draw.
- A reader writes onto an answer (run the unit suite with `'use strict'`
  prefixed to every shell script: any `TypeError` is one).
- A cold draw measures more than ~20 % slower than `origin/main` on a
  profile whose active block is logged only up to the current week
  (measured: +9 % today's cards, +13 % with the PR 6 bands).

## Maintenance notes

**Landed 2026-09-21**, branch `claude/039-history-cache`, no deviation in
design from the request except the numbering (045) and two additions the
measurements forced: cut-offs as slices, and the rule's projection filed
beside the answer.

**Measurements** — plans/038's synthetic profile (6 blocks × 12 weeks ×
6 days × 8 lifts × 4 sets, 13 824 rows), Node on the same desktop, one
day's eight cards at week 7 of the last block, 30 runs each.
`scratchpad/measure-cache.js` (derived from the orchestrator's
`measure-sessions.js`, root taken from argv). "Cold" empties the cache
before each run (as after a broad write); "warm" repeats the call with
nothing logged in between. This machine measured `exHistory` at 14.7 ms
today where plans/038 recorded 8.4, so compare within a column, not with
038's table.

| Reading | `origin/main` | this plan, cold | this plan, warm |
|---|---|---|---|
| `sessionsOf` bands (id + like), 8 cards | 16.3 | 17.5 | 0.02 |
| `exHistory`, 8 cards | 14.7 | 17.8 | 0.03 |
| a full draw's log work today (objetivo + brake + two early-exit bands) | 88–91 | 104 | 0.9 |
| the same with the PR 6 bands on `sessionsOf` | 106–114 | 122 | 0.6 |
| a draw after a change of week (PR 6 bands) | 103 | — | 12.3 |
| a tick + its card redrawn, bands as today | 0.00 | — | 0.29 |
| a tick + its card redrawn, PR 6 bands | 1.8 | — | 0.30 |

Read: a draw with nothing logged since the last one costs under 1 ms of
log work, down from ~90; a change of week ~12 ms (the rule's projection
of each new slice — the reads themselves are slices); a tick ~0.3 ms,
where today's 0.00 was the prose invariant reusing the brake.

A **cold** draw (app load, after `copyPrev`, `clearDay`, the plan editor,
an import, undo) is slower than today. Measured again, three alternating
runs each, on the realistic variant of the profile — the active block
logged only up to the week being trained (12 864 rows,
`measure-cache-real.js`):

| Cold draw, log work | `origin/main` | no freeze | this plan |
|---|---|---|---|
| today's cards | 93 | 95.5 | 101.5 (+9 %) |
| with the PR 6 bands | 106.7 | 111.6 | 120.5 (+13 %) |

The freeze is most of it (~6–9 ms; a recursive freeze was ~40 %, and
sharing one frozen empty `drops` list saved ~3 ms more); the cache's own
bookkeeping (keys, slices) is the other ~2–5 ms. Inside STOP condition 3
of plans/038 and this plan's own, and paid only on a cold draw. Dropping
the freeze is the lever if it ever matters; the poison test would then
have to become a strict-mode run of the suite.

**Correctness checks beyond the unit suite** (scratchpad, not committed):
- `'use strict'` on every shell script: 787/787 (before the index row) — nothing writes onto an
  answer.
- A fuzzer: 300 random profiles × 60 random card writes (90 % scoped,
  10 % broad) × random questions (both `weeks`, id / like / none, day,
  block subsets, cut-offs, `skipDeload`), each cached answer compared with
  a fresh `readSessions`, and `exHistory` with the same question on an
  uncached clone: 144 000 checks, 0 mismatches. It catches "scoped writes
  never evict", "blocks after the cut-off", "day filter" and "like
  queries ruled out by lift" mutations.
- Unit mutations, each caught: scoped claim ignored (3 fails), cut-off /
  lift / day ignored in `historySees` (1 each, the keep-case), `save()`
  not invalidating (5), no freeze (1), unit not in the cache (1), render
  cache keeping log facts (1), block list not in the key (1), variant cut
  not in the projection key (2), a slice keeping the cut week (1).
- Smoke, targeted (static server on :8791): "main session", "weight
  drops", "objetivo de peso y diagnóstico", "el mismo ejercicio en dos
  sesiones", "nota, energía y control de descarga", "primera semana de un
  bloque nuevo" — 329 passed; "orden real", "revisión del bloque", "block
  delete purges", "Guardar cambios", "dos pestañas" — 61 passed.

**`resetRenderCache()` in tests.** Of the ~20 calls in `test/unit.js`,
none is needed any more for history freshness — a test that writes the
log directly and reads again needs `logChanged()` (or the `save()` the
app would call), not a reset. They were left in place: each still resets
the per-draw facts it was written against, and removing them is churn.
The two brake-counting cases (plans/027) still hold, since the brake is
still once per draw.

**For plans/038 PR 6.** The bands can move onto `sessionsOf` with no
early exit: re-run `measure-cache.js` there. Two things to know: a
`like` query is dropped by any card write in a block it reads (it cannot
be ruled out by lift), which is harmless for the prior-block band (it
reads earlier blocks only) but means a like-query over the *active* block
is re-read after every tick; and `lastTime`/`priorBlock` should leave
`renderCache` in the same PR.
