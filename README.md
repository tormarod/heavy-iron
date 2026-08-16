# heavy-iron

A simple gym training log for two people, hosted as a static site. No
backend, no build step — everything is saved to `localStorage` in your
browser.

## Features

- **Two profiles** (Hombre / Mujer), each with their own plan, weeks, and
  history.
- **Blocks**: each profile can have several training blocks (e.g. "Bloque
  1", "Bloque 2"). Use **Nuevo bloque** to start the next one from a copy
  of the current plan, and **Gestionar** to delete the ones you no longer
  want without disturbing the block you are training — see
  [Deleting blocks](#deleting-blocks-you-no-longer-want).
- **Plan editor**: edit exercise names, alternatives, cues, sets, reps,
  rest time, and shared/superserie flags for the active block, add or
  remove exercises and days, and reorder them — all without losing what
  you have already logged. See [Editing a block mid-way](#editing-a-block-mid-way).
- **8-week week/day navigation**, rest timer, "copy previous week's
  weights", and per-exercise progress charts (best weight logged per
  week).
- **Backup / restore**: download a `.json` file with both profiles'
  data, or copy/paste it as text. Restoring replaces everything.
- **Import a block from JSON**: paste a block definition (e.g. one an
  AI training agent generated for you), or pick one from `blocks/` in
  this repo — see [Importing blocks](#importing-blocks-from-json) below.

## Data & privacy

All data lives only in the browser's `localStorage` on the device you're
using — there is no server and no sync between devices. Each person's
phone/browser keeps its own log. Use the backup feature regularly if you
care about not losing your history (e.g. clearing browser data, switching
phones).

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
2. **Publish it to `blocks/` in this repo** — commit a file there plus
   an entry in `blocks/index.json`, and it shows up as a one-click
   "Importar" option for anyone using the app, fetched read-only from
   `raw.githubusercontent.com` (no token, no write access from the app
   itself). This is the intended path for a training agent with commit
   access to this repo: it commits a new block file, and the block is
   available in the app the next time the sheet is opened — no copying
   and pasting.

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
- `ex.share` / `ex.ss`: optional flags — `1` marks the exercise as a
  shared/couple's station ("JUNTOS") or part of a superset ("SS").
- `ex.alt`, `ex.cue`: optional free text.
- `phase`: optional — per-week (`1`–`8`) goal text shown in the banner.
  Any week left out falls back to a generic RIR-based default, so this
  can be partial or omitted entirely.

Whatever doesn't validate (missing exercise name/reps, no days, etc.)
is rejected with an inline error and nothing is imported.

## Running locally

No build step needed — it's plain HTML/CSS/JS.

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

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
