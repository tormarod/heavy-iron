# Plan 050: One way to count stored sets — and the two screens that counted the wrong ones

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 2805d9c..HEAD -- js/app.js js/profile-transfer.js js/qr-transfer.js js/review.js js/block-editor.js test/unit.js test/smoke.js docs/guide.md`
> Plans 048, 049 and 051, and a restore-limits fix, may be in flight. None
> of them touches the counters below. Re-locate each function by grep.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW. There are two intended visible changes, each in its own
  commit (Steps B and C).
- **Category**: architecture — part (c) of candidate 5 of the architecture
  review of 2026-09-21, settled with the maintainer on 2026-09-22.
- **Planned at**: commit `2805d9c`, 2026-09-22

## Why this matters

Five functions count stored sets with the same rule: a set is **used**
(`rowUsed`) or **done**. They differ only in how they walk the storage:
- `countShareLog(log, onlyDone)`, app ~6038
- `blockLoggedSets(profile, blockId)`, app ~2475
- `blockDoneSets(profile, blockId)`, app ~6051
- `countProfileSets(p)`, profile-transfer ~269
- `countBackupSets(data)`, profile-transfer ~285

An in-memory check at `e9e8e7a` confirmed they agree. The counting rule
was never duplicated, so folding them is low leverage. The walk is what's
repeated.

The stock-take did find two screens counting the wrong sets:

1. **The QR send sheet over-counts.** `js/qr-transfer.js` ~359–375 shows
   `blockLoggedSets`/`blockDoneSets`, which count every stored set,
   including sets under retired (`off`) days and exercises. But the payload
   (`blockShareLog`) leaves retired items out, by plans/025's design. In
   memory, a block with one live set and two under retired items showed 3
   on the sender, while the payload and the receiver both showed 1. The
   smoke test at smoke.js ~950 passes only because its block has nothing
   retired.
2. **The block review's set count includes stranded weeks.** `js/review.js`
   ~154 uses `blockDoneSets`, which walks every stored week, while the
   review's tonnage stops at the block's length. CONTEXT.md (**stranded
   week**) says screens about a block hide them.

## The decisions (settled 2026-09-22 — do not re-open)

1. **One counter:** `countSets(blockLog, onlyDone)`, which is today's
   `countShareLog` renamed.
   - It keeps walking every stored key, not `forEachSlot`, because the
     delete dialogs count everything `deleteBlocks` deletes, including a
     non-slot key.
   - The other four become one-liners over it (or are deleted with their
     callers switched), keeping each caller's scope.
   - `loggedSets`, `weeksBeyondEnd` and `parkedRows` answer different
     questions and stay.
   - These are raw storage counts on purpose, so they do not move onto
     `sessionsOf`.
2. **The send sheet counts the payload it is about to send:**
   `countSets(blockShareLog(profile, block), …)`, for both the used and the
   done figure.
3. **The review counts the block's own weeks**, matching its tonnage.
   Stranded weeks stay hidden, as everywhere else on screens about a block.

## Steps

**A. `countSets`** (no visible change). Rename `countShareLog` to
`countSets`, fold the other four onto it, and switch the callers. Nothing a
caller shows changes. Prove it with a throwaway check against `origin/main`
over random profiles (every counter, both used and done), recording the
count.

**B. The send sheet** (visible, own commit). Switch the two figures in
`js/qr-transfer.js` to count `blockShareLog`'s output. Add a unit test: a
block with sets under a retired day and a retired exercise shows the
payload's count. Add a smoke assertion only if the smoke.js ~950 section
can gain a retired item cheaply; otherwise say so.

**C. The review** (visible, own commit). Count done sets over the block's
own weeks only. Add a unit test: a stranded week's sets are not in the
review's count, and the tonnage and count now agree on which weeks they
cover. If the guide describes the review's set count, keep it true.

**D. Verify.**
- `node --check` and `node test/unit.js`.
- `node test/smoke.js --only` for the QR section (~942–1090) and
  "revisión del bloque".

## STOP conditions

- Step A's check finds any difference.
- A caller relies on a counter's exact walk in a way that
  `countSets(blockLog)` cannot express.

## Maintenance notes

(Filled in when the PR lands.)
