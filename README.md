# heavy-iron

A simple gym training log for two people, hosted as a static site. No
backend, no build step — everything is saved to `localStorage` in your
browser. It installs to a phone's home screen and works with no signal.

## Using it

The app is in Spanish. This is what the screens do.

**First open.** A short setup asks who trains, in kg or lb, and which plan
to start from — then you are looking at week 1, day 1 of a block. Skipping
it keeps the defaults. See [Making it yours](#making-it-yours).

**A session, top to bottom.** Pick the week and the day in the two rows
under the title. The banner states that week's goal and RIR target. Each
exercise below it shows what it wants — `4 × 6–10`, rest time — over one
row per set:

| Control | What it does |
|---|---|
| the two boxes | the weight and the reps you did. The greyed number is what you lifted on that set the last week you logged it — tick without typing and it takes that. `22,5` works. |
| **↓** | records weight coming off *that* set — a dropset, or the drop you needed to finish the reps. Adds an indented row with its own boxes; up to four per set. See [Weight drops](#weight-drops). |
| **✓** | marks the set done, and starts the rest timer. This is the control that counts: only ticked sets feed the chart, the **RÉCORD** badge and the totals. |
| **⚙** | machine settings for that exercise — seat height, pin position. Saved to the plan, not to the log. |
| **RIR último set** — `2+` `1` `0` | how the last set actually felt. Optional; tap the same chip again to clear it. |
| **Progreso ↗** | that exercise's weight, or estimated 1RM, over time. |

The rest timer runs along the bottom once a set is ticked: **−30**/**+30**
move the finish line, **Son.** turns the alarm on, **Saltar** ends it.

**The footer buttons**, in order: copy last week's weights into this day,
edit the plan of the block you are on, [the warm-up
calculator](#warm-ups-and-plate-maths), [the weekly volume
view](#weekly-volume-by-muscle-pattern-or-type), clear this day, back up
your data, settings, and wipe the log.

**Week to week.** Fill the rep range at the prescribed RIR, then next week
press **Copiar pesos de la semana anterior** on the same day: it brings
last week's numbers across and adds the increment on the exercises that
earned it. When the block ends, **+ Nuevo bloque** starts the next one
from a copy of the plan and leaves this one's history where it is.

## Features

- **Setup on first run**: name the people training, pick kg or lb, choose a
  colour each, and start from the built-in example plan, from a blank
  block, or from a block JSON you paste in. Reachable afterwards under
  **Ajustes** — see [Making it yours](#making-it-yours).
- **One person or two.** In solo mode the profile switcher, the JUNTOS/SOLO
  badges and the pair notes all disappear; the second profile is hidden
  rather than deleted, so you can switch back with nothing lost.
- **Two profiles**, each with their own plan, weeks, and history.
- **Blocks**: each profile can have several training blocks (e.g. "Bloque
  1", "Bloque 2"). Use **Nuevo bloque** to start the next one from a copy
  of the current plan, and **Gestionar** to delete the ones you no longer
  want without disturbing the block you are training — see
  [Deleting blocks](#deleting-blocks-you-no-longer-want).
- **Plan editor**: edit exercise names, alternatives, cues, sets, reps,
  rest time, and shared/superserie flags for the active block, add or
  remove exercises and days, and reorder them — all without losing what
  you have already logged. See [Editing a block mid-way](#editing-a-block-mid-way).
- **Blocks of any length**, 1 to 16 weeks, with the deload week you choose
  (or none at all) — see [Block length](#block-length-and-the-deload-week).
- **Week/day navigation**, rest timer, "copy previous week's weights", and
  per-exercise progress charts — for the current block, or across every
  block you have ever run, either as raw weight or as an estimated one-rep
  max (Epley) so a program moving between rep ranges still shows a
  consistent strength trend.
- **A target weight for every exercise, every week**, read off last week's
  reps and RIR rather than guessed — see
  [The weekly objetivo](#the-weekly-objetivo).
- **Diagnóstico**: every exercise's strength trend at once, ranked worst
  first and crossed with the signals already in your log, so a stall comes
  with a reason and something to change — see [Diagnóstico](#diagnóstico).
- **Volume as a trend, with landmarks**: the block's weeks in one view per
  muscle, against the 10–20 hard-sets band, with the muscles you marked
  `prioritario` flagged in amber when they fall under it — see
  [Volume across the block](#volume-across-the-block).
- **Weekly volume, three ways to slice it**: hard sets per muscle, per
  movement pattern, or compound vs. isolation — as the plan prescribes
  them this week, or as you actually ticked them, with the kilos moved so
  far in the block on top. See
  [Weekly volume](#weekly-volume-by-muscle-pattern-or-type) and
  [Kilos moved so far](#kilos-moved-so-far).
- **A warm-up and plate calculator**: a ramp up to your working weight and,
  on a barbell, which plates go on each side. See
  [Warm-ups](#warm-ups-and-plate-maths).
- **Undo** on the three things that destroy data: clearing a day, wiping a
  profile, deleting a block.
- **Works offline, installs like an app** — see [Offline](#offline-and-installing).
- **Session feedback while you train**: last week's weight waiting in the
  box, a **RÉCORD** badge when a set beats everything you have ever logged
  on that exercise, and the session's total volume in the footer — see
  [During the session](#during-the-session).
- **Weight drops on any set**: record a dropset, or the weight you had to
  strip off to finish the reps, without inventing a set that wasn't there.
  Marking a drop as *forzado* stops the automatic weight increase next
  week — see [Weight drops](#weight-drops).
- **Light and dark**, following the phone unless you override it with the
  ◐ button in the header.
- **Backup / restore**: download a `.json` file with both profiles'
  data, or copy/paste it as text. Restoring replaces everything. There is
  also a one-way **CSV export** for looking at the numbers in a
  spreadsheet.
- **Move one person between phones**: export a single profile and load it
  on the other device — it replaces that person and leaves the other
  alone. See [Two phones](#two-phones-one-profile-each).
- **Or pass it on camera**: show a QR on one phone, scan it on the other —
  a block's plan, a block *with everything you have logged in it*, or a
  whole profile. No files, no network, no server. See
  [QR](#passing-data-with-the-camera-qr).
- **Import a block from JSON**: paste a block definition (e.g. one an
  AI training agent generated for you), or pick one from `blocks/` in
  this repo — see [Importing blocks](#importing-blocks-from-json) below.

## Making it yours

The app ships with one couple's training plan in it, and for a long time
that was structural rather than cosmetic: the two profiles were keyed
`hombre` and `mujer`, and deleting one brought it back — with a stranger's
plan attached — on the next open. That's gone. The keys are internal now,
and everything you see is yours to set.

On a device with nothing saved, the first thing you get is a short setup:

| Question | What it does |
|---|---|
| **¿Quién entrena?** | Two people, or just you. Switches solo mode on or off; changeable any time. |
| **Nombres** | What each profile is called everywhere in the app, including backups and the CSV. |
| **Color** | The accent for each profile — blue or green — so you can tell whose session is on screen at a glance. |
| **Unidad de peso** | `kg` or `lb`. |
| **Plan de partida** | The built-in 8-week example plan; a blank block with one day and one empty exercise; or **Traer un JSON**, which takes a pasted block (with the same template download and AI prompt buttons as [Importar JSON](#importing-blocks-from-json)) and makes it the starting plan for both profiles. A paste that doesn't validate is refused there and then, leaving the sheet as it was. |

Skipping it keeps the defaults and never asks again. Everything except the
starting plan stays editable under **Ajustes** in the footer — the starting
plan isn't offered later because by then swapping it would throw away real
history, which is what blocks are for instead.

**Ajustes** also holds three fields the first run doesn't ask about,
because there is nothing to set them against yet: your bar weight and the
plates you have, used by [the calculator](#warm-ups-and-plate-maths), and
your **default weight increment** — the smallest step you can actually
load. That last one is what [the weekly objetivo](#the-weekly-objetivo)
rounds to for every exercise that doesn't carry an `inc` of its own; an
exercise that does carry one always wins over it. It starts at 2,5 kg
(5 lb) and, like the bar weight, is seeded from whichever unit you picked
and never rescaled afterwards.

It deliberately does *not* feed **Copiar pesos**: that button writes
weights into your log, and adding a default step to an exercise nobody
declared one for would silently put +2,5 kg on a 12 kg lateral raise.
Copying stays keyed on an explicit `ex.inc`; the objetivo line, which only
ever tells you something, is where the fallback is safe.

**About units.** `kg`/`lb` is a *label*, not a conversion. The app never
touches the number you typed — you write down what's on the machine, and
this is what it gets called on screen, in the chart and in the CSV header.
Changing it later relabels everything and rewrites nothing.

**About solo mode.** The second profile is hidden, not deleted. Its plan
and history stay in storage and in your backups, so turning two-person
mode back on returns everything exactly as it was.

## Block length and the deload week

A block is 1 to 16 weeks long, set in **Editar plan** alongside its name.
Pick which week is the deload — any of them, or **Sin descarga** if the
block doesn't have one. In the deload week every exercise does half its
sets, rounded up, minimum two; that used to be hardcoded to week 8.

Blocks saved before this are exactly what the app used to assume — eight
weeks, deload on week 8 — so nothing you already have moves.

Two things worth knowing when you change the length:

- **Shortening never deletes.** Sets logged in weeks the block no longer
  has are kept and hidden, and the session says how many; make the block
  long enough again and they come straight back. It's the same rule as
  dropping a set from an exercise.
- **Week goals follow.** Weeks the block grows into get a goal generated
  for them, and moving the deload moves its text with it. Anything you
  wrote yourself in a week's goal is left alone.

## Two phones, one profile each

There is still no sync — but there is now a way to carry one person across.
In **Copia de seguridad**, **Exportar &lt;name&gt;** writes a file with just
that person in it, and **Cargar un perfil** on the other phone loads it.

It replaces **only** the profile it came from. The other person's plan,
history, week and day are untouched, and the confirmation shows both set
counts before anything is overwritten:

```
Entra "Ana" del 14 ago 2026: 184 series registradas.
Se reemplaza Ana, que tiene ahora 12 series registradas.

Bruno no se toca. No se puede deshacer.
```

A profile file is not a backup and won't load as one — **Cargar copia**
rejects it, and says so. Use the full `.json` for backups and this for
moving one person.

## Passing data with the camera (QR)

Files are awkward in a gym: no signal to mail one, and AirDrop between an
iPhone and an Android is not a thing. **Copia de seguridad → Compartir por
QR** does it with the two cameras you already have — one phone draws the
data, the other reads it off the screen. Nothing is uploaded and nothing is
fetched; the data goes device → photons → device.

Three things can be sent, and the difference matters:

| | What travels | What it does on the other phone |
|---|---|---|
| **Plan** | the block's exercises, sets, reps, rest and cues | adds a new block |
| **Plan + registro** | the same, **plus every set logged against it and every RIR chip tapped** | adds a new block, with that history attached |
| **Perfil** | one person entire: all their blocks, all their history | **replaces** that profile, after asking |

The first two only ever *add* a block, so scanning one can't cost you
anything you already had. The third replaces a whole profile and goes
through the same confirmation (and the same set counts) as loading a
profile from a file.

A single QR a phone can actually read holds a few hundred bytes, and a
block with months of sets is tens of kilobytes — so the payload is
compressed, cut into numbered frames, and cycled on screen:

```
Fotograma 4/9 — mantén el otro móvil apuntando hasta que los recoja todos.
```

The reader collects frames by number, so they can arrive in any order and
repeat as often as they like — you just hold the phone there until it says
`Recibido 9/9`. Every frame carries a checksum of the whole payload and a
random id for the transfer, so a half-read share can't be stitched onto a
different one, and a lost frame is reported rather than guessed at.

Retired exercises and days are left out of what's shared: you send the plan
as you see it. Compression usually shrinks a full block log by around 8×;
if something still needs more than 60 frames, the app says so and points at
the file transfer rather than animating for a minute.

### Written down vs. marked done

A set counts as *registrada* the moment it holds anything — including a
weight you typed into the box and then never ticked. Only a set with the ✓
feeds the progress chart, the **RÉCORD** badge and the volume dashboard.

The transfer carries both kinds exactly as they are, ticks included. It
does not invent them: a set that crosses without a ✓ arrives without one,
because the alternative is the app deciding you completed work you never
marked as completed. So both screens say which is which when they differ:

```
3 series registradas, 1 marcada como hecha.
Las 2 sin marcar traen peso y reps pero llegan sin el ✓,
tal y como estaban en el otro móvil.
```

If a block arrives with numbers in the boxes and an empty chart, that is
what happened — the sets were written down on the sending phone but never
ticked, and its chart was empty too. Tick them and the chart fills in.

Camera unavailable or permission denied? It says so and points back at the
file buttons above it — the file transfer stays the primary path, and this
never becomes the only way to do something.

## Undo

Clearing a day, wiping a profile and deleting a block each take a
snapshot first, and offer **Deshacer** in a bar at the bottom of the
screen. One level deep: the next destructive action replaces it, and it
doesn't survive a reload. It covers the misfire that actually happens —
the wrong day, the wrong profile — not a change of heart tomorrow. For
that, keep backups.

## Data & privacy

All data lives only in the browser's `localStorage` on the device you're
using — there is no server and no sync between devices. Each person's
phone/browser keeps its own log. Use the backup feature regularly if you
care about not losing your history (e.g. clearing browser data, switching
phones).

The page is locked down with a Content-Security-Policy that only allows it
to talk to two hosts: Google Fonts for the typefaces, and
`raw.githubusercontent.com` to list and fetch the blocks published in this
repo (read-only, no token). Nothing else can be loaded and nothing can be
sent anywhere, so your log physically cannot leave the device except
through the backup buttons you press yourself.

The QR transfer doesn't change that. Both QR libraries are vendored in
`js/vendor/` and load under the existing `script-src 'self'`, and reading a
camera is not a network request — so the CSP above is untouched, and a
transfer still only happens between two phones pointed at each other.
Granting camera permission lets the page *read* frames; it never gets a way
to send one anywhere.

Blocks you import are treated as untrusted input, because they come from
outside the app: every field is length-capped, every number clamped to a
range a human could train, and everything drawn on screen is escaped, so a
block containing markup shows up as those characters instead of running.

### When the data goes wrong

The app repairs what it can on the way in — a block id that no longer
exists, a missing week-goal table, a day with no exercises — rather than
failing to draw. If the saved data is broken past repairing, you get a
recovery screen instead of a blank page: it **stops writing** so the
damaged copy is not overwritten, and offers to download the raw bytes as a
file before you reset anything.

Two smaller safeguards worth knowing about:

- **Nothing is lost to a pocket.** Writes are batched while you type, and
  flushed the moment the tab is hidden or closed, so the last set of the
  session is saved even if the phone locks straight after it.
- **Two tabs don't fight.** If the log changes in another tab, this one
  picks it up; if you had unsaved edits here, it says so instead of
  silently overwriting them.

## Offline and installing

The app registers a service worker that caches the page, styles, script
and fonts, so after the first visit it opens with no connection at all —
which is the normal state of a gym basement. Blocks published in `blocks/`
are fetched from the network first and fall back to the cached copy, so
the list is fresh when you have signal and still works when you don't.

On a phone, **Add to home screen** (Safari) or **Install app** (Chrome)
gives it its own icon and no browser chrome. Updates never swap the code
out from under a session: when a new version has been cached, a small
**Actualizar** prompt appears and nothing changes until you tap it.

## During the session

- **The weight box already knows what you did last time.** The greyed
  number in it is what you lifted on that same set the last week you
  logged it. Tick a set without typing anything and it takes that number,
  telling you so in the status line — change it if the weight was
  different.
- **Decimals with a comma work.** `22,5` is stored and charted as 22.5;
  previously the browser threw the whole value away when it saw a comma.
- **RÉCORD** appears on an exercise when a completed set beats the best
  weight you have ever logged for it, across every block of that profile.
  The set's tick turns amber.
- **The footer totals the session**: sets done, kilos moved (weight ×
  reps over every completed set), records, and the date you last logged
  something on this day.
- **The rest timer** can be nudged with **−30**/**+30** when the machine
  is still busy, and **Son.** turns on the alarm at zero for when the phone
  is face-down or you are wearing headphones. One beep is easy to miss
  mid-set, so it is a burst of four rapid sawtooth pulses — flat and
  klaxon-like rather than a melodic chime, and richer in harmonics than a
  sine at the same volume, which is what carries over gym noise and a tinny
  phone speaker — plus a vibration, repeating about once a second until you
  skip or nudge the timer, or six repeats go by. The countdown runs off a
  wall-clock end time, so it stays correct through a locked screen, and
  while it runs it holds a screen wake lock (where the browser has one) so
  the phone doesn't sleep between sets.
- **RIR, once per exercise.** Three chips — `2+` / `1` / `0` — after the
  sets, for how the last one actually felt. Optional and empty by default,
  same as `share`/`ss`: skip it and nothing changes. It is the other half
  of the RIR target `phase` already prescribes per week — that number says
  what the set was supposed to cost, this one says what it did, and tapping
  the same chip again clears it. It travels with a "plan + registro" QR
  share, and shows up as its own column in the CSV export.
- **A rep-decay warning, for free.** No input needed: if the first set of an
  exercise has ≥3 more reps typed than the last one, a small line appears
  under the sets — `⚠ caída de 4 reps: ¿primera serie al fallo?` — because
  that drop is usually the first set having been pushed closer to failure
  than the ones after it.
- **An objetivo for this week's weight, also for free.** Under the sets,
  in the same voice as the rep-decay line: `↗ objetivo: 65 kg × 6 (de 60×10
  a 2 RIR)`. Last week's set is corrected for how close to failure it
  actually went, and that estimate is solved back for the weight that lands
  you at the *bottom* of the rep range at this week's prescribed RIR —
  which is what double progression means and what the week banners already
  say in prose. See [The weekly objetivo](#the-weekly-objetivo) below for
  what it does and does not claim.
- **A ↓ on every set, for the weight that came off.** See
  [Weight drops](#weight-drops) below.
- **Ajustes**, collapsed. A `⚙` button under each exercise's name opens a
  one-line field for seat height, pin position — whatever you'd otherwise
  have crammed into the technique cue. It is a plan field, not a log one:
  editing it here writes straight to the exercise, same as **Editar plan**
  would, just from where you actually notice it needs setting.
- **Copiar pesos de semana anterior does double progression.** An exercise
  with an `inc` set gets its copied weight bumped by that amount instead of
  repeated as-is, but only when every set hit the top of the rep range last
  week — same rule the week banners already state in prose, now checked
  automatically. It also checks the other half of that rule: the cues say
  "top of the range *at 2 RIR*", not just top of the range, so a set ground
  out to failure doesn't count even if the rep number matches. A logged `0`
  RIR chip says so directly; with no RIR logged, the rep-decay flag stands
  in for it; and a set marked as a *forced* weight drop counts whatever the
  chip says, because having to strip the stack to finish the reps is not an
  inference about the set, it is a record of the weight being too heavy.
  Any of those signals withholds the add and falls back to a plain copy
  instead, and the status line says so ("… pero no sube — hubo que bajar
  peso, o la última serie parece que fue al fallo y no a 2 RIR").

Everything above is keyboard reachable, the set ticks are real buttons
with pressed state, dialogs close with `Escape`, and pinch-zoom is no
longer blocked.

## The weekly objetivo

Under the sets of every exercise, one line: `↗ objetivo: 65 kg × 6 (de
60×10 a 2 RIR)`. It is the answer to the only question you actually have
standing in front of the machine, and it costs no new input — the reps are
already in the log, they were just being read as a yes/no.

**What it does.** `Copiar pesos` has exactly two answers: last week's
weight, or last week's plus `inc`. Your reps decide which and are then
discarded. Three things follow from that, and the middle one is expensive:

- **Under-loading at the start of a block compounds.** Hit the top of a
  6–10 range at 3 RIR and `+2,5 kg` on a 60 kg lift is +4 %, against the
  ~+8 % the set just said was there. You spend three or four weeks of an
  eight-week block climbing back to where you already were.
- **It can never say "go down."** 75×5 on a 6–10 range copies 75 again,
  and again. The honest number is ~70.
- **Exercises without an `inc` never progressed at all** — which, before
  this, was most of them.

**How it gets there.** It inverts the Epley estimate the charts already
use. Correct last week's set for how close to failure it actually went,
then solve back for the weight that lands you at the *bottom* of the rep
range at this week's prescribed RIR — the bottom, because that is where
double progression restarts every time the weight goes up:

```
equiv    = reps + RIR                       // 2 RIR ≈ a set to failure 2 reps longer
e1RM     = w × (1 + equiv / 30)             // the same est1RM the charts plot
objetivo = e1RM / (1 + (repsMin + rirEstaSemana) / 30)
```

`repsMin` is the bottom of `ex.reps`; `rirEstaSemana` is dug out of the
free text in `phase[w].r`, so `"2–3 RIR"` reads as 3. Last week's RIR comes
from the chip you tapped; when you didn't tap one, the RIR the plan asked
for that week stands in and the line says so (`a 3 RIR previstos`).

| La semana pasada | Copiar pesos | Objetivo | |
|---|---|---|---|
| 60×10 @ 3 RIR | 62,5 | **65** (+8,3 %) | empezaste flojo, y el set lo dijo |
| 70×10 @ 1 RIR | 72,5 | **75** (+7,1 %) | tope del rango, casi al límite |
| 70×10 @ 0 RIR | 70 | **70** (0 %) | al fallo — mantiene |
| 65×8 @ 1 RIR | 67,5 | **67,5** (+3,8 %) | coinciden, como la mayoría de semanas |
| 75×5 @ 0 RIR | 75 | **70** (−6,7 %) | lo que copiar pesos no puede decirte |

**The guardrails**, in the order they apply:

- **The same failure gate as `Copiar pesos`, with one asymmetry.** RIR 0, a
  forced drop, or a rep decay of ≥3 all mean the set cannot be evidence
  that *more* weight is there, so a proposed increase is withheld and the
  line says why (`— la última serie fue al fallo`). A proposed *decrease*
  is not withheld: grinding out five reps of a 6–10 range at 0 RIR is the
  plainest possible statement that the weight is too heavy, and refusing to
  say so is the bug, not the safeguard.
- **±10 % a week**, applied *after* rounding and by stepping down to the
  bound rather than rounding up through it — otherwise a 2,5 kg step lands
  on 77,5 against a 77,0 ceiling.
- **Rounded to something you can load**: the exercise's own `inc`, else
  your default increment from **Ajustes**, else 2,5 kg / 5 lb.
- **Nothing above 15 reps.** Epley drifts badly up there, so it says `sin
  estimar` instead of inventing a number.
- **`2+` is read as exactly 2.** It's open-ended, so every estimate built
  on it comes out low — the right direction to be wrong in.
- **A move smaller than one increment is `mantener`.** No false precision.
- **Nothing at all in a deload week**, where `phase[w].r` carries no number
  to solve for and proposing a jump would be wrong anyway.

**What it does not touch.** The greyed placeholder in the weight box is
still last week's weight, unchanged. That number has a contract — tick
without typing and it takes that — and it is what makes `Copiar pesos` safe
to press. The objetivo is a line you read, never a number that gets logged
for you.

**One honest limit.** On light isolation work the smallest plate you own is
often a bigger jump than the estimate wants: 12 kg on lateral raises with a
1 kg step wants 12,8. There, adding a rep before adding weight is the
correct mechanism and this adds nothing over plain double progression —
`inc` wins and the line stays quiet with `mantener`.

## Weight drops

Every set row has a **↓** between the rep box and the tick. Pressing it
adds an indented sub-row under that set with its own weight and rep boxes,
and puts the cursor straight in the weight one — one tap, mid-set, with a
hand still on the stack.

Press **↓** again for another segment, up to four, so a triple drop
(`60×8 → 45×5 → 30×4`) is recorded as what it is: **one set** with two
drops, not three sets. **✕** removes a segment; removing the last one
leaves the row exactly as it was before.

Under the segments sit two chips, and which one you pick is the whole
point of recording this:

- **Dropset** — you finished the set, stripped weight and kept going. A
  technique you chose. This is the default.
- **Forzado** — you couldn't reach the target reps at that weight, so you
  dropped and finished them lighter. This one is amber, because it changes
  what the app does next week: it joins `0` RIR and the rep-decay flag as a
  reason for **Copiar pesos de semana anterior** to *withhold* the
  automatic increase, even on a week where every set hit the top of the
  range. A dropset says nothing of the sort and never blocks it.

### What a drop counts as

- **Volume, yes.** The reps after the weight came off still moved weight,
  so they are added to the footer's `kg movidos` — and to the block total
  in the volume view.
- **A set, no.** The progress bar, the "N de M series hechas" count and the
  weekly volume dashboard all still see one set — the dashboard exists to
  compare hard sets against what the plan asked for, and a drop doesn't
  change what the plan asked for.
- **A record, no.** A drop is lighter than the set it came off by
  definition, so it can't win a **RÉCORD** badge and never enters the
  progress chart or the estimated 1RM.

### Where it shows up

Last week's line on the card prints the drops with the set they belong to
(`60×10 ↓45×5`), and so does the CSV export — as two extra columns,
`bajadas` and `tipo_bajada`, rather than extra rows, so `serie` keeps
meaning the set number the plan asked for and every count taken off that
file still matches the app's. Drops travel with a "plan + registro" QR
share; a phone running a version of the app from before this feature will
read everything else in that payload and quietly ignore them.

Drops are stored on the log row itself (`d`, plus `dk` for the kind) rather
than in a side table like RIR, because a drop belongs to one specific set —
so clearing a day, deleting a block, moving an exercise to another day and
**Deshacer** all carry it without any extra bookkeeping.

## Warm-ups and plate maths

**Calculadora**, in the footer, builds a warm-up ramp up to a working
weight: 40%, 60% and 80% of it, then the weight itself. It is tied to no
exercise and reads nothing from your log — type whatever you are about to
lift.

Two modes:

- **Barra** also breaks every step down into the plates that go on *one
  side*, largest first, on top of the bar's own weight. The three warm-up
  percentages are rounded to something you can actually load (twice your
  smallest plate) and never drop below the empty bar. The target row is
  deliberately not rounded: a breakdown for the weight you asked for has to
  add up to it, not to a convenient stand-in. When your plates can't make a
  step exactly, the row says what is missing (`… · falta 1.25 kg`) rather
  than showing a total that doesn't add up.
- **Máquina** drops the plate column and ramps in steps of the stack's
  increment, which you type in — 5 kg / 10 lb to start with.

The bar weight and the plate set live in **Ajustes**, starting at 20 kg /
45 lb and a standard set. Changing the unit does **not** convert them, for
the same reason it doesn't convert your logged weights, so check them if
you have just switched.

## Weekly volume, by muscle, pattern or type

**Volumen muscular**, in the footer, counts the current week's hard sets
and draws one bar per group, biggest first, with the numbers in a table
underneath. Groups sitting at zero are listed too — seeing which of *this
block's own* muscles are getting nothing this week is as much the point as
the ranking.

Three toggles:

| Toggle | |
|---|---|
| **Plan** vs. **Registrado** | what this week asks for, against what you have actually ticked done. **Plan** counts sets the way the session does, so the deload halving and the "+1 set from week N" additions are already in the number. |
| **Músculo** / **Patrón** / **Tipo** | which tag to group by: `ex.muscle`, `ex.pattern`, `ex.type` — see [the JSON shape](#block-json-shape). |
| **Esta semana** vs. **Todo el bloque** | one week's bars, or the whole block as a trend with the growth band drawn on it — see [Volume across the block](#volume-across-the-block). |

The dimensions are orthogonal on purpose. "What does this hit" and "what
shape is this movement" are different questions, and a plan can look
balanced by muscle while being almost entirely isolation work, or thin on
horizontal pressing — neither of which shows up in a muscle-only
breakdown.

Untagged exercises are counted under **Sin clasificar** rather than
dropped. In the **Patrón** view an exercise with no `pattern` falls back to
its `type` first, so isolation work — which rarely has a pressing or
pulling plane worth naming — groups under *Aislamiento* instead of burying
that total among the genuinely untagged.

All three toggles keep the same set of rows, so switching one only ever
moves the numbers. That is what makes plan-against-done readable as
adherence rather than as two unrelated charts.

### Volume across the block

One week at a time answers "what did I do on Monday". It cannot answer the
question you actually have, which is *did chest volume go up across this
block, and is it enough?* **Todo el bloque** answers that: one line per
muscle across every week of the block, and — on the **Músculo**
dimension — the landmarks that turn a number into a verdict.

- **The shaded band is 10–20 hard sets per muscle per week.** Roughly the
  floor for growth at the bottom, and the point past which more sets keep
  helping but with clearly diminishing returns and a rising fatigue bill at
  the top.
- **The dotted line is 6.** Below it you are maintaining, not growing —
  which is fine for legs on an upper-body block, and fatal for the muscle
  the block is supposed to be for.
- **Each row says where that muscle typically sits**, as a median across
  the weeks that count. The deload is excluded, because halving it is the
  point of it, and on **Registrado** so are weeks you have not trained yet:
  a week with nothing logged is not a week of low volume.
- **The current week is the filled dot**, and the deload week is the faint
  vertical line.

These are working ranges from the hypertrophy literature, not precision
targets — individual response varies enough that the point of drawing them
is to find *your* numbers. That is why they are a band you read against
rather than a target the app nags you toward.

It draws small multiples — one sparkline per muscle — rather than a dozen
lines on one chart. On a 375px phone the superimposed version is spaghetti,
and the band can only be shaded legibly behind one series at a time.

The band is a *per-muscle* landmark, so **Patrón** and **Tipo** get the
trend without it: nobody has established a weekly set range for horizontal
pushing. **Sin clasificar** gets a line and a number but no verdict either
— it is a bucket whose members' only shared property is a missing tag.

### Priority muscles

**Editar plan** has a row of chips, one per muscle in the block: tap the
ones this block is actually *for*. They are stored on the block itself
(`block.priority`), not on your profile, because priorities change from
block to block — legs this one, arms the next — and they travel with the
plan through export, QR and JSON import.

The payoff is one line, in amber, at the top of **Todo el bloque**: when a
muscle you marked sits under the band it says so, and if a muscle you
*didn't* mark is sitting over the band it names that one too. That is the
whole complaint — "I'm not growing where I want to" — rendered as two
numbers instead of a feeling.

They are chips rather than a text field because the taxonomy is freeform
everywhere else and a typo would silently mark nothing. A muscle you
marked whose exercises have since been retired keeps its chip, so you can
un-mark it rather than leaving it set invisibly.

The shipped plans come with theirs already marked — `Pecho`, `Espalda`,
`Hombro` on the men's, `Glúteo`, `Cuádriceps` on the women's — matching
what each plan is documented to be built around. `Isquios` is deliberately
left unmarked on the women's plan: at 7 direct sets a week it sits under
the band, so marking it would open a fresh install on a warning about its
own shipped plan. Mark it yourself and the dashboard will say exactly
that, which is the feature working rather than a bug.

### Kilos moved so far

Above the bars sits the other half of the volume question: not how many
hard sets, but how much weight has actually gone up and down. The session
footer already reports the day's `kg movidos`; this strip is the same
number added up over the block — the block total, and this week's share of
it on its own — so a week that felt light next to the one before it has a
figure attached.

It is the same arithmetic as the footer line, `weight × reps` over every
set you have ticked done, drops included. Three things follow from that:

- It ignores the **Plan** / **Registrado** toggle. Tonnage only ever comes
  from what was ticked; the plan has no weights in it to total up.
- It counts sets logged against **retired exercises and extra sets** too,
  which the bar chart deliberately doesn't. Dropping an exercise from the
  plan doesn't unlift the sets you already did.
- Weeks past the end of a shortened block are left out, the same as
  everywhere else they're hidden — the "series en semanas por encima"
  notice in the session is what speaks for those.

Until a second week has kilos in it the strip shows one figure rather than
printing the same number twice.

## Diagnóstico

Twenty-two exercises, each with its own chart behind its own button. Nobody
opens twenty-two charts — and the diagnosis was never inside any one of
them anyway. It lives in the comparison, and nothing was making it.

**Diagnóstico** in the footer fits a line through the estimated 1RM of
every exercise in the current plan at once and sorts them **worst first**:
`bajando` · `plano` · `subiendo`. Like everything else here it asks for no
new input — it reads the weights, reps, RIR chips and timestamps you are
already recording.

- **The slope** is least squares over the last 6 sessions, expressed as a
  percentage of that exercise's own average e1RM, so a lateral raise and a
  leg press are comparable. Inside ±0,5 % per session is flat.
- **Fewer than 3 sessions gets no verdict at all** — two flat weeks is
  noise, not a stall.
- **Sets above 15 reps are dropped**, not plotted: Epley drifts up there,
  and one 20-rep back-off set would fake a trend that never happened.
- **Este bloque / Todos los bloques** switches between the current block's
  history and everything you have ever logged for those exercises.

The ranking on its own would still just be a list. What makes it a
diagnosis is the second half: each trend is crossed with what the log says
about *how* those sessions went, and the reading and the fix come from
that. The two right-hand columns below point at opposite changes, which is
exactly why guessing at a stall goes wrong.

| e1RM | Señal en el registro | Lectura | Qué cambias |
|---|---|---|---|
| plano | objetivo por debajo del peso actual | Peso mal elegido | Baja al objetivo y sube el rango de reps como es debido |
| plano | RIR 0, o una bajada forzada | Fatiga, no falta de esfuerzo | Mismo peso, vuelve a 1–2 RIR. Apretar más es la palanca equivocada |
| plano | caída de reps ≥3 | Primera serie al fallo | Empieza más ligero para que las series 2 y 3 sumen volumen |
| plano | RIR 2+ repetido | Falta intensidad | Sube carga o reps: te dejas el estímulo sin usar |
| plano | ninguna | Estancado sin señal clara | Marca el RIR unas semanas — sin eso no se distingue fatiga de falta de intensidad |
| bajando | huecos >7 días de mediana | Asistencia, no programa | Nada que tocar en el plan |
| bajando | sin huecos | Pierde fuerza de verdad | Si varios ejercicios bajan a la vez, mira el descanso y lo que comes — eso la app no lo ve |
| subiendo | el músculo va bajo la franja | Margen sin usar | Va bien con pocas series — si añades, añádeselas ahí primero |
| subiendo | — | Funciona | No toques nada |

The volume row reads **Registrado**, not **Plan**: "you have room to add
sets" is a claim about the sets you actually did.

The signals are read off the most recent sessions rather than the whole
window, because what you change on Monday answers to how last Monday went.
The gap check is a **median**, so one holiday in the middle of a block
doesn't relabel a perfectly attended exercise as an attendance problem.

Two exercises can share a name — the same lateral raise on two different
days — and they get one row each, computed separately.

## Editing a block mid-way

A block you are three weeks into is not frozen. **Editar plan** lets you
change the plan of the *active* block — add or drop a set, add or remove
an exercise, move one to another day, add, remove or reorder days — and
the sets you have already logged survive all of it. Nothing you edit there touches the log until
you press **Guardar cambios**, and closing with **Cerrar sin guardar**
throws the whole draft away.

What happens to your history in each case:

| Edit | Logged sets |
|---|---|
| Rename an exercise or a day, change reps/rest/cues/flags | untouched — the log follows the exercise, not its name |
| Reorder exercises, reorder days | untouched — they move with the item |
| **Send an exercise to another day** (**Enviar a…**) | untouched — it keeps its id, and its logged sets are moved over to the new day when you save |
| **Drop a set** (4 → 3) | the 4th row's numbers stay saved and hidden; the session shows a note saying so, and putting the set back brings them straight back |
| **Add a set** (3 → 4) | the new row is empty, everything else stays |
| **Remove an exercise or a day that has logged sets** | it is *retired*: out of the plan and out of the session, log kept, listed under **Retirados** at the bottom of the editor with a **Restaurar** button that puts it back exactly where it was |
| Remove an exercise or a day with nothing logged | just deleted — there is nothing to keep |
| **Borrar registro** on a retired item | the only edit that erases logged sets, and it asks first |

So "I want to swap this exercise out but keep what I lifted on it" and
"this day is not working, drop it" are both safe: remove it, keep
training, and restore it later if you change your mind. If you would
rather start clean, **+ Nuevo bloque** still copies the current plan
into a new block and leaves this one's history where it is.

Two things still work the way they always did: **Borrar este día**
clears one week's log for the day you are on, and **Borrar todos los
datos** clears a profile's whole log while leaving the plans in place.

## Deleting blocks you no longer want

**Gestionar** (in the block bar) lists every block of the current
profile with its creation date, how many days it has and how many sets
are logged in it, and deletes the ones you don't want — the trial runs,
the imports you did twice, the block you abandoned in week 2.

The rule is that deleting a block you are *not* training does not move
you: the active block keeps its log, its week and its day, and the
session behind the sheet does not change. **Dejar solo el bloque
actual** does that in one go — it deletes every other block of the
profile and leaves the one you are on untouched. Every delete asks
first, and says how many logged sets go with it.

Deleting the block you *are* training is still allowed (it is what
**Eliminar este bloque** in the plan editor does): its log goes with it,
and the app moves you to the newest block left, at week 1 day 1. A
profile always keeps at least one block, so the last one cannot be
deleted.

When several blocks share a name — which is what happens when you import
the same file twice — the picker adds their position and creation date
(`Bloque 1 (3) · 12 ago 26`) so you can tell which is which before
deleting one.

## Exporting the current plan as a template

**Editar plan** also has **Descargar plan (JSON)**, next to **Guardar
cambios**. It downloads whatever is currently in the editor — including
edits you have not saved yet — as a JSON file shaped exactly like the
`blocks/*.json` templates below: name, weeks, deload, phase and days/
exercises, with no logged sets and no retired days/exercises. That file is
exactly what **Importar JSON** accepts, so it is the way to turn a block
you have reshaped into something you can keep, hand to someone else, or
commit to `blocks/` as a new template.

Because it reads the live draft, exporting runs the same checks **Guardar
cambios** does — a day with no exercises, or an exercise missing its name
or rep range, is refused with the same message rather than shipped broken.

## Importing blocks from JSON

Instead of building a training block by hand in the plan editor, you can
generate one as JSON and import it via the **Importar JSON** button
(next to **+ Nuevo bloque**). It always imports into whichever profile
(Hombre/Mujer) is currently selected, and never overwrites existing
blocks or logged history — it just adds a new block.

Two ways to get JSON in:

1. **Paste it in** — open **Importar JSON** and paste into the text box.
   Good for a one-off block someone (or an AI agent) hands you in a chat.
2. **Publish it to `blocks/` in the repo** — commit a file there plus
   an entry in `blocks/index.json`, and it shows up as a one-click
   "Importar" option, fetched read-only from `raw.githubusercontent.com`
   (no token, no write access from the app itself). This is the intended
   path for a training agent with commit access: it commits a new block
   file, and the block is available in the app the next time the sheet is
   opened — no copying and pasting.

   The app fetches from **whichever repo is serving it**, worked out from
   the URL, so a fork lists its own blocks rather than this one's. Served
   from anywhere that isn't GitHub Pages (a local server, a custom
   domain), it falls back to this repo.

If the person you're sending this to doesn't use the app themselves — a
training partner, a coach — **Importar JSON** also has **Descargar
plantilla JSON**, which downloads `blocks/ejemplo-plantilla.json` as a
file, and **Copiar prompt para tu IA**, which copies a self-contained
prompt describing the block JSON shape (field names, limits, a worked
example) to the clipboard. They paste that into their own AI chat along
with their goals, and paste the JSON it returns into **Importar JSON**'s
text box.

`blocks/index.json` is a flat list:

```json
[
  { "file": "hombre-bloque-1.json", "label": "Hombre — Bloque 1 (plan de inicio)" },
  { "file": "mujer-bloque-1.json", "label": "Mujer — Bloque 1 (plan de inicio)" },
  { "file": "ejemplo-plantilla.json", "label": "Ejemplo — plantilla de bloque" }
]
```

`hombre-bloque-1.json` and `mujer-bloque-1.json` are exported copies of
the built-in default plans (see `js/data.js`) — handy if you want a
fresh copy of Bloque 1 as a new block, e.g. to restart a program from
scratch without losing the original's history.

## Los planes por defecto

The two profiles have deliberately different priorities, and the day
split follows from them: the men's plan prioritises upper body and
treats legs as maintenance, the women's plan prioritises legs and keeps
each muscle on a single day.

Every exercise in both plans declares an `inc` — the smallest step that
machine can really be loaded with, 1 kg on cable lateral raises, 2,5 on the
machine presses, 5 on the hack squat, leg press and hip thrust. That is
what double progression adds when you hit the top of the range, and what
the weekly objetivo rounds to. Only new installs get them: an existing log
is never rewritten, so set them yourself in **Editar plan** if you started
before this.

**Mujer — músculos separados por día.** Each muscle is trained on exactly
one day of the week, counting the indirect work compounds do. The plan
groups the muscles that unavoidably work together and keeps everything
else apart:

| Día | Músculos |
|---|---|
| 1 · Pecho + Hombro | pecho, deltoide anterior y lateral, tríceps |
| 2 · Cuádriceps + Espalda | cuádriceps, dorsal, deltoide posterior, bíceps |
| 3 · Glúteo + Isquios | glúteo, isquios, gemelos, core |

Biceps sit with back, and triceps with the presses, on purpose — that's
what *reduces* their exposure. Splitting them onto their own day would
mean the pulls hit them indirectly on one day and the curls hit them
directly on another. Glutes are the single exception: hack squats and
leg presses train them whatever you do, so they appear on two days. They
are also the priority muscle, so that's a feature.

Leg volume lands at 31 sets (42% of the week), split as 10 quad sets on
day 2 and 21 posterior-chain, calf and core sets on day 3. Days run
23 / 26 / 24 sets.

Her day 2 is the one adjacency the order can't avoid: hack squats and
leg presses train glutes, so the glute day that follows it starts on
legs that aren't completely fresh. With a rest day in between that's
about 48 hours, which is enough.

**Hombre — enfoque superior.** Around 67 hard sets a week go to upper
body — chest 15, back 14, biceps 11, lateral delts 8, triceps 8, rear
delts 7 — with every upper muscle trained twice a week. Legs get 11 sets
of maintenance work. Calves and core are left out on purpose; add them
in the plan editor if you want them.

His days are arranged around hers so the couple stations line up. Both
profiles run the same number of exercises per day — 7 / 8 / 7 — so the
two sessions finish together, and 15 of those exercises are shared,
spread 6 on day 1, 7 on day 2 and 2 on day 3. The cost is that his quads
and hamstrings get one session each; for 11 sets of maintenance work
that's a fair trade for training together.

Shared exercises don't have to carry the same number of sets — most of
them don't. Whoever has the extra set does it while the other resets the
machine.

**Order.** The week opens with the push day. Lateral raises sit between
the two presses on it: with no rows that day there is nothing else that
lets the front delts and triceps recover between the chest press and the
shoulder press, and lateral raises barely touch either. On her day 2 the
quad work comes first, ahead of the back work, since legs are the
priority.

**Progression.** Both week banners state the double-progression rule
explicitly (hit the top of the rep range on every set → add the smallest
increment next week) and restrict week 7's to-failure sets to machines
and isolation work rather than hack squats, RDLs and heavy hip thrusts.

The two RIR ramps differ, because the two lifters do. His runs 3 RIR in
week 1 down to 0–1 by week 7. Hers starts at 4 and ends at 1–2, which is
a real progression from where she actually trains rather than a number
she'd read past. Week 3 carries the part that matters: one set to true
failure on the pec deck, where failing is safe and costs nothing.
Self-reported RIR is unreliable until you have felt the end of a set —
novices routinely call a genuine 1–2 RIR "four" — so that single set is
what makes every other number on her scale mean something. If it turns
out she was closer to failure than she thought, the targets correct
themselves from week 4 on.

Run the three days with a rest day between them (e.g. Mon / Wed / Fri).

### The trade-off in the women's plan

One muscle per day means one *session* per muscle per week. Training a
muscle twice a week beats once when weekly volume is held equal, so this
costs something — though the effect is small, and it doesn't apply to
work you wouldn't otherwise do. It also caps useful volume: a muscle's
whole week now has to fit in one session, and past roughly 10 hard sets
in a single session the extra ones do much less. That's why quads sit at
10 and not 14.

If separation stops mattering more than the extra frequency, edit the
plan in **Editar plan** — or import a new block and leave this one's
history intact.

### Block JSON shape

```json
{
  "name": "Bloque 2",
  "days": [
    {
      "name": "Día A — Empuje",
      "pair": "Optional note shown for a shared/couple's session on this day.",
      "ex": [
        {
          "id": "chestpress",
          "n": "Press de banca con barra",
          "alt": "o press de pecho en máquina",
          "cue": "Optional coaching cue.",
          "setup": "Optional machine setting, e.g. \"asiento 4, respaldo 2\".",
          "muscle": "Pecho",
          "pattern": "Empuje horizontal",
          "type": "Compuesto",
          "sets": 4,
          "reps": "6–10",
          "rest": 150,
          "add": 4,
          "inc": 2.5,
          "share": 1,
          "ss": 0
        }
      ]
    }
  ],
  "priority": ["Pecho", "Hombro"],
  "phase": {
    "1": { "r": "2–3 RIR", "t": "Text shown for week 1's goal." },
    "8": { "r": "Descarga", "t": "Text shown for week 8 (deload)." }
  }
}
```

Field notes:

- `name` (block): optional, defaults to "Bloque importado".
- `days`: required, at least one. Any number of days works, though the
  day-picker layout is tuned for 3.
- `day.name`: optional, defaults to "Día N".
- `day.pair`: optional, free text.
- `day.id`: optional — the key logged sets are filed under, so the day
  survives being reordered later. Auto-assigned if omitted; leave it out
  unless you have a reason not to.
- `ex.n`: **required** — exercise name.
- `ex.reps`: **required** — a string like `"6–10"` or `"12-15"`.
- `ex.id`: optional — auto-generated by slugifying `n` if omitted (and
  de-duplicated if it collides with another exercise in the block). Only
  matters for matching "last time" history within the same block, so
  it's safe to leave out.
- `ex.sets`: optional, defaults to `3`.
- `ex.rest`: optional, seconds, defaults to `90`. Use `0` for exercises
  chained into a superset.
- `ex.add`: optional — from this week number onward, one extra set is
  added automatically (mirrors the built-in blocks' progressive-overload
  pattern). Must be a whole number ≥ 1 — a decimal (`2.3`) rejects the
  whole import with an error rather than getting silently rounded, because
  a rounded `add` used to rewrite the program's set count without saying
  so.
- `ex.inc`: optional, decimals allowed (e.g. `2.5`) — the smallest weight
  step this exercise can actually be loaded with. It does two jobs: it is
  what **Copiar pesos de semana anterior** adds once every set hit the top
  of `ex.reps` the week before (double progression), and it is what
  [the weekly objetivo](#the-weekly-objetivo) rounds to. Clamped to 0.25–50
  in whatever unit the profile uses, rounded to the nearest 0.25. Omitted,
  both fall back to your default increment from **Ajustes** (2,5 kg / 5 lb
  out of the box) — so it is worth setting per exercise where the real step
  differs: 1 kg on cable lateral raises, 5 kg on a leg press.
- `priority` (block): optional list of muscle names — the muscles this
  block is *for*, using the same freeform names as `ex.muscle`. Trimmed,
  de-duplicated and capped at 12; anything blank or unrecognisable is
  dropped rather than rejecting the import. Nothing checks that a name has
  exercises under it — a name with none simply never gets flagged. See
  [Priority muscles](#priority-muscles).
- `weeks` (block): optional, 1–16, defaults to `8`.
- `deload` (block): optional — the week number whose sets are halved. Use
  `0` for a block with no deload. Defaults to `8` on an 8-week block and
  to none on any other length.
- `ex.share` / `ex.ss`: optional flags — `1` marks the exercise as a
  shared/couple's station ("JUNTOS") or part of a superset ("SS").
- `ex.alt`, `ex.cue`: optional free text.
- `ex.setup`: optional free text (max 200 characters) — machine settings
  (seat height, pin position) rather than a technique reminder, which is
  what `cue` is for. Shown collapsed in the session, behind a `⚙` button,
  and editable inline from there.
- `ex.muscle`: optional free text — which muscle the exercise counts
  towards in the weekly volume dashboard (e.g. `"Pecho"`, `"Espalda"`).
  This is an anatomical grouping: hack squat and leg press both count as
  `"Cuádriceps"`, RDL and leg curl both count as `"Isquios"`, because
  that's the muscle each one is actually there to grow, regardless of the
  machine or the movement pattern. Freeform, not a fixed list; left
  unclassified if omitted.
- `ex.pattern`, `ex.type`: optional free text — the same kind of tag as
  `ex.muscle`, but answering "what shape is this movement" instead of
  "what does it hit", and with nothing anatomical about it: `pattern` for
  the movement's plane (e.g. `"Empuje horizontal"`, `"Tirón vertical"`,
  `"Rodilla dominante"`) and `type` for compound vs. isolation (e.g.
  `"Compuesto"`, `"Aislamiento"`). Both are switchable groupings in the
  same volume dashboard as `muscle` — useful because a plan can look
  balanced by muscle while still being thin on compound pressing, or heavy
  on isolation work, and neither shows up in a muscle-only breakdown.
  Freeform, not a fixed list; left unclassified if omitted.
- `phase`: optional — per-week (`1`–`8`) goal text shown in the banner.
  Any week left out falls back to a generic RIR-based default, so this
  can be partial or omitted entirely.

Whatever doesn't validate (missing exercise name/reps, no days, etc.)
is rejected with an inline error and nothing is imported.

Because imported blocks are untrusted input, the importer also enforces
limits rather than taking the JSON at its word. Anything over them is
rejected or trimmed, so a malformed (or hostile) file cannot hang the app
or smuggle markup onto the screen:

| Field | Limit |
|---|---|
| `days` | at most 14 |
| `day.ex` | at most 40 per day |
| `name`, `day.name` | 80 characters |
| `ex.n` | 120 · `ex.reps` 40 · `ex.alt` 200 · `ex.cue` 400 · `ex.setup` 200 · `ex.muscle` 40 · `ex.pattern` 40 · `ex.type` 40 |
| `day.pair` | 1000 characters |
| `ex.sets` | clamped to 1–12 · `ex.rest` to 0–900s |
| `ex.add` | a whole number 1–weeks, or the import is rejected — not clamped |
| `ex.inc` | clamped to 0.25–50, rounded to the nearest 0.25 |
| `phase[w].r` / `.t` | 40 / 400 characters |
| `weeks` | clamped to 1–16 · `deload` must fall inside it, or it's dropped |

`blocks/index.json` entries are checked too: `file` must be a plain
`*.json` name with no path in it, so an entry in that list can only ever
point at a file inside `blocks/`.

## Running locally

No build step needed — it's plain HTML/CSS/JS.

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Serve it over http rather than opening
`index.html` from disk: service workers (and therefore offline mode) are
not registered on `file://`, though everything else still works there.

While developing, the cached service worker will keep serving the old
files. Either tick **Update on reload** in the browser's Application →
Service Workers panel, or bump `CACHE_VERSION` in `sw.js`.

**Bump `CACHE_VERSION` in `sw.js` whenever you change `index.html`,
`css/` or `js/`.** The browser only looks for a worker update when the
worker file's own bytes change, and the shell is served cache-first — so
shipping a new `app.js` beside an untouched `sw.js` leaves returning
users on the old script indefinitely, with the new markup wired to
nothing. This has happened once already, so CI now fails the pull request
when the shell changes and `CACHE_VERSION` doesn't.

## Tests

There is no build step and no framework, so the tests drive the real app
in a real browser and assert the things a person would notice: that it
boots, that a set can be logged and survives a reload, that a hostile
block renders as text instead of running, that broken data lands on the
recovery screen instead of a blank page, and that the rest timer's
controls fit on a 375px phone.

```
npx playwright install chromium     # once
python3 -m http.server 8765 &
node test/smoke.js
```

They also run on every push and pull request
(`.github/workflows/test.yml`). When a bug turns out to have been
invisible from the outside, add a case to `test/smoke.js` rather than
fixing it quietly.

## Project layout

| File | What it is |
|---|---|
| `index.html` | the whole markup: header, session list, and the dialogs |
| `css/style.css` | one stylesheet; all colours are tokens declared at the top, twice (light and dark) |
| `js/data.js` | the default plans, used only on a device's first run |
| `js/block-editor.js` | block CRUD/list, importing a block from JSON, and the plan editor |
| `js/diagnostics.js` | the Diagnóstico screen: e1RM trend per exercise, crossed with the log's own signals |
| `js/profile-transfer.js` | backup/restore and moving one profile between phones as a file |
| `js/app.js` | everything else: state, rendering, QR transfer, calculator, volume dashboard |
| `js/vendor/` | the two QR libraries, verbatim from npm — see the README in there |
| `sw.js` | offline caching; bump `CACHE_VERSION` when releasing |
| `manifest.webmanifest`, `icon.svg` | what makes it installable |
| `blocks/` | blocks published for one-click import |
| `test/smoke.js` | browser-driven smoke tests |

## Known limits

Worth knowing before you plan around them:

- **Spanish only.** Every string lives inline in `app.js`, so translating
  is a real project rather than a patch. This is the biggest wall for
  anyone who finds the app and doesn't read Spanish.
- **No sync.** By design — there is no server. Data can be carried between
  phones by hand, as a file (see [Two phones](#two-phones-one-profile-each))
  or on camera (see [QR](#passing-data-with-the-camera-qr)), but both are
  something you do deliberately, not something that keeps two phones in
  step. A lost phone with no backup is still a lost history — the app
  nudges you after roughly 10 sessions with nothing exported, but it can
  only remind, not force one.
- **The QR transfer is one-way and manual.** It copies what is on the
  sending phone at that moment; it does not merge, and scanning the same
  block twice gives you two blocks.
- **Undo is one level deep** and doesn't survive a reload.
- **Two profiles, no more.** Solo mode hides one; there's no way to add a
  third.

## Hosting on GitHub Pages

Publishing is automated with the workflow at
`.github/workflows/pages.yml` — it deploys on every push to `main`.

One-time setup:

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to `GitHub Actions`.
3. Push (or merge) to `main`. The **Deploy to GitHub Pages** workflow
   runs automatically and publishes the site at
   `https://<your-username>.github.io/heavy-iron/` within a minute or
   two.

You can also trigger a deploy manually from the **Actions** tab
(`Deploy to GitHub Pages` → **Run workflow**) without needing a new
push.
