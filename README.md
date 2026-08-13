# heavy-iron

A simple gym training log for two people, hosted as a static site. No
backend, no build step — everything is saved to `localStorage` in your
browser.

## Features

- **Two profiles** (Hombre / Mujer), each with their own plan, weeks, and
  history.
- **Blocks**: each profile can have several training blocks (e.g. "Bloque
  1", "Bloque 2"). Use **Nuevo bloque** to start the next one from a copy
  of the current plan.
- **Plan editor**: edit exercise names, alternatives, cues, sets, reps,
  rest time, and shared/superserie flags for the active block, without
  touching code.
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
  { "file": "hombre-bloque-2.json", "label": "Hombre — Bloque 2 (equilibrado: pierna, gemelo, core)" },
  { "file": "mujer-bloque-2.json", "label": "Mujer — Bloque 2 (equilibrado: hombro, gemelo, core)" },
  { "file": "ejemplo-plantilla.json", "label": "Ejemplo — plantilla de bloque" }
]
```

`hombre-bloque-1.json` and `mujer-bloque-1.json` are exported copies of
the built-in default plans (see `js/data.js`) — handy if you want a
fresh copy of Bloque 1 as a new block, e.g. to restart a program from
scratch without losing the original's history.

`hombre-bloque-2.json` and `mujer-bloque-2.json` are revised follow-ups
to those two. They keep the same 3-day shape and the shared/couple
stations, but redistribute weekly volume — see
[Bloque 2](#bloque-2--qué-cambia-y-por-qué) below.

## Bloque 2 — qué cambia y por qué

The two profiles have deliberately different priorities, and Bloque 2
keeps them: the men's plan prioritises upper body and treats legs as
maintenance, the women's plan prioritises glutes and legs. What Bloque 2
fixes is the parts that weren't a priority call — volume that was spent
in the wrong place, and ordering that put exercises where they couldn't
be performed well.

**Hombre — enfoque superior.** Upper volume goes from ~53 to ~61 hard
sets a week, mostly by adding a third weekly chest session (dumbbell
press on day 2, so chest goes 12 → 15 sets at 3× frequency) and taking
direct arm work from 6 to 8 sets each. Legs stay at 11 sets, exactly
where Bloque 1 had them — but split across two days instead of one, so
hamstrings are trained twice a week rather than once at the same cost.
Calves and core are left out on purpose; add them in the plan editor if
you want them.

**Mujer — equilibrado.** The glute emphasis is untouched. Lateral raises
go from 0 to 3 sets (there was no side-delt work at all), calves 0 → 7,
core 0 → 3, and abductors 6 → 3, since Bloque 1 spent six weekly sets on
two machines doing the same job.

**Order, both plans.** A row now sits between the two presses on the push
day, so the shoulder press isn't performed on delts and triceps fresh out
of a heavy chest press. Bulgarian split squats move ahead of the leg
curl, and the leg press moves up to second on the women's day 3 — the
exercises that need fresh legs or balance shouldn't be last. The men's
leg work stays late in the session by design; it's maintenance work on
machines, so the position costs little.

**Progression, both plans.** The week banner now states the
double-progression rule explicitly (hit the top of the rep range on every
set → add the smallest increment next week), starts at 3 RIR for
calibration, and restricts week 7's to-failure sets to machines and
isolation work rather than hack squats and RDLs.

Run the three days with a rest day between them (e.g. Mon / Wed / Fri).

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
