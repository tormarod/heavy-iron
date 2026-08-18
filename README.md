# heavy-iron

A simple gym training log for two people, hosted as a static site. No
backend, no build step — everything is saved to `localStorage` in your
browser. It installs to a phone's home screen and works with no signal.

## Features

- **Setup on first run**: name the people training, pick kg or lb, choose a
  colour each, and start either from the built-in example plan or from a
  blank block. Reachable afterwards under **Ajustes** — see
  [Making it yours](#making-it-yours).
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
- **Undo** on the three things that destroy data: clearing a day, wiping a
  profile, deleting a block.
- **Works offline, installs like an app** — see [Offline](#offline-and-installing).
- **Session feedback while you train**: last week's weight waiting in the
  box, a **RÉCORD** badge when a set beats everything you have ever logged
  on that exercise, and the session's total volume in the footer — see
  [During the session](#during-the-session).
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
| **Plan de partida** | The built-in 8-week example plan, or a blank block with one day and one empty exercise. |

Skipping it keeps the defaults and never asks again. Everything except the
starting plan stays editable under **Ajustes** in the footer — the starting
plan isn't offered later because by then swapping it would throw away real
history, which is what blocks are for instead.

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
| **Plan + registro** | the same, **plus every set logged against it** | adds a new block, with that history attached |
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
  is still busy, and **Son.** turns on a double beep at zero for when the
  phone is face-down or you are wearing headphones. The countdown runs off
  a wall-clock end time, so it stays correct through a locked screen.

Everything above is keyboard reachable, the set ticks are real buttons
with pressed state, dialogs close with `Escape`, and pinch-zoom is no
longer blocked.

## Editing a block mid-way

A block you are three weeks into is not frozen. **Editar plan** lets you
change the plan of the *active* block — add or drop a set, add or remove
an exercise, add, remove or reorder days — and the sets you have already
logged survive all of it. Nothing you edit there touches the log until
you press **Guardar cambios**, and closing with **Cerrar sin guardar**
throws the whole draft away.

What happens to your history in each case:

| Edit | Logged sets |
|---|---|
| Rename an exercise or a day, change reps/rest/cues/flags | untouched — the log follows the exercise, not its name |
| Reorder exercises, reorder days | untouched — they move with the item |
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
          "muscle": "Pecho",
          "sets": 4,
          "reps": "6–10",
          "rest": 150,
          "add": 4,
          "share": 1,
          "ss": 0
        }
      ]
    }
  ],
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
  pattern).
- `weeks` (block): optional, 1–16, defaults to `8`.
- `deload` (block): optional — the week number whose sets are halved. Use
  `0` for a block with no deload. Defaults to `8` on an 8-week block and
  to none on any other length.
- `ex.share` / `ex.ss`: optional flags — `1` marks the exercise as a
  shared/couple's station ("JUNTOS") or part of a superset ("SS").
- `ex.alt`, `ex.cue`: optional free text.
- `ex.muscle`: optional free text — which muscle the exercise counts
  towards in the weekly volume dashboard (e.g. `"Pecho"`, `"Espalda"`).
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
| `ex.n` | 120 · `ex.reps` 40 · `ex.alt` 200 · `ex.cue` 400 · `ex.muscle` 40 |
| `day.pair` | 1000 characters |
| `ex.sets` | clamped to 1–12 · `ex.rest` to 0–900s · `ex.add` to 1–8 |
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
| `js/app.js` | everything else: state, rendering, plan editor, import, backup, QR transfer |
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
  step. A lost phone with no backup is still a lost history, and nothing
  reminds you to take one.
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
