# 030 — Sixth pass: user-facing features, direction only

Generated 2026-09-19 against commit `f103ebf` (the merge of PR #105, which
moved plans 021–029 into `plans/done/`). Direction only, like the fourth
audit: no correctness, security, performance or test pass this round. It
answers one question — **what could this app do for the person using it
that it does not do today** — and records the answer so the next agent
does not re-derive it.

Nothing here is planned. The fourth audit's convention applies: the
maintainer picks from the tables, and each pick becomes its own numbered
plan with a drift check, steps and a `CACHE_VERSION` bump. Every option
touching `index.html`, `css/` or `js/` bumps `CACHE_VERSION` in `sw.js`.

## What this is not

Five decisions are settled (AGENTS.md § "Documented limits") and were not
weighed: **Spanish only, no sync, the QR transfer is one-way, undo is one
level deep, two profiles.** Anything that needs a server — accounts,
cloud sync, a social feed, push reminders, an in-app model call — is
listed once under "Considered and rejected" with the reason and is not an
option. No build step, no modules, and a CSP that reaches nothing but
Google Fonts are constraints every option below was checked against.

## How it was done

Three lenses, each grounded before it made a table:

1. **The code, read as a user.** `index.html` in full, `docs/guide.md` in
   full, `buildExCard` and the tick handler (`js/app.js:2761-3160`), the
   profile shape `migrate()` repairs (`js/app.js:324-370`), `buildCsv`
   (`js/app.js:5013`), the manifest, and every `navigator.*` /
   platform-API call in `js/` (`grep -n "navigator\." js/*.js sw.js`).
   Every gap below cites the line that shows it is a gap.
2. **What comparable apps do, and what people ask them for.** A research
   subagent read the current listings, docs, changelogs and 2025–2026
   reviews of Hevy, Strong, Boostcamp, Liftosaur, Alpha Progression, the
   RP Hypertrophy app, JEFIT, FitNotes, Setgraph, KeyLifts, Gymaholic,
   Juggernaut AI, Fitbod, Gravitus and Stronglifts, plus r/weightroom,
   r/naturalbodybuilding, r/Fitness and r/androidapps threads on "best
   tracker" and "missing feature". Its report is summarised per option
   under **Who else has it**; the sources are listed at the end. One
   caveat it reported and this document keeps: the session's egress
   proxy blocked the vendors' own domains and Reddit, so per-app facts
   come from search-engine summaries of the vendors' docs, changelogs
   and 2025–2026 reviews rather than from the pages in full. The one
   hard, countable demand signal it could read directly is Liftosaur's
   public GitHub "Ideas" board with its vote counts (fetched
   2026-09-19); every "N votes" below is that board.
3. **What a static PWA can do in 2026, on both phones.** Half the stated
   household is on iOS Safari, which lacks several APIs Android Chrome
   has. The table under "Platform capabilities checked" says which ones,
   so no option below quietly assumes an API one phone does not have.

The fourth audit (2026-09-18) already did a direction pass and recorded
21 findings; the fifth carried them forward unchanged. **Those are not
repeated as findings here.** They are listed once, compactly, under
"Carried forward", so this document is the live list and the older tables
can be read as history. Where a new option builds on a carried one it
says so.

## The eight options worth weighing (the headline)

Ranked by leverage for the people actually using this: a couple training
three days a week, machine-based double progression, already deep enough
into the app to have built the objetivo v3. "Every session" beats "every
block" beats "once".

| # | Option | Why it is up here | Effort |
|---|---|---|---|
| N2 | **Open on the next session** — `Siguiente: Empuje, semana 4` becomes where the app opens, not a sentence | Every session starts with two taps the footer already knows the answer to (`js/app.js:3237`) | S |
| N1 | **Bodyweight log** — one optional number per training day, charted beside strength, in the review | The one outcome variable a hypertrophy log has none of; the foundation the carried bodyweight/assisted-exercise item (#21) cannot be built without; present in every comparable app | M |
| N3 | **Session summary when the last set is ticked** — duration, kilos moved against the same day last week, records, next session; shareable as an image | The reward moment; the footer line (`js/app.js:3234-3240`) is the only feedback today and it compares with nothing | S–M |
| N5 | **Do the alternative today** — `ex.alt` becomes a tap, the session is filed as a variant, the plan is untouched | "Machine taken" is the gym's daily failure and the app already solved half of it with session order (`moveSessionEx`, `js/app.js:1794`); `alt` is display-only (`js/app.js:2847, 2894`). The most-requested non-hardware feature in the comparison: 45 votes on Liftosaur's board, shipped by Hevy in July 2026 as "just this session / all future" | M |
| N7 | **One more set today** — a row for this session only, without editing the plan for the rest of the block | The storage already keeps rows beyond the plan (`parkedRows`, `js/app.js:1915`); only the UI is missing | S–M |
| N4 | **Exercise names autocomplete from history, inheriting id, tags and `inc`** | `sameLift` matches by id then name (`js/app.js:2127`); a hand-typed row gets `uid()` and loses its cross-block history on one typo; the editor only autocompletes tags (`js/block-editor.js:867-872`) | S |
| N6 | **Offer an early deload when the brake keeps firing** | `brakeOn` (`js/app.js:4165`) already computes the signal; it holds one day and nothing reads it across weeks; RP, Juggernaut AI and StrongLifts each make a deload trigger part of their headline autoregulation | S–M |
| N8 | **Partner band on JUNTOS cards, then a two-person session view** | The premise of the app that no comparable app has; `ex.share` is a badge (`js/app.js:2888`) and the other profile's log is one key away | S / L |

## New options, by leverage

Impact is for the stated household; **Conf.** is how sure the reading of
the gap is (HIGH = the cited line settles it). **iOS** says whether the
option works the same on iOS Safari as on Android Chrome.

| # | Option (UI name) | Impact | Effort | Risk | Conf. | iOS | Evidence (`f103ebf`) | Disposition |
|---|---|---|---|---|---|---|---|---|
| N1 | Bodyweight log (`Peso corporal`) | HIGH | M | LOW–MED | HIGH | same | `js/app.js:338-363` (no map), `:5020` (no column), `js/profile-transfer.js:75`, `js/qr-transfer.js` | **plan** — first, it unlocks carried #21 |
| N2 | Open on the next session (`Hoy toca…`) | HIGH | S | LOW | HIGH | same | `js/app.js:3237-3238` says it, `:2377, :2391` are the only writers | **plan** |
| N3 | Session summary + share image (`Resumen de la sesión`) | MED–HIGH | S–M | MED | HIGH | same (`navigator.share` files) | `js/app.js:3221-3241`, `:3032` (`r.ts`), `:1418-1422` | **plan**, after the tick-discipline spike (carried #10) |
| N4 | Exercise-name autocomplete inheriting id/tags/`inc` | MED–HIGH | S | LOW | HIGH | same | `js/block-editor.js:867-872`, `js/app.js:285-287, 2127` | **plan** |
| N5 | Do the alternative today (`Hoy hago la alternativa`) | MED–HIGH | M | MED | HIGH | same | `js/app.js:2847, 2894`, `:3716, :3781` (variants) | **design first** — where the alt's rows are filed |
| N6 | Early-deload offer (`Adelantar la descarga`) | MED | S–M | MED | HIGH | same | `js/app.js:4165, 3387`, `js/block-editor.js:1110` | **plan**, offer only, never automatic |
| N7 | One more set today (`+ serie hoy`) | MED | S–M | MED | HIGH | same | `js/app.js:1915, 1530, 2879` | **plan** — a per-session count, not a reinterpretation of parked rows |
| N8 | Partner band on JUNTOS cards → two-person view | MED / MED? | S / L | LOW / HIGH | HIGH / MED | same | `js/app.js:2888-2892`, `js/data.js:63, 94` (15 shared ids) | band: **plan**; view: **spike** (product call, carried #19) |
| N9 | All-blocks calendar and monthly session counts | MED | S–M | LOW | HIGH | same | `js/diagnostics.js:279, 840-848` (one block), `:670` (scope only on trend) | option |
| N15 | Per-exercise session note that returns next week | MED | S | LOW | HIGH | same | `js/app.js:1662-1668` (per slot), `:2937-2960` (`setup` is plan-level) | option |
| N29 | Rest timer: don't auto-start / no timer after an exercise's last set | MED (two people on one machine) | S | LOW | HIGH | same | `js/app.js:3036` unconditional; `:471-478` the only timer prefs; "stop the timer after the last set" is 31 votes on Liftosaur's board | option |
| N44 | Warm-up rows on the card (`Calentamiento`), excluded from every reader | MED–LOW here (machines), MED on a bar | S–M | MED | HIGH | same | the ramp exists only in the calculator (`js/calculator.js:95`); no row type but `d` (drops) on a log row; warm-up handling is 59 votes across three Liftosaur requests | option, after carried #16 |
| N45 | `±` stepper on the weight box, moving by the exercise's own step | MED–LOW | S | LOW | HIGH | same | `incFor` is the ladder's step; boxes are plain text inputs (`js/app.js:2975-2976`); Strong's keypad is its most-praised feature | option |
| N47 | Post-session per-muscle feedback (soreness, pump) driving next week's set count | MED? | M–L | HIGH | MED | same | `energy` is confined to the review by design (`js/app.js:1706-1730`); the band is fixed at 10–20 (`js/volume-sheet.js:30-36`); RP sells exactly this at $34.99/month, English only | **spike** — the tension is recorded below |
| N31 | Search any exercise ever logged (`Buscar en el historial`) | MED | S–M | LOW | HIGH | same | `openChart` only from a card; Diagnóstico lists the current plan (`js/diagnostics.js:670`) | option |
| N30 | Session date override (`Esta sesión fue el…`) | MED–LOW | S | LOW | HIGH | same | `js/app.js:3032` stamps the tick, `:3582` `GAP_DAYS` reads it | option |
| N18 | Open-ended rep targets (`8+`, AMRAP) | MED–LOW here, HIGH for imported programs | S | MED | HIGH | same | `js/app.js:1598-1611` (last number is the top), censoring in `targetFor` | option |
| N10 | Weekly volume across all blocks | MED–LOW | S–M | LOW | HIGH | same | `js/volume-sheet.js:30-36` (block-scoped) | option |
| N13 | 1RM percentage table in the calculator | LOW–MED | S | LOW | HIGH | same | `js/calculator.js:93-99`, `js/app.js:3498` | option |
| N16 | Haptic tick (`navigator.vibrate` on ✓) | LOW–MED | S | nil | HIGH | **no** (no Vibration API) | `js/rest-timer.js:149` is the only call | option, Android polish |
| N17 | Scroll to the next unticked set when the rest ends, and to the paired card on a `rest: 0` tick | LOW–MED | S | LOW | HIGH | same | `js/rest-timer.js:32-90` touches no focus; Hevy's "smart superset scrolling" is the same thing and needs no pair id | option |
| N50 | A trend line on `Progreso` | LOW–MED | S | LOW | HIGH | same | `theilSen` (`js/app.js:3630`) is fitted for the Diagnóstico and never drawn; 14 votes on Liftosaur's board | option |
| N49 | Keep the screen on for the whole session (`Ajustes`) | LOW–MED | S | LOW | HIGH | same (16.4+) | the wake lock is held only during a rest (`js/rest-timer.js:371-395`) | option |
| N42 | `Tal día como hoy` — a set from a year ago on this calendar day | LOW (delight) | S | LOW | HIGH | same | `r.ts` on every ticked set (`js/app.js:3032`); KeyLifts' "Workout Memories" | option |
| N48 | More published blocks in `blocks/` (upper/lower, full body ×2, a second block for each seed) | LOW–MED for a newcomer | S (content) | LOW | HIGH | same | the registry exists with three entries (`blocks/index.json`); Boostcamp's 11 000 programs and Liftosaur's 50 are the template-library pitch | option, no code |
| N43 | Strength standards / relative-strength comparison of the two profiles | LOW–MED | M | MED (table licensing) | MED | same | needs N1; Gravitus and Fitbod compute a level from bodyweight and sex | record only |
| N19 | Time-based sets (`seg` instead of `rep`) | LOW here, MED for imports | M | MED | HIGH | same | `js/app.js:2976` integer-only reps; `est1RM`/`setVolume` assume reps | option |
| N25 | Optional video link per exercise (`url`) | LOW–MED | S | LOW (https-only validator) | HIGH | same | `cue`/`alt` are text; CSP does not block `<a href>` navigation | option |
| N26 | Large-text mode | LOW | M (602 `px`, 0 `rem` in `css/style.css`) | LOW | HIGH | same | `css/style.css` | option |
| N24 | Import history from Strong / Hevy / FitNotes exports | LOW here, MED for a newcomer | M–L | MED | HIGH | same | only JSON/QR importers exist (`js/block-editor.js:218`, `js/profile-transfer.js:75`); Boostcamp's users keep asking for export, which this app already has | record only |
| N41 | App-icon badge with sessions left this week | LOW | S | LOW | HIGH | **iOS only** (16.4+; Android Chrome has no `setAppBadge`) | no `navigator.setAppBadge` call | record only |

### N1 — Bodyweight log

**What the user sees.** Under `¿Cómo llegas?`, one more optional box:
`Peso corporal` with the unit, once per training day (it is a session
fact, not a set fact — the same shape as `energy` and the note). Empty by
default; skip it and nothing changes. **Progreso** gains a `Peso corporal`
line to draw beside any exercise's e1RM, **Diagnóstico → Fuerza** shows
the block's change in bodyweight next to the strength index, and the
**block review** carries one line — `Peso corporal: 74,2 → 75,4 kg
(+1,6 %)` — because "did the block work" is strength *and* mass, and the
review has had only one of them. The CSV gets the value repeated on every
row of that session, like `nota` and `energia`.

**Evidence.** `migrate()` repairs seven per-profile maps — `log`, `rir`,
`notes`, `energy`, `order`, `obj`, `variants` (`js/app.js:338-363`) — and
none holds a bodyweight. `buildCsv`'s header (`js/app.js:5020`) has no
column. `normalizeImportedProfile` (`js/profile-transfer.js:75`) and the
QR `perfil` payload would both need the map, which is the same three-
validator shape `obj` and `variants` went through in plan 025.

**Who else has it.** Every app in the comparison — Hevy, Strong, JEFIT,
FitNotes, Liftosaur, Boostcamp, Alpha Progression, Gymaholic, Progression
— tracks bodyweight, most of them as the first non-lift measurement;
Hevy lets it be updated from inside a bodyweight exercise's set row, and
Fitbod prices bodyweight lifts off it (its "1SM"). Circumferences and
custom measurements are the next step everywhere (9 votes for custom
measurements on Liftosaur's board) and would share this map's shape. It
is the most common feature this app lacks outright.

**Why first.** Two carried items depend on it: bodyweight/assisted
exercises (fourth audit #21) need a bodyweight to price a pull-up, and the
review-vs-previous-block spike (#15) is thin without the mass axis. It is
also the cheapest "is this working" number there is for hypertrophy — the
guide already refuses to let the app pretend it knows more than the log
holds, and this is the one number the log does not hold.

**Effort M, risk LOW–MED.** Storage is one number per calendar day per
profile, with the same unit stamp rows carry (`stampRowUnit`,
`js/app.js:548`) so a mid-block unit switch reads as one line. The work
is in the three validators (backup, profile file, QR) and the CSV, not
the screen. Decide once: keyed by ISO day (bodyweight is a morning
number) rather than by slot (a slot is a plan position).

### N2 — Open on the next session

**What the user sees.** The footer already prints `Sesión completa — 22
series registradas. Siguiente: Cuádriceps + Espalda.` Today that is a
sentence; the next open lands on the finished day and the person taps the
day tab, or the week tab and the day tab. With this, opening the app on a
later calendar day than the completed session lands on the next day (and
on the next week after the last day), with one status line —
`Empuje hecho el lun 14 · hoy toca Cuádriceps + Espalda` — and a
`Volver` in it. Nothing moves on the same day (a session is browsed after
it is done), nothing moves while a session is half done, and the last day
of the last week offers `+ Nuevo bloque` instead of moving.

**Evidence.** `drawSessionFoot` (`js/app.js:3221-3241`) computes the next
day and writes nothing; `profile.day` and `profile.week` change only from
the tab clicks (`js/app.js:2377, 2391`) and on block creation
(`:1246-1260`). There is no "opened on" bookkeeping; the `r.ts` of the
last tick (`:3032`) is enough to know the session was another day.

**Who else has it.** Hevy and Strong open on the next routine, Boostcamp
and Liftosaur on "today's workout", Alpha Progression on the next planned
session. It is the one convention every app shares.

**Effort S, risk LOW.** A navigation, not a write: the misfire is landing
on the wrong day, which one tap on the day tab fixes, so it needs no undo
snapshot. It reads the same `dayCards.every(done)` the backup nag reads
(`js/app.js:3040-3043`).

### N3 — Session summary, and a card to share

**What the user sees.** Ticking the last set of the day opens a small
sheet: sets done, `kg movidos` against the same day last week as a
percentage (`+6 % que la semana pasada`), records set, RIR chips tapped,
the session note, `Siguiente: …`. Where the ticks are spread over the
session, the duration (`52 min`). A `Compartir` button draws the same
card onto a canvas and hands it to the share sheet as a PNG, the way the
review `.txt` and the CSV already go out (`downloadFile`, `js/app.js:1418-
1422`); a `Cerrar` keeps it out of the way of someone who does not want
a ceremony.

**Evidence.** The footer line (`js/app.js:3234-3240`) is the only
end-of-session feedback and compares with nothing; the per-set timestamp
(`:3032`) has never been read as a duration (fourth audit #10). The
canvas needs no CSP change: `img-src 'self' data:` already allows the
data it produces, and a share is not a fetch.

**Who else has it.** Hevy, Strong and JEFIT end every workout on a
summary card (duration, tonnage, average rest, records) with a share
image; Fitbod's periodic "Workout Report" is the same idea over a period.
The third-party round-ups of the r/Fitness and r/weightroom "best
tracker" threads report that people value speed of logging and visible
progress over features and paywalls, and the summary without the social
network is exactly what a client-side card is.

**Effort S for the sheet, S for the image, risk MED.** The risk is the
fourth audit's #10: four sets ticked at once from memory make a
thirty-second "session". Print the duration only when the ticks span at
least three distinct minutes, and never make it a number anything else
reads. The carried spike (#10) settles tick discipline first; this option
is the reason to run it.

### N4 — Exercise names autocomplete from history

**What the user sees.** Typing a name in the plan editor offers the names
used in any block of either profile; picking one copies the exercise's
`id`, `muscle`, `pattern`, `type`, `inc`, `minRir`, `setup`, `cue` and
`alt`. The new row is then the same lift as its history: the chart's
`Todos los bloques`, the Diagnóstico and the objetivo's cross-block
`level` read it without a rename.

**Evidence.** `sameLift` (`js/app.js:2127`) matches by id and then by
name; a row added in the editor gets `uid()` and matches only by exact
name, so `Press inclinado` and `Press inclinado máquina` are two
histories. `MUSCLE_BY_ID` (`js/app.js:~300`) backfills tags for the seed
ids only. The editor autocompletes `muscle`/`pattern`/`type` from three
datalists (`js/block-editor.js:867-872`, filled at `js/app.js:285-287`)
and not the name.

**Who else has it.** Every app has an exercise library; the difference
here is that the library is the person's own history, which is the only
one the objetivo can read. Liftosaur and Boostcamp both key progression
off a stable exercise id for the same reason.

**Effort S, risk LOW.** A fourth datalist and one copy on pick. Ids are
deduped per block by the editor and by `migrate()`, so an id that already
exists in the block gets a fresh one — say so in the status line rather
than silently.

### N5 — Do the alternative today

**What the user sees.** The grey `o press de banca con barra` under an
exercise becomes a tap. The card flips to the alternative's name for this
session, its rows log under it, the objetivo says `sin historial en esta
variante` the first time and reads the alternative's own history after
that, and the plan is untouched — next week the card is the original
again. A second tap flips back.

**Evidence.** `ex.alt` is drawn and never read (`js/app.js:2847, 2894`;
editor field at `js/block-editor.js:881-882`). The variants machinery
(`recordVariant`, `js/app.js:3781`; `variantSince`, `:3716`) already
models "a different lift from here on" for renames, and session order
(`moveSessionEx`, `:1794`) already models "the machine was taken".

**Who else has it.** Hevy shipped "swap exercise — just this session /
all future" in July 2026 (Pro); Liftosaur substitutes by muscle
similarity; Juggernaut AI swaps per day or per block; Fitbod substitutes
by equipment; Boostcamp paywalls it and its reviewers complain about
exactly that. "Alternative exercises in a program" is the top
non-hardware idea on Liftosaur's board (45 votes). Hevy's two-way answer
is the right shape here too: `solo hoy` is this option, and `de aquí en
adelante` is a rename, which the editor already does and plan 028 made
honest.

**Effort M, risk MED — design first.** The open question is where the
rows are filed: a derived id (`chestpress@alt`) keeps every reader
working by construction but makes the alternative a lift with a
name-only identity; a per-session map (`subs`, `blockId → slot → exId →
name`, the `rir` shape) keeps the log key stable but every reader that
prints a name has to consult it. The chart, the Diagnóstico, the review,
the CSV and the QR carry all touch it. Decide before writing a plan.

### N6 — Offer an early deload

**What the user sees.** When the brake has fired two weeks running, or
Diagnóstico has more than half the plan `bajando` with the deload two or
more weeks away, one line under the brake note: `Dos semanas frenando.
¿Adelantar la descarga a la semana 6?` — a tap sets it, the week-goal
text follows (the guide's "week goals follow" rule already exists), and
nothing else changes. Declining hides it for the week.

**Evidence.** `brakeOn` (`js/app.js:4165`) evaluates one week and holds
one day; `drawBrakeNote` (`:3387`) prints it and nothing remembers it.
`block.deload` is written only by the editor (`js/block-editor.js:1110`).
The energy chips (`:3280`) are confined to the review by design and are
not an input here.

**Who else has it.** StrongLifts deloads after N failed sessions on a
lift (configurable −10/−15 %); Juggernaut AI cuts sets or proposes a
rest day when its readiness check scores low; the RP app plans the deload
and moves it on accumulated fatigue ratings. "A deload feature" is a
standing request on Liftosaur's board (8 votes) — small next to
substitution, but it is the one autoregulation the app already has the
signal for.

**Effort S–M, risk MED.** The brake was designed as "the cheapest way to
be wrong": a week of a session you can certainly do. A deload is a bigger
bet, so it is an offer with a reason printed, never a change the app
makes. A false positive costs one light week; a missed one costs nothing
the app does not cost today.

### N7 — One more set today

**What the user sees.** Under the last row, `+ serie hoy`. It adds a row
for this session only; the volume dashboard's `Registrado` counts it when
ticked, `Plan` does not, the objetivo's `phi[k]` prices it as set k+1
(which it already does for the set `ex.add` brings in), and next week the
card is back to the plan's count.

**Evidence.** Rows beyond the plan are already stored and reported —
`parkedRows` (`js/app.js:1915`) and the `Hay 1 serie registrada por
encima…` note (`:2879`) — because shortening a plan hides rows. The only
route to a fifth set today is `Editar plan → +1 → Guardar`, which changes
every remaining week.

**Who else has it.** Every app; in Hevy and Strong "+ Add set" is the
default control under every exercise, and Progression and KeyLifts add
"skip" beside it (a state the fourth audit rejected here — see below).

**Effort S–M, risk MED.** Do not reinterpret parked rows: they mean "the
plan shrank" and this means "today grew", and one note cannot say both.
A per-session count map (`extra`, the `rir` shape, integer) is the
honest shape, and it travels with the `plan + registro` QR share like
`rir` does.

### N8 — Partner band, then a two-person session

**What the user sees, small.** On a JUNTOS exercise, a third history band
under the card's own: `Ana · Sem. 3 · 40×12 · 40×10`, from the other
profile's latest session on the same id or name, tagged with the
snapshot's age when that profile arrived by QR (`copia del 12 sep`). No
comparison is drawn — the two are not the same lifter.

**What the user sees, large.** One phone, both people: a shared exercise
shows both sets of rows on one card, colour-coded by profile accent,
alternating, each tick filed under its own profile. One rest timer.

**Evidence.** `ex.share` is a badge (`js/app.js:2888-2892`); the seed
plans share 15 ids (`js/data.js:63, 94, …`) and were written so the two
sessions finish together (`docs/guide.md` § "Los planes por defecto");
both profiles are in `state.profiles` on one device and the QR `perfil`
kind lands a snapshot of the other on a second device.

**Who else has it.** Nothing in the comparison does the two-person view.
Hevy has "compare with a friend — exercises in common" and friend
leaderboards, Gravitus per-exercise leaderboards, and both need their
servers; Tonal's partner workouts and a couple of "gym buddy" apps
alternate two people on one device, but none is a tracker. Strong,
Boostcamp, Liftosaur and the rest are single-user by construction. This
is the app's own premise and its one angle no comparable app can copy
without a server — and the compare screen (`¿quién va mejor?`, per lift,
absolute and per kilo of bodyweight once N1 exists) is the client-side
version of the only social feature people cite by name.

**Effort S for the band (risk LOW), L for the view (risk HIGH).** The
view has to answer what happens when the two blocks' weeks or days
differ, whose day is drawn, and how the rest timer serves two people. The
fourth audit filed it as a product call (#19); it still is. The band
needs no call and is the evidence for whether the view is wanted.

### N9 — The calendar across every block

**What the user sees.** Frecuencia's calendar, which today draws the
block's weeks, gets a `Todos los bloques` that draws the last twelve
months as one grid, with sessions per month underneath and the longest
run of weeks that met the plan. A calendar, not a streak: the guide is
explicit that the shape of the gaps is the point, and a streak counter
punishes the rest week the plan itself prescribes.

**Evidence.** `buildHeatmapSVG` (`js/diagnostics.js:279`, drawn at
`:840-848`) takes one block; the `Todos los bloques` scope switch changes
only the trend tab (`diagRows`, `:670`). There is no all-time count of
sessions anywhere in the app.

**Who else has it.** Calendars and weekly streaks are in Hevy, FitNotes,
JEFIT and Gymaholic; Hevy's "gym consistency" page is one of its
marketed features. The review round-ups call the consistency view the
most motivating non-lift screen.

**Effort S–M, risk LOW.** `freqRows` (`js/diagnostics.js:233`) already
gathers ticked days; the change is the window and the drawing.

### N15 — A note per exercise per session

**What the user sees.** Beside `⚙`, a `✎` that opens one line for this
exercise today — `agarre se resbala, usar correas`, `rodilla izq. en la
bajada` — which comes back under the card next week the way the session
note does (plan 019), and reaches the CSV.

**Evidence.** The session note is keyed by slot with no exercise under it
(`getNote`, `js/app.js:1668`); `ex.setup` is a plan field
(`:2937-2960`). The "deliberately not per set" comment (`:1662`) is about
sets; per exercise per session is between that and the day.

**Who else has it.** Hevy added exercise-level notes in July 2026 after
requests; Strong and Liftosaur pin a note to the exercise; FitNotes goes
one further with a comment per set. The pattern that ships is a note
that comes back next time, which is what plan 019 already built for the
session note.

**Effort S, risk LOW.** A `rir`-shaped map, a CSV column, a QR carry.

### N29 — A rest timer that can stay quiet

**What the user sees.** In `Ajustes`, `Temporizador de descanso: siempre /
nunca / no tras la última serie`; in the plan editor, a rest of `0`
already means "superset →" and could keep meaning it. Two people
alternating on one machine do not rest by the clock — the partner's set
is the rest — and today every tick starts a countdown they skip. The
third setting is the one people ask for by name: the last set of an
exercise starts a rest nobody takes, because the next machine has its
own.

**Evidence.** `startRest` is unconditional on a ticked set with a rest
(`js/app.js:3036`); the only timer preferences are `sound` and `bgAlarm`
(`:471-478`). Whether a set is the exercise's last is known at the tick
(`si === n - 1`).

**Who else has it.** Hevy exposes twelve timer settings, Strong and
Boostcamp an auto-start toggle. "Stop the timer after the last set" is
31 votes on Liftosaur's board, its fourth-highest idea, and "bigger timer
font" another 9.

**Effort S, risk LOW.**

### N31 — Find any exercise ever logged

**What the user sees.** In Diagnóstico, a search box: `press inclinado`
lists every exercise ever logged with that text, in any block of the
profile, with its last session and a `Progreso ↗`. Today an exercise not
in the current block has no entry point at all — the history is "one
block away" and invisible until the exercise is put back in a plan.

**Evidence.** `openChart` is reachable only from a card; the Diagnóstico
iterates the current plan (`diagRows`, `js/diagnostics.js:670`).

**Who else has it.** Every app has exercise history search; FitNotes
swipes from a set straight to that exercise's history. It matters here
because swapping machines between blocks is the normal case and the
objetivo reads history across blocks that the person cannot see.

**Effort S–M, risk LOW.**

### N30 — Log a session on the day it happened

**What the user sees.** A `fecha` under the session note, prefilled with
today; change it and every set ticked in this session is stamped with
that day. For the paper-note session logged the morning after, and for
the couple's second phone catching up.

**Evidence.** `r.ts = Date.now()` on every tick (`js/app.js:3032`);
Frecuencia's gaps, the layoff rule (`GAP_DAYS`, `:3582`) and the calendar
all read it, so a Monday session logged on Tuesday widens a gap and can
trip the ten-day repeat.

**Who else has it.** Hevy and Strong let the workout date be edited;
FitNotes logs to any calendar day.

**Effort S, risk LOW.** One per-slot override read by the tick; no map
rewrite.

### N18 — Open-ended rep targets

**What the user sees.** `8+` or `AMRAP` in the reps field means the top
is open: the set is never read as "cut off at the top", so a 14 on an
`8+` raises the level as the reading it is, and the objetivo says `8+ →
a por más` instead of prescribing a rung.

**Evidence.** `repRangeTop` takes the last number in the string
(`js/app.js:1598`), so `8+` is an 8–8 range and any set of 8 is censored
as a floor (`targetFor`'s range check).

**Who else has it.** Liftosaur and Boostcamp (5/3/1, GZCLP and every
program with an AMRAP set); KeyLifts is built around 5/3/1's plus sets;
StrongLifts by construction. A "to failure" set type is 12 votes on
Liftosaur's board.

**Effort S, risk MED.** The seeds and the objetivo are double-progression
and never ask for an open set; this is for imported blocks. The AI prompt
would say so.

### The rest of the table, in one line each

- **N10 — Volume across all blocks.** `js/volume-sheet.js` is block-
  scoped; a `Todos los bloques` span of weekly sets per muscle is the
  mesocycle-over-mesocycle view RP and Alpha Progression draw. S–M.
- **N13 — Percentage table.** The calculator (`js/calculator.js:93-99`)
  could show 60–95 % of an exercise's current e1RM; Strong, Liftosaur and
  KeyLifts do. Low here: the seeds are machine-based. S.
- **N16 — Haptic tick.** `navigator.vibrate(30)` on ✓, Android only
  (`js/rest-timer.js:149` is the only call today). Gloves and sweat. S.
- **N17 — Scroll to the next set when the rest ends.** Hevy does; the
  timer's end (`js/rest-timer.js:32-90`) touches no focus. S.
- **N19 — Time-based sets.** Reps are integer-only (`js/app.js:2976`) and
  every reader assumes reps; a `seg` unit per exercise for planks and
  carries is M and matters only for imported plans.
- **N25 — A video link per exercise.** An `https:`-only `url` field,
  shown as a link; the CSP does not block navigation. For the coach and
  AI flows more than for the household. S.
- **N26 — Large text.** `css/style.css` has 602 `px` values and no `rem`,
  so this is a stylesheet pass, not a toggle. Pinch-zoom already works. M.
- **N24 — Strong / Hevy / FitNotes import.** Only for a newcomer with a
  history elsewhere; the block-shaped model makes the mapping (weeks,
  days, ids) the hard part. A static FitNotes-clone PWA reads FitNotes
  backups directly, so the formats are documented. M–L; record only.
- **N41 — App-icon badge.** `navigator.setAppBadge(sessionsLeft)` works
  on iOS 16.4+ for an installed app and **not** on Android Chrome, which
  badges only from notifications. Low value either way: the plan is
  three days a week and the person knows. S; record only.
- **N44 — Warm-up rows on the card.** Alpha Progression inserts warm-up
  sets scaled by the lift, StrongLifts and Liftosaur compute them per
  exercise, Boostcamp saves a warm-up template per lift; Hevy and Strong
  tag a set as warm-up and exclude it from stats. Three separate
  Liftosaur requests total 59 votes (programmable 32, single-plate 15,
  off by default 12), which is the second-largest demand signal in the
  comparison. Here the seeds are machine-based and the ramp matters on a
  bar, so the value is in imported blocks and in the two barbell
  alternatives the seeds name. Carried #16 (the calculator opens with
  the card's target) is the down-payment; rows on the card that no
  reader counts is the feature. S–M; the risk is every reader that
  iterates `rows` having to skip a new row type.
- **N45 — A `±` stepper on the weight box.** Strong's on-screen keypad
  with ±2.5 is the thing its reviews praise first; FitNotes and
  Liftosaur have increment buttons. Here most ticks need no typing (the
  placeholder is the objetivo), so the stepper is for the deviation:
  one tap up or down the exercise's own step (`incFor`), or better, the
  next rung of the logged ladder the objetivo already walks. S.
- **N47 — Per-muscle feedback after the session.** The RP app asks
  soreness, pump, workload and joint pain per muscle and adds, holds or
  removes sets the next week; Mesostrength copies it; RP charges
  $34.99/month for it and is English-only, as is Boostcamp, so a
  Spanish-language version has no direct competitor. Here it would turn
  the fixed 10–20 band into a per-muscle landmark that moves. The
  tension is explicit in the guide: the energy chip "is never fed into
  any estimate … which is all an optional input can honestly support",
  and the objetivo reads only what the log measured. A spike, not a
  plan: it needs a decision that self-reported soreness is evidence the
  app may act on, which is the decision the RIR chip already got and
  the energy chip was refused.
- **N42 — `Tal día como hoy`.** KeyLifts' "Workout Memories": the set
  you beat on this calendar day a year ago. `r.ts` has it; one line in
  the footer once a year of history exists. Delight, not need. S.
- **N43 — Strength standards.** Gravitus ranks against 300 000 lifters
  by bodyweight and sex, Fitbod computes a strength score. The couple's
  `¿quién va mejor?` per kilo of bodyweight needs only N1 and no table;
  a "beginner → elite" level needs a standards table whose licensing is
  the risk. Record only; the relative-strength line lands under N8.
- **N48 — More published blocks.** The registry and the one-click import
  exist; three files are in it. Content, not code: an upper/lower and a
  full-body ×2 for a newcomer, a second block for each seed so the AI
  round-trip has a worked example of "the block after this one". S.
- **N49 — Keep the screen on all session.** Hevy has the setting; the
  wake lock here is held only while a rest runs
  (`js/rest-timer.js:371-395`). One preference, both phones. S.
- **N50 — A trend line on the chart.** `theilSen` (`js/app.js:3630`) is
  the Diagnóstico's slope and is never drawn; 14 votes on Liftosaur's
  board for trend lines, 11 for a chart filtered by rep count (the
  latter belongs with carried #14's rep-range records). S.

## Carried forward from the fourth and fifth audits — still open

Re-checked at `f103ebf`; none has landed. The fourth audit's numbering is
kept so its detail sections still resolve.

| Fourth # | Option | Effort | Status here |
|---|---|---|---|
| 7 | A file lane for `plan + registro` (the QR overflow points at exports that *replace*) | S | open; `obj`, notes and energy would join it |
| 8 | Copy a block to the other profile | S–M | open |
| 9 | A week-goal (`phase`) editor | M | open — design first (the "still generic?" heuristic) |
| 10 | Session duration / rest-vs-prescribed | S / M | **spike**; N3 is now the reason to run it |
| 11 | Duplicate exercise / duplicate day in the editor | S | open |
| 12 | Last backup date (only a counter exists, `js/app.js:504`) | S | open |
| 13 | Chart table shows every set; heat-map cells open the day | S–M | open |
| 14 | All-time `Récords` sheet | M | open; 020's `{ w, e }` shape is what it needs. The market's shape is **records per rep count** (best weight at 1, 3, 5, 8, 10, 12 reps — RepCount, Boostcamp, Hevy's set records; 7 + 11 votes on Liftosaur's board) plus "best this block / this year", which one walk of the log gives for free |
| 15 | Review against the previous block | M–L | **spike**; N1 gives it the mass axis |
| 16 | Calculator opens with the card's target weight | S | open |
| 17 | Per-exercise "apply the objetivo" tap | S | open, with the recorded tension |
| 18 | Paste-import confirmation and provenance | M | open |
| 19 | Partner band on JUNTOS cards | S | → N8 |
| 20 | Equipment per profile | M | open (`state.prefs` is global, `js/app.js:471-504`) |
| 21 | Bodyweight / assisted exercises | M–L | open; **blocked on N1** |
| fifth | The `obj` readout — how often the objetivo was right | M | **spike** (metric, censoring, screen vs CSV) |
| third | A distinct empty state for "logged, all at zero" | S | open, the down-payment on 21 |

## Considered and rejected

Recorded so nobody re-audits. Each names the reason.

- **Cloud sync, accounts, a shared plan between the two phones.** Needs
  a server; settled (AGENTS.md). The couple's angle is served client-side
  by N8 and the QR `perfil` snapshot.
- **A social feed, leaderboards, cheering a partner's PR.** Needs a
  server. The share card (N3) is the client-side version.
- **Push reminders ("you have not trained in 4 days").** Web Push needs
  a push service and a server to schedule; Notification Triggers is a
  dead API; a local timer only fires while the page is open. Not
  possible without a server.
- **An in-app model call (the AI writes the block inside the app).**
  `connect-src 'self'` and "nothing can be sent anywhere" (`docs/guide.md`
  § "Data & privacy") are the design; the copy-paste round-trip
  (plans 016/017) is the feature. Reversing it is a privacy decision,
  not a feature.
- **Progress photos.** `localStorage` is ~5 MB and the backup story is
  "the download is what survives"; photos would make it megabytes and
  put faces in a file that travels to a coach. IndexedDB could hold them
  and that is not the objection.
- **Apple Health / Health Connect / Google Fit export, a watch
  companion, home-screen widgets.** All need native code; no web API
  exists for any of them on either phone.
- **Web Bluetooth for a heart-rate strap.** Android Chrome only, iOS
  Safari never; and a hypertrophy log has no reader for heart rate.
- **Voice logging.** Android Chrome's `SpeechRecognition` sends audio to
  Google's servers — the one thing the CSP exists to prevent — iOS
  WebKit's is reported unreliable, and gym noise defeats both. The 2026
  apps that lead with it (Sleet, GymNote) are native.
- **A photo of the machine on the exercise.** Alpha Progression added
  user images in 2025 and Liftosaur has 9 votes for it; the objection
  is the same as for progress photos (megabytes in a backup that travels)
  and `ex.setup` is the text version that already exists.
- **Muscle recovery percentages.** Fitbod, JEFIT and Gymaholic fade a
  muscle back to 100 % over 48–72 h. The log has no evidence for a
  recovery curve; Frecuencia's real gaps and the plan's rest days are
  what it can honestly say. Nine votes on Liftosaur's board for
  muscle-specific recovery windows, recorded, not weighed.
- **Sharing a block as a link.** Hevy, Liftosaur and Boostcamp share
  programs by URL; a static site could carry compressed JSON in the
  hash. The app reads no URL at all, which is a verified security
  positive (fourth audit), and the QR and JSON paste already carry a
  block between two people without a URL. Not worth the surface.
- **A watch companion, Strava / Garmin / Apple Health sync.** The single
  biggest request everywhere (Wear OS is 119 votes on Liftosaur's board,
  Strava and Garmin 23 each) and native-only; listed so nobody weighs it.
- **Auto-backup to a file on the phone.** `showSaveFilePicker` is
  desktop-only; Android and iOS have no way to rewrite a chosen file
  silently. The share sheet on every Nth session (the existing nag,
  `maybeNagBackup`) is the ceiling. Carried #12 (a visible date) is the
  honest version.
- **Manifest `shortcuts` / `share_target` / `file_handlers`.** Rejected
  in the fourth audit — the app reads no URL, which is a verified
  security positive — and unchanged: N2 removes the need for a
  "today's session" shortcut from the other side.
- **A "skipped" set state.** Rejected in the fourth audit (no consumer);
  unchanged. N7's per-session count is the additive twin and does have
  consumers.
- **Behaviour on the `ss` flag.** Rejected in the fourth audit (`rest: 0`
  carries the behaviour); unchanged.
- **A second language.** Settled.
- **Per-set RIR.** `js/app.js:1662` says why once per exercise: mid-set
  entry is friction, and the objetivo's censoring reads the last set. A
  per-set chip would sharpen `phi[k]` and is the model most apps use
  (RPE per set), but it is a data-model change to the `rir` map with
  every reader in tow, for a lifter who already skips the one chip on
  most sessions. Recorded, not weighed.
- **Percentage-based programs (5/3/1 waves) in the objetivo.** Off the
  app's methodology; a narrow rep range (`"5"`) already produces linear
  progression through the existing rule, which covers the novice case.
  N18 is the small piece worth taking.
- **A muscle heat-map on a body diagram.** The taxonomy is freeform by
  design (`docs/guide.md` § "Weekly volume"); a diagram needs a fixed
  one, so it would work for the seed names and show nothing for
  `Deltoide posterior`. The bars already answer the question.
- **Streak counters.** Not the calendar (N9) — a counter. The plan
  prescribes rest days and a deload; a streak punishes both.
- **Duplicate helpers, the `app.js` split, the smoke sleeps, CI on
  push.** Not user-facing; carried in the fifth audit's own lists.

## Platform capabilities checked

What a static PWA can use in 2026, on the two phones this household
runs. "Same" means the option works identically on both.

| API | Android Chrome | iOS Safari | Used today | Would serve |
|---|---|---|---|---|
| Web Share with files | yes | yes (15+) | `downloadFile` (`js/app.js:1418`) | N3 share card |
| Canvas → Blob | yes | yes | no | N3 |
| Vibration | yes | **no** (removed from WebKit) | alarm only (`js/rest-timer.js:149`) | N16 |
| Screen Wake Lock | yes | yes (16.4+) | rest timer | N49 |
| Notifications from the worker | yes | installed app only, 16.4+ | rest end | — |
| Media Session | yes | partial | lock-screen rest card | — |
| Badging (`setAppBadge`) | **no** (badges come from notifications) | installed app only, 16.4+ | no | N41 |
| Persistent storage | yes | yes (17+); installed apps are exempt from the 7-day eviction | asked once | — |
| Compression Streams | yes | yes (16.4+) | QR frames | — |
| `getUserMedia` | yes | yes | QR scan | — |
| Manifest `shortcuts` | yes | **no** | — | (rejected, fourth audit) |
| Web Share Target | yes | **no** | — | (rejected, fourth audit) |
| File System Access pickers | **desktop only** | **no** | — | (auto-backup, rejected) |
| Web Bluetooth | yes | **no** | — | (HR strap, rejected) |
| Speech recognition | yes, server-side | 14.5+, reported flaky | — | (voice, rejected) |
| Web Push | needs a server | installed app only, 16.4+, needs a server | — | (reminders, rejected) |
| Notification Triggers (scheduled) | abandoned | **no** | — | (reminders, rejected) |
| Live Activities, widgets, watch, Health APIs | **no** | **no** | — | (rejected) |

## The Spanish-speaking market, in three lines

Alpha Progression, Hevy, JEFIT and Strong ship Spanish; RP and Boostcamp
— the two apps whose autoregulation N6 and N47 borrow from — are
English-only, so a Spanish-language version of either loop has no direct
competitor. The Spanish round-ups and store listings that market "100 %
offline, sin cuenta" (Blast, Strive) and the one-star reviews of Gym WP
for paywalling everything say the no-account model this app already has
is what that market is asking for. Two locale details to keep as they
are: decimal-comma input (`js/app.js:2969-2971`) and the 20 kg bar with 1.25 kg
plates as the kg defaults (`js/app.js:4227-4228`); one to watch when
publishing blocks (N48) is vocabulary, `jalón` and `press de banca` in
Spain against `polea al pecho` and `press banca` elsewhere.

## Landing order and the bump cascade

If the maintainer takes the headline as it stands: **N2, N4, N16, N29**
first (each S, each one file, together one `CACHE_VERSION` bump if landed
as one PR — they touch different functions); then **N1** on its own (three
validators, its own smoke section for the round-trip, land after nothing
else is in flight in `js/profile-transfer.js`); then **N7** and **N15**
(each a `rir`-shaped map — land one at a time, they edit the same purge
and move helpers plan 025 just fixed, and take the highest version on
conflict); then the tick-discipline spike (carried #10) and **N3** on top
of it; **N6** any time after N2; **N8**'s band any time, its view only
after the product call. **N5** waits on its design decision.

Every `js/` change bumps `CACHE_VERSION` from v-current and lands one PR
at a time; `docs/guide.md` gets a section per feature, the README's
"What it does" list a line, and `AGENTS.md`'s map list every new
per-profile map, since plan 029 found it missing two.

## Not audited

Visual design; the training methodology behind the seeds and the v3
constants; `js/vendor/`, `test/` and `tools/` internals; whether any
option's smoke section fits the 375 px layout; the market subagent's
sources were read for what apps *offer*, not verified for what they
*deliver* — app-store copy overstates. Performance of N9/N31 on a
multi-year log is a slot-count derivation, not a measurement.

## Sources

Read by the market subagent on 2026-09-19. The vendors' own domains and
Reddit were unreachable through the session's egress proxy, so those
entries were read as search-engine summaries of the page named; the
Liftosaur board and the other GitHub pages were fetched in full.

- Hevy — `hevyapp.com/features/…` (track-workouts, workout-settings,
  exercise-programming-options, social-features, live-activity,
  gym-consistency, progress-photos, track-body-measurements,
  workout-plan-generator, `community-updates/july-26`);
  `help.hevyapp.com` articles 33106320824727, 34896293707927,
  35385479603479, 36011896355479, 38385724273047;
  `sensai.fit/blog/hevy-review-2026`; `repreturn.com/hevy-app-review`.
- Strong — `strong.app`; `help.strongapp.io/article/171-warm-up-calculator`;
  `thetaperapp.com/articles/how-to-export-strong-data`;
  `repreturn.com/strong-app-review`.
- Boostcamp — `boostcamp.app/features`, `/workout-tracker`, `/vs/strong`,
  `/pro`; App Store listing id1529354455 (reviews).
- Liftosaur — `github.com/astashov/liftosaur` (README);
  `github.com/astashov/liftosaur/discussions/categories/ideas` (vote
  counts as fetched 2026-09-19), discussions #152 and #264;
  `liftosaur.com/doc/api`, `/doc/mcp`, `/blog/posts/liftosaur-overview`.
- Alpha Progression — `alphaprogression.com/en/blog/alpha-progression-guide`;
  `hotelgyms.com/blog/alpha-progression-the-gym-logger-app-from-germany`;
  `fitnessdrum.com/alpha-progression-app-review`.
- RP Hypertrophy — `rpstrength.com/pages/hypertrophy-app`;
  `dr-muscle.com/rp-hypertrophy-app-review`;
  `mesostrength.com/blog/rp-hypertrophy-alternatives`.
- JEFIT — `jefit.com/support/faq`;
  `jefit.com/blog/best-fitness-apps-tracking-volume-sets-recovery-2026`.
- FitNotes — `fitnotesapp.com/workout_tracking`, `/progress_tracking`;
  `github.com/gueladjo/workout-notes` (a static FitNotes-format reader).
- Setgraph — `setgraph.app`;
  `setgraph.app/ai-blog/best-workout-tracker-app-reddit` (an aggregation
  of the r/Fitness and r/weightroom threads).
- KeyLifts — `keylifts.com`; App Store listing id1437949461.
- Gymaholic — `gymaholic.me`; `regpaq.com/gymaholic-app-review`.
- Juggernaut AI — `juggernautai.app/blog/juggernautai-25`;
  `powerliftingtechnique.com/juggernaut-ai-review`;
  `garagegymreviews.com/juggernautai-review`.
- Fitbod — `fitbod.me/blog/fitbod-insights-feature`; `help.fitbod.me`
  articles 16436302450711, 12732749777047;
  `fitbod.zendesk.com/hc/en-us/articles/360006269014`.
- Gravitus — `gravitus.com`; `gravitus.com/strength-standards`.
- Progression (Android) — Play Store listing
  `workout.progression.lite`.
- RepCount — `repcountapp.com`; `justuseapp.com/en/app/594982044/…/reviews`.
- StrongLifts — `stronglifts.com/app`; `support.stronglifts.com/article/71-increments`,
  `/87-warmup`, `/154-plate-calculator`.
- Mesostrength / round-ups — `mesostrength.com/blog/best-hypertrophy-training-apps`;
  `hypro.app/blog/best-workout-tracker-apps`;
  `pontefuerteai.com/blog/best-gym-app-reddit-recommends-2025`.
- Partner apps — `tonal.com/blogs/all/discover-tonals-partner-workouts`;
  Play Store listing `com.gymbuddy2026.app`;
  `getfitcraft.com/blog/best-fitness-apps-for-couples`.
- Voice and accessibility — `sleetgymtracker.com/blog/voice-logging-gym-tracker`;
  App Store listing id6751173250 (QuickSets).
- Spanish market — `vivagym.com/es-es/las-8-apps-para-mejorar-tu-entrenamiento`;
  `androidphoria.com/aplicaciones/mejores-apps-para-registrar-entrenamientos-progreso-gym-gratis`;
  App Store (ES) listing id1524374229 (Gym WP, reviews); `fitkeeperapp.com`.
- Platform — `magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide`;
  `progressier.com/pwa-capabilities/screen-wake-lock`;
  `developer.chrome.com/docs/web-platform/notification-triggers`;
  `developer.chrome.com/docs/capabilities/web-apis/badging-api`;
  `web.dev/blog/compressionstreams`; `webkit.org/blog/14403/updates-to-storage-policy`;
  `developer.mozilla.org/…/Manifest/Reference/share_target`;
  `instantpwa.com/answers/pwa-bluetooth-access`;
  `testmuai.com/learning-hub/speech-recognition-api-browser-support`.
