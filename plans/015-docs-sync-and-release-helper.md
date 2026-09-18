# Plan 015: The agent briefing, README and vendor recipe match the code, and the release bump is one command

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 6def9fc..HEAD -- AGENTS.md README.md js/vendor/README.md tools/`
> Also re-derive every line number below with the greps given — they are
> the point of this plan and may have moved again.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (no app code changes; **no `CACHE_VERSION` bump**)
- **Depends on**: 014 (its script-list test makes one AGENTS.md sentence obsolete; land 014 first or phrase Step 2 conditionally)
- **Category**: docs + dx
- **Planned at**: commit `6def9fc`, 2026-09-18
- **Overlap**: `plans/009-architecture-deepening.md` item 8 re-anchors the
  same four AGENTS.md references. If it has landed, Step 1 is a check, not
  an edit.

## Why this matters

`AGENTS.md` exists so each agent session stops re-deriving the same
invariants, and it says a wrong one has already shipped a crash. Today it
points at `js/app.js:5437` in a 4,252-line file, cites `IMPORT_LIMITS` 230
lines from where it is, and states that CI does not check the `SHELL`
array when it has for weeks. The README's layout table still puts QR
transfer and the volume dashboard in `app.js`, says the unit harness loads
"six" files (thirteen), and its rung-3 recipe omits installing Playwright
— a gap AGENTS.md documents instead of fixing. The vendored-library refresh
recipe never regenerates `SHA256SUMS`, so following it fails CI.

On the tooling side, eight commits in history are one-line `CACHE_VERSION`
bumps after a red CI run. A one-command helper removes that round-trip.
The pre-PR hook also `npm install`s Playwright without `--ignore-scripts`;
adding the flag is free hardening for the maintainer's workstation.

## Current state

Re-derive each with the grep shown; fix what the grep proves.

**AGENTS.md**
- `grep -n "js/app.js:[0-9]*\|js/block-editor.js:[0-9]*" AGENTS.md` →
  `:50` cites `js/app.js:5437` (tail is `wireBlockEditor();` at
  `grep -n "^wireBlockEditor();" js/app.js` → 4231); `:164` cites
  `js/block-editor.js:207` (`grep -n "^function normalizeImportedBlock" js/block-editor.js` → 218);
  `:165` cites `js/app.js:32` (`grep -n "^const esc" js/app.js` → 35);
  `:166` cites `js/app.js:2284` (`grep -n "^const IMPORT_LIMITS" js/app.js` → 2054).
- `AGENTS.md:109-110`: "CI enforces the version bump … but **not** the
  `SHELL` array update — that half is on you." `.github/workflows/test.yml`
  has a step "Require every shell script and stylesheet to be in sw.js's
  SHELL array" (`grep -n "SHELL array" .github/workflows/test.yml`).
- `AGENTS.md:140`: `npm install --no-save playwright@1.56.1  # once — the README omits this`.
- `AGENTS.md:54-55` quotes the `app.js` guard comment with "seven files";
  the source says "three" (plan 013 Step F rewrites the source; match it
  here to whatever the source says after 013, or "the files below").
- `AGENTS.md:222`: "See `README.md`'s 'Project layout' table (~line 1599)"
  — `grep -n "^## Project layout" README.md` → 1603.

**README.md**
- `grep -n "everything else: state, rendering" README.md` → the `js/app.js`
  row says "…, QR transfer, volume dashboard" — both have their own rows.
- `grep -n "six source files" README.md` → the unit-suite paragraph.
- `grep -n "npx playwright install chromium" README.md` → the rung-3 recipe
  (three lines: install chromium, `python3 -m http.server 8765 &`,
  `node test/smoke.js`) with no `npm install --no-save playwright@1.56.1`.
- `grep -n "Every string lives inline in" README.md` → "in `app.js`".
- `grep -n "render-icons" README.md` → the layout-table row says only "run
  it after editing the artwork"; `tools/render-icons.mjs:20` requires
  `playwright`.
- `grep -n "perfil" README.md` — if the CSV columns are listed, plan 011
  adds a `unidad` column; coordinate (011 owns that edit).

**js/vendor/README.md**
- Lines 8-9: "`js/app.js` injects them with a `<script>` tag" — the
  injection is in `js/qr-transfer.js` (`grep -n "js/vendor" js/qr-transfer.js`).
- Lines 18-21 restate the two digests in prose; `js/vendor/SHA256SUMS` is
  the checked copy (`.github/workflows/test.yml`: `sha256sum -c SHA256SUMS`).
- Lines 24-35 recipe ends "Then re-run `node test/smoke.js` and bump
  `CACHE_VERSION`" — never says to regenerate `SHA256SUMS` or bump
  `VENDOR_VERSION` in `sw.js` (`grep -n VENDOR_VERSION sw.js`).

**tools/**
- `tools/` holds `render-icons.mjs` and `smoke-gate.sh` only.
- `sw.js:21`: `const CACHE_VERSION = 'v55';`
- `tools/smoke-gate.sh:119`: `npm install --no-save "playwright@$PLAYWRIGHT_VERSION" >/dev/null 2>&1 || fail …`
- Evidence for the helper: `git log --format=%h -- sw.js` filtered to
  single-file commits shows eight one-line bump commits between 2026-08-16
  and 2026-08-27 (`810cc8d ad946f1 7e416f1 c684268 cf85462 bf6684c 93ebaab b59e57f`).

House style: prose comments explain *why*; scripts under `tools/` carry a
header comment in the same voice as `tools/smoke-gate.sh`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Nothing to build | — | — |
| Unit (unchanged) | `node test/unit.js` | `N passed, 0 failed` |
| Shell script syntax | `bash -n tools/bump-cache-version.sh` | exit 0 |
| Helper dry run | `tools/bump-cache-version.sh --dry-run` | prints `v55 -> v56` (or current → next), changes nothing |

## Scope

**In scope**: `AGENTS.md`, `README.md`, `js/vendor/README.md`,
`tools/bump-cache-version.sh` (new), `tools/smoke-gate.sh` (one flag).

**Out of scope**: anything under `js/`, `index.html`, `css/`, `sw.js`
(a docs PR must not bump `CACHE_VERSION`; CI does not require it for
these paths), `.github/workflows/*`, `plans/` other than the status row.

## Git workflow

- Branch: `claude/015-docs-sync-and-release-helper`
- Commit per file group; imperative sentence messages. No push/PR unless instructed.
- The smoke-gate hook skips itself on a branch that touches none of
  `index.html css/ js/ sw.js manifest.webmanifest blocks/ test/` — expected here.

## Steps

### Step 1: AGENTS.md — replace line numbers with symbols

- `:50` → "called from the tail of `js/app.js` (the block starting
  `wireBlockEditor();`)". Update the quoted comment to match `js/app.js`
  after plan 013 (or, if 013 has not landed, leave the quote but add
  "(the source still says 'three'; plan 013 fixes it)").
- `:164` → "(`normalizeImportedBlock` in `js/block-editor.js` is the
  reference implementation)"; `:165` → "`esc` (top of `js/app.js`)";
  `:166` → "`IMPORT_LIMITS` (grep for it in `js/app.js`)".
- `:222` → drop "(~line 1599)"; say "the `## Project layout` heading".

**Verify**: `grep -n "js/app.js:[0-9]\|js/block-editor.js:[0-9]" AGENTS.md` → 0 matches.

### Step 2: AGENTS.md — the release rule is now fully enforced

Rewrite `:109-110` to: CI enforces both halves — the `cache-version` job
fails a PR whose shell changed without a bump, and its second step fails
one whose `js/*.js` or `css/*.css` file is missing from `SHELL`. If plan
014 has landed, add: the unit suite also asserts `index.html`, `SHELL` and
`loadApp()` agree. Add one sentence pointing at
`tools/bump-cache-version.sh` (Step 5).

**Verify**: `grep -n "that half is on you" AGENTS.md` → 0 matches.

### Step 3: README.md

- `js/app.js` row → "everything else: state, storage and recovery, the
  session view, the progression estimate, sheets and navigation, settings,
  the share/import vocabulary, the CSV export".
- "six source files" → "every shell script, in the same order as the
  `<script>` tags".
- Rung-3 recipe: insert `npm install --no-save playwright@1.56.1   # once`
  as the first line. Then remove "— the README omits this" from `AGENTS.md:140`.
- "Every string lives inline in `app.js`" → "Every string lives inline in
  the source".
- `render-icons.mjs` row: append "(needs the same `playwright` module as
  the smoke suite)".

**Verify**: `grep -n "six source files\|QR transfer, volume dashboard\|lives inline in \`app.js\`" README.md` → 0 matches;
`grep -n "npm install --no-save playwright" README.md` → 1 match;
`grep -n "README omits" AGENTS.md` → 0 matches.

### Step 4: js/vendor/README.md

- Lines 8-9: "`js/qr-transfer.js` injects them…".
- Replace the prose digest block with one sentence: "The digests live in
  `SHA256SUMS`, which CI verifies on every pull request."
- Recipe: add after the `cp` lines
  `(cd js/vendor && sha256sum qrcode.js jsQR.js > SHA256SUMS)` and change
  the closing sentence to "Then regenerate `SHA256SUMS` as above, bump
  `VENDOR_VERSION` **and** `CACHE_VERSION` in `sw.js`, and run the QR smoke
  section (`node test/smoke.js --only QR`)."

**Verify**: `grep -n "SHA256SUMS" js/vendor/README.md` → ≥ 2 matches;
`grep -n "js/app.js injects" js/vendor/README.md` → 0.

### Step 5: `tools/bump-cache-version.sh`

Create it, executable (`chmod +x`), zero dependencies beyond `bash`, `grep`,
`sed`. Behaviour:
- Reads `const CACHE_VERSION = 'vN';` from `sw.js`, computes `v(N+1)`.
- `--dry-run` prints `vN -> vN+1` and exits 0 without writing.
- Otherwise rewrites the line in place (`sed -i` on Linux/Git Bash; use a
  temp file + `mv` for portability), prints the new value, and warns (exit
  0) if `git diff --name-only origin/main...HEAD` plus uncommitted changes
  touch none of `index.html css/ js/` ("nothing in the shell changed — a
  bump is not needed").
- Header comment in the house voice: the eight follow-up commits, the CI
  gate as backstop, "take the highest version on a merge conflict".

**Verify**: `bash -n tools/bump-cache-version.sh` → exit 0;
`tools/bump-cache-version.sh --dry-run` → `v55 -> v56` (or current);
`git status` → `sw.js` unchanged after the dry run.
Do **not** run it without `--dry-run` in this plan (no shell change here).

### Step 6: `--ignore-scripts` on the hook's install

`tools/smoke-gate.sh:119`: `npm install --no-save --ignore-scripts "playwright@$PLAYWRIGHT_VERSION"`.
Add a comment: the browser download that install scripts would do is
already the next line (`npx playwright install chromium`), so nothing is
lost, and no transitive package runs code on the maintainer's machine at
install time.

**Verify**: `bash -n tools/smoke-gate.sh` → exit 0. If Playwright is
already in `node_modules/`, run `rm -rf node_modules/playwright*` is **not**
required; simply confirm `node -e "require('playwright')"` still works.

## Done criteria

- [ ] All greps in Steps 1–4 hold
- [ ] `tools/bump-cache-version.sh --dry-run` prints the current and next version and leaves `sw.js` unchanged
- [ ] `grep -n "ignore-scripts" tools/smoke-gate.sh` → 1 match
- [ ] `node test/unit.js` → `0 failed` (unchanged)
- [ ] `git diff --name-only` shows only `AGENTS.md README.md js/vendor/README.md tools/bump-cache-version.sh tools/smoke-gate.sh plans/README.md`
- [ ] `sw.js` unchanged

## STOP conditions

- Any grep in "Current state" returns something other than described
  (the docs have already been fixed, or moved further).
- `sw.js`'s version line is not of the form `const CACHE_VERSION = 'v<digits>';`.
- Plan 011 has edited the README CSV columns and your Step 3 would touch
  the same lines — leave those lines to 011.

## Maintenance notes

- Prefer symbol names over line numbers in AGENTS.md from now on; the file
  most likely to move (`js/app.js`) is the one most often cited.
- If `tools/bump-cache-version.sh` proves useful, the next step is a
  second PreToolUse hook entry or a mention in AGENTS.md "The release rule"
  (done in Step 2); do not auto-bump in the hook — a docs-only PR must not
  bump.
- Deferred, maintainer decision: whether the headless job should also run
  on `push` to `main` (direct pushes happen; the browser suite is
  hook-bound). Recorded in plans/README.md.

### How this plan was followed (executed 2026-09-18)

Three places where the plan text did not match the repo, and what was done
instead:

- **Step 4's verification command does not exist.** The plan closes the
  vendor recipe with `node test/smoke.js --only QR`. `--only` matches
  section names, and there is no QR section: the QR checks are sub-headings
  inside `main session`, which `test/smoke.js:23` says explicitly because
  they build on that page's state. `--only QR` would select nothing and the
  suite would exit on its "matched no section" path. The recipe ships
  `--only "main session"` with one clause saying why.
- **The plan's "CI does not require a bump for these paths" is wrong for
  `js/vendor/README.md`, so `.github/workflows/test.yml` was edited after
  all.** The `cache-version` job gated on
  `grep -qE '^(index\.html|css/|js/)'`, and that path starts with `js/` —
  so Step 4, in a plan that forbids bumping `CACHE_VERSION`, was the one
  edit here that turned the job red. The three options (bump anyway, narrow
  the gate, drop Step 4) were put to the maintainer, who chose to narrow
  it: the pattern is now anchored on the extension,
  `^(index\.html|css/.*\.css|js/.*\.js)$`. That is identical to the old
  one for every file the shell actually contains and stops the three
  non-shell files under `js/vendor/` — `README.md`, `SHA256SUMS`, the
  license — from asking for a bump. It is outside the plan's stated scope;
  it is here because the plan's own Step 4 could not land without it. The
  same commit drops a comment in that file quoting the AGENTS.md sentence
  Step 2 deleted.
- **Step 1 was half a check, as the Overlap note predicted.** The
  `js/app.js:5437` citation and the "seven files" quote were already gone
  (`40048a0`, `7762bcf`); only the three citations under "Untrusted input"
  and the `~line 1599` pointer needed editing.

Smaller drift, all anticipated by the plan's own header: `CACHE_VERSION` is
`v60`, so the dry run prints `v60 -> v61`, not `v55 -> v56`; the
`smoke-gate.sh` install line is 153, not 119. The done criterion
`grep "ignore-scripts" tools/smoke-gate.sh` → 1 match is why the comment
added there describes the flag rather than naming it twice.
