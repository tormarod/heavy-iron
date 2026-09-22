# heavy-iron — the guide

What every screen does and why it does it that way. The
[README](../README.md) is the technical side: running, testing and
deploying the app, and the [block JSON shape](../README.md#block-json-shape).

## Using it

The app is in Spanish. This is what the screens do.

**First open.** A short setup asks who trains, in kg or lb, and which plan
to start from — then you are looking at week 1, day 1 of a block. Skipping
it keeps the defaults. See [Making it yours](#making-it-yours).

**A session, top to bottom.** Two rows stay stuck to the top of the screen.
The first is who is training and which block — two chips, each opening a
sheet to change it — and **⋯**, which opens the same **Más** sheet the bar
does.
The second is the three days: tap one, or use the arrow keys once the row
has the keyboard. Under the header, `‹ Semana 1 de 8 · 3 RIR ›` is the
week: the arrows step to the one either side, and a tap on the middle opens
that week's goal text and the full strip, where a dot marks every week you
have logged something in. A shared-station note is one line under that
until you tap it, and stays open for the rest of the session. Each exercise
below is one card: its position, its name, and one line saying what it wants
— `4 × 6–10 · desc. 2.5 min · asiento 4`. Under that, one row per set, headed
once by `kg · rep · RIR`:

| Control | What it does |
|---|---|
| the three boxes | the weight, the reps and the RIR of that set. The greyed number in each is what the week asks of it — the objetivo's weight and reps for that set, and the week's own RIR; before there is an objetivo to ask anything, the weight box shows what you lifted on that set the last week you logged it and the rep box shows the plan's range. `22,5` works. Tick without typing and the set takes the **weight** showing; the other two stay empty, because a rep count or a reserve nobody reported is not a measurement. |
| **↓** | records weight coming off *that* set — a dropset, or the drop you needed to finish the reps. Adds an indented row with its own boxes; up to four per set. See [Weight drops](#weight-drops). |
| **✓** | marks the set done, and starts the rest timer. This is the control that counts: only ticked sets feed the chart, the **RÉCORD** badge and the totals. |
| the name | tap it for what the card does not print: the alternative exercise, the amber cue, and the machine settings — seat height, pin position, saved to the plan rather than to the log. The chevron at the end of the plan line is what says it opens. |
| **⋯** | the five things that are not typing numbers: **Progreso ↗** (that exercise's weight, or estimated 1RM, over time — across every day of the block that plans it, see [The same lift on two days](#the-same-lift-on-two-days)), the two ways to move the exercise inside the session, the machine settings, and the calculator. |

**The two actions you use mid-session** sit above the list, where a hand
already on the bar can reach them: **Rellenar con el objetivo** and [the
warm-up calculator](#warm-ups-and-plate-maths).

**The bar**, along the bottom, is four destinations rather than a row of
buttons:

| Destination | What it opens |
|---|---|
| **Sesión** | the page you are already on. A sheet covers the bar while it is open, so the one thing left for this button to do is take you back to the top of the day. |
| **Progreso** | [Volumen muscular](#weekly-volume-by-muscle-pattern-or-type), [Diagnóstico](#diagnóstico) and [Revisión del bloque](#the-block-review). |
| **Plan** | **Editar plan**, **+ Nuevo bloque**, [**Importar JSON**](#importing-blocks-from-json) and [**Gestionar bloques**](#deleting-blocks-you-no-longer-want). |
| **Más** | **Copia de seguridad** (with [moving a profile to another phone](#two-phones-one-profile-each) and [the QR transfer](#passing-data-with-the-camera-qr) inside it), **Ajustes**, **Tema** — a tap cycles **automático** (follow the phone), **claro** and **oscuro**, and the choice rides along in backups — the shortcut to [the pocket alarm](#during-the-session) — and, kept apart under **Zona de peligro**, **Borrar este día** and **Borrar todos los datos**. |

The footer keeps what is not an action: the session note, what is stranded
past the end of the block, the totals line, the save status and the
version.

Once a set is ticked the rest timer takes the bar's place: **−30**/**+30**
move the finish line, **Saltar** ends it, the line underneath names the set
you are going back to and what it is asking for, and **Aviso sonoro** is
the switch for the alarm at zero.

**Week to week.** Fill the rep range at the prescribed RIR, then next week
press **Rellenar con el objetivo** on the same day: it writes the weight
[the objetivo](#the-weekly-objetivo) asks for into every set, which is the
same number the greyed placeholder was already showing. When the block
ends, **+ Nuevo bloque** starts the next one from a copy of the plan and
leaves this one's history where it is. Its first week already has an
objetivo, built on the block before it.

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
  of the current plan, and **Gestionar bloques** to delete the ones you no longer
  want without disturbing the block you are training — see
  [Deleting blocks](#deleting-blocks-you-no-longer-want).
- **A review at the end of each block**, exportable as the prompt that
  writes the next one — see [The block review](#the-block-review).
- **Plan editor**: edit exercise names, alternatives, cues, sets, reps,
  rest time, and shared/superserie flags for the active block, add or
  remove exercises and days, and reorder them — all without losing what
  you have already logged. See [Editing a block mid-way](#editing-a-block-mid-way).
- **Blocks of any length**, 1 to 16 weeks, with the deload week you choose
  (or none at all) — see [Block length](#block-length-and-the-deload-week).
- **Week/day navigation**, rest timer, "fill the week with the objetivo",
  and per-exercise progress charts — for the current block, or across every
  block you have ever run, either as raw weight or as an estimated one-rep
  max (Epley) so a program moving between rep ranges still shows a
  consistent strength trend.
- **A target weight and rep count for every SET, every week**, read off the
  whole history of that exercise rather than guessed: a set that reached the
  top of its range goes up a rung, one the range says is out of reach comes
  down, the rest chase a rep, and a chip beside the line says how much the
  numbers are worth arguing with. See
  [The weekly objetivo](#the-weekly-objetivo).
- **The order the session was actually done in**, corrected with two arrows
  when the machine you wanted was taken — see
  [During the session](#during-the-session).
- **Diagnóstico**: every exercise's strength trend at once, ranked worst
  first and crossed with the signals already in your log, so a stall comes
  with a reason and something to change; how often you actually trained
  each muscle, read off the timestamps already on every ticked set; and one
  strength line per muscle that survives changing machines. See
  [Diagnóstico](#diagnóstico).
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
  on that exercise — by weight, or by estimated 1RM — and the session's
  total volume in the footer — see
  [During the session](#during-the-session).
- **Weight drops on any set**: record a dropset, or the weight you had to
  strip off to finish the reps, without inventing a set that wasn't there.
  Marking a drop as *forzado* makes the [Diagnóstico](#diagnóstico) read
  that session as one taken to failure — see [Weight drops](#weight-drops).
- **Light and dark**, following the phone unless you override it under
  **Más → Tema** — a tap cycles automático, claro and oscuro.
- **Backup / restore**: download a `.json` file with both profiles'
  data, or copy/paste it as text. Restoring replaces everything. There is
  also a one-way **CSV export** for looking at the numbers in a
  spreadsheet. It carries every set you have ever logged, including the
  ones the app hides: weeks past the end of a block you shortened, and
  exercises you have since taken out of the plan, which come after the
  plan's own and with no `orden`.
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
| **Color** | The accent for each profile — ember or cyan (brasa / cian) — so you can tell whose session is on screen at a glance. |
| **Unidad de peso** | `kg` or `lb`. |
| **Plan de partida** | The built-in 8-week example plan; a blank block with one day and one empty exercise; or **Traer un JSON**, which takes a pasted block (with the same template download and AI prompt buttons as [Importar JSON](#importing-blocks-from-json)) and makes it the starting plan for both profiles. A paste that doesn't validate is refused there and then, leaving the sheet as it was. |

Skipping it keeps the defaults and never asks again. Everything except the
starting plan stays editable under **Ajustes**, in **Más** — the starting
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

It is only ever the *fallback* step, and only where the exercise's own
logged weights cannot supply a rung: [the objetivo](#the-weekly-objetivo)
climbs the stack the log already knows about, so on any exercise with a
history the real notches win over both this and `ex.inc`. Where it does
apply — a brand-new exercise, or a jump the stack has never made — a step
too big for the rep range is refused and named rather than prescribed.

**About units.** `kg`/`lb` is a *label*, not a conversion. The app never
touches the number you typed — you write down what's on the machine, and
that is the number the card shows you. Changing it later relabels
everything and rewrites nothing.

What the label does do is get stamped on each set as you log it. That stamp
is only read by the screens that draw one line through many sessions — the
progress chart, Diagnóstico, the block review and the tonnage strip on the
volume dashboard — which convert set by set rather than adding kg and lb
together. So a block you switched units halfway through still reads as one
honest line, and the session view still shows exactly what you typed. The
CSV export takes the same approach from the other end: `peso` is the number
as typed, and `unidad` next to it says which unit that row is in. The stamp
travels with the set, too: a backup you restore, a profile you load and a
block sent by QR all bring an lb set back in lb.

A set and its drops share one stamp, so there is one exception to "never
touches the number". If you switch units and then type into a set logged
in the old one — its weight, or one of its drops — whatever else that set
holds is converted to the new unit (100 kg becomes 220,46 lb), because what
you just typed is in the unit the card now shows. The greyed weight from a
past week, and the one a tick takes when the box is empty, is likewise
shown converted into the unit you use now, so ticking last week's 100 kg
after switching to lb logs 220,46 lb rather than 100 lb.

**About solo mode.** The second profile is hidden, not deleted. Its plan
and history stay in storage and in your backups, so turning two-person
mode back on returns everything exactly as it was.

## Block length and the deload week

A block is 1 to 16 weeks long, set in **Editar plan** alongside its name.
Pick which week is the deload — any of them, or **Sin descarga** if the
block doesn't have one. In the deload week every exercise does half its
sets, rounded up, minimum two; that used to be hardcoded to week 8.

Writing "Descarga" into a week's own goal makes that week a deload too, on
every screen — the DL marker, the banner, the volume view, "¿funcionó la
descarga?" — even if you never touched the field above; a goal that says
"sin descarga" does not.

Blocks saved before this are exactly what the app used to assume — eight
weeks, deload on week 8 — so nothing you already have moves.

Two things worth knowing when you change the length:

- **Shortening never deletes.** Sets logged in weeks the block no longer
  has are kept and hidden, and the session says how many; make the block
  long enough again and they come straight back. It's the same rule as
  dropping a set from an exercise. The CSV export is the one place that
  still lists them.
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
| **Plan + registro** | the same, **plus every set logged against it, with the RIR written on each one** | adds a new block, with that history attached |
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

Two of the things stored there are written by the app rather than by you —
the objetivo it showed you each session, and the names an exercise has been
given over time. Neither asks for any input and both are explained under
[what the objetivo writes down](#what-it-writes-down). They travel in the
backup like everything else, and a backup written before they existed
restores without them rather than failing.

The page is locked down with a Content-Security-Policy that only allows it
to talk to one external host: Google Fonts, for the typefaces. Blocks
published to `blocks/` in this repo are fetched same-origin, relative to
the page, so listing and importing them needs no entry of its own. Nothing
else can be loaded and nothing can be sent anywhere, so your log physically
cannot leave the device except through the backup buttons you press
yourself.

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
- **The browser is asked not to bin it.** By default a site's storage is
  "best effort": a phone short on space may evict it, and a year of
  training is exactly the kind of small, rarely-read data that looks
  disposable from outside. The app asks for persistent storage once, after
  the first setup is saved — installing it is what makes that ask cheap,
  since Chrome grants it to an installed app without asking anybody and
  Firefox shows a single prompt. **Copia de seguridad** says what the log
  weighs and whether the promise was given, and offers the ask again if it
  wasn't. Persistent or not, it is still one device: the download is what
  survives a lost phone.
- **Two tabs don't fight.** If the log changes in another tab, this one
  picks it up; if you had unsaved edits here, it says so instead of
  silently overwriting them.

## Offline and installing

The three typefaces — Barlow Condensed, Barlow and JetBrains Mono — come
from Google, and they are loaded so that they cannot hold the app up: the
stylesheet is parked on `media="print"` — which is not render-blocking —
and switched on once it has arrived. A stylesheet in front of the scripts
holds them back until it resolves, so a slow font host, a captive portal
or a dead connection used to mean a minute of "Cargando tu registro…" from
an app that needs no network at all. Every rule reads one of the three
`--font-*` tokens rather than naming a face itself, and each token carries
its own fallback stack, so the first paint of a cold start is the right
shape in the wrong face rather than somebody's default serif.

The app registers a service worker that caches the page, styles, script
and fonts, so after the first visit it opens with no connection at all —
which is the normal state of a gym basement. The page and its scripts
always come from the same cached release: a new release installs behind
the one you are on and shows an **Actualizar** prompt, and taking it up
reloads onto the new one. Should a shell ever fail to start anyway, the
last script on the page switches to that waiting release by itself. Blocks published in `blocks/`
are fetched from the network first and fall back to the cached copy, so
the list is fresh when you have signal and still works when you don't.

On a phone, **Add to home screen** (Safari), **Install app** (Chrome) or
**Instalar** in the ⋮ menu (Firefox for Android) gives it its own icon and
no browser chrome. Firefox is the fussy one: it ignores the SVG icon and
only offers to install when the manifest points at a PNG whose size it can
read, which is why `icon-192.png` and `icon-512.png` sit next to
`icon.svg`. Updates never swap the code out from under a session: when a
new version has been cached, a small **Actualizar** prompt appears and
nothing changes until you tap it. Ignore it and it comes back on the next
launch, because a new version parked behind the running one only takes
over once every window is closed — and an app you background rather than
quit never closes one. Coming back to the app after a while also looks for
a new version: an app that is resumed rather than relaunched never
navigates, and navigating is the only time the browser checks by itself.
The version running is printed at the bottom of the page, under the
buttons — asked of the worker serving the page rather than read from a
constant, so it says what is actually installed rather than what the code
thinks it is. On a browser too old to answer, or before any worker is in
charge, the line simply isn't there.

## During the session

- **The order you actually did them in.** The plan is a prescription, not a
  record: the bench is taken, so you do the lateral raises first and come
  back to it. The card's **⋯** menu offers **"Hiciste este antes"** and
  **"Hiciste este después"**, each naming the position the card lands in,
  and the number in the square beside the name is the position it was
  actually done in. It is recorded per session, so the same day next week
  starts from the plan again, and only when the sequence differs from the
  plan's — an
  untouched session stores nothing at all. A line above the list confirms
  the change and offers **Volver al orden del plan**, since undoing four
  swaps one arrow at a time is not a way back. Sets stay filed under the
  exercise and not under a position, so moving a card carries its numbers,
  its RIR and its history with it, and the CSV gains an `orden` column
  so you can ask a spreadsheet whether the exercises you do last are the
  ones going nowhere.
- **The weight box already knows what you did last time.** The greyed
  number in it is what you lifted on that same set the last week you
  logged it. Tick a set without typing anything and it takes that number,
  telling you so in the status line — change it if the weight was
  different. The number it shows is [the objetivo](#the-weekly-objetivo)'s
  own weight for that set; on an exercise with no history at all it falls
  back to last week's, and then to the block before. On the first week of a
  new block the band underneath still names the block and week the numbers
  came from, because an objetivo built on a history you cannot see is a
  number out of nowhere.
- **Decimals with a comma work.** `22,5` is stored and charted as 22.5;
  previously the browser threw the whole value away when it saw a comma.
- **RÉCORD** appears on an exercise when a completed set beats the best
  weight you have ever logged for it, across every block of that profile.
  The set's tick turns amber.
- A second badge, **RÉCORD 1RM**, outlined rather than filled, marks a set
  that beats your best *estimated* one-rep max on that exercise without
  beating the weight — the rep progress double progression is made of. It
  only fires once there is an estimate to beat, and never on a set past 15
  reps, where the estimate stops being one. When a set does both, the weight
  badge is the one you see.
- **The footer totals the session**: sets done, kilos moved (weight ×
  reps over every completed set), records, and the date you last logged
  something on this day. Once every set is ticked it also names the
  session after this one: the next day, or after a week's last day the
  first day of the week after. The last day of the block's last week names
  no week past the end. If there is a later block in the picker, the line
  points to its first day, week 1. If there isn't, it points to
  **+ Nuevo bloque** under **Plan**.
- **The rest timer** can be nudged with **−30**/**+30** when the machine
  is still busy, and **Aviso sonoro** turns on the alarm at zero for when the phone
  is face-down or you are wearing headphones. One beep is easy to miss
  mid-set, so it is a burst of four rapid sawtooth pulses — flat and
  klaxon-like rather than a melodic chime, and richer in harmonics than a
  sine at the same volume, which is what carries over gym noise and a tinny
  phone speaker — plus a vibration, repeating about once a second until you
  skip or nudge the timer, or six repeats go by. The countdown runs off a
  wall-clock end time, so it stays correct through a locked screen, and
  while it runs it holds a screen wake lock (where the browser has one) so
  the phone doesn't sleep between sets. Moving to another day, week, block
  or profile ends it, and so does an undo that puts a different session on
  screen.
- **The alarm can follow the phone into your pocket.** Off by default,
  switched on under **Ajustes → "Aviso con la pantalla apagada"**. A page
  the phone has stopped running can't beep, and locking the screen or
  switching to another app stops it running — so with the setting on, the
  app plays a near-silent loop for the length of the rest, which is what
  keeps a page from being frozen. That has a price, said plainly in the
  setting itself: Android hands audio focus to whatever is playing, so on
  some phones it pauses the music you are lifting to. It stops as soon as
  the alarm has had its say, not at the end of the session. While it runs,
  the rest shows up on the lock screen as a media card — what you are
  resting for, when it ends, and the same **−30** / **+30** / skip — and
  the end of the rest also posts a notification, but only when the app is
  out of sight. Coming back to the app takes the notification down.
- **RIR, per set.** A third box in the set row, next to the reps: one
  digit, `0` to `5`, for how that set actually felt. Optional and empty by
  default, same as `share`/`ss`: skip it and nothing changes. It is the
  other half of the RIR target `phase` already prescribes per week — that
  number says what the set was supposed to cost, this one says what it did
  — and the week's own target is the greyed number in the box. Empty it to
  clear it. Anything outside `0`–`5` is refused rather than stored: past
  five in reserve the number stops saying anything a lifter can feel. The
  objetivo prices each set on its own reserve; the Diagnóstico and the
  block review read the last set's as the session's. It travels with a
  "plan + registro" QR share on the row itself, and the `rir` column of the
  CSV export is the set's own value, blank where you typed nothing — a
  session logged before the release that moved the record onto the row
  carries its one chip on that session's last row.
- **A rep-decay warning, for free.** No input needed: if the first set of an
  exercise falls away sharply by the last one, a small line appears under
  the sets — `⚠ caída de 4 reps: ¿primera serie al fallo?` — because that
  drop is usually the first set having been pushed closer to failure than
  the ones after it. Write that first set's RIR and the line stops asking:
  at 0 or 1 in reserve it says the drop is explained, and at 2 or more it
  says it is not — `⚠ caída de 4 reps con la primera serie holgada (RIR 3):
  ¿descansos cortos?` The threshold is **proportional**: a quarter of the
  first set's reps, with a floor of 2. At a fixed load with real rest sets
  taper by something like 10–25 % by the fourth one, so `15·15·12·12` is an
  ordinary session and `8·7·6·5` is not, even though both "drop 3 reps".
  Judging it on the absolute number alone flagged every high-rep machine
  session as a first set taken to failure. It no longer *decides* anything
  — the objetivo measures the drop between sets properly now, and this line
  names the one thing that measurement cannot: that the first set of the
  session you are in was probably taken closer to failure than the rest.
- **An objetivo for this week's weight and reps, also for free.** Under the
  sets, in the same voice as the rep-decay line, one answer per set:
  `↗ objetivo: 47,25×9 · 45×9 · 45×8 · 42,75×9`. The reps decide whether
  each set goes up, down or holds; the RIR scales what those reps were
  worth; the estimated 1RM only sizes the step once it has been earned. See
  [The weekly objetivo](#the-weekly-objetivo) below for what it does and
  does not claim.
- **Energía, three chips before you start.** `baja` / `normal` / `alta`,
  asked at the top of the session rather than inside it, because how you
  arrived is a different question from how it went. Optional and absent by
  default. It is never fed into any estimate and
  never plotted as a line — it comes back as context in the block review
  ("las sesiones flojas movieron un 18 % menos"), which is all an optional
  input can honestly support.
- **A note per session.** One free-text line under the sets: *dormí 5 h*,
  *sin desayunar*, *gimnasio a reventar*. Worthless the day you write it
  and the only thing that explains a dip in the chart six weeks later. It
  is prose nobody averages, so a session you skip it on costs nothing.
  The last one you wrote on this same day comes back under the box the next
  week — `Sem. 2: rodilla izquierda en la hack` — so the thing that explains
  the dip is in front of you when you are about to repeat it. It is also in
  the CSV, repeated on every row of that session, as `nota`, beside an
  `energia` column for the chip.
- **After a deload, whether it worked.** Standing on the week after a
  deload, one line says how the same exercises came back compared with the
  week before it — matched pairs, so a swapped machine cannot fake it. It
  is the only evidence there is about whether your deloads are the right
  length.
- **A ↓ on every set, for the weight that came off.** See
  [Weight drops](#weight-drops) below.
- **Ajustes de máquina**, behind the name. Tapping an exercise's name — the
  chevron beside the plan line marks it as something that opens — gives you
  a one-line field for seat height, pin position — whatever you'd otherwise
  have crammed into the technique cue — along with the alternative exercise
  and the technique cue themselves. The card's own line previews what is in
  it, so you rarely have to open it at all. It is a plan field, not a log
  one: editing it here writes straight to the exercise, same as **Editar
  plan** would, just from where you actually notice it needs setting. The
  **⋯** menu opens the same fold with the cursor already in the field.
- **Rellenar con el objetivo writes what the objetivo says**, set by set.
  It calls the same rule the line under the sets shows and the same one the
  placeholder in each weight box shows, so the three can never disagree:
  the sets that earned a rung get it, the sets the range says are out of
  reach come down one, and the rest keep their weight. The status line says
  how many exercises moved which way. It used to carry its own inline copy
  of double progression — top of range plus `ex.inc` — which could only
  ever answer "same weight" or "one increment more".

Everything above is keyboard reachable, the set ticks are real buttons
with pressed state, dialogs close with `Escape`, and pinch-zoom is no
longer blocked.

## The same lift on two days

A plan can put the same exercise in two sessions — the block that ships
with the app does exactly that, with lateral raises on the push day and
again on the third. Until now each of those had its own history and
neither could see the other: the log is keyed
`blockId → w{week}-{dayId} → exId`, so the `dayId` in the slot walls them
apart. You pressed 22,5 on Monday and Thursday's card still said the last
time was 20.

**What makes two rows the same lift is the plan, not the log.** A block
written as JSON gives its exercises readable ids (`chestpress`), so both
rows carry the same one. Rows added in the plan editor get a fresh `uid()`
each and share nothing but the name — which is why the shipped block has
`lat1` and `lat2` under one name. So both are matched: the id when it
matches, the name when it does not. Renaming one of them is how you say
they were never the same lift.

**The history merges. The target does not.** Two things change:

- The card shows a **second history band** under the first, tagged with
  the other session's day (`SEM. 2 · PECHO/BRAZO…`). The first band is
  still this session's own last time.
- **Progreso ↗**, in the card's **⋯** menu, plots every session of that
  lift in the block on one line. A week can now hold two points, which a
  week axis has nowhere to put, so for these lifts the axis counts
  sessions and the labels name the day (`S3 · Empuje`). A lift planned on
  one day only keeps the week axis exactly as before.

[The objetivo](#the-weekly-objetivo) keeps the two days apart inside the
block, and that is the whole reason the card keeps two bands instead of
merging them into one. The same machine done first on Monday and fourth on
Thursday, after everything that came before it, is not the same set:
pre-fatigue on a machine press is worth 10–20 %, and the two slots are
often prescribed different rep ranges for different jobs. Feed the fresher
day's numbers into the tired day's target and the app prescribes a weight
you cannot hit, then reads the miss as a decline. Across *blocks* the day
is not part of the key, because an earlier block's days were renumbered by
whoever wrote it and matching on them would throw the history away rather
than separate it.

So the app puts both sessions in front of you and draws no conclusion from
the comparison. Whether Thursday should chase Monday is a judgement about
fatigue and exercise order that the log does not contain, and it stays
yours.

## The weekly objetivo

Under the sets of every exercise, one line — and one answer per set:

```
↗ objetivo: 47,25×9 · 45×9 · 45×8 · 42,75×9 · 42,75×8   confianza media
   Esta semana pide más RIR: las reps pueden bajar y no es retroceso.
```

It answers the only question you actually have standing in front of the
machine, and it costs almost no new input. The weights and reps are in the
log, the RIR is optional — per set, with the week's own prescription
standing in — and the range, the step and the phase text are in the plan.

**Double progression is still rep-first.** The reps decide the case and the
estimated 1RM only sizes the step, and only once the reps have earned the
move. An estimator driven off e1RM alone tells a lifter who put up
`32×15/15/12/12` on a 10–15 range to jump to 35 kg and start again at 10 —
throwing away two sets of 15 he already owns and restarting him at the
bottom of a range he never finished.

What changed is how much evidence goes into each decision, and how many
decisions there are. The rule used to price ONE weight for the whole
exercise off the LAST set of LAST week. That is a single session spent on a
question the log has months of data for, and it froze two shapes of session
solid: the one that ends every set at the top of the range (nothing left to
compare, so nothing moved) and the one whose first set is plainly stronger
than its fourth (one weight for both, priced off whichever end the rule
happened to read).

### What a set is worth — and when it is only a floor

Every set is read as an estimated 1RM with the session's reserve added back
in, which is what it would have been worth taken to failure:

```
e = w × (1 + (reps + rir) / 30)      Epley, the same est1RM the charts use
```

A set is **censored** — a floor under the capacity rather than a reading of
it — when any of these is true:

| | why |
|---|---|
| it ended at the top of the rep range | it was cut off there; it never went near failure |
| you wrote 2 or more in reserve | open-ended: it may have been four |
| nothing was written for it | nothing says how close to failure it was |
| it ran past twelve reps | above that the reserve people report stops being reliable |

Every one of those pushes the estimate **down**, which is the safe side: a
target one rep light costs one slightly easy set, a target one rep heavy
costs the session. So a censored set may only ever *raise* the level, never
lower it — a session of `39×15/15/15` at the top of a 12–15 range is not
evidence that you got weaker — and the set that has to guess how much is in
reserve gets one rep of slack when it decides whether the next rung fits.
Without that slack a set that always finishes at the top of its range could
never go up: the estimate it is judged on is the very number being
under-read.

Each of the four rows above is read **per set**, on that set's own number.
A set you left blank takes the reserve of the next set that has one — the
set before a set you took to 0 had at least that much left, so pricing it
there under-reads it, which is the safe direction — and a set with nothing
after it either is the "nothing was written" row. That inheritance is
exactly what the one chip per session used to do to every set, which is why
a log with no per-set values reads precisely as it always did.

**The set worth writing down is the first one.** `level` reads the first set
of each session, so a first set you marked at 0 or 1 is a *reading* the
level can move on, while one marked 2 or more — or left blank — stays a
floor. That is what the `confianza` chip is counting: it climbs from `baja`
to `alta` as the first sets stop being floors.

**And a session you paced now reads as one.** Run four sets at 3 → 2 → 1 → 0
in reserve and the old single chip priced every one of them as if it had
gone to failure: the first set came out worth less than it was, and the
drop across the session looked smaller than it was. Priced per set the
first set is read at what it proved, the decline between sets is the
reserve you really spent, and the last set ends up asked for more rather
than less.

### Three estimates, three different questions

| | what it answers | how |
|---|---|---|
| `level` | what the first set can do today | the best capacity of the last three sessions |
| `phi[k]` | what is left by set k | the median ratio between consecutive sets, over the last six sessions |
| `g` | what one more session is worth | Theil–Sen over the last six, floored at one more rep |

The **level** is a maximum over three sessions, so one bad night cannot move
it and three sessions renew it completely. Going *down* takes more than a
bad night: a session at least 5 % under the best of the three before it, read
off a set that was not censored. One of those holds the load where it is —
nothing goes up for that exercise (`La última sesión bajó: hoy no sube la
carga`) — though a set the range says is out of reach still comes down a
rung. Two in a row is the level itself moving, and the line says so.

**`phi[k]` is measured between consecutive sets and in capacity, not in
reps** — which is what lets a back-off set at another weight count. `45×9`
after `45×12` and `42,75×9` after `45×12` say the same thing about fatigue,
and only the ratio of the two capacities knows it. A censored set says
nothing about the drop *into* it, but it does bound the drop *out* of it
from above. On the real chest-press history that comes out as
`1 · 0,952 · 0,929 · 0,904`: the fourth set keeps 90 % of what the first
one was worth. This is also what prices the set `ex.add` brings in
mid-block, which has never been done at all.

**`g` is a rate, and Theil–Sen is the median of the slopes between every
pair of points.** A least-squares line through six sessions is steered by
whichever one went worst; the median of the pairwise slopes is not, which
matters because the one bad session is exactly the point a training log
always has. It is capped at 3 % per session — above that the "trend" is the
learning curve of a new movement, and extrapolating it prescribes a weight
nobody can lift in three weeks. In the first three sessions of a variant the
trend is not read at all, for the same reason. The floor is always one more
rep on the first set: a flat trend still gets asked for a rep, and whether
that ask keeps failing is the Diagnóstico's question, not this one's.

`g` only applies to the sets that **keep** their weight. Going up a rung is
the progression; adding a rep on top of it is asking for both at once.

### One decision per set

```
base   = max(what this set did last time, level × phi[k])
```

Taking the better of the two claims is what stops a pessimistic decay
profile — the kind a calibration week full of back-offs leaves behind — from
prescribing less than the set has already proved it can do. Then:

| when | answer |
|---|---|
| the set reached the top of the range, and the reps still land inside it one rung up | **up a rung**, into the bottom half of the range |
| the model and last week's own reps agree the bottom of the range is out of reach | **down a rung**, up to three |
| anything else | same weight, and the reps `base × (1 + g)` predicts |

**After a step up the target lands in the bottom half of the range**, never
at the top of what the estimate allows. A jump priced off an optimistic
reading would otherwise earn the next jump on the same reading, and two
weeks later the weight is somewhere nobody lifted.

**At the same weight the target never asks for less than was already done**,
minus only what a stricter RIR this week honestly costs **that set**. A set
you did at 3 in reserve, asked for 2 this week, gives up nothing — whatever
the last set of that session was done at.

**A set is never heavier than the set before it.** That is not a refinement,
it is the difference between a prescription and a list of numbers: sets get
harder down a session, never easier.

The clearest case for deciding per set is the one that named the old rule.
`32×15/15/12/12` on a 10–15 range was "mantener" as one weight. As four
decisions it is two sets up and two sets chasing reps:
`↗ objetivo: 34,25×10 · 34,25×10 · 32×11 · 32×11`. The other half of the
argument is the chest press, whose first set sat capped at 12 reps for
weeks: for all four sets to reach 12 at once, the first would have to be
good for 16,5 reps to failure — four to six reps past the range it is being
measured in.

### The ladder is the stack, not the ruler

`ex.inc` says what one step is worth, but a plate stack is not a ruler: the
lateral raise goes 18 → 19 and the pec deck goes 39 → 45 → 52. The weights
already logged against an exercise **are** the stack, so the next rung up is
the lowest of them within one and a half steps, and only when there is none
does `ex.inc` have to invent one. That is what keeps a 2,5 kg default from
proposing 20,5 on a machine whose next pin is 23, and what lets a 1 kg
micro-plate be a real rung.

When the only step available overshoots the range, the line says so instead
of prescribing a jump nobody can make: `El siguiente escalón (9,3 kg) no
cabe en el rango: micro-carga, medio escalón o más tempo`.

### Coming back, and going down

**A layoff of more than ten days repeats the last session, set by set.**
Nothing moves. Three weeks off does not cost a trained lifter maximal
strength, and discounting it prescribes a week of work already owned —
Rodrigo's chest press came back to its week-3 level in the first session
after two weeks away. Neither is it the week to add anything. The level is
then rebuilt inside the run of sessions since the layoff, because coming
back at 90 % and being measured against the best week of two months ago
prices every set as a failure. `phi[k]` is deliberately *not* cut there:
how much a fourth set gives away is a property of the exercise, not of the
month.

**A deload prescribes half the sets at the bottom of the range**, at the
first rung at or under 60 % of the last session's opening weight — walked
down the same ladder everything else moves on, because 60 % of a stack is
usually not a number the stack has.

### The brake

Three exercises whose latest session is a real decline, inside a week, is
not three programming problems. It is sleep, food or fatigue, and the whole
day says so before any card is read:

```
Esta semana no sube nada: 3 ejercicios han bajado a la vez.
Mira sueño, comida o fatiga antes que el plan.
```

Nothing goes up that day and every exercise's expected gain drops to zero,
which is the cheapest possible way to be wrong about it: one week of
repeating a session you can certainly do. It is worked out once when the day
is drawn and handed to the rule as an argument, so the rule itself never
reads the clock or the other exercises.

### Confidence

A chip beside the line — `confianza baja` / `media` / `alta` — counting how
many of the last six sessions read the first set rather than only bounding
it. Nothing downstream changes with it. It is there because a number built
on six censored sessions and a number built on six clean ones are not the
same number, and the lifter is the one who has to decide how hard to argue
with it.

### What it writes down

Two records, neither of which asks you to type anything:

- **`obj`** — the objetivo that was on the screen, kept once the session
  starts and never rewritten. It holds the confidence, the kind of target
  (objetivo, descarga, vuelta), whether the day was held or braked, and
  each set's weight, reps and arrow — not the notes, the level or the
  trend. It is the only thing that can later tell a back-off the rule
  *asked for* from a weight that had to come off, and the only way to
  measure the rule's own error instead of assuming it.
- **`variants`** — the names an exercise has had, with the date each one
  started. Renaming an exercise in the plan editor usually means a different
  machine or a different groove, and the loads are not comparable;
  everything logged before the current name began stops feeding its target.
  This has to be recorded rather than derived, because the log keeps no copy
  of the name a session was done under.

Both travel in the backup, in a profile file and in the QR "perfil"
transfer, and every reader copes with them missing — which is what every
backup written before this rule looks like.

### The guardrails

They are listed here by what they protect, not in the order the code
applies them — the code first drops what does not count (deload weeks,
sessions before a rename, the other day of a split lift), then answers "no
history, no line", then the deload and the layoff, and only then reads the
week's RIR against the one you typed.

- **`2+` is read as exactly 2**, and a set with nothing written as 0. Both
  come out low, which is the right direction to be wrong in — and both
  censor that set anyway, so neither can raise the estimate on its own.
- **A prescribed range reads as its hard end.** `"2–3 RIR"` is a week you
  are meant to be able to take to 2; reading it as 3 quietly under-loads
  everything built on it.
- **`ex.minRir` is a floor the week cannot get under.** For the lifts nobody
  takes to failure — a squat, a Romanian deadlift — a week prescribing 0–1
  RIR is a number you are not going to follow, and a target solved for it is
  a weight you cannot make.
- **Deload weeks and the sessions before a variant change are out of every
  window.** A deload is ~60 % of the working weight by design and is
  evidence about nothing.
- **A lift the plan puts on two days keeps two histories.** The same machine
  pressed first on Monday and fourth on Thursday is not the same set;
  folding them would prescribe a weight set on the fresher day and then read
  the fatigued one as a decline. Across blocks the day is not part of the
  key, because an earlier block's days were renumbered by whoever wrote it.
- **No history, no line.** The objetivo appears with the first logged
  session and says nothing before it.

**One rule, one place.** `Rellenar con el objetivo` writes exactly these
numbers, set by set, and the greyed placeholder in every weight box shows
the same thing — so ticking a set without typing takes the objetivo, which
is the contract that box has always had with a better number inside it. The
`Diagnóstico` reads this rule's own `level` rather than fitting a second
line through the same log with a different definition of "how strong is this
today". Two screens that disagree in public are two screens nobody trusts.

**What it still does not do.** It never logs anything for you. The line is
something you read and the placeholder is something you can overwrite; the
only way a number reaches the log is you putting it there.

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
  dropped and finished them lighter. This one is amber. It used to veto
  next week's increase outright; it no longer does, and nothing is lost by
  that — the reps done at the working weight are what the level is read
  from, and the stripped ones were never working sets to begin with. What
  it still does is flag the session in the [Diagnóstico](#diagnóstico),
  which is where "why did this happen" belongs. A dropset says nothing of
  the sort and never did.

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

**Calculadora**, above the list (and in every card's **⋯**), builds a
warm-up ramp up to a working
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

**Volumen muscular**, in **Progreso**, counts the current week's hard sets
and draws one bar per group, biggest first, with the numbers in a table
underneath. Groups sitting at zero are listed too — seeing which of *this
block's own* muscles are getting nothing this week is as much the point as
the ranking.

Three toggles:

| Toggle | |
|---|---|
| **Plan** vs. **Registrado** | what this week asks for, against what you have actually ticked done. **Plan** counts sets the way the session does, so the deload halving and the "+1 set from week N" additions are already in the number. |
| **Músculo** / **Patrón** / **Tipo** | which tag to group by: `ex.muscle`, `ex.pattern`, `ex.type` — see [the JSON shape](../README.md#block-json-shape). |
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
  the weeks that count. Deload weeks are excluded, because halving them is
  the point of them, and on **Registrado** so are weeks you have not
  trained yet: a week with nothing logged is not a week of low volume.
- **The current week is the filled dot**, and every deload week is a faint
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
  notice in the session is what speaks for those, and the CSV export,
  the one exception, still lists them.

Until a second week has kilos in it the strip shows one figure rather than
printing the same number twice.

## Diagnóstico

Twenty-two exercises, each with its own chart behind its own button. Nobody
opens twenty-two charts — and the diagnosis was never inside any one of
them anyway. It lives in the comparison, and nothing was making it.

**Diagnóstico**, in **Progreso**, has three tabs — **Por ejercicio**,
**Frecuencia** and **Fuerza** — and all three read entirely off what you
already log.

**Por ejercicio** fits a line through the *level* of every exercise in the
current plan at once and sorts them **worst first**: `bajando` · `plano` ·
`subiendo`. Like everything else here it asks for no new input — it reads
the weights, reps, RIR and timestamps you are already recording.

- **The slope** is least squares over the last 6 sessions of the same
  `level` [the weekly objetivo](#the-weekly-objetivo) is built on,
  expressed as a percentage of its own average so a lateral raise and a leg
  press are comparable. Inside ±0,5 % per session is flat. It used to be
  fitted through the best e1RM of each session instead, and that is a
  different number from the one the target is built on: a session that
  ended `15/15/15` at the top of its range is a *floor* under the capacity,
  and reading it as a measurement reported the pec deck as "pierde fuerza"
  and the shoulder press, the incline press and the Romanian deadlift as
  "planos" while the card right next to them was putting the weight up.
- **A decline the rule has already confirmed outranks the fitted line.**
  Two sessions in a row under the level is the thing the line is trying to
  detect, already detected.
- **A second slope, over kilos per set**, is fitted the same way — see
  [the work axis](#the-work-axis) below.
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
| plano | objetivo por debajo del peso actual (no un reinicio) | Peso mal elegido | Baja al objetivo y sube el rango de reps como es debido |
| plano | RIR 0 en la serie típica de la sesión, o una bajada forzada | Fatiga, no falta de esfuerzo | Mismo peso, vuelve a 1–2 RIR. Apretar más es la palanca equivocada |
| plano | caída de reps ≥3, y la primera serie no apuntada a 2+ | Primera serie al fallo | Empieza más ligero para que las series 2 y 3 sumen volumen |
| plano | RIR 2+ en la serie típica, en dos de las últimas tres sesiones | Falta intensidad | Sube carga o reps: te dejas el estímulo sin usar |
| plano | los kilos por serie suben | Las series de después se ponen al día | Déjalo correr — cuando dejen de sumar, entonces sí es un estancamiento |
| plano | los kilos por serie bajan | Se vacían las series de después | Empieza más ligero, o quita una serie y haz enteras las que queden |
| plano | los kilos por serie tampoco se mueven | Estancado de verdad | Haz lo que mande el objetivo de la semana; si lleva medio bloque igual, cambia el ejercicio |
| plano | ninguna | Estancado sin señal clara | Apunta el RIR de cada serie unas semanas — sin eso no se distingue fatiga de falta de intensidad |
| bajando | huecos >7 días de mediana | Asistencia, no programa | Nada que tocar en el plan |
| bajando | sin huecos | Pierde fuerza de verdad | Si varios ejercicios bajan a la vez, mira el descanso y lo que comes — eso la app no lo ve |
| subiendo | la ficha no sube el peso esta semana | Sube, pero hoy no toca | Mismo peso a la RIR prevista — si las reps vuelven, sube; si vuelve a caer, el nivel se ajusta solo |
| subiendo | el músculo va bajo la franja | Margen sin usar | Va bien con pocas series — si añades, añádeselas ahí primero |
| subiendo | — | Funciona | No toques nada |

"La serie típica" is the median of the RIR you wrote on the session's
working sets. A session paced 3 → 2 → 1 → 0 has a typical set with a rep
in reserve and is not read as fatigue; one ground out at 0 on every set
is. A session where you only wrote the last set's RIR reads exactly as it
did before this: the objetivo's inheritance rule (see [The weekly
objetivo](#the-weekly-objetivo)) gives every earlier set that value, so
its median is that value.

The volume row reads **Registrado**, not **Plan**: "you have room to add
sets" is a claim about the sets you actually did.

The `subiendo` + "hoy no toca" row is not a stall — the trend really did
climb. It is the rule holding the weight for a day, either because the last
session came in under the level or because
[the brake](#the-brake) is on across the whole day, and it reads the
target's own answer rather than re-deriving anything. Before this row the
session screen held the weight while Diagnóstico said *no toques nada* —
one log, two screens, opposite instructions.

The signals are read off the most recent sessions rather than the whole
window, because what you change on Monday answers to how last Monday went.
The gap check is a **median**, so one holiday in the middle of a block
doesn't relabel a perfectly attended exercise as an attendance problem.

Two exercises can share a name — the same lateral raise on two different
days — and they get one row each, computed separately.

### The work axis

The trend fits a line through the **best set** of each session and throws
the rest away. That is the right number for "am I getting stronger", and it
is blind to half of what a session is:

```
semana 1   45×12  45×8  45×6      e1RM 63,0    390 kg/serie
semana 4   45×12  45×12 45×11     e1RM 63,0    525 kg/serie
```

Identical point on the chart. Nine more reps of work, 135 more kilos per
set. Before this the screen called that `Estancado, sin una señal clara`
and sent you to fix a lift that was fixing itself — sets 2 and 3 catching
up is exactly what the weeks after a correct calibration are supposed to
look like.

So each session also carries the **kilos it moved**, and a second least
squares runs over **kilos per set**:

- **Per set, never raw tonnage.** A block that adds a fourth set has not
  made the first three any harder, and raw kilos would report that as
  progress.
- **The reading is withheld unless the set count held still** across the
  whole window. Per-set takes the count out of the total but not out of the
  average — a fourth set is a tired set, so adding one lowers kilos/serie
  and dropping one raises it. Refusing to read it then costs a true flag
  rather than inventing a false one.
- **Its own flat band, ±1,5 % per session**, not the trend's ±0,5 %. e1RM
  moves in kilos; kilos per set move in *reps*, and one rep out of ten is a
  10 % session all by itself.
- **The rep ceiling does not apply.** `EST_MAX_REPS` is a statement about
  Epley, not about kilos: a 20-rep set moved weight whether or not an
  estimate can honestly be read off it.
- **The kilos are `setVolume()`**, the same definition the volume strip
  uses, drops and all. A forced drop therefore *adds* work — but the
  `RIR 0 / bajada forzada` row is checked first and has already claimed
  that session, which is why the work reading needs no special rule for it.

It reads in both directions. A top set that holds while kilos/serie drain
away is fatigue arriving *across* the session rather than within it — the
`caída de reps ≥3` row is the within-session version of the same story, and
it is checked first and wins when both fire.

It only ever speaks in the `plano` half of the matrix. A weight that went
up with the reps reset underneath it drops kilos/serie for a week, and that
is double progression working exactly as designed — so `subiendo` never
consults it.

### Frequency, from the timestamps you already have

Every ticked set carries `r.ts`, and until now nothing read it but one line
in the session footer. **Frecuencia**, the second tab of the same sheet,
turns it into the answer to the question that otherwise eats a whole block:
*is the program not working, or did I only train twice that month?*

At three days a week, one skipped session quietly moves chest from every
~3,5 days to every ~7 — and training a muscle twice a week beats once when
the volume is equal. A lift that stalls on that spacing has an attendance
record behind it, not a programming problem.

It sits in the same sheet as the trend, and the exercise rows carry their
own spacing (`· cada 7 días`) next to the slope, deliberately: a stall and a
nine-day gap have to be read together or the wrong thing gets changed.

Each muscle gets:

- **The median gap between sessions that actually trained it.** Median, so
  one holiday in the middle of a block doesn't relabel an otherwise
  well-attended muscle. A session is a logged day with at least one ticked
  set for that muscle, dated by the first set you ticked in it — which is
  when you were in the gym.
- **Sessions done against sessions planned**, counted over week 1 to the
  week you are on. The current week is included and still in progress, so
  early in a week the percentage reads a little low.
- **What the plan asked for**, as the same kind of gap: a muscle on two of
  your training days is every 3,5 days. When the real spacing is more than
  half a day wider than that, the row turns amber — half a day of slack, so
  a session moved from Monday to Tuesday isn't a lapse.

Above them is a calendar of the block: one column per week, Monday at the
top, each day shaded by how many sets you ticked on it. The shape of the
gaps is the point, and a column of numbers hides it.

Rows sort by worst attendance first, and a muscle you never trained at all
sorts above one you trained every week — it has no gaps to measure, but
zero of eight sessions is the loudest thing on the screen, not the
quietest.

Retired exercises still count toward the sessions you did (they were
trained), but not toward what the plan asks for (they are not scheduled any
more). A ticked set with no timestamp — logged before the app recorded
them, or imported without one — is skipped rather than filed at the epoch.

### Strength per muscle, across exercise swaps

A per-exercise chart fragments every time you change a machine, and over a
year of blocks you will. **Fuerza**, the third tab, gives one line per
muscle instead: *Pecho +8 % en 8 semanas* is the sentence you were actually
after, and it is much closer to "my chest grew" than any single machine's
number.

Two decisions are what make it survive a swap:

- **It indexes to a baseline week rather than plotting kilos.** The first
  week that muscle has anything logged is 100 (usually week 1; a log that
  starts late gets a baseline it can actually use). Different exercises
  carry wildly different absolute loads, and a leg press would drown a leg
  extension in any average of raw weight.
- **Each week is compared to the baseline over the exercises present in
  both** — matched pairs. Averaging whatever happened to be logged that
  week instead would turn every swapped machine into a cliff, which is
  precisely the artefact this view exists to remove. Each row says how many
  exercises its endpoint rests on (`sobre 2 ejercicios de 3`), so the
  number never looks broader than it is.

The average is of each exercise's *own ratio*, not a ratio of averages: an
exercise counts once regardless of what it loads, for the same reason the
index is a ratio in the first place. Sets past 15 reps are excluded exactly
as they are on the trend tab, so one 20-rep back-off set cannot move a
muscle's whole index on an estimate Epley cannot support.

A week with no matched pair breaks the line rather than being interpolated
through — pretending to know is the one thing this view is for not doing —
and a muscle with a single logged week says *sin comparación* instead of
drawing a flat line that would read as "no change".

## The block review

**Revisión del bloque**, in **Progreso**, is the reckoning `+ Nuevo bloque`
never
used to make. Eight weeks of evidence sat in the log and the block written
on top of it was written from memory.

It collects what the other screens already compute, one row per muscle:
strength change from [the index](#strength-per-muscle-across-exercise-swaps),
sessions made against sessions planned from
[frequency](#frequency-from-the-timestamps-you-already-have), sets actually
done against sets prescribed from
[the volume trend](#volume-across-the-block), the deload check, and your
session notes. Priority muscles come first. It invents nothing; it gathers.

Under the muscle rows, the exported text lists every exercise of the plan
with its trend, the RIR you typed on each set — counted as sets, against
the block's own total — and the reading Diagnóstico gives it, so whatever
writes the next block knows which press stalled, not only that chest went
nowhere.

**The export is the feature.** *Copiar prompt con la revisión* hands you
the same JSON-format prompt the import sheet gives out — with the evidence
stapled underneath. Paste it into whatever writes your next block, paste
the JSON that comes back into the box under those buttons — it lands
as a new block, through the same checks **Importar JSON** runs — and the
next block is
written against what actually happened rather than what you remember of
it. There is also *Copiar solo la revisión* and a `.txt` download.

`+ Nuevo bloque` offers it before doing anything else, and only when the
block you are leaving has something logged. The question comes before the
name prompt, so choosing to read it costs nothing you have already typed,
and closing the review picks the new-block flow back up rather than
dropping you on a sheet. Declining goes straight to naming it — the review
is offered, never forced.

### What a deload does to these numbers

A deload week is prescribed at roughly 60 % of the weight, so anything that
measures strength has to refuse to count it, or a block that did exactly
what it was told reads as a loss. Two places had to learn this:

- The **strength index** keeps the deload on the chart — those sets
  happened — but will not use it as either end of a comparison.
- The **fitted trend** on the Diagnóstico tab drops it before fitting, so a
  planned back-off cannot pull an exercise into `bajando`.

Both read the deload the way [the weekly objetivo](#the-weekly-objetivo)
does: the week you picked as the block's deload, and also any week whose
goal in the plan says *Descarga*, even if you wrote it there by hand and
never set the deload week at all. Before, only the picked week was left
out, so a hand-written deload was fitted into the trend like any other.

The volume view already worked this way, for the same reason: halving the
sets is the point of the week, not a lapse in it.

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
| **Enviar a…** a day that already has that exercise | untouched — that day is greyed out, marked *(ya lo tiene)*, or *(lo tiene retirado)* when its copy is under **Retirados**: a day holds an exercise once, since two copies would share one log. To keep it only on that day, remove the copy you were sending (its sets are kept and still count); to replace that day's copy, erase it under **Retirados** first |
| **Drop a set** (4 → 3) | the 4th row's numbers stay saved and hidden; the session shows a note saying so, and putting the set back brings them straight back |
| **Add a set** (3 → 4) | the new row is empty, everything else stays |
| **Remove an exercise or a day that has logged sets** | it is *retired*: out of the plan and out of the session, log kept, listed under **Retirados** at the bottom of the editor with a **Restaurar** button that puts it back exactly where it was |
| Remove an exercise or a day with nothing logged | just deleted — there is nothing to keep |
| **Borrar registro** on a retired item | the only edit that erases logged sets, and it asks first |
| **Guardar cambios** after another tab has saved | untouched — nothing is written: the editor says the data changed in another tab and stays open, and **Editar plan** opened again starts from what that tab saved |

So "I want to swap this exercise out but keep what I lifted on it" and
"this day is not working, drop it" are both safe: remove it, keep
training, and restore it later if you change your mind. If you would
rather start clean, **+ Nuevo bloque** still copies the current plan
into a new block and leaves this one's history where it is.

A block holds at most 14 days, and a day at most 40 exercises, **retired
ones included** — they are still part of the block, and they travel in
every backup. The editor stops there so that whatever you save can always
come back in, from a backup, a profile file, **Importar JSON** or a QR
scan: **+ Añadir día** or **+ Añadir ejercicio** greys out with the
reason underneath, and **Enviar a…** marks a full day *(completo)*. When
retired items are what fills it, make room by deleting one under
**Retirados** (its logged sets go with it), or start the next block with
**+ Nuevo bloque**, which copies only what you train. A block that grew
past the limit before the editor stopped there keeps working and still
restores from its backups; it just can't grow any further.

Two things still work the way they always did: **Borrar este día**
clears one week's log for the day you are on, and **Borrar todos los
datos** clears a profile's whole log while leaving the plans in place.

## Deleting blocks you no longer want

**Gestionar bloques** (in **Plan**) lists every block of the current
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

A profile holds at most **40 blocks**, and this is where room is made.
The limit is what keeps every backup restorable, so every way of adding
a block stops there: at 40, **+ Nuevo bloque**, **Importar JSON** (a
paste or a block from the list), a block scanned by QR and the JSON
pasted back into **Revisión del bloque** say so instead of adding one,
and send you here — **+ Nuevo bloque** with a button that opens this
sheet. Pasting every attempt at an AI-written block is the quick way to
get there, and those attempts are easy to spot: the ones you never
trained say *sin registro*, and deleting one takes no logged set with
it. A profile that went past 40 before the limit existed keeps working
and still restores from its backups; it just can't take another block
until it is back under.

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
generate one as JSON and import it via the **Importar JSON** row of the
bar's **Plan** hub. It always imports into whichever profile
(Hombre/Mujer) is currently selected, and never overwrites existing
blocks or logged history — it just adds a new block, as long as the
profile has room for one (at most 40; see
[Deleting blocks](#deleting-blocks-you-no-longer-want)).

Two ways to get JSON in:

1. **Paste it in** — open **Importar JSON** and paste into the text box.
   Good for a one-off block someone (or an AI agent) hands you in a chat.
2. **Pick one from the list** — blocks published in the repo's `blocks/`
   folder show up in the same sheet as one-click "Importar" options,
   fetched read-only, same-origin (no token, no write access from the app
   itself). This is the intended path for a training agent with commit
   access: it commits a new block file, and the block is available in the
   app the next time the sheet is opened, once the Pages deploy for that
   push finishes — no copying and pasting. How to publish one is in the
   [README](../README.md#publishing-a-block-for-one-click-import).

   The app fetches `blocks/` relative to its own page, so **whichever
   repo is serving it** is whichever repo's blocks show up — a fork lists
   its own rather than this one's — and a block you have already imported
   stays importable offline (the service worker caches same-origin
   `blocks/` requests network-first). Two of the published blocks,
   `hombre-bloque-1.json` and `mujer-bloque-1.json`, are exported copies
   of the built-in default plans — handy if you want a fresh copy of
   Bloque 1 as a new block, e.g. to restart a program from scratch without
   losing the original's history.

If the person you're sending this to doesn't use the app themselves — a
training partner, a coach — **Importar JSON** also has **Descargar
plantilla JSON**, which downloads `blocks/ejemplo-plantilla.json` as a
file, and **Copiar prompt para tu IA**, which copies a self-contained
prompt describing the block JSON shape (field names, limits, a worked
example) to the clipboard. They paste that into their own AI chat along
with their goals, and paste the JSON it returns into **Importar JSON**'s
text box.

Once the app is set up, that prompt also carries your own current block as
JSON — ids included, so the AI can keep the exercises it keeps — and the
facts the app already knows: unit, default increment, bar and plates, days
per week, block length and priority muscles. Only on a first run, before
any setup, does it fall back to the shipped example.

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

## Known limits

Worth knowing before you plan around them:

- **Spanish only.** Every string lives inline in the source, so translating
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
