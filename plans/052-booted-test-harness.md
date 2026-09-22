# Plan 052: A unit harness that boots the app and keeps its handlers — `test/harness.js`, `bootApp()`, one history fixture

> **Executor instructions**: Follow this plan one PR at a time. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes"; the orchestrator maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8142e33..HEAD -- test/unit.js test/smoke.js js/ AGENTS.md`
> This plan changes only `test/`, `AGENTS.md` and this file. Any change to
> `loadApp`, `inert`, `drawable` or the precache-hole section of
> `test/unit.js` since `8142e33` means comparing against "Current state"
> first.

## Status

- **Priority**: P2
- **Effort**: M, in two PRs
- **Risk**: LOW. Only tests change: no `js/` edit, and no `CACHE_VERSION`
  bump unless one is needed. The PR gate runs the smoke suite because
  `test/` changes.
- **Category**: architecture — candidate 2 of the second architecture
  review (2026-09-22), settled with the maintainer the same day.
- **Planned at**: commit `8142e33`, 2026-09-22

## Why this matters

`loadApp()` (test/unit.js ~74) gives every element the `inert()` stub
(~26). The stub throws every assigned `onclick` away and parses nothing,
so `load()`'s first draw falls into `showRecovery`. **The suite at large
runs with `ready: false, frozen: true`**, and handler-level behaviour
can't be tested. The consequences:

- Tests copy handler sequences by hand. `peSaveProbe` (~3409) copies the
  plan editor's move loop, so it could never catch the move-then-erase bug
  (second review, candidate 1).
- Functions were made top-level partly so tests could reach them
  (`writeRows`, `sessionOnScreen`).
- A draw-time precache hole got through. The precache fix (#148–#151)
  added a `drawable()` stub (~51) so that section can draw. But `drawable`
  also drops handlers and reads nothing back, so it proves "the draw did
  not throw", not "a set can still be ticked".
- Six fixture builders overlap:
  - `targetProbe` (~1328), `brakeProbe` (~1536), `twoDayProbe` (~1793) and
    `diagProbe` (~2520), which build profiles by hand;
  - `sessionFixture` (~4800), which builds sessions in and resets the
    global `state`;
  - `cacheFixture` (~5045).

  There are also 47 `state = defaultState(); migrate()` resets and 29
  `state.prefs.units =` assignments.

The second review showed that a fake document of about 20 lines (one
element per id, remembered query answers, `createTextNode`) lets the real
`drawApp` build all seven cards, and drives the real tick and `#peSave`.

## The decisions (settled 2026-09-22 — do not re-open)

1. **A remembering stub, not a DOM.**
   - `getElementById` returns one element per id.
   - Each element's `querySelector(sel)` returns an element remembered per
     root and selector.
   - `querySelectorAll(sel)` returns a remembered list, long enough for
     the card's row destructuring.
   - `createElement` and `createTextNode` exist.
   - `innerHTML` is stored but never parsed. Handlers survive, so a test
     fires `el.onclick()` / `el.oninput({ target: el })`.

   **Tests assert data effects only** (rows, records, what `save` wrote).
   What a user sees stays in `test/smoke.js`. No jsdom, since AGENTS.md
   forbids dependencies.
2. **An always-on fake clock** in the booted harness: a `setTimeout` /
   `setInterval` queue, `advance(ms)`, and a settable `Date.now` inside the
   vm. A real rest-timer interval would otherwise keep Node alive after the
   suite.
3. **Side by side.** `loadApp()` stays for the ~970 existing tests, and
   `bootApp()` is added. Tests move over only where they copy handler code,
   monkeypatch `render`/`save`/`brakeOn`, or need a real handler.
   `loadApp()` gains one test stating that it is unbooted
   (`ready === false`), so nobody assumes otherwise again.
4. **`test/harness.js`** holds `inert`, `drawable` (folded into the new
   stub if it's subsumed), `SHELL_SCRIPTS`, `loadApp`, `bootApp`, the fake
   document and the clock. `test/unit.js` requires it. The four-lists
   check (`index.html`, `SHELL`, `loadApp`, `js/`) keeps reading
   `SHELL_SCRIPTS` from there.
5. **One history fixture**, in PR 2:
   - `targetProbe`, `brakeProbe`, `twoDayProbe`, `diagProbe`,
     `sessionFixture` and `cacheFixture` collapse onto one fixture: sessions
     in, profile out, units set explicitly, and optionally installed as the
     active profile.
   - It builds on `sessionFixture`'s spec.
   - Each probe keeps only its own assertion helper.
   - Moved assertions are unchanged, and must still pass.
6. **PR 1's first users of `bootApp()`:**
   - a real boot asserting `ready` and not `frozen`;
   - one tick through the real card, writing its set;
   - "Rellenar" (`#copyPrev`) and `clearDay`'s data effects through their
     real handlers;
   - `peSaveProbe` on the real `#peSave`, keeping its current, passing
     assertions.
7. **The precache-hole section boots** with each guarded split file left
   out. It asserts `ready`, not `frozen`, and that a tick through the real
   card writes its set. That makes split rule 1 a mechanical check for
   every guarded file, present and future. Also cover the "Ver la revisión"
   button path (`openReview`) if the harness reaches it cheaply.
8. **Candidate 1's failing test does not land here.** The move-then-erase
   test lands with candidate 1's fix. Every test in this plan passes when
   it merges.

## Steps

### PR 1 — the harness

**A.** Create `test/harness.js` (decision 4). Move `inert`, `drawable`,
`SHELL_SCRIPTS` and `loadApp` into it unchanged. `test/unit.js` requires
them. `node test/unit.js` must give the same count and results.

**B.** Add `bootApp({ omit, state })` (decisions 1 and 2). It returns
`{ ctx, call, doc, clock }` or similar, with a small helper to find a
card's element by selector. `load()` runs for real. `state` optionally
seeds `localStorage` before boot.

**C. First users** (decision 6), in a new section of `test/unit.js`.
Assert data effects, including the unbooted `loadApp()` test (decision 3).

**D. The precache section boots** (decision 7), replacing or extending
`loadApp(…, { drawing: true })`.

**E.** Update `AGENTS.md`'s "How to verify a change" to name `bootApp()`
for handler-level data tests and `loadApp()` for pure logic.

**F. Verify.**
- Run `node test/unit.js` twice. It must pass and exit (no hanging
  timers).
- Run the suite with each `bootApp` test's handler deliberately broken, and
  check it fails. Show at least three.
- Since `test/` changes, the PR gate runs the full smoke suite; don't run
  it by hand.

### PR 2 — one history fixture

**G.** Collapse the six builders (decision 5). For each probe moved, the
assertions are unchanged and pass, and the count before and after is
recorded. Delete the builders that become unused. Don't touch `js/`.

## STOP conditions

- Moving the harness (Step A) changes any test's outcome.
- `bootApp()` can't boot without editing `js/`. Report what the app needs
  from a document, rather than bending production code to the stub.
- A moved probe's assertion changes outcome in PR 2.

## Maintenance notes

### PR 1 — the harness (branch `claude/052-pr1`)

**Drift.** Clean: the drift check printed nothing, and main had not
moved from `8142e33`.

**Step A.** A pure move. The run after it was byte for byte the run
before it: 1033 passed, 0 failed. AGENTS.md's three pointers at
`loadApp()` in `test/unit.js` now name `SHELL_SCRIPTS` in
`test/harness.js`.

**No STOP: the boot needed nothing from `js/`.** `load()` runs for real
and `drawApp` builds all seven cards. What the fake document supports:
- `getElementById`: one element per id, made on first ask. All 181
  literal ids the app looks up are in `index.html`.
- Per element, `querySelector(sel)` answers with one remembered element
  and `querySelectorAll(sel)` with a remembered list of three. Setting
  `innerHTML` or `textContent` forgets those answers and detaches the
  children.
- `innerHTML` and `textContent` are stored, never parsed. `className`
  (with a `classList` over it), attributes, `value`, `checked`,
  `disabled`, `hidden`, `style` and `dataset` are plain data.
- `appendChild`, `removeChild`, `remove`, `replaceWith` and
  `replaceChildren` keep `children` and `parentNode`. That is what
  `drawCard`'s swap and `refreshWeekDot`'s `children[week - 1]` read,
  and how `card(i).set(j)` finds a row.
- `addEventListener` listeners are kept and reachable through `fire()`,
  and `click()` fires them. `focus()` and `blur()` move
  `document.activeElement`, and `contains()` walks `parentNode`.
- The document also has `createElement`, `createTextNode`,
  `documentElement`, `head`, `body`, `visibilityState: 'visible'` and an
  `execCommand` that answers false.
- `window.matchMedia` never matches. `navigator` is empty, so every
  service-worker, wake-lock, media-session, notification, audio and
  persistence branch returns early. `location.reload()` is counted.
- The clock queues `setTimeout` and `setInterval`, and `advance(ms)` runs
  what falls due, in order. `now` can be set. Inside the vm, `Date` is a
  subclass whose `now()` and argument-less constructor read the clock,
  and boots start at a fixed `BOOT_TIME`.

**What surprised.**
- A handler promise that rejects before anything holds it crashes Node
  as an unhandled rejection. Tests attach `.catch` before they yield.
- `load()`'s own `save()` is still pending right after a boot. Unless it
  lands first, it carries a press's changes to storage even when the
  press saves nothing. The handler tests boot through `settled()`.
- A box typed into is a write of its own (`writeRows`), and it starts the
  session. So the tick test presses an untouched set.
- Step F found both of those: break 2 below passed until they were
  fixed.
- The standing rule-2 breach is live. Without `js/diagnostics.js`,
  "+ Nuevo bloque → Ver la revisión" throws `strengthRows is not
  defined` and makes no block. It is now asserted as such, read off
  `RULE2_STANDING`, so fixing it there moves the expectation.

**Tests.** 1033 → 1063, all passing. The 30 new ones:
- "the harness": `loadApp()` does not boot (1).
- The precache section boots each hole. It asserts frozen false as well
  as ready, and a set ticked on the real card is written and saved (7).
- `bootApp()` section: a first run (3); one tick, with its adopted
  weight, record, save and rest timer (4); "Rellenar" (3); "Borrar este
  día", answered both ways, then undone (4).
- "+ Nuevo bloque" → "Ver la revisión" for each hole (7).
- `peSaveProbe` on the real "Editar plan" and "Guardar cambios": its two
  assertions are kept, plus one that the save ran to its end (1).

**Step F.** `node test/unit.js` passed twice, 1063/0, exiting in about
1.1 s each time. A booted shell left with the rest interval running,
and the clock never advanced, exits by itself in about 160 ms. Each break
below was made in `js/`, the suite run, and the file restored byte for
byte:

| Break | Result |
|---|---|
| 1. The tick stops adopting the greyed weight | 1 FAIL |
| 2. The tick writes around `writeRows` | 2 FAIL |
| 3. "Rellenar" files no objetivo records | 1 FAIL |
| 4. "Borrar este día" purges only the log | 1 FAIL |
| 5. "Borrar este día" takes no undo snapshot | 1 FAIL |
| 6. "Guardar cambios" with the id-only origin map (plans/008 item 1) | 2 FAIL |
| 7. `app.js` stops stubbing `startRest` | 2 FAIL (static rule 1, and the `js/rest-timer.js` hole's tick) |

Against break 6, the Step A suite, with its copy of peSave's loop,
passes 1033/0.

**Deviations.**
- `loadApp()`'s `omit` went with `drawing` and `drawable`: nothing used
  it once the precache section booted.
- `peSaveProbe` gained one assertion, because unchanged rows are also
  what a save that never ran looks like.
- "Ver la revisión" is its own section in the async half of
  `test/unit.js`, since it awaits the dialogs.
- Comment-only updates: `test/unit.js`'s header, and one comment in
  `test/smoke.js` that said the unit suite cannot press a tick.

**Left for others.**
- README.md's layout table does not list `test/harness.js`. This plan
  confines itself to `test/`, AGENTS.md and this file.
- PR 2: `SEED` and `seeded()` in the `bootApp()` section are a seventh
  history builder (week 1 of the seed's first day). They belong in the
  one fixture, which should also be able to feed `bootApp`'s `state`.
