# Plan 023: Every imported string in the AI round-trip document is delimited — block name, priority tags, verdict tags and session notes included

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- js/app.js js/review.js js/block-editor.js js/diagnostics.js test/unit.js sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

Two features hand the user a text document to paste into a language model:
"Copiar prompt para tu IA" (asks the model to write the next block) and the
block review's export (tells the model how the last block went). Both embed
strings that arrive from outside the app — a pasted or scanned block, a
published `blocks/*.json`, a partner's profile file. Plan 016 established
the rule that every such string is delimited with `«…»` so that a name
cannot read as an instruction to the model, and recorded the rule as
closed.

At `4f7e037` five interpolations are still raw: the block name and the
priority-muscle list in the prompt (both added *by* plan 016's own
implementation), the block name and the priority list in the review, the
muscle tag inside the "Funciona, y con margen" verdict, and the session
note. 80 characters of attacker-chosen prose sitting next to the app's own
instructions is enough to steer the model — and the reply comes straight
back into the app as JSON through the review sheet's paste box. The cost is
also documentary: plan 016 is now a decision record that says something
false.

After this plan every one of those sites goes through the one delimiting
helper, the helper lives where both files can reach it, and unit assertions
pin each site.

## Current state

Files:

- `js/review.js` — the block review and its export text. `reviewName`
  (line 36) is the helper; `reviewText` (line 158) builds the document.
- `js/block-editor.js` — `buildAiPrompt` (near line 444) builds the prompt;
  lines 514–526 assemble the "Lo que la app ya sabe" context.
- `js/diagnostics.js` — `diagVerdict` (line 542) writes the verdict text;
  lines 626–636 embed a muscle tag.
- `js/app.js` — where the helper must move to (see the split rule below);
  `esc` is at line 35.
- `test/unit.js` — the 016 section "the round-trip text carries the app's
  own context" at lines 2359–2435 is the pattern and the place to extend.
- `sw.js` — `CACHE_VERSION` at line 21 (`'v68'`).

The helper — `js/review.js:31-36`:

```js
/* Exercise names, day names and muscle tags arrive from imports and go
   into a document written for a language model. Delimited, so a name
   cannot read as an instruction to the model; `txt()` already collapsed
   whitespace on the way in, so the only characters to strip are the
   delimiters themselves. */
const reviewName = s => '«' + String(s == null ? '' : s).replace(/[«»]/g, '') + '»';
```

Its current callers: `js/review.js:189` (`reviewName(m.tag)`), `:205`
(`reviewName(x.name)`, `reviewName(x.day)`), `:224` (`reviewName(n.day)`).

The raw sites:

`js/block-editor.js:520-524`:

```js
    const ctx = [
      'Entreno ' + (soloMode() ? 'solo' : 'en pareja') + '.',
      'Peso en ' + units() + '. Incremento por defecto: ' + p.inc + ' ' + units() + '. Barra: ' + p.barWeight + ' ' + units() + '. Discos por lado: ' + p.plates.join(', ') + '.',
      'Mi bloque actual, "' + block.name + '", tiene ' + days.length + (days.length === 1 ? ' día' : ' días') + ' por semana y ' +
        blockWeeks(block) + ' semanas' + (dl ? ', con descarga en la semana ' + dl : ', sin descarga') + '.',
      priority.length ? 'Músculos prioritarios: ' + priority.join(', ') + '.' : '',
```

`js/review.js:163` and `:167`:

```js
  L.push('## Cómo fue el bloque anterior ("' + r.name + '")');
  …
  if (r.priority.length) L.push('- Músculos que marqué como prioritarios: ' + r.priority.join(', ') + '.');
```

`js/review.js:205` embeds `x.lectura` and `x.cambio`, which for one verdict
branch contain a muscle tag verbatim — `js/diagnostics.js:631-635`:

```js
    if (sig.volLow) {
      return { lectura: 'Funciona, y con margen: ' + sig.volTag + ' se queda por debajo de la franja de series' +
                 (sig.volPriority ? ', siendo prioritario' : ''),
               cambio: 'Va bien con pocas series. Si quieres más, añádeselas a ' + sig.volTag + ' antes que a nada.' };
    }
```

`js/review.js:224`:

```js
      L.push('- Semana ' + n.week + ', ' + reviewName(n.day) + ': ' + n.text);
```

(`n.text` is the session note — the user's own text on this phone, but it
arrives from a partner's profile file or a QR "perfil" too.)

**The split rule that decides where the helper lives** (`AGENTS.md`, "No
modules"): `js/block-editor.js` counts as part of `js/app.js` (it predates
the split), and *a symbol another split file reads stays in `app.js`
outright*. `js/review.js` and `js/diagnostics.js` are split files. Today
`reviewName` is defined in `review.js` and read only there; once
`block-editor.js` and `diagnostics.js` read it too, it must be defined in
`js/app.js`. It cannot be defined in both — the thirteen scripts share one
global scope, and a second top-level `const reviewName` is a parse error
that leaves the app on "Cargando tu registro…" (the incident `AGENTS.md`
describes). `test/unit.js` loads every script into one vm context, so a
duplicate throws there first.

The 016 unit assertions to extend — `test/unit.js:2359-2378` (excerpt):

```js
  console.log('\n== the round-trip text carries the app\'s own context (plans/016) ==');
  call('state = defaultState(); migrate(); state.setupDone = true; state.prefs.units = "kg";');
  const ownPrompt = await call('buildAiPrompt({ withBlock: true })');
  …
  ok('with the app set up, the prompt carries the current block as JSON',
     ownPrompt.indexOf('Mi bloque actual') >= 0 && ownPrompt.indexOf(ownPlan) >= 0, ownPrompt.slice(-200));
  …
      day.ex[0].n = 'Press «raro» de banca';
  …
  const review = call('reviewText(buildBlockReview(getProfile(), getBlock()))');
  ok('with the name delimited and the delimiters stripped from it',
     review.indexOf('- «Press raro de banca» (') >= 0, (review.match(/- «Press.*/) || [''])[0]);
```

`diagVerdict` is pure and is already asserted directly at
`test/unit.js:799-810` (`call('diagVerdict("up", {}).lectura') === 'Funciona'`).

No smoke or unit assertion pins the "Funciona, y con margen" text
(verified: `grep -n "franja de series" test/*.js` is empty), so delimiting
the tag at its source changes nothing a test reads. It does change what the
Diagnóstico sheet shows on screen for that verdict (`«Pecho»` instead of
`Pecho`), which is consistent with how the review already shows names.

Conventions: Spanish for user-visible text, English why-comments; no
inline styles; bump `CACHE_VERSION` because `js/` changes; rungs 1–2 after
every edit, no full smoke run.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `for f in js/app.js js/review.js js/block-editor.js js/diagnostics.js; do node --check $f; done` | exit 0 |
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| Bump the cache | `bash tools/bump-cache-version.sh` | next version written to `sw.js` |

## Scope

**In scope**:
- `js/app.js` (add the helper next to `esc`)
- `js/review.js` (remove the helper; two call sites)
- `js/block-editor.js` (two call sites)
- `js/diagnostics.js` (two call sites in one verdict)
- `test/unit.js`
- `sw.js` (bump only)

**Out of scope**:
- Any other string in the prompt or review: exercise names, day names and
  muscle rows are already delimited. Numbers and the app's own sentences
  are not imported.
- `txt()`, `esc()`, `IMPORT_LIMITS` — the input side is not the problem.
- The Diagnóstico sheet's layout.

## Git workflow

- Branch: `claude/023-ai-document-delimits-<6 hex chars>`.
- Two commits: `Move reviewName to app.js so the prompt and the Diagnóstico can use it`, then `Delimit the block name, priority tags, verdict tag and notes in the AI text`. Trailer on each:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Move the helper to `js/app.js`

Cut the comment and the `const reviewName = …` line from
`js/review.js:31-36`. Paste them into `js/app.js` directly after `esc`
(after line 37, before the `num` helper), widening the comment's first
sentence to name every kind of string it now covers: exercise names, day
names, block names, muscle tags and session notes. Add one sentence saying
why it lives here: `js/block-editor.js` and `js/diagnostics.js` read it,
and a symbol another file reads stays in `app.js` (`AGENTS.md`).

Leave a one-line pointer where it was in `js/review.js` ("`reviewName`
lives in js/app.js — the prompt and the Diagnóstico use it too").

**Verify**: `node --check js/app.js && node --check js/review.js` → exit 0.
`node test/unit.js` → `0 failed` (this is also the duplicate-declaration
check: a `reviewName` left in both files throws at load).

### Step 2: Delimit the five sites

- `js/block-editor.js:522`: `'Mi bloque actual, "' + block.name + '", tiene '`
  → `'Mi bloque actual, ' + reviewName(block.name) + ', tiene '`.
- `js/block-editor.js:524`: `priority.join(', ')` → `priority.map(reviewName).join(', ')`.
- `js/review.js:163`: `'## Cómo fue el bloque anterior ("' + r.name + '")'`
  → `'## Cómo fue el bloque anterior (' + reviewName(r.name) + ')'`.
- `js/review.js:167`: `r.priority.join(', ')` → `r.priority.map(reviewName).join(', ')`.
- `js/review.js:224`: `n.text` → `reviewName(n.text)`.
- `js/diagnostics.js:632` and `:634`: both `sig.volTag` → `reviewName(sig.volTag)`.
  Add a two-line comment above the `if (sig.volLow)` saying the tag is
  imported and this sentence is exported verbatim into the review, so it is
  delimited here rather than parsed out again in `js/review.js`.

**Verify**: syntax check all four files → exit 0.
`grep -n "block.name\|r.name\|priority.join\|sig.volTag\|n.text" js/block-editor.js js/review.js js/diagnostics.js`
→ every remaining hit is either inside `reviewName(…)` or is not one of the
five sites (e.g. `block.name` used for the sheet title, which is DOM text
set via `textContent`, not the AI document).

### Step 3: Pin each site

In `test/unit.js`, inside the 016 section, before `const ownPrompt = …`
(line 2361), set a hostile block name and priority list on the current
block:

```js
  call('getBlock().name = "Bloque «raro» 2"; getBlock().priority = ["Pecho «x»", "Espalda"];');
```

This works because both readers take the stored list as it is:
`blockPriority` (`js/app.js:1460`) is `block.priority` or `[]`, and
`cleanPriority` (`js/app.js:1466`) — `safeKey(txt(v, MUSCLE_LIMIT))`,
de-duplicated, capped at `PRIORITY_MAX` — runs only when a list is
*written* (plan-editor save, import), never on read, and does not filter
tags against the block's exercises. `«` and `»` survive `txt()`. The
review reads the same `blockPriority(block)` at `js/review.js:143`.

and add after the existing prompt assertions:

```js
  ok('the block name in the prompt is delimited and its own delimiters stripped',
     ownPrompt.indexOf('Mi bloque actual, «Bloque raro 2», tiene') >= 0, ownPrompt.slice(0, 600));
  ok('and so is every priority tag',
     ownPrompt.indexOf('Músculos prioritarios: «Pecho x», «Espalda».') >= 0, ownPrompt.slice(0, 600));
```

After the existing review assertions (around line 2378), add:

```js
  ok('the review heading delimits the block name',
     review.indexOf('## Cómo fue el bloque anterior («Bloque raro 2»)') >= 0, review.slice(0, 200));
  ok('and the priority line delimits each tag',
     review.indexOf('prioritarios: «Pecho x», «Espalda».') >= 0, (review.match(/prioritarios.*/) || [''])[0]);
```

Directly after the `diagVerdict` assertions (line 810), add:

```js
ok('the volume-margin verdict delimits the imported muscle tag',
   (() => { const v = call('diagVerdict("up", { volLow: true, volTag: "Pecho «x»" })'); return v.lectura.indexOf('«Pecho x»') >= 0 && v.cambio.indexOf('«Pecho x»') >= 0; })());
```

For the session note, in the 016 section's seeding block (the `call(\`…\`)`
that writes `pr.log`), also write a note: `pr.notes[blockId] = { [slot(2,
day.id)]: 'nota «rara»' };` (check `profile.notes` is keyed the same way
`getNote` reads it — `grep -n "^function getNote" js/app.js`), then assert
`review.indexOf(': «nota rara»') >= 0`. If the review omits notes unless
`r.notes.length` (it does, `js/review.js:219`), the seeded note must reach
`buildBlockReview` — check how it collects notes (`grep -n "notes" js/review.js`)
and seed whatever it reads.

Then restore the block name after the section so later sections see the
seed name (`call('getBlock().name = "…"')` with the original, or re-seed
`state = defaultState()` as the next section already does — check line
2437 onward).

**Verify**: `node test/unit.js` → `0 failed`, at least 6 more assertions.
Run once with Step 2 reverted (`git stash`) and confirm the new assertions
FAIL, then `git stash pop`.

### Step 4: Bump the cache version

`bash tools/bump-cache-version.sh`.

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → above v68.

## Test plan

- New unit assertions: prompt block name, prompt priority tags, review
  heading, review priority line, verdict tag (lectura + cambio), session
  note.
- Existing to keep green: all of the 016 section (2359–2435), the five
  `diagVerdict` lines (799–810).
- Pattern: the 016 section's `ownPrompt` / `review` string assertions.

## Done criteria

- [ ] `grep -n "const reviewName" js/*.js` prints exactly one line, in `js/app.js`
- [ ] `grep -c "reviewName(" js/review.js` ≥ 6 and `grep -c "reviewName(" js/block-editor.js` = 2 and `grep -c "reviewName(" js/diagnostics.js` = 2
- [ ] `node --check` exits 0 on all four files
- [ ] `node test/unit.js` exits 0 with `0 failed`, ≥ 6 assertions more than at `4f7e037` (356), and the new ones fail with Step 2 reverted
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a version above v68
- [ ] `git status --short` lists only the six in-scope files
- [ ] `plans/README.md` status row for 023 updated

## STOP conditions

- `reviewName` is already defined in `js/app.js` at `HEAD` (someone moved
  it) — re-anchor and skip Step 1, but check for a leftover in `review.js`.
- `js/block-editor.js` or `js/diagnostics.js` runs `reviewName` at *load
  time* (top level) rather than inside a function — it would run before
  `app.js` defines it. Neither does at `4f7e037`; if that changed, stop.
- The 016 section at `test/unit.js:2359` has moved or no longer builds
  `ownPrompt`/`review` the way the excerpt shows.
- A smoke section turns out to assert the exact "Funciona, y con margen"
  text (it does not at `4f7e037`) — update that assertion in the same
  change and note it in the PR.

## Maintenance notes

- The rule: any string that came from an import and is written into text
  destined for a model goes through `reviewName`. New fields added to the
  prompt (`buildAiPrompt`) or the review (`reviewText`, `diagVerdict`) must
  follow it; a reviewer should grep the diff of those functions for `+`
  concatenations of `block.`, `ex.`, `x.`, `r.` or `sig.` string fields.
- `reviewName` strips only `«»`; it relies on `txt()` having collapsed
  newlines on the way in. If an import path ever stops running `txt()`,
  the delimiter is no longer sufficient on its own.
- The Diagnóstico sheet now shows the tag as `«Pecho»` inside that one
  verdict. If that reads badly on screen, the alternative is to return the
  tag as a separate field from `diagVerdict` and delimit only in
  `reviewText` — a bigger change than this plan; the current choice is the
  smaller one.
- Plan 016's text in `plans/done/016-…md` remains as written; the index
  records this regression so the next audit does not re-derive it.
