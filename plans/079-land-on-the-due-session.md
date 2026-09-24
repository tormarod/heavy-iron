# Plan 079: The first open of a new day lands on the session that's due, and the day tabs show what is done

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report — do not improvise.
> Fill in "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` — do not edit it.
>
> **One PR** (`claude/079-land-on-due`). It changes `index.html`, `css/` and
> `js/`, so it **bumps `CACHE_VERSION`** once, as its last commit.
>
> **Drift check (run first)**:
> `git diff --stat c82678d..origin/main -- js/app.js index.html css/style.css docs/guide.md CONTEXT.md test/unit.js`
> Plans 078 and 080 may land first. 080 edits the tick handler and
> `drawSessionFoot` in `js/app.js`. 078 edits `js/block-editor.js`. Both
> edit `docs/guide.md` and `test/unit.js` in other places. Re-find each
> excerpt below by its quoted text. If its *meaning* changed, that is a STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW–MED (a navigation on open, resume and profile switch; one new stored preference)
- **Depends on**: none
- **Category**: direction (every session)
- **Planned at**: commit `c82678d`, 2026-09-24 — picked by the maintainer from the eleventh pass (`plans/README.md`, "Eleventh pass"). The maintainer said the household logs on **two phones**, each on their own profile.

## Why this matters

The app always reopens on the session left on screen, which is usually the
one finished last time. `nextSessionLine` (`js/app.js`) already works out
what comes next. It prints "Siguiente: …" in the footer, and only once every
set is ticked, and nothing acts on it. So every training day, each person
taps a day tab, or `›` and then a day tab after a week's last day, before
they can start. One missed `›` means typing into last week's finished
session, whose boxes stay editable. An installed app resumed from the
background never reruns `load()` at all ("it is the same page it was on
Tuesday", as the update check's own comment in `js/app.js` puts it).

After this plan:

- The first time the app is opened or resumed on a new calendar day, it
  moves to the slot after the last session trained in the active block. A
  line above the list says so and offers **Volver**.
- Switching to the other person does the same for them, when their screen
  was left on the session they last trained.
- Each day tab shows a dot when that day has something logged this week,
  like the week strip already does.

## The decisions (settled — do not re-open)

1. **What is due.** It is found from the active block's own sessions: the
   session with the latest date (`ts`) among sessions on a live day
   (`dayList(block)`) that have a date (`ts > 0`). It is `null` in six
   cases (the third and sixth were added in the review of #194):
   - there is no such session;
   - that session's local day (`localDay(ts)`) is today or later, which
     means you trained today, so nothing is "due" yet;
   - the block's most recent tick of any set is under `DUE_AFTER_MS`
     (two hours) old, which means a session is still going on past
     midnight. It is the latest tick and not the session's median `ts`,
     because a long session's median can be hours old while its last tick
     is minutes old;
   - the block has no slot after it;
   - the slot after it is already on screen;
   - the slot after it already has a ticked set. The line (decision 5)
     does not show on a slot with ticks, so that move could be neither
     announced nor taken back. This happens when days are trained out of
     order, or a forgotten session is filled in later.

   **The slot after** is the next live day in the same week. After the
   week's last live day it is week + 1, day 0. After the block's last week
   there is none; the footer already says "Fin del bloque …" there. It
   does not matter whether that session had every set ticked: a skipped
   set, like the default plan's "first one to go" kickback, must not keep
   you on it.
2. **When it moves — the first open of a new day.** `writeState` records
   `state.prefs.lastDay = localDay(Date.now())` on every successful write.
   `load()` and a resume (`visibilitychange` to visible) move only when
   `lastDay` is a date *earlier* than today.
   - Any save, whether a tick, a navigation or `load()`'s own write-back,
     disarms it for the rest of the day. So a person who goes back to look
     at yesterday is not pulled forward again.
   - An absent `lastDay` means "don't move". The first open after this
     ships only records the day.
   - This gate is also what keeps every existing booted unit test where it
     is. Their fixtures are copies of a real first-run save, so they carry
     today's `lastDay` (see "Current state", the tests).
   - The move at open and resume ignores where the view was left: a view
     left on an old week is exactly what should give way.
3. **When it moves — a profile switch.** There is no `lastDay` gate here.
   The switched-to profile moves to its due slot only when its view is on
   its own latest trained slot, meaning it was left on the session it
   finished. On a two-phone household the other profile is a copy moved by
   file or QR, so this rarely fires, and a wrong landing costs one tap.
4. **What a resume respects.** Nothing moves unless the app is `ready`, not
   `frozen`, not `held` (a two-tab conflict is asking), not `discarding`,
   and no sheet is open (`sheetStack.length === 0`).
5. **The line and Volver.**
   - A new `<div class="ord-note" id="dueNote" hidden></div>` sits right
     after `#ordNote` in `index.html`, reusing the order note's classes, so
     the contrast suite needs nothing new.
   - It reads `Te toca <day name> (semana <w>).` and has one button,
     `Volver` (class `ord-reset`), with
     `aria-label="Volver a <from day name>, semana <from week>"`.
   - It shows while the view is still the slot the app landed on, for the
     same profile and block, and nothing in that slot is ticked yet.
   - **Volver** restores the week and day it came from and forgets the
     landing. Any draw showing a different slot forgets it too.
6. **The day dots.**
   - `dayHasLog(profile, block, w, dayId)` answers "a ticked set in this
     slot"; `weekHasLog` is rewritten on top of it.
   - Each day button in `renderNav` gets a `<span class="dot">` (appended,
     not written into `innerHTML`) when its slot this week has one, and
     its `aria-label` gains `, con series registradas`.
   - The tick-time refresh that already moves the week's dot moves the
     current day's too.
   - CSS: `.day` gains `position: relative`. `.day .dot` is a small
     absolutely placed circle in `var(--signal)`, and `var(--on-signal)` on
     `.day.on`. No `color` is declared, so it is not a text pair for the
     contrast suite.
7. **Wording is Spanish and informal**, like the rest of the app's notes. It
   can be tuned in review; the structure cannot.

## Current state

All in `js/app.js` unless noted; line numbers are at `c82678d`.

**What the footer knows and does not act on** (search `function nextSessionLine`):

```js
function nextSessionLine(profile, block, days) {
  if (profile.day < days.length - 1) return 'Siguiente: ' + days[profile.day + 1].name + '.';
  if (profile.week < blockWeeks(block)) return 'Siguiente: ' + days[0].name + ', semana ' + (profile.week + 1) + '.';
  const order = profile.blockOrder || [];
  ...
```

Its strings are pinned by `test/unit.js` ("the newest block ends with
'+ Nuevo bloque' …"). **Leave `nextSessionLine` unchanged.** Put the
"slot after" rule in the new function, even if two lines repeat.

**Where the view comes from** — `load()` (search `function load()`):

```js
  ready = true;
  applyTheme();
  render();
  /* Write straight back: on a first run that persists the starting plan, and
     on a later one it persists whatever migrate() had to repair, so the same
     repair does not have to be redone on every open. */
  save();
  mark('Cargado');
```

**The only visibility handler that saves** (search `document.addEventListener('visibilitychange'`,
the first one, near "The phone going into a pocket"):

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
```

`flushSave()` returns at once when nothing is pending (`if (!saveT && !held) return true;`),
so hiding the app writes nothing unless a change is waiting.

**The one write path** — `function writeState(force)`:

```js
  try {
    pruneLog();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    mark('Guardado ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    return true;
```

**Preferences are repaired in `migrate()`**, each on its own line, e.g.
`state.prefs.sound = !!state.prefs.sound;` and
`if (['es', 'en'].indexOf(state.prefs.lang) < 0) state.prefs.lang = 'es';`
(search `state.prefs.bgAlarm = !!state.prefs.bgAlarm;`). A backup carries
`prefs` whole (`BACKUP_FIELDS`, `js/profile-transfer.js`). No test pins the
list of preference keys.

**The local day** (search `function localDay(ts)`), a hoisted function declaration:

```js
function localDay(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
```

**Sessions and their dates** — `sessionsOf(profile, { weeks: 'plan', blocks: [block.id] })`
returns frozen sessions `{ block, week, day, lift, ts, sets }`. `ts` is the
session date: the median of its ticked sets' `ts`, 0 when none has one.
AGENTS.md: read logged sets through `sessionsOf`, and never change its
answer.

**The profile switch** — `renderProfiles` (search `b.onclick = () => { closeSheet('profileSheet'); state.activeProfile = key; commit('view'); };`).

**The order note, the pattern for the new line** — `drawOrderNote`, called
from `drawApp` right after `const sessionEx = orderedEx(…)`:

```js
function drawOrderNote(profile, block, day, sessionEx) {
  /* Guarded for the same reason wireDiagnostics/wireReview are at the foot
     of this file: ... */
  const host = $('ordNote');
  if (!host) return;
  ...
  host.innerHTML = '';
  host.hidden = !changed;
  if (!changed) return;
  const txtEl = document.createElement('span');
  txtEl.textContent = 'Orden cambiado: empezaste por ' + sessionEx[0].n + '.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ord-reset';
  btn.textContent = 'Volver al orden del plan';
  btn.onclick = () => {
    setOrder(profile, block.id, profile.week, day.id, null);
    commit('view');
    mark('Orden del plan restablecido');
  };
  host.appendChild(txtEl);
  host.appendChild(btn);
}
```

In `index.html` the element sits in `<main>`, just above the list:
`<div class="ord-note" id="ordNote" hidden></div>`.

**The week dot, the pattern for the day dot** (search `function weekHasLog`):

```js
function weekHasLog(profile, block, w) {
  return dayList(block).some(d => {
    const s = profile.log[block.id] && profile.log[block.id][slot(w, d.id)];
    return !!s && Object.values(s).some(a => Array.isArray(a) && a.some(x => x && x.done));
  });
}
```

Right after it comes `refreshWeekDot(profile, block)`, called from
`drawCard` after a tick (search `refreshWeekDot(profile, block);`). The day
buttons are built in `renderNav` (search
`b.innerHTML = '<span class="day-n">Día ' + (i + 1)`) with
`b.setAttribute('aria-label', 'Día ' + (i + 1) + ': ' + d.name);`. In
`css/style.css`, `.day` is a 60 px, `overflow: hidden` button (search
`^.day {`), and `.wk .dot` / `.wk.on .dot` are the week dot's rules.

**Sheets** — `const sheetStack = [];` in `js/app.js` holds every open sheet.

**The unit suite pins every `save('view')` / `commit('view')`** (test
section "the history cache: one read per question, dropped by the write",
the `expected` list around `test/unit.js:7801`). It attributes each call to
the last top-level `function NAME` line above it. So put every new
`commit('view')` inside a **named top-level function**, never inline in an
`addEventListener` callback. Then add exactly the names the assertion
reports to `expected`, with a comment.

**Booted-test fixtures** — `test/unit.js` around line 8544:
`const SEED = JSON.stringify(Object.assign(firstRun.saved(), { setupDone: true }));`
is a real first-run save. Once `writeState` records `lastDay`, `SEED`
carries `lastDay` = the boot day (`BOOT_TIME` in `test/harness.js`,
2026-09-22 18:00 UTC), and every `seeded(...)` / `settled(...)` boot opens
on the same day: no move. `seeded()` stamps its sets
`BOOT_TIME - 7 * 864e5`, a week before the boot.

**Conventions** (AGENTS.md): Spanish on screen and English comments that say
why; no `style` attribute; classes in `css/style.css`; nothing newer than
Safari 15; a new id read only by `app.js` needs no guard, but guard it the
way `drawOrderNote` does anyway; bump `CACHE_VERSION` with
`tools/bump-cache-version.sh`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` (1538 at `c82678d`, plus 078's and 080's if they landed) |
| Smoke, one section | `node test/smoke.js --only "<name>"` with `python3 -m http.server 8765` running | the section passes |
| Bump | `bash tools/bump-cache-version.sh` | `CACHE_VERSION` + 1 |

Never run the full browser suite by hand; the PR hook does (AGENTS.md).

## Scope

**In scope**:
- `js/app.js` — the new functions, `writeState` (one line), `migrate()` (one repair line), `load()` (one call), the resume listener, `renderProfiles`' click, `renderNav`, `refreshWeekDot`, `drawApp` (one call), `drawCard` (one call)
- `index.html` — the `#dueNote` element
- `css/style.css` — `.day` position and the two `.day .dot` rules; `min-height: 24px` on `.ord-reset` (review of #194)
- `docs/guide.md`, `CONTEXT.md` — Step 7
- `test/unit.js` — Step 6, and the pinned `expected` list
- `test/smoke.js` — one case in "accesibilidad: tamaños, foco y área segura" holding a landing's "Volver" to the 24×24 floor, and nothing else (review of #194, widened by the orchestrator)
- `sw.js` — the bump only

**Out of scope** (do NOT touch):
- `nextSessionLine` and `drawSessionFoot` (080 edits the latter's other branch).
- Switching **blocks** (`js/block-editor.js`, the picker resets to week 1, day 1): a per-block memory of the view is a different mechanism, recorded in the eleventh pass as not planned.
- The rest timer: moving the view already ends a rest (`sessionOnScreen`, `drawApp`). Change nothing there.
- `RECORD_PARTS`, `NON_RECORD_FIELDS`, `profile-transfer.js`: `lastDay` is a preference on `state.prefs`, not a profile key.

## Git workflow

Branch `claude/079-land-on-due` from `origin/main`
(`git checkout -B claude/079-land-on-due --no-track origin/main`). Commits
are plain sentences, e.g. "Plan 079: the first open of a new day lands on
the session that's due", "Plan 079: a dot on each day tab with something
logged", and "Bump the shell to vNNN" last. Add the `Co-Authored-By` trailer
the session gives you. Before pushing, rebase on `origin/main` and re-bump
if its `CACHE_VERSION` moved. Open the PR only if the operator told you to.

## Steps

### Step 1: `lastDay` is written on every save and repaired on load

- In `writeState`, inside the `try`, immediately before `localStorage.setItem(…)`:
  `state.prefs.lastDay = localDay(Date.now());`, with a comment: what reads
  it (the landing) and why it is the save and not the draw (any change
  made today disarms the landing).
- In `migrate()`, with the other preference repairs:
  `if (typeof state.prefs.lastDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.prefs.lastDay)) delete state.prefs.lastDay;`

**Verify**: `node --check js/app.js`; `node test/unit.js` → `0 failed`. If
anything fails here, it is a test comparing whole saved states across a
clock advance of a day or more. That is a STOP (see below). Do not edit
that test.

### Step 2: `dueSlot` and `landOnDue`

Near `nextSessionLine`, add two top-level functions (English comments,
why-prose):

- `dueSlot(profile, block)` → `{ week, day }` or `null`, exactly as decision
  1 says. Read the sessions through
  `sessionsOf(profile, { weeks: 'plan', blocks: [block.id] })`, never raw
  rows, and never modify the returned objects. `day` is the index into
  `dayList(block)`.
- `landOnDue(reason)`, with `reason` one of `'open'`, `'resume'`, `'switch'`:
  - Apply decision 2's gate for `'open'` and `'resume'`, and decision 3's
    condition for `'switch'`.
  - When it moves, record the landing in a module-level `let landed = null;`:
    `{ profile: state.activeProfile, block: block.id, from: { week, day }, to: { week, day } }`.
  - Return `true` if it moved.
  - It never saves; its callers do.

**Verify**: `node --check js/app.js`; `node test/unit.js` → `0 failed` (nothing calls them yet).

### Step 3: Call it on open, on resume and on a profile switch

- `load()`: `landOnDue('open');` right after `applyTheme();`, before `render();`.
  `load()`'s existing `save()` persists the move.
- Resume: a new top-level `function landOnResume()`. It does nothing unless
  decision 4's conditions hold; then `if (landOnDue('resume')) commit('view');`.
  Call it from the existing visibility listener's visible branch:
  `if (document.visibilityState === 'hidden') flushSave(); else landOnResume();`.
- Profile switch: in `renderProfiles`' click, call `landOnDue('switch');`
  after `state.activeProfile = key;` and before its existing `commit('view');`.

**Verify**: `node test/unit.js`. The pinned-claims assertion ("the writes
that claim to reach no session …") now fails, naming
`js/app.js:landOnResume`. Add exactly that entry to `expected`, with a
comment citing plans/079. Then → `0 failed`.

### Step 4: The line and Volver

- `index.html`: `<div class="ord-note" id="dueNote" hidden></div>` directly after `#ordNote`.
- `js/app.js`: a top-level `function drawDueNote(profile, block, day)`, built like `drawOrderNote`:
  - Guard the element.
  - Decide what `landed` still means: decision 5. Forget it when the view
    has moved elsewhere.
  - Hide when there is nothing to say.
  - Otherwise draw the span and the `Volver` button, whose click restores
    `landed.from`, sets `landed = null` and calls `commit('view')`.
  - Use `dayHasLog` (Step 5) for "nothing in that slot is ticked yet".
- Call it from `drawApp` right after `drawOrderNote(…)`. Also call it from
  `drawCard` next to `refreshWeekDot(…)`, so the first tick hides it.

**Verify**: `node test/unit.js`. The pinned-claims assertion names
`js/app.js:drawDueNote`. Add it to `expected` with the same comment. Then → `0 failed`.

### Step 5: The day dots

- `js/app.js`: `function dayHasLog(profile, block, w, dayId)`, and
  `weekHasLog` rewritten as `dayList(block).some(d => dayHasLog(profile, block, w, d.id))`,
  so there is one rule.
- `renderNav`: for each day button, when
  `dayHasLog(profile, block, profile.week, d.id)`:
  - append a `span.dot` with `createElement` and `appendChild`;
  - append `, con series registradas` to its `aria-label`.
- `refreshWeekDot`: after the week's dot, do the same add-or-remove for the
  current day's button (`$('days').children[profile.day]`). Update its
  comment: it now moves both dots.
- `css/style.css`: add `position: relative;` to the `.day` rule, then
  ```css
  .day .dot {
    position: absolute; top: 6px; right: 6px; width: 6px; height: 6px;
    border-radius: 50%; background: var(--signal);
  }
  .day.on .dot { background: var(--on-signal); }
  ```
  with a one-line comment that the dot is the week strip's, one level down.

**Verify**: `node test/unit.js` → `0 failed`. The contrast section must still
pass: the new rules declare no `color`.

### Step 6: Tests

A new section in `test/unit.js`, inside the same enclosing block as the
plans/053 booted-editor section (it needs `SEED`, `seeded`, `settled`,
`reopen`), titled
`console.log('\n== the first open of a new day lands on the session that\'s due (plans/079) ==');`.

Compute days with the shell's own function, not by hand:
`const dayOf = ts => call('localDay(' + ts + ')')`. Use `call` from the
suite's shared `loadApp()` context, which runs in the same process and so
the same time zone. For a "yesterday" `lastDay`, use `dayOf(BOOT_TIME - 864e5)`.
For "trained today", stamp sets at exactly `BOOT_TIME` or a few seconds
after it, never before: `BOOT_TIME` is local midnight at UTC+6.

Cases:
1. **Lands.**
   - Setup: `seeded({ week: 1, day: 0 })` with `s.prefs.lastDay` set to
     yesterday, booted.
   - The view is week 1, day 1.
   - `#dueNote` is not hidden, and its text names day 1's name and "semana 1".
   - After `boot.clock.advance(1000)`, `boot.saved().prefs.lastDay === dayOf(BOOT_TIME)`.
2. **Volver.**
   - Press the note's button (`boot.$('dueNote').children` finds it).
   - The view is week 1, day 0 again, and the note is hidden.
3. **Stays.**
   - Plain `seeded({ week: 1, day: 0 })` (the SEED's own `lastDay`, today)
     stays on day 0.
   - A state with `lastDay` deleted stays on day 0.
   - Assert both. The first is the guarantee every other booted test relies on.
4. **Trained today.**
   - `lastDay` yesterday, with every set of the seeded day stamped at `BOOT_TIME`.
   - No move.
5. **End of the block.**
   - Log the last day of the block's last week, with `lastDay` yesterday.
   - No move, and no note.
6. **View left elsewhere.**
   - `lastDay` yesterday, latest trained week 1 day 0, view left at week 1 day 2.
   - It lands on week 1 day 1.
7. **Resume.**
   - Boot with `lastDay` today: no move.
   - Set `boot.doc.visibilityState = 'hidden'` and `boot.fire(boot.doc, 'visibilitychange')`.
   - `boot.clock.advance(864e5)`, then set `'visible'` and fire again.
   - The view moved to the due slot, and `boot.saved()` after a further
     `advance(1000)` has the new `lastDay`.
   - Repeat, with a sheet opened (`boot.call("openSheet('moreSheet')")`)
     before becoming visible: no move.
8. **Profile switch.**
   - Give the second profile of `SEED` (`mujer`) a week-1 day-0 session
     stamped a week before boot, with her view on it.
   - Press her button in `#profiles` (`boot.$('profiles').children`).
   - Her view is week 1, day 1.
   - With her view on day 2 instead, it stays.
9. **Dots.**
   - After case 3's boot, day 0's button (`boot.$('days').children[0]`)
     has a child with `className === 'dot'` and its `aria-label` ends with
     `, con series registradas`.
   - Day 1's has neither.
   - Go to day 1 (`boot.$('days').children[1].onclick()`) and tick its
     first card's first set (`boot.card(0).set(0)`; see `cardOnScreen` in
     `test/harness.js` for what `set(i)` returns and how to tick).
   - Day 1's dot appears. That is the tick-time refresh, not a full redraw.
10. **migrate() repairs `lastDay`.**
    - Via `call` on the shared context: `'x'`, `5` and `{}` are deleted.
    - `'2026-09-21'` is kept.

**Verify**: `node test/unit.js` → `0 failed`, with the new cases passing.
Then prove the tests can fail:

- Temporarily make `landOnDue` return `false` at its top: cases 1, 6, 7
  and 8 must fail.
- Temporarily skip the `lastDay` gate for `'open'`: case 3's first
  assertion must fail, and many existing booted sections will too. Restore.

Record both results in Maintenance notes.

### Step 7: The guide and the glossary

- `docs/guide.md` § "Using it", in "A session, top to bottom", after the
  sentence about the three days: a dot on a day means something is logged
  on it this week.
- `docs/guide.md` § "During the session", in the bullet that begins
  **The footer totals the session**, add three things. The first time the
  app is opened, or come back to, on a later day, it goes to that next
  session by itself, with a line above the list and **Volver**. It never
  moves on a day you have already trained. Switching to the other person
  does the same for them when their screen was left on the session they
  last trained.
- `CONTEXT.md`, after **Session start**: **Due session**. It is the session
  after the last one trained in the block, once that one was on an earlier
  day, and the app opens on it the first time it is opened on a new day.
  `_Avoid_: today's session (it may not be today), next workout`.

**Verify**: `node test/unit.js` → `0 failed` (the doc-link checks).

### Step 8: In a browser

With `python3 -m http.server 8765` running, run each of these with
`node test/smoke.js --only "<name>"`:

- `layout` — the header's measured height must not change;
- `tamaños` — targets and focus;
- `main session`;
- `CSP`.

**Verify**: all four pass.

### Step 9: Bump

`bash tools/bump-cache-version.sh`, committed alone as "Bump the shell to vNNN".

**Verify**: `git diff origin/main -- sw.js` is one line; `node test/unit.js` → `0 failed`.

## Test plan

- The ten cases of Step 6, in the booted style of the plans/053 section.
- Two mutation checks (Step 6).
- The pinned `expected` list grows by exactly `landOnResume` and `drawDueNote`.
- Smoke: the four sections of Step 8. The PR hook runs the rest.

## Done criteria

- [ ] `node --check js/app.js` → exit 0
- [ ] `node test/unit.js` → `0 failed`; at least 20 new assertions pass
- [ ] `grep -n "lastDay" js/app.js`: apart from comments, it matches only the `writeState` assignment, the `migrate()` repair and the reads in `landOnDue`
- [ ] `grep -c 'id="dueNote"' index.html` → `1`; `grep -c "style=" index.html` unchanged from `origin/main`
- [ ] The `expected` list gains exactly the two new names
- [ ] `git diff --stat origin/main` lists only in-scope files; `CACHE_VERSION` + 1
- [ ] Maintenance notes filled in

## STOP conditions

- An existing unit assertion fails after Step 1 or Step 3 for any reason
  other than the pinned-claims list. That means a fixture lands, or compares
  `prefs` across days. Report which. Do not edit fixtures or identity tests
  to make room.
- A smoke section fails because a stored state landed somewhere its script
  did not expect.
- `nextSessionLine`, `drawOrderNote`, `writeState` or the visibility listener
  no longer match their excerpts in meaning.
- You find a reason the landing must write anything other than the view
  (`profile.week`, `profile.day`) and `lastDay`.
- Case 7 cannot be made to pass without faking `document.visibilityState`
  differently from how the harness exposes it (`boot.doc`).

## Maintenance notes

- The first open after this ships moves nothing: there is no `lastDay` yet.
  From the next day on, it lands.
- A reviewer should check that no path other than `writeState` writes
  `lastDay`. An import or restore that brings another phone's `lastDay` is
  harmless: the next save overwrites it.
- Not done, recorded in the eleventh pass: keeping the view per block when
  another block is picked (`js/block-editor.js` resets it to week 1, day
  1), and offering "+ Nuevo bloque" at a finished block.

Executor, 2026-09-24 (`claude/079-land-on-due`, rebased onto `ccf51be`,
after plan 078 landed):

- **STOP checks.** After Step 1 and after Step 3 the only failing unit
  assertion was the pinned-claims list, which named exactly
  `js/app.js:landOnResume`, then (Step 4) `js/app.js:drawDueNote`. No
  fixture landed and no identity test moved. Unit: 1541 before, 1568 with
  the new section (27 assertions), 1578 after the rebase (078 added 10).
- **Mutation checks**, each reverted, `js/app.js` identical to its commit
  afterwards:
  - (a) `landOnDue` returning `false` at its top: 10 fail. Those are
    cases 1 (3), 2, 5's week wrap, 6, 7 (2) and 8, and the first-tick
    case. Each fails on its own evidence: the "Volver" presses are
    conditional, so a missing button does not fail its neighbours.
  - (b) The `lastDay` gate skipped for `'open'`: 20 fail. Case 3's
    "stays" is one of 8 in this section. The other 12 are existing booted
    assertions: 4 in plans/052's section, 5 in plans/060's, 1 in the
    plans/071 case under plans/067 B's heading, and 2 in plans/076's.
  - (c) `landOnResume` without the `askResolve` check (see below): only
    "…nor from under a question" fails.
  - (d) The profile click landing without the `switching` check (see
    below): only "…picking the person already on screen moves nothing"
    fails.
- **Deviations**, each small and each pinned by a test or a comment:
  - `landOnResume` also waits while a question is open (`askResolve`),
    as well as for an empty sheet stack. `#askSheet` is never on
    `sheetStack` (see `askReturn`). "Borrar este día" is a row of the Más
    sheet, which closes before the question opens, so the question is up
    with the stack empty. `clearDay` reads `profile.week` only after the
    answer, so a landing underneath would clear the captured day in
    another week than the dialog named. Decision 4 says "no sheet is
    open", and this covers the one sheet the stack does not hold.
  - The profile click lands only when the key changes. Tapping the person
    already on screen switches nothing. Without the check, a view that
    "Volver" had just put back on the session they finished was pulled
    forward again.
  - There are three helpers beyond the plan's functions:
    - `lastTrained(profile, block)`: the latest dated session on a live
      day, which `dueSlot` and the switch condition both need.
    - `setDot(btn, on)`: both dots, in `renderNav` and `refreshWeekDot`.
    - `dayTabLabel(i, d, logged)`: one accessible name, used in both
      places.
  - `setDot` finds the dot among the button's children instead of with
    `querySelector('.dot')`, which is what `refreshWeekDot` used before.
    The harness document answers every selector with an element, so that
    lookup always "found" a dot, and case 9 could not see the tick-time
    refresh. The behaviour in a real DOM is the same: the dot is always a
    direct child.
  - `landOnDue` wraps its work in `try`/`catch` and returns `false` on a
    throw. In `load()` it runs before `render()`'s guard, so a throw would
    stop `load()` with the skeleton still up. The draw that follows reads
    the same sessions inside its own guard, where the recovery screen is.
  - A landing's `from` is the raw stored view. When it is out of range
    (damaged storage), `drawDueNote` names the first day, which is what
    `drawApp` draws.
  - `CONTEXT.md` says "slot" where Step 7's wording said "session",
    because the glossary defines a session as one lift in one slot.
  - The test section sits after plans/077's closing brace, above the
    adoptStored section's leading comment. Inserting it directly before
    that section's `console.log`, the brief's literal anchor, would have
    separated the comment from its heading.
- **For the reviewer:**
  - In Chromium at 375 px, "Volver" measures 46×21. That is under the
    24×24 floor that "accesibilidad: tamaños" holds visible controls to.
    It is `.ord-reset`, the class decision 5 prescribes, and the order
    note's own "Volver al orden del plan" has the same size. The section
    passes because neither note is visible during it. Adding
    `min-height: 24px` to `.ord-reset` would settle both. I left it
    alone, as it is outside this plan's CSS scope. (Settled in the
    review round below.)
- **Time zones.** The whole unit suite passes under Asia/Dhaka (UTC+6,
  where `BOOT_TIME` is local midnight), Asia/Kolkata and Asia/Kathmandu
  (30 and 15 minutes before one), Pacific/Kiritimati, Etc/GMT+12 and
  America/Los_Angeles. Set `TZ` from PowerShell: Git Bash drops a value
  that contains a slash, so an IANA name silently runs in local time.
- **Browser.** An uncommitted Playwright probe against the real shell, in
  light and dark, with a stored `lastDay` of yesterday:
  - the app lands on day 2, with the line and "Volver";
  - the header stays 133 px and the tabs 60 px, with the dot 6 px inside
    the tab's top-right corner;
  - "Volver" goes back;
  - a real `visibilitychange` lands again;
  - the first tick hides the line and dots the tab;
  - there were no CSP violations and no page errors.

  The smoke sections "layout", "tamaños", "main session" and CSP passed
  (272, 0 failed). None of them landed then, since their stored states
  were from today; "tamaños" seeds a landing since the review round.

Review of #194 (one round, verdict REVISE; the four deviations above were
approved):

- **Rebased** onto `bc24d77`, plan 080's merge. The rebase dropped this
  branch's bump, being identical to main's v145→v146, so the bump was
  redone as the last commit: v147. Unit on the merged tree before this
  round's changes: 1592 (main's 1565 plus this plan's 27).
- **Past midnight** (should-fix). The failing case was a session ticked
  at 23:30 and 23:58, its rest running, hidden at 23:58:30 and shown at
  00:00:30. It jumped to the next day and stopped the rest, because its
  date and `lastDay` were both yesterday. `dueSlot` now returns null while
  the block's latest tick of any set is under `DUE_AFTER_MS` (two hours)
  old, and `lastTrained` returns that tick as `lastTick`. The local was
  first named `tick`, which the split-rule check read as
  `js/rest-timer.js`'s `tick()`, so it was renamed.
- **Silent move** (should-fix). When the slot after the latest session
  already had a ticked set, the app moved there and the line hid itself.
  That happens with days trained out of order, or a forgotten session
  filled in later. `dueSlot` now returns null there.
- **Target size** (should-fix). `.ord-reset` has `min-height: 24px`,
  which fixes the order note's button too. "Tamaños" now seeds a landing
  and holds the whole screen, "Volver" included, to the 24×24 floor, with
  the section's own measuring code hoisted into `undersizedNow`.
- **Label** (nit). Volver's `aria-label` clamps the week the way
  `drawApp` does.
- **New unit assertions** (11). Their times come from the shell's own
  `Date` through the shared context, on a day after the boot's, so they
  hold in every zone:
  - after a landing, `›` and then `‹` (2);
  - the clamped label;
  - a retired middle day;
  - the latest session on a retired last day;
  - every set undated;
  - days trained out of order;
  - past midnight: nothing moves at 00:00:30, then it lands at 09:00,
    both by resume and by `load()` (3);
  - a long session (21:30, 21:35, 23:58), the case that tells the last
    tick from the median.

  Unit is 1603 on the merged tree (1565 + 38), in local time and under
  each of the six zones above.
- **Mutations**, each reverted, with the file restored byte for byte:
  - no `DUE_AFTER_MS` check: both past-midnight "stays" assertions fail;
  - the median instead of the last tick: only the long session fails;
  - no "next slot already ticked" check: only the out-of-order case
    fails;
  - `lastTrained` with no filter: the retired-last-day and undated cases
    fail. Removing only the retired-day half fails the first; removing
    only the undated half fails the second;
  - no "forget on another slot": both `›`/`‹` assertions fail;
  - no week clamp: the label assertion fails;
  - `.ord-reset` without its `min-height`: the new "tamaños" case fails
    (`ord-reset 46x21`).
- **Kept as designed:**
  - After "Volver", switching to the other person and back lands her
    again. Decision 3 puts no gate on a switch, and her view is back on
    the session she finished.
  - Unticking the only set on the landed slot brings the line back:
    decision 5 read literally ("nothing in that slot is ticked yet").
