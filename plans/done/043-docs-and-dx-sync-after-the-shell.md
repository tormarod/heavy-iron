# Plan 043: The docs and the three "what is the shell" regexes match the code after plans 032–037

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3913b8f..HEAD -- docs/guide.md README.md AGENTS.md tools/bump-cache-version.sh tools/smoke-gate.sh`
> If any changed since this plan was written, re-read each "Current state"
> excerpt at its stated line before editing; a line that has moved is fine,
> a sentence that has already been fixed is a step to skip and report.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — prose, two regexes in advisory/skip paths, and one
  install flag. No shell file changes, so **no `CACHE_VERSION` bump**.
- **Depends on**: none. (The one stale *code comment* found by the same
  audit, `js/diagnostics.js:8`, rides with plan 041 because a `js/` change
  costs a bump.)
- **Category**: docs / dx
- **Planned at**: commit `3913b8f`, 2026-09-21

## Why this matters

Every merge to this repo comes from an agent, and `AGENTS.md`,
`README.md` and `docs/guide.md` are what each session reads first. The
eighth audit checked them line by line against the code after the shell
rework and found the bulk accurate — the `<script>` list, the `wire*()`
block, § "Using it", every quoted label, every cross-link. What is wrong
is small and specific, and stale is worse than missing:

- The guide's Features list still sends the reader to a "◐ button in the
  header" for the theme; plan 034 removed it, and the same file already
  says the right thing forty lines earlier (**Más → Tema**).
- The README's layout table describes `index.html` as "header, session
  list, and the dialogs" — the file's third and fourth structural parts
  since plan 037 are the bottom bar and the docked rest timer. Its limits
  table reads as exhaustive and omits two clamped fields the prose
  documents (`ex.minRir` 0–5, `priority` capped at 12).
- `AGENTS.md`'s single `file:line` anchor points one line above the
  sentence it quotes (plan 029 inserted a line above it).
- The documented Playwright install lacks the `--ignore-scripts` that
  `tools/smoke-gate.sh` uses and explains at length — so a contributor
  following either doc installs with lifecycle scripts on, on the machine
  the gate was hardened to protect, and the gate then finds the module
  and never re-installs.
- Three copies of "what is the shell" disagree. CI's `cache-version` job
  was narrowed in plan 029 to `^(index\.html|css/.*\.css|js/.*\.js)$` so
  that editing `js/vendor/README.md` stops demanding a bump;
  `tools/bump-cache-version.sh` still carries the old prefix form and its
  advisory *says* "CI only asks for one when index.html, css/ or js/
  move" — wrong in the one direction that matters, because that advisory
  is what stands between an agent and an unnecessary bump that costs
  every returning user a shell re-download. `tools/smoke-gate.sh`'s
  `TESTED_PATHS` has the same `js/` prefix, so a vendor-notes PR runs
  two and a half minutes of Chromium.
- The `tools/*.sh` scripts are bash; the repo documents the Git Bash and
  PowerShell variants side by side for the python server in three places
  and never says the tools need bash at all — on the maintainer's own
  platform.

## Current state

All excerpts at `3913b8f`.

```markdown
<!-- docs/guide.md:136-137 -->
- **Light and dark**, following the phone unless you override it with the
  ◐ button in the header.
```
`grep -n "◐" docs/guide.md index.html js/*.js` → only this line. The
correct description is at `docs/guide.md:49` ("**Tema** — a tap cycles
**automático** (follow the phone), **claro** and **oscuro**").

```markdown
<!-- README.md:161 -->
| `index.html` | the whole markup: header, session list, and the dialogs |
```
`index.html:119-136` is `<nav class="navbar" id="navBar" …>` with four
destinations; `:638-663` is the docked rest timer.

```markdown
<!-- README.md:317-328 — the limits table -->
| Field | Limit |
|---|---|
| `days` | at most 14 |
…
| `weeks` | clamped to 1–16 · `deload` must fall inside it, or it's dropped |
```
`ex.minRir` is clamped to 0–5 and dropped otherwise (`js/app.js:475`,
`js/block-editor.js:297`), documented in prose at `README.md:265-270` only.
`priority` is trimmed, de-duplicated and capped at `PRIORITY_MAX = 12`
(`js/app.js:1516, 1523-1530`), documented at `README.md:271-276` only.

```markdown
<!-- AGENTS.md:191 -->
**Testing policy** (`test/smoke.js:9-10`): *"Add a case here whenever a bug
```
The quoted sentence is at `test/smoke.js:10-11`.

```
<!-- README.md:124 -->
npm install --no-save playwright@1.56.1   # once
<!-- AGENTS.md:176 -->
npm install --no-save playwright@1.56.1  # once
```
```bash
# tools/smoke-gate.sh:198
  npm install --no-save --ignore-scripts "playwright@$PLAYWRIGHT_VERSION" >/dev/null 2>&1 || fail "npm install playwright failed"
```
(with the reason at `tools/smoke-gate.sh:190-195`: "Lifecycle scripts are
off, which costs nothing and closes the one place this repo runs
third-party code at install time").

```bash
# tools/bump-cache-version.sh:98-101
if ! printf '%s\n' "$changed" | grep -qE '^(index\.html|css/|js/)'; then
  echo "bump-cache-version: nothing in the shell changed — a bump is not needed" >&2
  echo "bump-cache-version: (CI only asks for one when index.html, css/ or js/ move)" >&2
fi
```
```yaml
# .github/workflows/test.yml:79 — what CI actually asks
          if ! echo "$changed" | grep -qE '^(index\.html|css/.*\.css|js/.*\.js)$'; then
```
```bash
# tools/smoke-gate.sh:137
TESTED_PATHS='^(index\.html|css/|js/|sw\.js|manifest\.webmanifest|blocks/|test/)'
# tools/smoke-gate.sh:43-47 — its own description of the list
# none of the files below changed. The list is what the two suites actually
# load or read: the shell, the worker, the published blocks and the tests.
# It is deliberately wider than CI's cache-version rule (index.html, css/,
# js/), because the smoke suite also exercises sw.js and imports from
# blocks/. This script is not on the list: …
```
`manifest.webmanifest` is on the list and justified — `test/smoke.js:3725`
fetches it — but the comment's enumeration does not mention it.

`AGENTS.md:172-180` and `README.md:123-129` give the server line in both
shells; `AGENTS.md:138-140` and `README.md:139-144` name the two `.sh`
tools with no shell note. `.claude/settings.json` invokes the gate as a
bare `"${CLAUDE_PROJECT_DIR:-.}"/tools/smoke-gate.sh`.

`test/unit.js:3121-3143` checks that every relative link in `README.md`,
`docs/guide.md`, `AGENTS.md` and `plans/README.md` resolves to a file and
a heading — it runs on every `node test/unit.js` and is the verification
for the prose steps. Nothing in the unit suite pins the two regexes.

Conventions: prose in the docs is plain and specific (see the existing
limits rows for register); the two tools' comments explain *why* a rule
exists and name the incident that produced it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Docs cross-links + everything else | `node test/unit.js` | last line `N passed, 0 failed` (760 at `3913b8f`; this plan adds no assertion, so N stays whatever `main` prints) |
| The bumper, read-only | `bash tools/bump-cache-version.sh --dry-run` | prints `vN -> vN+1`, exit 0, `git status` unchanged |
| A regex, by hand | `printf 'js/vendor/README.md\n' \| grep -qE '<regex>'; echo $?` | `1` (no match) — see Steps E and F |
| Bash syntax | `bash -n tools/bump-cache-version.sh && bash -n tools/smoke-gate.sh` | exit 0 |

No smoke run is needed: nothing the browser suite loads changes, and the
gate will skip itself on this branch (`nothing the tests can see changed`).

## Scope

**In scope**:
- `docs/guide.md` — lines 136–137.
- `README.md` — line 161, the limits table, line 124, and one sentence
  near line 144.
- `AGENTS.md` — line 191, line 176, and one sentence after line 180.
- `tools/bump-cache-version.sh` — lines 98 and 100.
- `tools/smoke-gate.sh` — line 137 and the comment at 43–47.
- `plans/README.md` — your status row.

**Out of scope**:
- `js/*`, `css/*`, `index.html`, `sw.js` — any change there needs a bump
  and belongs to 041.
- `.github/workflows/test.yml` — it is the reference the two tools are
  being aligned *to*.
- `js/vendor/README.md` — its refresh recipe already regenerates
  `SHA256SUMS` (`:32`); verified, nothing to do.
- `docs/guide.md` beyond the one line: § "Using it" was verified against
  the shell line by line.

## Git workflow

- Branch: `claude/043-docs-dx-sync`
- One commit per step, plain-sentence messages
  (`Plan 043 Step E: the bumper's advisory asks what CI asks`).
- Do NOT push or open a PR unless the operator instructed it. No bump.

## Steps

### Step A: The guide's Features list points at the theme where it lives

Replace `docs/guide.md:136-137` with:

```markdown
- **Light and dark**, following the phone unless you override it under
  **Más → Tema** — a tap cycles automático, claro and oscuro.
```

**Verify**: `grep -c "◐" docs/guide.md` → `0`; `node test/unit.js` →
`0 failed`, same count as before.

### Step B: The README's layout row and limits table say what the code does

1. Replace `README.md:161` with:

```markdown
| `index.html` | the whole markup: the header, the session list, the bottom bar and the docked rest timer, and the sheets |
```

2. In the limits table (`README.md:317-328`), after the `ex.inc` row, add
   two rows:

```markdown
| `ex.minRir` | a whole number 0–5, or the field is dropped |
| `priority` | names trimmed and de-duplicated, blanks dropped, at most 12 |
```

**Verify**: `grep -c "minRir" README.md` → `2` (the prose bullet at `:265`
and the new table row — it is `1` before this step); `grep -c "bottom bar"
README.md` → `1`; `node test/unit.js` → `0 failed`, same count as before.

### Step C: `AGENTS.md`'s anchor points at the sentence it quotes

In `AGENTS.md:191`, replace `test/smoke.js:9-10` with `test/smoke.js:10-11`.

**Verify**: `sed -n 10,11p test/smoke.js` contains "Add a case here
whenever a bug turns out"; `grep -c "test/smoke.js:10-11" AGENTS.md` → `1`.

### Step D: The documented install matches the gate's

1. `README.md:124` → `npm install --no-save --ignore-scripts playwright@1.56.1   # once`
2. `AGENTS.md:176` → `npm install --no-save --ignore-scripts playwright@1.56.1  # once`
3. After the code block that line sits in, in each file, add one sentence:

```markdown
`--ignore-scripts` on purpose: it is the one place this repo would run
third-party code at install time, and `tools/smoke-gate.sh` installs the
same way (its comment says why).
```

**Verify**: `grep -c "ignore-scripts" README.md AGENTS.md` → `2` each
(the command and the sentence); `node test/unit.js` → `0 failed`, same
count as before.

### Step E: The bumper asks what CI asks

In `tools/bump-cache-version.sh`:

- Line 98: replace `'^(index\.html|css/|js/)'` with
  `'^(index\.html|css/.*\.css|js/.*\.js)$'`.
- Line 100: replace the message with
  `echo "bump-cache-version: (CI only asks for one when index.html or a css/*.css or js/*.js file moves — not the vendor notes)" >&2`.
- Directly above line 98 add a comment:

```bash
# The same regex as the cache-version job in .github/workflows/test.yml,
# extension-anchored: the prefix form also matched js/vendor/README.md and
# SHA256SUMS, and this advisory then stayed silent on a vendor-notes branch
# CI would never have asked to bump (plans/043). Keep the two identical.
```

**Verify**:
`bash -n tools/bump-cache-version.sh` → exit 0.
`printf 'js/vendor/README.md\n' | grep -qE '^(index\.html|css/.*\.css|js/.*\.js)$'; echo $?` → `1`.
`printf 'js/app.js\n' | grep -qE '^(index\.html|css/.*\.css|js/.*\.js)$'; echo $?` → `0`.
`bash tools/bump-cache-version.sh --dry-run` → `vN -> vN+1` and `git
status --short sw.js` prints nothing.

### Step F: The gate skips a vendor-notes branch, and its comment lists what it tests

In `tools/smoke-gate.sh`:

- Line 137: replace `js/|` with `js/.*\.js$|` so the line reads
  `TESTED_PATHS='^(index\.html|css/|js/.*\.js$|sw\.js|manifest\.webmanifest|blocks/|test/)'`.
- In the comment at lines 43–47, replace "the shell, the worker, the
  published blocks and the tests" with "the shell, the worker, the
  manifest (the `installable` section fetches it), the published blocks
  and the tests", and replace "(index.html, css/, js/)" with "(index.html,
  css/*.css, js/*.js)". Add one sentence after "imports from blocks/.":
  "`js/` is anchored on `.js` so the vendor libraries still count and the
  three notes beside them (README, SHA256SUMS, the licence) do not
  (plans/043)."

**Verify**:
`bash -n tools/smoke-gate.sh` → exit 0.
`printf 'js/vendor/README.md\n' | grep -qE '^(index\.html|css/|js/.*\.js$|sw\.js|manifest\.webmanifest|blocks/|test/)'; echo $?` → `1`.
`printf 'js/vendor/jsQR.js\n' | grep -qE '^(index\.html|css/|js/.*\.js$|sw\.js|manifest\.webmanifest|blocks/|test/)'; echo $?` → `0`.
`printf 'manifest.webmanifest\n' | grep -qE '…same regex…'; echo $?` → `0`.

### Step G: The tools say they are bash, where they are named

1. In `AGENTS.md`, after the fenced block that ends at line 180
   (`Start-Process python3 …`), add:

```markdown
`tools/*.sh` are bash scripts. On Windows run them from Git Bash, or as
`bash tools/smoke-gate.sh` from PowerShell; the hook in
`.claude/settings.json` resolves the shebang itself.
```

2. In `README.md`, after the paragraph ending at line 144 ("…so a
   docs-only PR opens without waiting for Chromium."), add:

```markdown
Both scripts under `tools/` are bash: on Windows, run them from Git Bash
or as `bash tools/<name>.sh` from PowerShell.
```

**Verify**: `grep -c "bash tools/" AGENTS.md README.md` → `1` each;
`node test/unit.js` → `0 failed`, same count as before.

## Test plan

- No new automated tests: the docs cross-link section in `test/unit.js`
  re-checks every link touched, and the two regexes are verified by the
  `printf | grep` probes in Steps E and F (record their output in the PR
  description).
- Verification: `node test/unit.js` → `0 failed`, same count as on `main`;
  both `bash -n` checks exit 0; `--dry-run` writes nothing.

## Done criteria

- [ ] `node test/unit.js` ends `0 failed`, the passed count unchanged from `main`
- [ ] `grep -c "◐" docs/guide.md` → `0`
- [ ] `grep -c "minRir" README.md` → `2` and `grep -c "bottom bar" README.md` → `1`
- [ ] `grep -c "test/smoke.js:10-11" AGENTS.md` → `1`
- [ ] `grep -c "ignore-scripts" README.md` → `2` and `grep -c "ignore-scripts" AGENTS.md` → `2`
- [ ] `grep -c 'css/\.\*\\\.css|js/\.\*\\\.js)\$' tools/bump-cache-version.sh` → `1`
- [ ] `grep -c 'js/\.\*\\\.js\$' tools/smoke-gate.sh` → `1`
- [ ] `grep -c "bash tools/" AGENTS.md README.md` → `1` each
- [ ] `bash -n tools/bump-cache-version.sh && bash -n tools/smoke-gate.sh` exit 0
- [ ] `git status --short` lists only the six in-scope files
- [ ] `plans/README.md` status row for 043 updated

## STOP conditions

- `grep -n "◐" docs/guide.md` returns nothing, or `AGENTS.md:191` already
  says `10-11`: someone fixed it since `3913b8f`. Skip that step and say so.
- `.github/workflows/test.yml:79` no longer reads
  `'^(index\.html|css/.*\.css|js/.*\.js)$'` — CI moved; align the tools to
  whatever it now says and report the new regex, or stop if it is no
  longer a single grep.
- `node test/unit.js` reports a docs cross-link failure after any step:
  a link you edited no longer resolves; fix the link, do not touch the
  test.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Three files now hold the shell regex: `test.yml:79`,
  `tools/bump-cache-version.sh:98`, and the wider `TESTED_PATHS` in
  `tools/smoke-gate.sh:137`. Each carries a comment naming the other; a
  change to one is a change to all three. A unit assertion that reads all
  three and compares the shell part would close this for good — it was
  judged not worth its own step here because the regexes are one line
  each and the comments now say so.
- If a fourth clamped block field is added, add it to *both* the field
  notes and the limits table in `README.md`; the table is what an agent
  writing a block JSON reads as the contract.
- Reviewer: check that the `--ignore-scripts` sentence in each doc does
  not contradict the gate's own comment if that comment is later
  reworded.
