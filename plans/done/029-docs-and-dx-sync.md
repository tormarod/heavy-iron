# Plan 029: The briefing, the guide and the app's self-description match the code; CI leaves Node 20; the PR gate cannot be bypassed by a quoted `gh pr create`; doc links are checked

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4f7e037..HEAD -- AGENTS.md docs/guide.md README.md manifest.webmanifest index.html .github/workflows/test.yml tools/smoke-gate.sh test/unit.js test/smoke.js js/app.js js/vendor/README.md sw.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S (many one-line edits; one ~30-line test section)
- **Risk**: LOW
- **Depends on**: plans/021 (soft — Step 2's `obj` bullet describes the record after 021 adds `kind`/`hold`/`brake`; if 021 has not landed, describe the fields as of `4f7e037` and note it)
- **Category**: docs / dx
- **Planned at**: commit `4f7e037`, 2026-09-19

## Why this matters

Every merge in this repo comes from an agent, and `AGENTS.md` exists so
sessions stop re-deriving the same invariants. It names five of the six
slot-keyed maps and never mentions `obj`, `variants` or the objetivo rule
at all; an agent copying its list will leave the sixth map behind on the
next purge — the bug class plan 002 was written for. The guide's write-up
of the rule is unusually accurate, with three specific disagreements. The
installed app describes itself as "bloques de 8 semanas" in two places
while blocks are 1–16 weeks. The rung-3 recipe in three files is a
PowerShell parse error on the maintainer's primary shell. CI runs on Node
20, which left maintenance on 2026-04-30. The PR gate's command regex is
bypassed by `bash -c "gh pr create …"` (verified against the live regex).
Nothing checks the cross-links the README split just doubled. And the
repo has no `.editorconfig`.

Each item is a line or two. Together they are what the next agent reads
first.

## Current state

### 1. `AGENTS.md:258-264` — the map list

```
One shape is worth naming here because it is read in four files: a log key
is `slot(week, dayId)` and is read back by `parseSlot`, both in `js/app.js`,
and nothing else runs the regex — `test/unit.js` fails if anything does.
To walk one block of `log`/`rir`/`notes`/`energy`/`order`, use `forEachSlot`
rather than rebuilding keys week by week: it visits the slots that exist,
which is the only way a purge reaches a week filed above `MAX_WEEKS`.
```

`js/app.js:342` declares `profile.obj` with the same `blockId → slot →
exId` shape; `js/app.js:347` declares `profile.variants`, keyed by exercise
id alone (`exId → [{ n, since }]`), read by `variantSince`
(`js/app.js:3598`) — the one per-profile map that must *not* be walked by
slot. The rule lives at `js/app.js:3391-4064` and is documented in
`docs/guide.md` § "The weekly objetivo".

### 2. `docs/guide.md` vs the code (three places)

`docs/guide.md:654-657`:

```
bad night: a session at least 5 % under the best of the three before it, read
off a set that was not censored. One of those holds every weight where it is
for the day (`La última sesión bajó: hoy no sube la carga`). Two in a row is
the level itself moving, and the line says so.
```

The code (`js/app.js:3933`) gates only the *up* branch on `hold`; the
down-walk (`js/app.js:3970-3976`) still runs, so a set whose reps fell
under the range comes down a rung on a hold day. **Decision (2026-09-19,
maintainer): the guide changes to match the code.** The `levelOf` comment
at `js/app.js:3776` says the same as the guide ("One of those holds the
weights where they are for a day") and changes with it.

`docs/guide.md:783-786`:

```
- **`obj`** — the objetivo that was on the screen, kept once the session
  starts and never rewritten. It is the only thing that can later tell a
  back-off the rule *asked for* from a weight that had to come off, and the
  only way to measure the rule's own error instead of assuming it.
```

The record (`recordTarget`, `js/app.js:3679-3689`) stores `v`, `at`,
`conf` and per-set `w`/`r`/`m`; after plan 021 also `kind`, `hold`,
`brake`. It does not store the notes, the level, the trend or `phi`.

`docs/guide.md:798`: the heading `### The guardrails, in the order they
apply`, followed by RIR normalisation → window exclusions → "No history, no
line". The code applies them in nearly the reverse order: `exHistory`'s
exclusions (deload weeks, pre-variant sessions, the other day) at
`js/app.js:3730-3742`, then "no history" at `3808`, then the deload and
layoff branches, and `weekRir` (the RIR guardrails) only at `3873`.

### 3. "8 semanas" — `manifest.webmanifest:4` and `index.html:15`

```
  "description": "Registro de entrenamiento para dos perfiles: bloques de 8 semanas, temporizador de descanso y progreso por ejercicio.",
```
```
<meta name="description" content="Registro de entrenamiento para dos perfiles: bloques de 8 semanas, temporizador de descanso y progreso por ejercicio. Funciona sin conexión.">
```

`README.md:15`: "Blocks of 1–16 weeks with an optional deload week";
`js/app.js:492`: `const MAX_WEEKS = 16;`.

### 4. The rung-3 recipe — `AGENTS.md:165-168`, `README.md:122-126`, `test/smoke.js:3-5`

All three give `python3 -m http.server 8765 &`. In PowerShell 5.1 a
trailing `&` is a reserved token and the line fails to parse. The
equivalent that backgrounds in PowerShell:
`Start-Process python3 -ArgumentList '-m','http.server','8765'`.

### 5. CI on Node 20 — `.github/workflows/test.yml:29-31`

```yaml
      - name: Set up Node
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "20"
```

Node 20 left maintenance on 2026-04-30. `test/unit.js` uses `node:vm`,
`node:fs`, `node:path` and nothing version-specific.

### 6. The gate's command regex — `tools/smoke-gate.sh:74-86`

```bash
if [ ! -t 0 ]; then
  verdict="$(node -e '
    let s = "";
    process.stdin.on("data", d => { s += d; }).on("end", () => {
      let call;
      try { call = JSON.parse(s); } catch (e) { return; }   // not a hook: run
      const tool = String(call.tool_name || "");
      if (/^mcp__.*create_pull_request$/.test(tool)) return;
      if (tool === "Bash") {
        const cmd = String((call.tool_input && call.tool_input.command) || "");
        if (/(^|[;&|(]|\n)\s*gh\s+pr\s+create\b/.test(cmd)) return;
        console.log("a Bash call that is not `gh pr create`");
        return;
      }
```

Verified against this regex at `4f7e037`: `gh pr create --title x`,
`git push && gh pr create`, `cd /repo; gh pr create` and `echo
hi\ngh pr create` are gated; `bash -c "gh pr create --title x"`, `sh -c 'gh
pr create'` and `eval "gh pr create"` are **not** — the guard prints "a
Bash call that is not `gh pr create`", exits 0, and the PR opens ungated.
The whole `node -e` script is inside single quotes in bash, so a literal
`'` cannot be added to the character class; `\x27` in the JS regex is the
same character.

### 7. No doc-link check

`README.md` carries 19 anchors into `docs/guide.md`; `docs/guide.md:5,
925, 1376` link back; `AGENTS.md` names README headings. All resolve at
`4f7e037` (checked), but `plans/README.md` already carried four dead
`README.md:NNN` refs one commit after the split. `test/unit.js:1747-1785`
already asserts a non-JS repo contract from Node (`blocks/index.json`) and
CI runs the suite on every PR — the pattern to copy:

```js
console.log('\n== blocks/index.json is a contract: every entry exists, validates, and round-trips ==');
const blockIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks/index.json'), 'utf8'));
ok('index.json is a non-empty array', Array.isArray(blockIndex) && blockIndex.length > 0);
```

### 8. No `.editorconfig`

`.gitattributes` forces LF; nothing states indent style. `js/`, `css/`,
`test/` and `tools/*.sh` are two-space indented.

### 9. `js/vendor/README.md:35`

"Then regenerate `SHA256SUMS` as above" — the recipe block's own last line
already does that; the sentence points at itself (plan 015 leftover).

Conventions: Spanish for anything a user sees (the manifest and meta
descriptions are user-visible); English elsewhere; `index.html` and
`js/app.js` are in the `CACHE_VERSION` gate — this plan touches one line
of each (the description; the `levelOf` comment), so it bumps once.
`manifest.webmanifest`, docs, CI, tools and tests are outside the gate.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit suite | `node test/unit.js` | `N passed, 0 failed` |
| Syntax | `node --check js/app.js && node --check test/unit.js && bash -n tools/smoke-gate.sh` | exit 0 |
| Gate regex table | see Step 6 | every row as expected |
| Bump | `bash tools/bump-cache-version.sh` | next version in `sw.js` |

## Scope

**In scope**: `AGENTS.md`, `docs/guide.md`, `README.md`, `manifest.webmanifest`, `index.html` (line 15 only), `js/app.js` (the `levelOf` comment only), `js/vendor/README.md` (one sentence), `.github/workflows/test.yml` (one value + comment), `tools/smoke-gate.sh` (one regex), `test/unit.js` (two new sections), `test/smoke.js` (header comment only), `.editorconfig` (create), `sw.js` (bump only).

**Out of scope**:
- Any code behaviour. The hold semantics are settled as "docs match code".
- Replacing `python3` in `tools/smoke-gate.sh` with a Node server — an
  option recorded in `plans/README.md`, not this plan.
- The hook's MCP matcher in `.claude/settings.json` — verify-by-running,
  noted in the index's "not audited".
- `plans/README.md` beyond the status row (the fifth-audit section is
  already written).

## Git workflow

- Branch: `claude/029-docs-and-dx-sync-<6 hex chars>`.
- One commit per numbered step, imperative subjects (`Name obj and variants in the AGENTS.md map list`, `Move CI to Node 22`, `Gate a quoted gh pr create too`, …). Trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `AGENTS.md` names all six maps and the two exceptions

At `AGENTS.md:261-263`, change the list to
`` `log`/`rir`/`notes`/`energy`/`order`/`obj` `` and add, after the
paragraph, one short paragraph: `variants` is the one per-profile map keyed
by exercise id rather than by block and slot (`exId → [{ n, since }]`,
read only by `variantSince`), so it is never walked by slot and is not in
any purge or move helper's list; and the objetivo rule that reads both
lives in `js/app.js` under "peso objetivo" (`targetFor`) and is documented
in `docs/guide.md` § "The weekly objetivo" — both maps are absent from
every backup written before v3, so every reader copes with them missing.

**Verify**: `grep -n "\`obj\`" AGENTS.md` and `grep -n "variants" AGENTS.md`
each print at least one line.

### Step 2: The guide matches the code (three edits) and the comment with it

- `docs/guide.md:655-656`: replace "One of those holds every weight where
  it is for the day" with wording that matches the code: one such session
  holds the load *down* for that exercise — nothing goes up
  (`La última sesión bajó: hoy no sube la carga`) — though a set the range
  says is out of reach still comes down a rung. Keep the rest of the
  sentence.
- `js/app.js:3776` (inside the comment above `capSeq`): "One of those
  holds the weights where they are for a day." → "One of those stops the
  weights going up for a day (a set the range says is out of reach still
  comes down)." Keep the next sentence.
- `docs/guide.md:783-786`: after "never rewritten", say what the record
  holds — the confidence, the kind of target (objetivo, descarga, vuelta),
  whether the day was held or braked, and each set's weight, reps and
  arrow — and that it does not hold the notes, the level or the trend. If
  plan 021 has not landed, list only `conf` and the per-set fields and add
  "(the kind and the hold/brake flags arrive with plan 021)".
- `docs/guide.md:798`: retitle to `### The guardrails`, and add one
  sentence under it: they are listed here by what they protect, not in the
  order the code applies them — the code first drops what does not count
  (deload weeks, sessions before a rename, the other day of a split lift),
  then answers "no history, no line", then the deload and the layoff, and
  only then reads the week's RIR.

**Verify**: `grep -n "holds every weight" docs/guide.md` → empty.
`grep -n "in the order they apply" docs/guide.md` → empty.
`node --check js/app.js` → exit 0.

### Step 3: "bloques de 1 a 16 semanas"

In `manifest.webmanifest:4` and `index.html:15` replace "bloques de 8
semanas" with "bloques de 1 a 16 semanas".

**Verify**: `grep -rn "8 semanas" manifest.webmanifest index.html` → empty.
`node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest','utf8'))"` → exit 0.

### Step 4: The rung-3 recipe works in both shells

In `AGENTS.md:167`, `README.md:124` and `test/smoke.js:4`, keep the bash
line and add the PowerShell one beside it, labelled:

```
python3 -m http.server 8765 &                                 # Git Bash
Start-Process python3 -ArgumentList '-m','http.server','8765' # PowerShell
```

(In `test/smoke.js`'s header comment, keep the ` *   ` prefix.)

**Verify**: `grep -n "Start-Process" AGENTS.md README.md test/smoke.js` →
three lines. `node --check test/smoke.js` → exit 0.

### Step 5: CI on Node 22

`.github/workflows/test.yml:31`: `node-version: "20"` → `"22"`, with a
comment line above: Node 20 left maintenance on 2026-04-30; 22 is the
current maintenance LTS. Run the suite locally on the executor's Node
(`node --version` — any ≥ 20 is fine for the local check).

**Verify**: `grep -n 'node-version: "22"' .github/workflows/test.yml` →
one line. `node test/unit.js` → `0 failed`.

### Step 6: The gate regex gates a quoted invocation, and a unit table pins it

In `tools/smoke-gate.sh:84`, change the separator class from `[;&|(]` to
`[;&|("\x27]` so the line reads:

```js
        if (/(^|[;&|("\x27]|\n)\s*gh\s+pr\s+create\b/.test(cmd)) return;
```

Add one sentence to the comment above the block (lines 66–73): a quote is a
separator too, so `bash -c "gh pr create …"` runs the gate.

Then in `test/unit.js`, before the `blocks/index.json` section, add a
section that reads the regex out of the script and runs a table through
it — the regex is now load-bearing and lives in a file no suite loads:

```js
console.log('\n== the PR gate recognises gh pr create wherever it hides (plans/029) ==');
{
  const gate = fs.readFileSync(path.join(ROOT, 'tools/smoke-gate.sh'), 'utf8');
  const m = /if \((\/\(\^\|\[[^\]]*\]\|\\n\)\\s\*gh\\s\+pr\\s\+create\\b\/)\.test\(cmd\)\) return;/.exec(gate);
  ok('the gate regex is where the plan left it', !!m, gate.slice(0, 0));
  if (m) {
    const re = eval(m[1]);   // the literal, as JS
    const gated = ['gh pr create --title x', 'git push -u origin HEAD && gh pr create --fill', 'cd /repo; gh pr create',
                   'bash -c "gh pr create --title x"', "sh -c 'gh pr create'", 'eval "gh pr create"', 'echo hi\ngh pr create'];
    const passed = ['ghx pr create', 'gh prune', 'echo done'];
    gated.forEach(c => ok('gated: ' + JSON.stringify(c), re.test(c)));
    passed.forEach(c => ok('not gated: ' + JSON.stringify(c), !re.test(c)));
  }
}
```

(`eval` on a string the suite itself extracted from a tracked file is the
simplest way to get the same `RegExp` the shell will run; if the extraction
regex is too brittle, match on `gh\\s+pr\\s+create` and take the enclosing
`/…/` literal by scanning for the delimiters.)

**Verify**: `bash -n tools/smoke-gate.sh` → exit 0. `node test/unit.js` →
`0 failed`, 11 more assertions. Then confirm the live guard end to end:

```bash
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"bash -c \"gh pr create --title x\""}}' | SMOKE_GATE_SKIP=1 SMOKE_GATE_FORCE=1 bash tools/smoke-gate.sh 2>&1 | head -3
```

→ the output must NOT contain "not a pull request being opened, skipping";
it should proceed to "smoke-gate: syntax check" (and stop at the unit
suite, because `SMOKE_GATE_SKIP=1`).

### Step 7: Doc cross-links resolve — a unit section

Add after the gate section:

```js
console.log('\n== docs cross-links resolve (README.md, docs/guide.md, AGENTS.md, plans/README.md) ==');
{
  const slug = h => h.toLowerCase().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
  const headings = file => (fs.readFileSync(path.join(ROOT, file), 'utf8').match(/^#{1,6} .+$/gm) || [])
    .map(h => slug(h.replace(/^#+ /, '')));
  const docs = ['README.md', 'docs/guide.md', 'AGENTS.md', 'plans/README.md'];
  docs.forEach(file => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const links = [...src.matchAll(/\]\(([^)\s]+)\)/g)].map(x => x[1]).filter(l => !/^(https?:|mailto:)/.test(l));
    links.forEach(link => {
      const [rel, anchor] = link.split('#');
      const target = rel ? path.normalize(path.join(path.dirname(file), rel)) : file;
      const exists = fs.existsSync(path.join(ROOT, target));
      ok(file + ' → ' + link + ' exists', exists);
      if (exists && anchor && /\.md$/.test(target)) ok(file + ' → #' + anchor + ' is a heading', headings(target).includes(anchor), headings(target).join(' | '));
    });
  });
}
```

GitHub's slug rule: lowercase, drop punctuation except hyphens, spaces to
hyphens; the `\p{L}` class keeps accented letters, which the guide's
Spanish headings use. Run it; if a link fails for a reason that is a real
broken link, fix the link (in-scope files only); if it fails because the
slug rule differs (e.g. duplicate headings get `-1` suffixes), adjust the
`slug` function and say so in a comment.

**Verify**: `node test/unit.js` → `0 failed`; the section prints one
`PASS` per link (dozens).

### Step 8: `.editorconfig`

Create at the repo root:

```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

**Verify**: `git status --short` shows `?? .editorconfig`; `git diff --stat`
shows no other file changed by creating it (editors apply it only on save).

### Step 9: The vendor README sentence

Delete the sentence at `js/vendor/README.md:35` ("Then regenerate
`SHA256SUMS` as above.") — the block above it already ends with the
`sha256sum … > SHA256SUMS` line.

**Verify**: `grep -n "as above" js/vendor/README.md` → empty. This file is
outside the `cache-version` regex (`js/.*\.js` only) — no bump for it.

### Step 10: Bump the cache version

`index.html` and `js/app.js` changed (a description, a comment):
`bash tools/bump-cache-version.sh`.

**Verify**: `grep -n "CACHE_VERSION = " sw.js` → bumped.

## Test plan

- New unit sections: the gate regex table (11 assertions), the doc-link
  check (one per link; dozens).
- Existing to keep green: everything — no behaviour changes.
- The gate end-to-end check in Step 6 (a piped hook call).

## Done criteria

- [ ] `grep -n "\`obj\`" AGENTS.md` and `grep -n "variants" AGENTS.md` each non-empty
- [ ] `grep -n "holds every weight\|in the order they apply" docs/guide.md` empty; `grep -n "holds the weights where they are" js/app.js` empty
- [ ] `grep -rn "8 semanas" manifest.webmanifest index.html` empty
- [ ] `grep -c "Start-Process" AGENTS.md README.md test/smoke.js` → 1 each
- [ ] `grep -n 'node-version: "22"' .github/workflows/test.yml` → one line
- [ ] `grep -n '\\x27' tools/smoke-gate.sh` → one line; the piped hook check in Step 6 does not print "skipping"
- [ ] `node test/unit.js` exits 0 with `0 failed` and ≥ 30 more assertions than at `4f7e037`
- [ ] `.editorconfig` exists with `root = true`
- [ ] `grep -n "as above" js/vendor/README.md` empty
- [ ] `grep -n "CACHE_VERSION = " sw.js` shows a bumped version
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 029 updated

## STOP conditions

- The gate regex at `tools/smoke-gate.sh:84` is not the literal quoted in
  "Current state".
- The doc-link section finds a broken link in a file outside this plan's
  scope (e.g. a `plans/done/*.md`) — report it, do not edit that file.
- `docs/guide.md:654-657` or `:783-786` or `:798` no longer read as quoted.
- Node 22 is not available to `actions/setup-node` (it is; if the workflow
  fails on that step in the PR, report rather than pin a different major).

## Maintenance notes

- The doc-link section will fail the next time a heading is renamed or a
  section moves between `README.md` and `docs/guide.md` — that is its job.
  Fix the link, not the test.
- The gate regex table is the place to add a shape the next time a PR
  opens ungated; the `eval` extraction assumes the literal keeps its
  `if (/…/.test(cmd)) return;` form.
- `AGENTS.md`'s map list is the one an agent copies; the next new map goes
  there in the same commit that adds it.
- Node 22 reaches end of life in April 2027; the comment in `test.yml`
  should carry the date so the next bump is not a surprise.
