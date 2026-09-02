# Plan 007: Write `AGENTS.md` so the repo's load-bearing invariants stop being rediscovered

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f9afbe0..HEAD -- README.md index.html sw.js js/`
> If any in-scope file changed since this plan was written, re-read the
> sections you are transcribing from before writing them down.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `f9afbe0`, 2026-09-02

## Why this matters

Every merge commit in the last 60 — 24 of 24 — arrives as a pull request from
a `claude/*` branch. Agents are effectively the only contributor to this
repository, and there is no repo-scoped `AGENTS.md` or `CLAUDE.md`. Each
session re-derives the same handful of invariants from scratch, and getting
one wrong has already shipped a user-visible crash: commit `5ed2906`, *"Fix
stuck-loading crash for returning users after the app.js split"*, whose
remedy is now a guard with a nine-line comment at `js/app.js:4707-4717`
explaining what it protects against.

The invariants are not discoverable from the code alone — several are
*deliberate absences* (there is no build step **on purpose**; there is no
module system **on purpose**), and an absence looks identical to an oversight
unless someone wrote down which it is. That is exactly what this file is for.

The information already exists, scattered across `README.md`, inline comments
and CI config. This plan does not invent guidance; it **transcribes what is
already true** into the one file an agent reads first.

## Current state

There is no `AGENTS.md` and no `CLAUDE.md` anywhere in the tree. `.claude/`
contains only `settings.json` (an empty `PreToolUse` hooks array) and a local
permission allowlist.

The source facts you will transcribe — read each before writing about it:

1. **No build step, on purpose.** `README.md:1433-1447` ("Running locally").
   Plain HTML/CSS/JS, served by any static server. There is no `package.json`.
2. **Six scripts, one global scope, order matters.** `index.html:479-484`:

```html
<script src="js/data.js"></script>
<script src="js/block-editor.js"></script>
<script src="js/diagnostics.js"></script>
<script src="js/review.js"></script>
<script src="js/profile-transfer.js"></script>
<script src="js/app.js"></script>
```

3. **The `wire*()` deferral rule, and why.** `js/app.js:4705-4720`:

```js
wireBlockEditor();
/* Guarded, unlike wireBlockEditor/wireProfileTransfer, because these two
   files are newer than some already-deployed shells: a returning user
   whose service worker still holds the previous index.html can be served
   this app.js against markup that has no script tag for them yet. An
   unguarded call would throw here, load() below would never run, and the
   app would sit on "Cargando tu registro…" — the same stuck screen the
   first script split caused. Losing a button until the worker updates is
   the right failure. */
if (typeof wireDiagnostics === 'function') wireDiagnostics();
if (typeof wireReview === 'function') wireReview();
wireProfileTransfer();

load();
enableWebfont();
registerServiceWorker();
```

4. **The `CACHE_VERSION` rule.** `README.md:1445-1455` and the `cache-version`
   job in `.github/workflows/test.yml`, which fails a PR when `index.html`,
   `css/` or `js/` change and `sw.js`'s `CACHE_VERSION` does not. New files
   must also be added to the `SHELL` array in `sw.js`.
5. **How to run the tests.** `README.md:1457-1475`, plus the CI workflow —
   which reveals a step the README omits: `npm install --no-save playwright@1.56.1`.
   Without it a clean clone fails with `Cannot find module 'playwright'`.
6. **The testing policy.** `test/smoke.js:9-10`: *"Add a case here whenever a
   bug turns out to have been invisible from the outside."*
7. **Untrusted input is bounded and escaped.** `js/app.js:20-24` (`esc`),
   `js/app.js:2030-2036` (`IMPORT_LIMITS` and the reasoning above it),
   `js/block-editor.js:198` (`normalizeImportedBlock`).
8. **The CSP is strict and deliberate.** `index.html:4-9`. No inline scripts —
   the webfont flip is done in a real script *because* the CSP has no room for
   an inline `onload` (`index.html:27-31`).
9. **Documented limits that are decisions, not bugs.** `README.md:1496-1516`:
   Spanish only; no sync; QR transfer one-way and manual; undo one level deep
   and not surviving a reload; exactly two profiles.
10. **Comment style.** Comments explain *why*, in prose, often naming the bug
    they prevent. This is the repo's most distinctive convention and the
    easiest for an agent to violate.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Confirm no manifest exists | `ls package.json` | "No such file" |
| Confirm the claim about tests | `npm install --no-save playwright@1.56.1 && node test/smoke.js` | 0 failures |
| Check CI triggers | `grep -n "^on:" -A3 .github/workflows/test.yml` | `pull_request`, `workflow_dispatch` |

## Scope

**In scope**:

- `AGENTS.md` (create, repo root)
- `README.md` — at most one line pointing contributors at it

**Out of scope**:

- **Any file under `js/`, `css/`, `index.html` or `sw.js`.** This plan writes
  documentation only. No `CACHE_VERSION` bump is needed, and CI will not ask
  for one.
- `.claude/settings.json` and `.claude/settings.local.json` — do not modify;
  the local file is a personal permission allowlist.
- Creating a `CLAUDE.md` **as well**. Write one file. `AGENTS.md` is the
  broader convention and is read by Claude Code; a second file duplicating it
  is a drift hazard.
- Restructuring `README.md`. It is 84 KB, actively maintained and accurate —
  `AGENTS.md` links to it rather than repeating it.

## Git workflow

- Branch: `advisor/007-agents-md`
- One commit. Message style: short imperative sentence, no prefix.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Verify every factual claim before writing it

Do not transcribe from this plan alone — the repo is the source of truth and
may have moved. For each of the ten items in "Current state", open the cited
file and confirm it still says what is quoted. Note any that have drifted; if
a *rule* has changed, STOP and report rather than documenting the old one.

**Verify**: you can state, for each of the ten items, the file and line you
confirmed it at.

### Step 2: Write `AGENTS.md`

Create `AGENTS.md` in the repo root. Target **120-200 lines** — long enough to
carry the invariants, short enough to be read in full every session. Prefer
the imperative, and give a reason for every rule; a rule an agent does not
understand is one it will optimise away.

Cover, in roughly this order:

**What this is** — two sentences. A Spanish-language gym training log for two
people, shipped as a static PWA to GitHub Pages, all data in `localStorage`,
no server.

**The constraints that are decisions, not gaps** — the most important section.
Make it unambiguous that these are deliberate:

- No build step, no bundler, no `package.json`, no TypeScript. Do not add one.
- No modules. Six `<script>` tags share one global scope, in the fixed order
  at `index.html:479-484`. `js/app.js` loads last because it wires the others
  and then calls `load()`.
- A file other than `app.js` must keep **all** DOM wiring inside its
  `wire*()` function, called from `app.js`'s tail. Quote the guard comment at
  `js/app.js:4707-4717` and say plainly what it cost to learn: a returning
  user's cached `index.html` may not have a `<script>` tag for a newly added
  file, so `app.js` must tolerate its absence.
- Spanish for everything a user sees; English for code comments.

**The release rule** — bump `CACHE_VERSION` in `sw.js` whenever `index.html`,
`css/` or `js/` change, and add any new shell file to the `SHELL` array. Say
that CI enforces the first half and *not* the second, so the array is on the
author.

**How to verify a change**, with exact commands:

```
npm install --no-save playwright@1.56.1   # once — the README omits this
npx playwright install chromium           # once
python3 -m http.server 8765 &
node test/smoke.js
```

Add `node --check js/<file>.js` as the fast syntax gate. **If
`plans/003-headless-assertion-layer.md` has landed, add `node test/unit.js`
here as the fastest check of all** — check whether `test/unit.js` exists
before writing that line.

**Testing policy** — quote `test/smoke.js:9-10`. A bug that was invisible from
the outside gets a smoke case, not a quiet fix.

**Untrusted input** — anything arriving from a file, a paste, the repo's
`blocks/`, or a QR scan is untrusted. It goes through a `normalizeImported*`
function and is escaped with `esc` on the way out. Point at
`js/block-editor.js:198` as the reference implementation.

**The CSP** — strict, in a `<meta>` tag at `index.html:9`, and no inline
scripts or styles may be added. Note that this is why the webfont flip lives
in a real script.

**Comment style** — the repo's most distinctive convention. Comments explain
*why*, frequently naming the bug they prevent. Include one real example
transcribed from the source so the register is unmistakable; the
`showRecovery` header at `js/app.js:882-886` or the `CACHE_VERSION` comment at
`sw.js:14-18` both work well.

**Documented limits** — list the five from `README.md:1496-1516` and say
plainly that they are settled decisions. An agent proposing to "fix" the
Spanish-only UI or add sync is re-litigating a choice, not finding a gap.

**Where things live** — a short pointer table, or a link to
`README.md:1477-1495`, which already has one. Do not duplicate it.

**Verify**: `wc -l AGENTS.md` → between 120 and 200.

### Step 3: Point at it from the README

Add one line to `README.md`, in or just before the "Project layout" section
(~line 1477). Something in the README's voice, e.g.:

```
Working on this with an AI agent? `AGENTS.md` has the invariants that are
easy to break and hard to see — the script load order, the `CACHE_VERSION`
rule, and which of this project's absences are deliberate.
```

**Verify**: `grep -n "AGENTS.md" README.md` → at least one match.

### Step 4: Check it against reality

The test of this file is whether it is *correct*, not whether it exists. Run
the commands you documented, exactly as written, and confirm each behaves as
described:

- `node --check js/app.js` → exit 0
- `npm install --no-save playwright@1.56.1` → succeeds
- `python3 -m http.server 8765 &` then `node test/smoke.js` → 0 failures
- If you documented `node test/unit.js`, run it → 0 failures

Any command in `AGENTS.md` that you have not personally run must be removed.

**Verify**: every command block in `AGENTS.md` has been executed successfully
in this session.

## Test plan

There is no automated test for a documentation file. The verification is
behavioural:

- Every command in `AGENTS.md` was run and worked (Step 4).
- Every factual claim traces to a file and line confirmed in Step 1.
- The file contains no rule the repo does not actually follow. **A confidently
  wrong `AGENTS.md` is worse than none** — it will be trusted.

## Done criteria

ALL must hold:

- [ ] `AGENTS.md` exists at the repo root, between 120 and 200 lines
- [ ] `grep -c "js/app.js\|index.html\|sw.js" AGENTS.md` returns 5 or more (it cites real locations, not vague advice)
- [ ] `grep -n "CACHE_VERSION" AGENTS.md` returns a match
- [ ] `grep -n "wire" AGENTS.md` returns a match (the deferral rule is documented)
- [ ] `grep -n "playwright" AGENTS.md` returns a match (the undocumented install step is now documented)
- [ ] `grep -n "AGENTS.md" README.md` returns a match
- [ ] Every command block in `AGENTS.md` was executed successfully during Step 4
- [ ] `git status` shows only `AGENTS.md` (new) and `README.md` modified — **no source file changed**
- [ ] `ls package.json` still reports no such file
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A rule in "Current state" no longer matches the repo — document what is
  true, and report the discrepancy rather than silently choosing one.
- A command you are about to document does not work. Do not document an
  aspirational workflow.
- You find yourself wanting to change source code to match something you
  wrote. The file describes the repo; the repo does not follow the file.
- You are tempted to write both `AGENTS.md` and `CLAUDE.md`. One file.

## Maintenance notes

For whoever owns this next:

- **This file goes stale silently, and stale guidance is trusted guidance.**
  The highest-risk entries are the script list (changes when a file is split
  out of `app.js`) and the test commands. Any PR that adds or renames a file
  under `js/` should touch `AGENTS.md` in the same commit.
- **The `wire*()` rule is the one with a scar behind it** (commit `5ed2906`).
  If a future change makes the guard at `js/app.js:4707-4717` unnecessary —
  for instance, if the service worker ever stops serving a stale
  `index.html` — that section needs revisiting rather than deleting.
- **Keep it short.** The value is that it gets read in full. If it grows past
  ~200 lines, move detail into `README.md` and link to it; the README is the
  reference, `AGENTS.md` is the briefing.
- **What a reviewer should scrutinise**: not the prose, but whether each claim
  is true today. Spot-check three citations at random against the source.
