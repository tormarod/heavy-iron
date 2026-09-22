# Plan 059: The app parses on Safari 15 — the one lookbehind goes, and a unit check holds `js/` to that floor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` unless you were told otherwise.
>
> **Drift check (run first)**:
> `git diff --stat b15ae87..origin/main -- js/app.js test/unit.js README.md AGENTS.md sw.js`
> Other agent sessions land PRs on this repo mid-task. Re-locate every
> anchor below by `grep`, never by line number alone.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. **Land before plan 062**, whose `phaseRir` rewrite
  must not use lookbehind either; this plan's check is what enforces that.
- **Category**: bug (compatibility) + tests
- **Planned at**: commit `b15ae87`, 2026-09-22 (tenth audit, finding 3)

## Why this matters

`js/app.js` contains one regular expression with a **lookbehind**
(`(?<!…)`), added on 2026-09-22 by plan 054 (commit `c7aaee4`). Safari
only understands lookbehind from 16.4 (March 2023). On any older WebKit —
an iPhone 6s/7/SE (1st gen) stuck on iOS 15, or an iOS 16.0–16.3 phone
that was never updated — a regex literal the engine cannot parse is a
**SyntaxError for the whole file**: `js/app.js` never runs, the page sits
on "Cargando tu registro…", `js/boot-guard.js` finds no newer worker and
says "La app no ha podido arrancar", and even the recovery screen (which
lives in `app.js`) is out of reach. The data is intact but unreachable.

Half of the household the app is built for is on iOS Safari. Every other
line of `js/` already avoids syntax that new — there is no `?.`, `??`,
`.at(`, `structuredClone` or `Object.hasOwn` anywhere, and
`CompressionStream` is feature-tested before use — so the floor has been
kept by habit, never written down, and the first slip went unnoticed
because `test/smoke.js` runs Chromium only. **The maintainer set the floor
on 2026-09-22: Safari 15 / iOS 15.** This plan removes the one violation,
writes the floor down, and adds a unit check so the next slip fails
`node test/unit.js` instead of shipping.

## Current state

- `js/app.js` — search `const DESCARGA_RE`. Today (≈ line 6089–6095):

  ```js
  /* A "descarga" that the goal itself negates — "sin descarga", "no
     descarga" — is the block saying there is no deload here (CONTEXT.md,
     "deload week"), so it must not flip a week into one. Lookbehind rather
     than a second pass over the matches: `test()` alone then answers the
     question this file actually asks, "is there an unnegated 'descarga'
     anywhere in the text", instead of only the first occurrence's. */
  const DESCARGA_RE = /(?<!\b(?:sin|no)\s+)descarga/i;
  ```

  Its only reader is `deloadWeeks(block)`, a few lines below:

  ```js
  for (let w = 1; w <= weeks; w++) {
    const text = String((block && block.phase && block.phase[w] && block.phase[w].r) || '');
    if (DESCARGA_RE.test(text)) out.add(w);
  }
  ```

  Confirm with `grep -n "DESCARGA_RE" js/*.js` → exactly two lines, both
  in `js/app.js` (the declaration and the `.test(text)` call).
- Existing tests that pin the behaviour and must keep passing unchanged:
  `test/unit.js`, search `deloadWeeks: "sin descarga" and "no descarga" do not count`
  (≈ line 2395) and the section `plans/054 decision 5, visible change 2`
  (≈ line 2427).
- A scan of every shipped script for syntax newer than Safari 15 finds
  exactly that one line today:

  ```
  grep -nE '\(\?<[=!]|\.at\(|Object\.hasOwn\b|structuredClone|\.findLast(Index)?\(|\.toSorted\(|\.toReversed\(|\.toSpliced\(|\.with\(|static \{|Array\.fromAsync|Promise\.withResolvers|Object\.groupBy|Map\.groupBy' js/*.js sw.js
  → js/app.js:6095:const DESCARGA_RE = /(?<!\b(?:sin|no)\s+)descarga/i;
  ```

- `test/unit.js` opens with source-level checks that read files as text
  before any app code runs — the pattern to follow. Exemplar (≈ line 44–74):

  ```js
  console.log('\n== the four script lists agree (AGENTS.md: index.html, sw.js SHELL, loadApp, js/) ==');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  …
  /* Not recursive: js/vendor/ holds bundled libraries that are deliberately
     not shell scripts and have no tag of their own. */
  const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
  …
  ok('sw.js reads the cache via fromCache, not bare caches.match',
     !swSrc.includes('caches.match('),
     'found bare caches.match( in sw.js');
  ```

  `ok(name, cond, extra)` is the assertion helper; `extra` is printed after
  `→` on failure.
- Conventions (from `AGENTS.md`): English code comments that explain *why*,
  in prose, often naming the bug they prevent; Spanish for anything a user
  sees. No build step, no transpiler — the floor is kept by writing older
  syntax, not by compiling to it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check js/app.js` | exit 0, no output |
| Unit suite | `node test/unit.js` | last line `N passed, 0 failed`, exit 0 |
| The scan above | the `grep -nE …` line in Current state | no output after Step 1 |
| Bump | `bash tools/bump-cache-version.sh` | prints old → new version |

Do **not** run the full `test/smoke.js` or `tools/smoke-gate.sh`; a hook
runs it once when the PR is opened (AGENTS.md, "How to verify a change").

## Scope

**In scope**: `js/app.js` (the `DESCARGA_RE` declaration and its one
reader only), `test/unit.js` (one new source-check section and one new
equivalence case), `README.md` (§ "How it's built", one paragraph),
`AGENTS.md` (§ "Constraints that are decisions, not gaps", one bullet),
`sw.js` (the `CACHE_VERSION` bump only).

**Out of scope**: `js/vendor/*` (vendored verbatim, not ours to rewrite;
excluded from the check); `css/style.css` (a CSS feature a browser does not
know degrades rather than killing the app — not this plan); adding WebKit
to `test/smoke.js` (a bigger change to the browser suite and its install
recipe; recorded as a follow-up); `phaseRir` (plan 062 rewrites it).

## Git workflow

- Branch: `claude/059-safari-floor`, cut from `origin/main`
  (`git checkout -B claude/059-safari-floor --no-track origin/main`).
- Commits in the repo's style — a plain sentence, no prefix, e.g.
  `deloadWeeks reads "descarga" without a lookbehind`. End every commit
  message with the `Co-Authored-By:` line your session instructions give.
- `CACHE_VERSION` bump as the **last** commit before the PR, via
  `bash tools/bump-cache-version.sh`. If another PR merges first, rebase on
  `origin/main`, take the higher version on conflict, and bump again if you
  are no longer above it.

## Steps

### Step 1: Replace the lookbehind with a loop over the matches

In `js/app.js`, replace `DESCARGA_RE` with a small function of the same
meaning: *true when the text contains at least one "descarga" that is not
immediately preceded by the word "sin" or "no" and whitespace*. Shape:

```js
/* …keep the first sentence of the old comment, then say why it is a loop:
   a lookbehind would do this in one regex, but Safari only parses one from
   16.4, and a regex literal the engine cannot read is a SyntaxError for the
   whole of app.js — the app never starts (plans/059). The floor is Safari 15. */
function saysDescarga(text) {
  const re = /descarga/gi;
  let m;
  while ((m = re.exec(text))) {
    if (!/\b(?:sin|no)\s+$/i.test(text.slice(0, m.index))) return true;
  }
  return false;
}
```

and change the reader in `deloadWeeks` to `if (saysDescarga(text)) out.add(w);`.
Delete the `const DESCARGA_RE` line. Keep the name `saysDescarga` unless
`grep -n "saysDescarga" js/*.js` already finds one (then STOP).

**Verify**: `node --check js/app.js` → exit 0;
`grep -n "DESCARGA_RE\|(?<" js/*.js` → no output;
`node test/unit.js` → `0 failed` (the two existing "sin descarga" cases
still pass).

### Step 2: Pin the new function to the old regex's answers

In `test/unit.js`, next to the existing `deloadWeeks: "sin descarga"…`
case, add a seeded equivalence check. Node supports lookbehind, so the test
may build the old regex itself (the new syntax check in Step 3 scans `js/`
and `sw.js` only, never `test/`). Generate ~2,000 strings from a small
alphabet of fragments — `'descarga'`, `'Descarga'`, `'DESCARGA'`, `'sin'`,
`'no'`, `'nos'`, `'casino'`, `' '`, `'  '`, `','`, `'-'`, `'semana'`,
`'2'`, `'RIR'` — joined in random order and length 0–8, with a fixed
seed. Reuse the LCG plan 058's fuzz already uses (`test/unit.js`, search
`let seed = 20260922;` — the next line is
`function rnd() { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; }`);
copy those two lines into your own block scope with a different seed
rather than sharing its state. For each,
assert `call('saysDescarga(' + JSON.stringify(s) + ')') === /(?<!\b(?:sin|no)\s+)descarga/i.test(s)`.
Collect mismatches and report the first few in `extra`. Name the case
`'saysDescarga answers exactly what the lookbehind it replaced answered, over 2,000 seeded labels (plans/059)'`.

**Verify**: `node test/unit.js` → the new case PASSes, `0 failed`.
Then temporarily change `\s+$` to `\s*$` in `saysDescarga`, rerun → the
new case FAILs; revert the mutation → PASS again.

### Step 3: A source check for syntax newer than Safari 15

In `test/unit.js`, beside the other source-level checks near the top
(after the `sw.js reads the cache via fromCache` assertion is a good
place), add a section:

```js
console.log('\n== shipped scripts parse on Safari 15 (plans/059) ==');
```

It reads every top-level `js/*.js` (not `js/vendor/`) plus `sw.js`, and for
each line tests a list of patterns, each with the Safari version that
first supports it (write it in a comment on each entry — that list is the
documentation):

| Pattern (regex source) | Feature | Safari |
|---|---|---|
| `\(\?<[=!]` | regex lookbehind | 16.4 |
| `\.at\(` | `Array/String.prototype.at` | 15.4 |
| `\bObject\.hasOwn\b` | `Object.hasOwn` | 15.4 |
| `\bstructuredClone\b` | `structuredClone` | 15.4 |
| `\.findLast(Index)?\(` | `findLast`/`findLastIndex` | 15.4 |
| `\.to(Sorted\|Reversed\|Spliced)\(` | change-by-copy arrays | 16 |
| `\.with\(` | `Array.prototype.with` | 16 |
| `\bstatic\s*\{` | class static blocks | 16.4 |
| `\bArray\.fromAsync\b` | `Array.fromAsync` | 16.4 |
| `\bPromise\.withResolvers\b` | `Promise.withResolvers` | 17.4 |
| `\b(Object\|Map)\.groupBy\b` | `groupBy` | 17.4 |

(The regex `v` flag, Safari 17, is left off: a line-based pattern for a
flag letter after a regex literal cannot be told from division. Review
catches it.)

One `ok(...)` for the whole section: `'no shipped script uses syntax newer than Safari 15 (plans/059)'`,
with `extra` listing `file:line  feature` for every hit. The parser is
line-based on purpose, like the id-dating section's: a comment that trips
it is reworded, not special-cased.

Add a short comment above the section saying why: the floor, the
2026-09-22 incident (`c7aaee4` shipped a lookbehind; on Safari < 16.4
`app.js` did not parse and the app never started), and that the list is
of features, not a compiler — something newer that is not on it is caught
by review, and belongs on it once found.

**Verify**: `node test/unit.js` → the new case PASSes, `0 failed`.
Mutation check: temporarily put back `const DESCARGA_RE = /(?<!x)descarga/i;`
anywhere in `js/app.js`, rerun → the new case FAILs and its `→` line names
`js/app.js:<line>` and "lookbehind"; remove it → PASS.

### Step 4: Write the floor down

- `README.md`, § "How it's built": add one sentence to the first paragraph
  or a two-sentence paragraph after it: the app targets **Safari 15 / iOS 15
  and current Chrome/Firefox**, written without syntax newer than that
  (no build step to transpile it), and `node test/unit.js` fails on a
  known newer feature in `js/` or `sw.js`.
- `AGENTS.md`, § "Constraints that are decisions, not gaps": one new bullet
  after the "No build step…" bullet: **Safari 15 is the floor.** No
  lookbehind, `.at()`, `Object.hasOwn`, `structuredClone`, `findLast`, …
  in `js/*.js` or `sw.js`; the list and the check are in `test/unit.js`
  ("shipped scripts parse on Safari 15"); a regex literal the browser
  cannot parse is a SyntaxError for the whole file, which is the stuck
  loading screen.

**Verify**: `node test/unit.js` → `0 failed` (it also checks the docs'
internal links).

### Step 5: Bump and hand over

`bash tools/bump-cache-version.sh`, commit, then open the PR (the smoke
hook runs then). PR body: what broke and on which devices, the fix, the
new check, the floor.

**Verify**: `git diff --stat origin/main...HEAD` lists only the five
in-scope files.

## Test plan

- Step 2's seeded equivalence case (new function vs the old regex), with a
  mutation that must fail it.
- Step 3's source check, with a mutation that must fail it.
- The two existing "sin descarga" cases and plan 054's section stay green
  unchanged.

## Done criteria

- [ ] `grep -rn "(?<" js/*.js sw.js` → no output
- [ ] `grep -n "DESCARGA_RE" js/*.js test/unit.js` → at most the old regex
      inside the Step 2 test (test/unit.js), nothing in `js/`
- [ ] `node --check js/app.js` exit 0; `node test/unit.js` → `0 failed`,
      with the two new cases named `(plans/059)` passing
- [ ] Both mutation checks were run and failed as expected (say so in the PR)
- [ ] `README.md` and `AGENTS.md` each name Safari 15 as the floor
- [ ] `sw.js` `CACHE_VERSION` is higher than `origin/main`'s
- [ ] Only the in-scope files changed (`git diff --stat origin/main...HEAD`)

## STOP conditions

- `grep -n "DESCARGA_RE" js/*.js` shows a reader other than `deloadWeeks`
  (another file started using it — a precache-hole question this plan did
  not settle).
- The Step 3 scan finds a hit other than `DESCARGA_RE` on the current tree
  (someone added newer syntax since `b15ae87`): report the hit; do not
  rewrite that code under this plan.
- The equivalence case in Step 2 fails for a string you believe the old
  regex got *wrong*: the goal here is identical behaviour, not a better
  rule. Report the string.

## Maintenance notes

- Plan 062 rewrites `phaseRir`. Its natural fix (refusing a decimal like
  "1,5 RIR") reaches for `(?<![\d.,])`; this check forbids it. The plan
  says how to do it without one.
- The list in Step 3 is not a compiler. When a newer feature turns up in
  review, add it to the list with its Safari version.
- Follow-up not in this plan: a WebKit project in `test/smoke.js` would
  catch what the list does not know. It costs a second browser download per
  gate run; weigh that separately.
- *(Executor: record here anything that deviated from the plan.)*
