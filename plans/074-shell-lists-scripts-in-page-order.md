# Plan 074: `sw.js`'s `SHELL` lists the page's scripts in the page's order, and the unit suite holds it there

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If a STOP condition occurs, stop and report — do not
> improvise. Fill in "Maintenance notes" when done; the orchestrator
> maintains `plans/README.md` — do not edit it.
>
> **One PR** (`claude/074-shell-order`). It changes `sw.js`, so it
> **bumps `CACHE_VERSION`** once, as its last commit.
>
> **Drift check (run first)**: `git diff --stat dfa29a9..origin/main -- sw.js test/unit.js AGENTS.md index.html test/harness.js`
> — plans 075–077 run at the same time and touch `test/unit.js`,
> `AGENTS.md` and (076, 077) `sw.js`'s version line, in other places.
> Re-find each excerpt below by its quoted text; a changed meaning is a
> STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (the order of a precache list has no runtime meaning)
- **Depends on**: none
- **Category**: tech-debt / tests
- **Planned at**: commit `dfa29a9`, 2026-09-23 — the maintainer asked for
  the topics plan 072 had set aside to be done after all

## Why this matters

Three lists name the shell's scripts: the `<script>` tags in `index.html`,
`SHELL_SCRIPTS` in `test/harness.js`, and `SHELL` in `sw.js`. The first two
are in the same order, and the unit suite holds them to it. `SHELL` is
not: it lists `js/app.js` fifth and `js/data.js` last, the order files were
added over time. The order means nothing to the service worker, which
precaches the list as a set. But three lists in two orders are harder to
compare by eye, and AGENTS.md said for a long time that all three are held
"in the same order", which plan 070 corrected to "`SHELL` to membership
only". The maintainer asked for the lists to agree instead. After this
plan they do, and a test keeps them that way.

## The decisions (settled — do not re-open)

1. **`SHELL`'s script entries follow `index.html`'s order.** The target
   list is `'./'`, `'index.html'`, `'js/theme-init.js'`, `'css/style.css'`,
   then the twelve body scripts in tag order, then everything after
   `js/data.js` today (`manifest.webmanifest`, the icons and their comment),
   unchanged. The twelve are `js/data.js`, `js/block-editor.js`,
   `js/diagnostics.js`, `js/review.js`, `js/profile-transfer.js`,
   `js/calculator.js`, `js/rest-timer.js`, `js/chart.js`,
   `js/volume-sheet.js`, `js/qr-transfer.js`, `js/app.js`,
   `js/boot-guard.js`. `js/theme-init.js` and `css/style.css` keep their
   places, which already match the page's `<head>`. Nothing is added or
   removed, and `VENDOR` is untouched.
2. **The unit suite holds the order**: a new assertion in the section "the
   four script lists agree" requires `SHELL`'s entries that are
   `index.html` scripts to appear in exactly `index.html`'s order.
3. **A bump.** CI and the deploy guard only count `index.html`, `css/` and
   `js/` as the shell, so they would let this through without one. But a
   byte-changed `sw.js` is a new worker to every phone either way, and a
   new `CACHE_VERSION` makes it an ordinary release: a fresh cache, and
   the old one deleted on activate.
4. **AGENTS.md's release rule says the lists agree in order again**, in
   the sentence plan 070 wrote about membership.

## Current state

`sw.js:32-55` — `SHELL` today:

```js
const SHELL = [
  './',
  'index.html',
  'js/theme-init.js',
  'css/style.css',
  'js/app.js',
  'js/block-editor.js',
  'js/diagnostics.js',
  'js/review.js',
  'js/profile-transfer.js',
  'js/calculator.js',
  'js/rest-timer.js',
  'js/chart.js',
  'js/volume-sheet.js',
  'js/qr-transfer.js',
  'js/boot-guard.js',
  'js/data.js',
  'manifest.webmanifest',
  'icon.svg',
  /* The PNGs the install prompt reads: … */
  'icon-192.png',
  …
];
```

`test/harness.js:44` — `SHELL_SCRIPTS`, the order to match: `js/theme-init.js`,
then the twelve in the order of decision 1.

`test/unit.js`, section `== the four script lists agree (AGENTS.md:
index.html, sw.js SHELL, loadApp, js/) ==` (search for it). It already
builds `indexScripts` (the `<script src="js/…">` tags of `index.html`, in
order) and `shellFiles` (`SHELL`'s entries, comments stripped), and
asserts:
- "index.html loads exactly the files loadApp() loads, in the same order";
- "every index.html script is in sw.js SHELL";
- "every js/*.js file is a script tag in index.html";
- "every js/ entry in SHELL exists on disk".

`AGENTS.md` § "The release rule", second paragraph:

```
… `test/unit.js` closes the rest
of that circle ("the four script lists agree", plans/014): it holds
`index.html` and `SHELL_SCRIPTS` in `test/harness.js` to the same files in
the same order, and `SHELL` to membership only — every `index.html` script
is in it, and every `js/` entry in it exists on disk. The deploy workflow
…
```

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Syntax | `node --check sw.js` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| Bump (last commit) | `bash tools/bump-cache-version.sh` | `sw.js` one version up |
| CR check | `node -e "for (const f of ['sw.js','test/unit.js','AGENTS.md']) console.log(f, (require('fs').readFileSync(f,'utf8').match(/\r/g)\|\|[]).length)"` | `0` each |

## Scope

**In scope**: `sw.js` (the order of `SHELL`'s entries, then the bump),
`test/unit.js` (one assertion in the section above), `AGENTS.md` (the one
sentence above), this plan's Maintenance notes.

**Out of scope**: every other line of `sw.js` (`VENDOR`, the handlers,
`CACHE_VERSION` except through the tool), `index.html`,
`test/harness.js`, `.github/`, the loadWorker tests (plan 066). They do
not depend on the order; if one fails, that is a STOP.

## Git workflow

`git fetch origin && git checkout -B claude/074-shell-order --no-track origin/main`;
plain-sentence commit subjects; the bump is the last commit.

## Steps

### Step 1: reorder `SHELL`

Move `'js/app.js'` from after `'css/style.css'` to after
`'js/qr-transfer.js'`, and `'js/data.js'` from after `'js/boot-guard.js'`
to right after `'css/style.css'`. Check the result against decision 1
entry by entry. No other line of `sw.js` changes. Add no comment: the
new test says why the order holds.

**Verify**: `node --check sw.js` → exit 0; `node test/unit.js` →
`0 failed` (same count as your baseline).

### Step 2: the assertion

In the section "the four script lists agree", right after "every
index.html script is in sw.js SHELL":

```js
ok('sw.js SHELL lists index.html\'s scripts in index.html\'s order',
   JSON.stringify(shellFiles.filter(f => indexScripts.includes(f))) === JSON.stringify(indexScripts),
   JSON.stringify(shellFiles.filter(f => indexScripts.includes(f))));
```

Precede it with a short comment. The order means nothing to the worker;
it is held so the three lists read the same (plans/074).

**Mutation check**: swap `'js/app.js'` and `'js/boot-guard.js'` in
`SHELL`. The new assertion FAILs, and the others still pass. Revert, and
it PASSes. Report it.

**Verify**: `node test/unit.js` → `0 failed`, one more pass than Step 1.

### Step 3: AGENTS.md

Replace the sentence quoted above ("it holds … exists on disk.") with one
saying that the check holds `index.html`, `SHELL_SCRIPTS` and `SHELL`'s
scripts to the same files in the same order, and every `js/` entry in
`SHELL` to a file on disk. Change nothing else in the file.

**Verify**: `node test/unit.js` → `0 failed` (the docs link check
included).

### Step 4: the bump

`bash tools/bump-cache-version.sh`, committed as "Bump the shell to vNNN".
Rebase and re-bump at push time if `origin/main` moved (your brief says
how).

## Test plan

One new assertion and its mutation check. The worker's own tests
(`== sw.js runs: install, activate, fetch, the swap (plans/066) ==`) must
stay green unchanged. The PR hook's browser suite, which includes the
worker sections, runs when you open the PR.

## Done criteria

- [ ] `SHELL`'s script entries are in `index.html`'s order; nothing
      added or removed (`git diff sw.js` shows only moved lines and the
      version)
- [ ] the new assertion passes, and fails under the mutation
- [ ] AGENTS.md's release rule says "in the same order" for all three
- [ ] `node test/unit.js` → `0 failed`; CR check `0`; one bump, last

## STOP conditions

- Any existing test fails after Step 1 (something did depend on the
  order).
- `index.html`'s script tags are not in `SHELL_SCRIPTS`' order on
  `origin/main`.

## Maintenance notes

- A new shell script goes into `SHELL` at its tag's position, not at the
  end. The new assertion says so when it is missed.
- *(Executor: record deviations here.)*
