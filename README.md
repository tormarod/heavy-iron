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
stations, but rebalance weekly volume — see
[Bloque 2](#bloque-2--qué-cambia-y-por-qué) below.

## Bloque 2 — qué cambia y por qué

Both Bloque 1 plans are upper-body heavy. Counting hard sets per muscle
per week, the men's plan lands around 12 for chest and 13 for back but
only 6 for quads and 5 for hamstrings (hamstrings trained once a week),
with no calf or core work at all. The women's plan is the mirror image:
plenty of glute and leg volume, but zero lateral-raise work, six weekly
sets split across two abductor machines that do the same job, and again
no calves or core.

Bloque 2 keeps the structure, the shared stations and the 8-week
RIR/deload progression, and changes three things:

- **Volume balance.** Hombre: quads 6 → 10 sets, hamstrings 5 → 9 and
  now trained twice a week, calves 0 → 7, core 0 → 3, with chest and
  back trimmed slightly to 10 each. Mujer: lateral raises 0 → 3,
  calves 0 → 7, core 0 → 3, abductors 6 → 3 (one machine instead of
  two overlapping ones); the glute emphasis is untouched.
- **Exercise order.** A row now sits between the two presses on the
  push days so the shoulder press isn't performed on delts and triceps
  fresh out of a heavy chest press. Leg curls move to second on leg day,
  the leg press moves up on the women's day 3, and Bulgarian split
  squats move ahead of the RDL — all so the exercise that most needs
  fresh legs or balance isn't the last thing in the session.
- **Progression.** The week banner now states the double-progression
  rule explicitly (hit the top of the rep range on every set → add the
  smallest increment next week), starts at 3 RIR for calibration, and
  restricts week 7's to-failure sets to machines and isolation work
  rather than hack squats and RDLs.

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
