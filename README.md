# heavy-iron

A gym training log for two people, in Spanish, shipped as a static site.
No backend, no build step: everything is saved to `localStorage` in the
browser, it installs to a phone's home screen and works with no signal.

This file is the technical one: what the repo does, how to run, test and
deploy it, and the block JSON format. Everything about *using* the app —
what each screen does and why — is in **[the guide](docs/guide.md)**.

## What it does

- **Two profiles, or one**, each with its own blocks, plans and history;
  names, colours and kg/lb are set on first run —
  [Making it yours](docs/guide.md#making-it-yours).
- **Blocks of 1–16 weeks** with an optional deload week, and a plan editor
  that never loses a logged set —
  [Block length](docs/guide.md#block-length-and-the-deload-week),
  [Editing a block mid-way](docs/guide.md#editing-a-block-mid-way).
- **A session view** with last week's weight already in the box, a rest
  timer whose alarm survives a locked screen, RIR and energy chips, a note
  per session and **RÉCORD** badges —
  [During the session](docs/guide.md#during-the-session).
- **A weight and rep target for every set, every week**, read off the
  exercise's whole history —
  [The weekly objetivo](docs/guide.md#the-weekly-objetivo).
- **Weight drops** on any set, as a dropset or a forced drop —
  [Weight drops](docs/guide.md#weight-drops).
- **Progress charts** per exercise, as weight or estimated 1RM, within a
  block or across all of them —
  [The same lift on two days](docs/guide.md#the-same-lift-on-two-days).
- **Diagnóstico**: every exercise's trend ranked worst first and crossed
  with the log's own signals, real training frequency per muscle, and one
  strength line per muscle that survives changing machines —
  [Diagnóstico](docs/guide.md#diagnóstico).
- **Weekly volume** by muscle, movement pattern or type, plan against
  done, and the block's trend against the 10–20 hard-sets band —
  [Weekly volume](docs/guide.md#weekly-volume-by-muscle-pattern-or-type).
- **A warm-up and plate calculator** —
  [Warm-ups](docs/guide.md#warm-ups-and-plate-maths).
- **A block review** at the end of each block, exported as the prompt that
  writes the next one — [The block review](docs/guide.md#the-block-review).
- **Blocks as JSON**: import one by pasting it or from the list published
  in `blocks/`, and export the current plan as a template —
  [Importing blocks](docs/guide.md#importing-blocks-from-json),
  [Block JSON shape](#block-json-shape).
- **Backup and restore** as a JSON file or text, a one-way CSV export, one
  profile moved between phones as a file, or anything passed by QR between
  two cameras — [Two phones](docs/guide.md#two-phones-one-profile-each),
  [QR](docs/guide.md#passing-data-with-the-camera-qr).
- **Offline and installable**, light and dark, with undo on the actions
  that destroy data —
  [Offline and installing](docs/guide.md#offline-and-installing),
  [Undo](docs/guide.md#undo).

## How it's built

Plain HTML, CSS and JavaScript: no bundler, no framework, no modules.
`index.html` loads the scripts as `<script>` tags into one shared global
scope, in a fixed order; `js/app.js` is the last but one and wires the
rest together. All state lives in `localStorage`, and `sw.js` precaches
the shell so the app opens with no connection — a new release installs
behind the running one and is offered as an **Actualizar** prompt rather
than swapped under a session. A strict Content-Security-Policy in
`index.html` lets the page reach nothing external but Google Fonts; the two QR libraries
are vendored in `js/vendor/`. Anything that arrives from a file, a paste,
`blocks/` or a QR scan is untrusted: it goes through the
`normalizeImported*` validators and the limits under
[Block JSON shape](#block-json-shape), and is escaped on the way out.

`AGENTS.md` records the invariants that are easy to break and hard to see
— the script load order, the `CACHE_VERSION` rule, which absences are
deliberate. `plans/` holds the implementation plans behind recent changes,
and [Data & privacy](docs/guide.md#data--privacy) in the guide says what
the storage and CSP choices mean for the person using it.

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

There is no build step and no framework, so there are two suites, split by
what they need to run.

The fast half needs nothing at all:

    node test/unit.js

It loads every shell script into one Node context, in the same order as the
`<script>` tags — the same shared scope they create — and asserts the parts that are arithmetic rather
than interface: the schema repair in `migrate()`, the import validators, the
statistics behind Diagnóstico.

The other half drives the real app in a real browser and asserts the things
a person would notice: that it boots, that a set can be logged and survives
a reload, that a hostile block renders as text instead of running, that
broken data lands on the recovery screen instead of a blank page, and that
the rest timer's controls fit on a 375px phone.

```
npm install --no-save playwright@1.56.1   # once
npx playwright install chromium           # once
python3 -m http.server 8765 &                                 # Git Bash
Start-Process python3 -ArgumentList '-m','http.server','8765' # PowerShell
node test/smoke.js
```

The suite is a list of sections, one browser context each, so while working
on one thing you can run just the sections that can see it instead of the
full two-and-a-half-minute pass: `node test/smoke.js --list` names them and
`node test/smoke.js --only "aviso de versión"` runs one (the flag repeats
and matches a case-insensitive substring; `SMOKE_ONLY=a,b` does the same
from the environment). A section whose selectors no longer match is
reported as a failure and the next section still runs.

Or let `tools/smoke-gate.sh` do all of that: it installs Playwright if it
is missing, serves the repo on a free port, runs both suites and stops the
server. It is the same script the Claude Code hook in
`.claude/settings.json` runs before a pull request is opened, and it blocks
the PR when anything fails. It skips itself when the branch touches nothing
the suites load, so a docs-only PR opens without waiting for Chromium.

Only the headless half runs on GitHub (`.github/workflows/test.yml`); the
browser suite needs a Chromium download on every run, so it runs on the
machine the pull request comes from instead. When a bug turns out to have
been invisible from the outside, add a case to `test/smoke.js` rather than
fixing it quietly; when it's arithmetic or data repair, add it to
`test/unit.js` instead.

Working on this with an AI agent? `AGENTS.md` has the invariants that are
easy to break and hard to see — the script load order, the `CACHE_VERSION`
rule, and which of this project's absences are deliberate.

## Project layout

| File | What it is |
|---|---|
| `index.html` | the whole markup: header, session list, and the dialogs |
| `js/theme-init.js` | resolves "auto" into an explicit `data-theme` before `css/style.css` is applied, so the first paint never flashes the wrong palette |
| `css/style.css` | one stylesheet; all colours are tokens declared at the top, once per theme (light and `[data-theme="dark"]`) |
| `js/data.js` | the default plans, used only on a device's first run |
| `js/block-editor.js` | block CRUD/list, importing a block from JSON, and the plan editor |
| `js/diagnostics.js` | the Diagnóstico screen: e1RM trend per exercise crossed with the log's own signals and with a second slope over kilos per set, real frequency per muscle from the row timestamps, and the indexed strength-per-muscle chart |
| `js/review.js` | the block review and the brief it exports for the next block |
| `js/profile-transfer.js` | backup/restore and moving one profile between phones as a file |
| `js/calculator.js` | the warm-up ramp and plate-loading calculator sheet |
| `js/rest-timer.js` | the rest countdown, its alarm, and the lock-screen card that keeps it audible from a pocket |
| `js/chart.js` | the per-exercise progress sheet: the line chart and the table under it |
| `js/volume-sheet.js` | the volume dashboard — the bars, the trends and the band behind them |
| `js/qr-transfer.js` | the QR wire format and the sheet that shows and scans it |
| `js/app.js` | everything else: state, storage and recovery, the session view, the weekly objetivo rule (read by the session, by "Rellenar con el objetivo" and by the Diagnóstico, so it cannot live in a split file), sheets and navigation, settings, the share/import vocabulary, the CSV export |
| `js/boot-guard.js` | the one script after `app.js`: if the shell did not boot, it hands over to the worker already waiting with a complete one |
| `js/vendor/` | the two QR libraries, verbatim from npm — see the README in there |
| `sw.js` | offline caching; bump `CACHE_VERSION` when releasing |
| `manifest.webmanifest`, `icon.svg`, `icon-*.png` | what makes it installable |
| `tools/render-icons.mjs` | re-exports the PNGs from `icon.svg` — run it after editing the artwork (needs the same `playwright` module as the smoke suite) |
| `blocks/` | blocks published for one-click import |
| `test/unit.js` | headless assertions for pure logic — no server, no browser |
| `test/smoke.js` | browser-driven smoke tests |
| `docs/guide.md` | the user guide: what every screen does and why |
| `AGENTS.md` | the briefing for agents: the invariants, the release rule, how to verify a change |
| `plans/` | implementation plans behind recent changes, with their status in `plans/README.md` |

## Block JSON shape

A block is one JSON document. This is what **Importar JSON**, the
first-run setup's **Traer un JSON** and the list published in `blocks/`
accept, and what **Descargar plan (JSON)** in the plan editor writes. How
importing looks from the user's side is in the guide under
[Importing blocks](docs/guide.md#importing-blocks-from-json).

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
  step this exercise can actually be loaded with. It is what
  [the weekly objetivo](docs/guide.md#the-weekly-objetivo) moves by while the exercise
  has no logged weights to read the real stack off, and how wide a window
  it searches for the next rung once it has. Clamped to 0.25–50 in whatever
  unit the profile uses, rounded to the nearest 0.25. Omitted, it falls
  back to your default increment from **Ajustes** (2,5 kg / 5 lb out of the
  box) — so it is worth setting per exercise where the real step differs:
  1 kg on cable lateral raises, 5 kg on a leg press.
- `ex.minRir`: optional integer 0–5 — the reserve this lift never goes
  under, whatever the week's phase text asks for. Set it (usually `1`) on
  the lifts nobody takes to failure — squat, Romanian deadlift, a heavy hip
  thrust — where a week prescribing 0–1 RIR is a number you are not going
  to follow and a target solved for it is a weight you cannot make. Omitted
  on machines and isolation work, which is the common case.
- `priority` (block): optional list of muscle names — the muscles this
  block is *for*, using the same freeform names as `ex.muscle`. Trimmed,
  de-duplicated and capped at 12; anything blank or unrecognisable is
  dropped rather than rejecting the import. Nothing checks that a name has
  exercises under it — a name with none simply never gets flagged. See
  [Priority muscles](docs/guide.md#priority-muscles).
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

### Publishing a block for one-click import

Commit the file to `blocks/` and add an entry to `blocks/index.json`, a
flat list:

```json
[
  { "file": "hombre-bloque-1.json", "label": "Hombre — Bloque 1 (plan de inicio)" },
  { "file": "mujer-bloque-1.json", "label": "Mujer — Bloque 1 (plan de inicio)" },
  { "file": "ejemplo-plantilla.json", "label": "Ejemplo — plantilla de bloque" }
]
```

The app fetches `blocks/` relative to its own page, read-only and
same-origin, so whichever repo serves the app lists its own blocks. The
list is fetched network-first and falls back to the service worker's
cache, so a block already imported stays importable offline. A new file
is available in the app once the Pages deploy for that push finishes.
`hombre-bloque-1.json` and `mujer-bloque-1.json` are exported copies of
the default plans in `js/data.js`; `ejemplo-plantilla.json` is the
template **Descargar plantilla JSON** hands out.

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

## Known limits

Settled decisions, not bugs — `AGENTS.md` says why each one stays:

- **Spanish only.** Every string lives inline in the source.
- **No sync.** There is no server; data moves between phones as a file or
  by QR, by hand.
- **The QR transfer is one-way and manual.** It copies, it does not merge.
- **Undo is one level deep** and doesn't survive a reload.
- **Two profiles, no more.** Solo mode hides one.

The guide's [Known limits](docs/guide.md#known-limits) says what each one
means day to day.
