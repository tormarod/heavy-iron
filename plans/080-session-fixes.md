# Plan 080: Six small promises the session breaks, kept

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report — do not improvise.
> Fill in "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` — do not edit it.
>
> **One PR** (`claude/080-session-fixes`), **one commit per step** (A–F),
> and a last commit that **bumps `CACHE_VERSION`** once.
>
> **Drift check (run first)**:
> `git diff --stat c82678d..origin/main -- js/app.js js/rest-timer.js index.html docs/guide.md test/unit.js`
> Plans 078 and 079 may land first. 079 edits `load()`, `writeState`,
> `renderNav`, `drawApp` and `drawCard` in `js/app.js`, all away from the
> lines below. Both edit `docs/guide.md` and `test/unit.js` elsewhere.
> Re-find each excerpt by its quoted text. If its *meaning* changed, that is
> a STOP.

## Status

- **Priority**: P2
- **Effort**: S (six independent edits, each a few lines plus a test)
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug / UX (found by the eleventh pass's direction lenses; not features)
- **Planned at**: commit `c82678d`, 2026-09-24. The maintainer picked the bundle from the eleventh pass (`plans/README.md`, "Eleventh pass").

## Why this matters

Each of these is a place where the app says one thing and does another, on
the everyday path:

- **A.** The Ajustes hint for the pocket alarm promises "El aviso suena
  aunque bloquees el móvil". But the alarm at zero only sounds or vibrates
  when **Aviso sonoro** is on, and that is off by default. Its only switch
  is on the rest timer, visible only during a rest. So someone who turns
  the pocket alarm on gets the silent keep-alive loop, which can pause
  their music, and at zero nothing but an OS notification, if they allowed
  one.
- **B.** The plates box in Ajustes says "separados por coma", but a comma is
  the decimal key on a Spanish phone, which the rest of the app honours
  ("22,5 works"). Typing `1,25` saves two plates, 1 and 25. The box also
  shows the stored plates with decimal points.
- **C.** A tick that takes the grey weight says so with `mark()` — "Serie 1
  anotada con 60 kg (…) — cámbialo si no fue eso". That line lives in the
  status bar at the foot of the page, far below the card, and the save's
  "Guardado hh:mm" replaces it 400 ms later. The rest timer the same tick
  brings up has a message line (`#tmsg`) that shows a fixed breathing tip
  instead.
- **D.** The day's very last tick starts a full rest countdown for a workout
  that is over. The countdown takes the bottom bar's place, so Progreso,
  Plan and Más are hidden until **Saltar** or three minutes after zero.
- **E.** Until every set is ticked, the footer says "Llega al tope del rango
  en todas las series y sube el peso el próximo día". That is the all-sets
  rule from the first commit. Since the objetivo (v3), every set gets its
  own answer, shown under each card.
- **F.** The Diagnóstico's last flat verdict tells the lifter "Apunta el RIR
  de cada serie unas semanas", even when every recent session already has
  an RIR on its sets. Plan 044 recorded the honest row and left its wording
  to the maintainer, who has now picked the fix.

## Current state

All in `js/app.js` unless noted; line numbers are at `c82678d`.

**A — Ajustes' save** (search `const bgAlarmTurnedOn = setupDraft.bgAlarm && !state.prefs.bgAlarm;`):

```js
  const bgAlarmTurnedOn = setupDraft.bgAlarm && !state.prefs.bgAlarm;
  state.prefs.bgAlarm = setupDraft.bgAlarm;
  if (!state.prefs.bgAlarm) keepAliveStop();
```

The hint (search `$('setupBgHint').textContent = setupDraft.bgAlarm`):
`? 'El aviso suena aunque bloquees el móvil o te vayas a otra app, y el descanso aparece en la pantalla de bloqueo con −30 / +30 / saltar. Para conseguirlo la app reproduce un sonido inaudible mientras dura el descanso: en algunos móviles eso pausa la música que estés escuchando. Si el móvil lo permite, además te avisa con una notificación.'`

`js/rest-timer.js`, the alarm loop (search `const fire = () => {`):

```js
  const fire = () => {
    if (!state.prefs.sound || count >= ALARM_REPEATS) {
      stopAlarmLoop();
      ...
      keepAliveStop();
      return;
    }
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
```

`keepAliveStart()` checks only `state.prefs.bgAlarm`. `state.prefs.sound`
defaults to `false` in `migrate()`. The only thing that sets it is the
`#tsound` switch in `wireRestTimer`. `drawApp` calls `renderSoundBtn()` on
every draw.

**B — the plates box.** In `index.html` (search `discos disponibles por lado`):
`<span class="pe-field-lbl">Calculadora — discos disponibles por lado (separados por coma)</span>`.
In `js/app.js`, opening Ajustes: `platesText: state.prefs.plates.join(', '),`.
Saving: `const plates = cleanPlates(String(setupDraft.platesText || '').split(','), state.prefs.units);`.
`num()` (top of the file) reads a decimal comma:
`parseFloat(String(v).replace(',', '.'))`. `cleanPlates(list, unit)` maps
`num`, keeps each size once within `PLATE_MIN`/`PLATE_MAX`, and caps the
count. `test/unit.js` § "'Guardar' in Ajustes keeps the plates migrate()
would (plans/055)" types `'25, 20, 20, 0.25, x, 100, 1.25'` and expects
`[25,20,0.25,1.25]`. Its comment says "The box is a comma-separated list, so
its decimals are written with a point".

**C and D — the tick** (search `tick.onclick = () => {` in `buildExCard`):

```js
    tick.onclick = () => {
      let adopted = '';
      writeRows(cardCtx, () => { adopted = tickRow(r, hint, Date.now()); });
      if (r.done && ex.rest) startRest(ex.rest, ex.n + ' · serie ' + (si + 1), hints.next[si]);
      if (r.done && !ex.rest) stopRest();
      /* The tick that finishes the whole day counts as a session — see
         maybeNagBackup. dayCards holds every card's rows by live reference,
         so this reads true only once every row across every exercise is
         done — including the cards this redraw is not going to touch. */
      if (r.done && dayCards.every(c => c.rows.every(rr => rr.done))) {
        state.prefs.sessionsSinceBackup++;
        maybeNagBackup();
      }
      drawCard(ex.id);
      if (adopted) mark('Serie ' + (si + 1) + ' anotada con ' + adopted + ' ' + units() + ' (' + hintFrom + ') — cámbialo si no fue eso');
    };
```

`js/rest-timer.js` (search `function startRest(sec, label, next) {`):

```js
  $('tlbl').textContent = 'Descanso · ' + label;
  $('tmsg').setAttribute('aria-live', 'polite');
  $('tmsg').textContent = 'Prueba de la frase: si puedes hablar sin quedarte sin aire, ya estás listo.';
```

`startRest` adds the class `up` to `#timer`. `app.js` stubs it for a precache
hole as `globalThis.startRest = function () {}` (search
`if (typeof startRest !== 'function')`), so an extra argument is safe in
both directions.

**E — the footer** (search `function drawSessionFoot`):

```js
  const head = doneN === total
    ? 'Sesión completa — ' + total + ' series registradas. ' + nextSessionLine(profile, block, days)
    : doneN + ' de ' + total + ' series hechas. Llega al tope del rango en todas las series y sube el peso el próximo día.';
```

`test/smoke.js` asserts only the `N de M series hechas` prefix (lines ~340, ~1515).

**F — the Diagnóstico.** `diagVerdict(trend, sig)`, the flat branch's last
two returns (search `'Estancado, sin una señal clara en el registro'`):

```js
    if (sig.workPct != null) {
      return { lectura: 'Estancado de verdad — ni la serie tope ni los kilos por serie se mueven',
               cambio: 'No hay progreso escondido en las series de después: haz lo que mande el objetivo de la semana, y si lleva medio bloque igual, cambia el ejercicio.' };
    }
    return { lectura: 'Estancado, sin una señal clara en el registro',
             cambio: 'Apunta el RIR de cada serie unas semanas: sin eso no se puede distinguir fatiga de falta de intensidad.' };
```

The signals are built in `diagRows` (search `const sig = {`). `recent` is
`points.slice(-3)`. `easy` and `failure` read `diagSessionRir(p.rirs)`, the
median of a session's typed per-set RIRs, or `null` when none is typed.
This fallback is reached when the trend is flat, none of `estDown`,
`failure`, `decay` or `easy` fired, and the work axis could not be read
(`sig.workPct` is only set when the set count held still across the window).
Plan 044's maintenance note says the honest row there is "the effort was
right and the top set still did not move: change the stimulus (a set, a rep
range, the exercise)".
`js/review.js` exports every row's `lectura` and `cambio` verbatim into the
AI document. `docs/guide.md` § Diagnóstico has a verdict table, whose last
flat row is
`| plano | ninguna | Estancado sin señal clara | Apunta el RIR de cada serie unas semanas — sin eso no se distingue fatiga de falta de intensidad |`.
`test/unit.js` pins `diagVerdict("flat", {}).lectura` as the old row (keep
that true). It also has `diagProbe` (search `const diagProbe = call(`), which
builds a flat lift from per-set `[reps, rir]` rows and returns
`row.trend + ' | ' + row.lectura`.

**Conventions** (AGENTS.md): Spanish on screen, English comments that say
why, no `style` attribute, nothing newer than Safari 15 (**no regex
lookbehind**), a changed behaviour goes into `docs/guide.md`, and bump
`CACHE_VERSION` with the tool.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js && node --check js/rest-timer.js` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` (1538 at `c82678d`) |
| One smoke section | `node test/smoke.js --only "<name>"` with `python3 -m http.server 8765` running | passes |
| Bump | `bash tools/bump-cache-version.sh` | `CACHE_VERSION` + 1 |

## Scope

**In scope**: `js/app.js`, `js/rest-timer.js`, `index.html` (the one label),
`docs/guide.md`, `test/unit.js`, `sw.js` (bump only).

**Out of scope** (recorded in the eleventh pass, not done here):
- The rest line after an exercise's last set, which says "Última serie
  hecha" instead of naming the next card, and its reps half, which is the
  ninth audit's finding 11.
- Showing RIR in the history bands (`60×10@2`).
- The review screen's missing energy summary.
- A file picker in Importar JSON.
- The plates as they appear in the AI prompt and the calculator: those are
  output, not input.
- Any change to when the keep-alive loop runs.

## Git workflow

Branch `claude/080-session-fixes` from `origin/main`
(`git checkout -B claude/080-session-fixes --no-track origin/main`). One
commit per step, each a plain sentence prefixed "Plan 080 A:" … "Plan 080 F:",
then "Bump the shell to vNNN". Add the `Co-Authored-By` trailer the session
gives you. Rebase and re-bump before pushing if `origin/main`'s
`CACHE_VERSION` moved. Open the PR only if the operator told you to.

## Steps

### Step A: Turning the pocket alarm on turns the sound on

1. In Ajustes' save, right after `state.prefs.bgAlarm = setupDraft.bgAlarm;`:
   `if (bgAlarmTurnedOn) state.prefs.sound = true;`. Add a comment: the
   alarm this setting keeps alive *is* the sound, and with it off the
   setting paid its cost (the silent loop) for nothing. Turning the alarm
   off leaves the sound as it is.
2. Add one sentence to the "on" hint:
   `Al activarlo se enciende también el aviso sonoro del temporizador; puedes apagarlo ahí mismo.`
3. `docs/guide.md` § During the session, bullet **The alarm can follow the
   phone into your pocket**: say that switching it on also turns on
   **Aviso sonoro**, which can be turned off again on the timer.
4. Tests (a new section, see "Test plan"):
   - From a boot where `prefs.sound` is false, `openSetup(false)`, set
     `setupDraft.bgAlarm = true` and press `#setupSave`. Then
     `prefs.sound === true && prefs.bgAlarm === true`.
   - Next, press `#tsound` to turn the sound off, and open and save
     Ajustes again without touching the alarm. The sound stays `false`.

**Verify**: `node test/unit.js` → `0 failed`, new assertions passing.

### Step B: The plates box takes a decimal comma

1. `index.html`: the label ends `(separados por punto y coma)`.
2. Opening Ajustes:
   `platesText: state.prefs.plates.map(p => String(p).replace('.', ',')).join('; '),`
   shows `1,25; 2,5; 5; 10; 15; 20` for the kg defaults.
3. Saving: split with
   `String(setupDraft.platesText || '').replace(/,\s+/g, ';').split(/[;\s]+/)`.
   A comma followed by whitespace is still a separator, so a list typed
   the old way (`20, 15, 10`) reads as before. A comma between digits is a
   decimal. No lookbehind. Add a comment saying why.
4. `docs/guide.md` § Making it yours, where Ajustes' bar weight and plates
   are described: the plates are separated by semicolons (`20; 15; 10; 5;
   2,5; 1,25`), because the comma is the decimal key.
5. Tests, extending the plans/055 section:
   - Update its comment: the box is now semicolon-separated, and ", " is
     still read as a separator.
   - Keep its assertion.
   - Add: `'20; 15; 2,5; 1,25'` → `[20,15,2.5,1.25]`.
   - Add: `'1,25'` → `[1.25]`.
   - Add: the text Ajustes opens with, saved unchanged, gives back the same
     plates.

**Verify**: `node test/unit.js` → `0 failed`.

### Step C: The rest timer says what a tick took

1. `js/rest-timer.js`: `function startRest(sec, label, next, note)`. Set
   `$('tmsg').textContent = note || 'Prueba de la frase: …'` (the same tip
   text). Add to the function's comment: `note` is what the tick that
   started this rest has to say, and it is shown where the eye is.
2. In the tick handler, build the adoption text once:
   `const adoptedNote = adopted ? 'Serie ' + (si + 1) + ' anotada con ' + adopted + ' ' + units() + ' (' + hintFrom + ') — cámbialo si no fue eso' : '';`
   - Pass it as `startRest`'s fourth argument.
   - Keep `mark(adoptedNote)` where the old `mark(…)` was, guarded by
     `if (adoptedNote)`.
3. `docs/guide.md` § During the session, "The weight box already knows what
   you did last time": "telling you so in the status line" becomes "telling
   you so on the rest timer the tick starts, and in the status line at the
   foot of the page".
4. Tests:
   - Boot `settled(seeded({ week: 2, day: 0 }))`, where week 2's cards have
     a grey weight.
   - Tick the first card's first set without typing
     (`boot.card(0).set(0).tick.onclick()`).
   - `boot.$('tmsg').textContent` starts with `Serie 1 anotada con`.
   - Type a weight into set 2 (`boot.type(boot.card(0).set(1).w, '50')`),
     then tick it. `#tmsg` starts with `Prueba de la frase`.

**Verify**: `node --check js/rest-timer.js`; `node test/unit.js` → `0 failed`.
This includes the precache-hole section that boots without
`js/rest-timer.js`.

### Step D: The day's last set starts no rest

1. In the tick handler, after `writeRows(…)`:
   `const dayDone = r.done && dayCards.every(c => c.rows.every(rr => rr.done));`
2. Then:
   - `if (r.done && ex.rest && !dayDone) startRest(…);`
   - `if (r.done && (!ex.rest || dayDone)) stopRest();`
3. The backup-counter `if` uses `dayDone` instead of repeating the
   expression.
4. Add a comment: a countdown for a workout that is over hides the bar
   until **Saltar**.
5. `docs/guide.md` § During the session, the **rest timer** bullet: the day's
   last set starts no rest.
6. Tests: in a `settled(seeded({ week: 2, day: 0 }))` boot, tick every
   set of the day, card by card (`boot.call('dayCards.length')`, each
   card's `rows.length`, `boot.card(i).set(k).tick.onclick()`). Look the
   card up again after every tick: the card is rebuilt.
   - Just before the last tick, `#timer` has the class `up`.
   - After the last tick it does not.
   - `state.prefs.sessionsSinceBackup` went up by exactly 1.

**Verify**: `node test/unit.js` → `0 failed`.

### Step E: The footer stops stating the old rule

1. The unfinished branch becomes `doneN + ' de ' + total + ' series hechas.'`.
2. Add a comment: each card's objetivo line says what each set asks, and a
   footer that repeated the all-sets rule contradicted it on every
   unfinished session.
3. Test: after a boot with a partly ticked day, `boot.$('note').textContent`
   starts with `N de M series hechas.` and does not contain `Llega al tope`.

**Verify**: `node test/unit.js` → `0 failed`.

### Step F: The Diagnóstico stops asking for RIR the log already has

1. In `diagRows`' `sig`, add
   `rirLogged: recent.length > 0 && recent.every(p => diagSessionRir(p.rirs) != null),`
   with a comment: every one of the last sessions carries an RIR, so
   "write down your RIR" is advice the log contradicts.
2. In `diagVerdict`'s flat branch, immediately before the final
   `return { lectura: 'Estancado, sin una señal clara en el registro', …`, add:
   ```js
   if (sig.rirLogged) {
     return { lectura: 'Estancado con el esfuerzo bien puesto — el RIR apuntado no es ni holgado ni de fallo',
              cambio: 'Llegas al RIR que toca y la serie tope no se mueve: cambia el estímulo — una serie más, otro rango de repeticiones u otro ejercicio.' };
   }
   ```
   Add a comment citing plan 044's maintenance note. The wording is the
   advisor's rendering of that note; the maintainer may reword it in
   review, but the condition and its place in the matrix stay.
3. `docs/guide.md` § Diagnóstico, the verdict table:
   - Insert a row before the last flat row:
     `| plano | ninguna, con el RIR apuntado en las últimas sesiones | Estancado con el esfuerzo bien puesto | Cambia el estímulo: una serie más, otro rango de repeticiones u otro ejercicio |`.
   - Change the last flat row's signal cell to
     `ninguna, y sin RIR apuntado en las últimas sesiones`.
4. Tests, next to the existing `diagVerdict` and `diagProbe` cases:
   - `diagVerdict("flat", { rirLogged: true }).lectura` is the new row.
   - `diagVerdict("flat", {}).lectura` is still the old one; the existing
     assertion stays.
   - Through `diagProbe`: three sessions whose set counts differ (e.g. 3,
     2, 3 sets), so the work axis is withheld. Reps inside the range and
     below its top (e.g. 10 or 11, so no set is censored at the top), and
     `'1'` typed on every set. The result is `'flat | Estancado con el esfuerzo bien puesto — …'`.
   - The same sessions with no RIR give `'flat | Estancado, sin una señal clara en el registro'`.
   - If no rep pattern yields `flat` for both, that is a STOP.

**Verify**: `node test/unit.js` → `0 failed`.

### Step G: In a browser, then bump

With `python3 -m http.server 8765` running, run `node test/smoke.js --only`
with each of: `main session`, `descanso con la pantalla apagada`,
`la barra y el menú de la tarjeta`, `objetivo de peso y diagnóstico`,
`revisión del bloque`.
Then `bash tools/bump-cache-version.sh`, committed alone.

**Verify**: all five sections pass; `git diff origin/main -- sw.js` is one
line; `node test/unit.js` → `0 failed`.

## Test plan

- A new `test/unit.js` section,
  `console.log('\n== six promises the session breaks, kept (plans/080) ==');`,
  inside the enclosing block of the plans/053 booted-editor section (it
  needs `SEED`, `seeded`, `settled`), for Steps A, C, D and E.
- Step B's cases extend the plans/055 plates section.
- Step F's cases go next to the existing `diagVerdict` and `diagProbe` cases.
- Mutation checks, each recorded in Maintenance notes:
  - revert A's one line: its first case fails;
  - revert B's split to `.split(',')`: the `'1,25'` case fails;
  - drop C's fourth argument: C's first case fails;
  - revert D's `!dayDone`: D's case fails;
  - remove F's `if (sig.rirLogged)` block: the first `diagProbe` case fails.

## Done criteria

- [ ] `node --check js/app.js && node --check js/rest-timer.js` → exit 0
- [ ] `node test/unit.js` → `0 failed`, with at least 12 new assertions
- [ ] `grep -c "Llega al tope del rango" js/app.js` → `0`
- [ ] `grep -c "separados por coma" index.html` → `0`
- [ ] `grep -c "Apunta el RIR de cada serie" js/app.js` → `1` (the old row stays, for a log with no RIR)
- [ ] Seven commits (A–F, bump); `git diff --stat origin/main` lists only in-scope files
- [ ] Maintenance notes filled in, including the five mutation results

## STOP conditions

- Any excerpt above no longer matches in meaning.
- Step C's or D's test cannot see the rest timer through `boot.$('timer')` /
  `boot.$('tmsg')`.
- Step F's `diagProbe` case cannot be made `flat` with the work axis
  withheld. That would mean the fallback row is reached differently from
  what this plan says.
- An existing unit or smoke assertion other than the plans/055 comment
  changes result. Name it. Note: a smoke test that ticks a whole day and
  then expects a timer is the likeliest.

## Maintenance notes

(Executor: deviations, the five mutation results, anything for the reviewer.)

- F's Spanish wording is a first draft for the maintainer to edit; the
  condition is the part that is settled.
- After A, a person who turns the sound off on the timer while the pocket
  alarm is on gets a silent pocket alarm again. That is their choice, made
  where the switch is. If it turns out to be a trap in practice, a
  separate switch in Ajustes is the next step.
- The five mutation checks, run by hand before committing (applied, unit
  suite run, reverted, `diff` against a pre-mutation copy confirmed an
  exact restore each time):
  - Reverting A's `if (bgAlarmTurnedOn) state.prefs.sound = true;` (deleted
    the line): **fails as predicted** — "turning the pocket alarm on in
    Ajustes turns Aviso sonoro on with it" (its first case) failed with
    `sound false, bgAlarm true`; the second A case failed too, as a
    consequence.
  - Reverting B's split to `.split(',')`: **fails as predicted** — "a
    single decimal-comma plate saves as one plate, not two split on its
    comma" (the `'1,25'` case) failed, `[1,25]` instead of `[1.25]`. Two
    other B cases failed alongside it (the semicolon-list and round-trip
    cases), which the plan did not require but is consistent with the same
    root cause.
  - Dropping C's fourth argument (`startRest(ex.rest, ex.n + ' · serie ' +
    (si + 1), hints.next[si])`, no `adoptedNote`): **fails as predicted**
    — C's first case, "a tick that takes the grey weight says so on the
    rest timer it starts", failed: `#tmsg` held the fixed breathing tip
    instead of "Serie 1 anotada con …".
  - Reverting D's `!dayDone` (back to `if (r.done && ex.rest) startRest(…)`
    and `if (r.done && !ex.rest) stopRest();`): **fails as predicted** —
    "the day's last tick starts no rest…" failed, `#timer` still carrying
    the `up` class after the last tick.
  - Removing F's `if (sig.rirLogged) { … }` block: **fails as predicted**
    — the first `diagProbe` case, "a flat lift over sessions with
    different set counts, RIR 1 on every set, reads the effort as already
    accounted for", failed and fell back to `flat | Estancado, sin una
    señal clara en el registro`. The plain `diagVerdict("flat", {
    rirLogged: true })` case failed alongside it, as a consequence.
- Step F's `diagProbe` case needed one iteration beyond the plan's own
  description. The first attempt varied reps across sessions (10, 11, 10)
  along with the set count, on the theory that only the top set's weight
  (fixed at 40 by `diagProbe`) drives the trend; that read as `up`, not
  `flat` — the estimated-1RM trend the rule reads is sensitive to reps
  too, not just weight. Holding reps at a constant 10 across all three
  sessions and varying only the set count (3, 2, 3) gets a `flat` trend
  with the work axis withheld, as the plan intended. Not a STOP: the
  `flat` case is reachable, just not with reps varying incidentally.
