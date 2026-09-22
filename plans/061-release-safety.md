# Plan 061: A release can't deploy under a version already shipped, a first visit isn't reloaded, and the smoke gate sees every way a PR is opened

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If a STOP condition occurs, stop and report — do not improvise. Fill in
> "Maintenance notes" when done; the orchestrator maintains
> `plans/README.md` unless you were told otherwise.
>
> **This plan is three small independent steps (A, B, C).** They may land
> as one PR or three; B is the only one that touches the shell and bumps
> `CACHE_VERSION`.
>
> **Drift check (run first)**:
> `git diff --stat b15ae87..origin/main -- .github/workflows/pages.yml .github/workflows/test.yml js/app.js .claude/settings.json tools/smoke-gate.sh AGENTS.md test/smoke.js sw.js`

## Status

- **Priority**: P2 (A is the most valuable of the three)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. Landing A early protects every later plan's
  deploy from the collision it describes.
- **Category**: dx / release / sw
- **Planned at**: commit `b15ae87`, 2026-09-22 (tenth audit, findings 6, 7, 12)

## Why this matters

**A — two PRs with the same bump both deploy.** The `cache-version` job in
`.github/workflows/test.yml` compares a pull request's `sw.js` against its
base *at the time the check runs*. Two PRs cut from the same `main` each
bump `v112 → v113`; each passes; they merge seconds apart without a
conflict (identical edits to one line merge cleanly); and the second
deploys new `js/` files under a `CACHE_VERSION` phones have already
installed — so those phones keep the first PR's copies of the files the
second one changed, cache-first, until some later bump. This happened on
2026-09-22: PRs #148, #149 and #150 all shipped `v113`, merged within
34 s (`aad71e9`, `b7f700e`, `527f290`). The repo's own process note ("take
the highest `CACHE_VERSION` on conflict") never fires, because there is
no conflict. The deploy workflow (`.github/workflows/pages.yml`) runs on
every push to `main` with no check at all.

**B — a first visit reloads under the user.** On a device's first visit
the new worker's `activate` calls `clients.claim()`; claiming a page that
had no controller fires `controllerchange`; the app's listener reloads the
page unconditionally. The reload lands whenever the precache finishes —
typically while the first-run setup sheet is open — and loses whatever was
typed or pasted there. The smoke suite already works around it
(`test/smoke.js`, the comment above its first-visit helper says a section
"ticked a set, the page reloaded under it").

**C — the smoke gate may be skipped.** The browser suite runs only as a
Claude Code `PreToolUse` hook when a PR is opened. The hook's matcher for
MCP tools is the exact name `mcp__github__create_pull_request`, but a
GitHub MCP installed as a plugin exposes differently prefixed tool names
(`mcp__plugin_<…>_github__create_pull_request`). The gate script itself
already accepts any `^mcp__.*create_pull_request$`; the matcher in
front of it is narrower, so the script is never called for those tools.

## Current state

- `.github/workflows/pages.yml` (whole file, 36 lines): `on: push:
  branches: ["main"]` and `workflow_dispatch`; one job `deploy` with
  checkout → configure-pages → upload-pages-artifact (`path: "."`) →
  deploy-pages, every action pinned to a commit SHA with a `# vX` comment.
  `permissions: contents: read, pages: write, id-token: write`.
- `.github/workflows/test.yml`, job `cache-version`, step
  `Require a CACHE_VERSION bump when the app shell changes` — the logic to
  mirror (read it in full; ≈ lines 64–100):

  ```bash
  changed=$(git diff --name-only "$base"...HEAD)
  if ! echo "$changed" | grep -qE '^(index\.html|css/.*\.css|js/.*\.js)$'; then
    echo "No app-shell changes — nothing to check."; exit 0
  fi
  old=$(git show "$base":sw.js | grep -m1 'CACHE_VERSION =')
  new=$(grep -m1 'CACHE_VERSION =' sw.js)
  if [ "$old" = "$new" ]; then
    echo "::error file=sw.js::The app shell changed but CACHE_VERSION did not."
    …; exit 1
  fi
  ```

- `js/app.js`, `registerServiceWorker` (search `function registerServiceWorker`,
  ≈ line 7123). Its tail (≈ line 7169):

  ```js
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    flushSave();
    location.reload();
  });
  ```

  Earlier in the same function, `offerUpdate` is only called when
  `navigator.serviceWorker.controller` is set — the function already
  distinguishes "no controller yet" from "an update".
- `sw.js` `activate` ends `.then(() => self.clients.claim())` (≈ line 114).
  Do not change `sw.js` beyond the bump.
- `js/boot-guard.js` has its **own** `controllerchange` listener, installed
  only when the skeleton is still on screen (a boot that failed). It is
  not affected and must not change.
- `.claude/settings.json`:

  ```json
  { "hooks": { "PreToolUse": [
      { "matcher": "mcp__github__create_pull_request",
        "hooks": [ { "type": "command", "command": "\"${CLAUDE_PROJECT_DIR:-.}\"/tools/smoke-gate.sh", "timeout": 900, … } ] },
      { "matcher": "Bash", "hooks": [ { "type": "command", "if": "Bash(gh pr create *)", … } ] }
  ] } }
  ```

- `tools/smoke-gate.sh` (≈ line 97): `if (/^mcp__.*create_pull_request$/.test(tool)) return out("", cwd);`
- `AGENTS.md` § "The release rule" and § "How to verify a change" describe
  the gate and the bump.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| YAML sanity | `node -e "require('fs').readFileSync('.github/workflows/pages.yml','utf8')"` then read it | parses by eye; indentation consistent |
| JSON | `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"` | exit 0 |
| Syntax | `node --check js/app.js` | exit 0 |
| Unit | `node test/unit.js` | `0 failed` |
| One smoke section | `node test/smoke.js --only "<name>"` | PASS (server on :8765, Playwright installed — AGENTS.md) |
| Bump | `bash tools/bump-cache-version.sh` | old → new |

## Scope

**In scope**: `.github/workflows/pages.yml` (A), `AGENTS.md` (A: one
sentence in § "The release rule"), `js/app.js` (B: the
`controllerchange` listener only), `test/smoke.js` (B: one new section),
`sw.js` (B: bump only), `.claude/settings.json` (C).

**Out of scope**: `test.yml`'s existing jobs (keep them as they are);
branch-protection settings (repository settings are the maintainer's, not
a file); `sw.js` logic; `js/boot-guard.js`; `tools/smoke-gate.sh`.

## Git workflow

- Branch `claude/061-release-safety` from `origin/main`
  (`git checkout -B claude/061-release-safety --no-track origin/main`).
- One commit per step, plain-sentence subjects. End messages with your
  session's `Co-Authored-By:` line. Bump last (B only).

## Steps

### Step A: The deploy refuses a shell that changed without a new version

In `.github/workflows/pages.yml`, add a job `guard` before `deploy`, and
make `deploy` `needs: guard`. `guard` runs on `ubuntu-latest`, checks out
with `fetch-depth: 0` using the **same pinned** `actions/checkout@<sha>`
line `deploy` already uses, and for `push` events compares what is being
deployed with what was on `main` before the push:

```yaml
  guard:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@<same sha as deploy's> # v7.0.1
        with:
          fetch-depth: 0
      - name: Refuse a shell that changed under a version already deployed
        if: github.event_name == 'push'
        env:
          BEFORE: ${{ github.event.before }}
        run: |
          # (comment: why — the 2026-09-22 v113 collision, and that the PR
          #  check cannot see it because it compares against a base that
          #  moved after it ran)
          changed=$(git diff --name-only "$BEFORE" HEAD)
          if ! echo "$changed" | grep -qE '^(index\.html|css/.*\.css|js/.*\.js)$'; then
            echo "No app-shell changes since the last deploy."; exit 0
          fi
          old=$(git show "$BEFORE":sw.js | grep -m1 'CACHE_VERSION =')
          new=$(grep -m1 'CACHE_VERSION =' sw.js)
          echo "deployed: $old"; echo "this push: $new"
          if [ "$old" = "$new" ]; then
            echo "::error file=sw.js::The shell changed since the last deploy but CACHE_VERSION did not — two PRs probably made the same bump. Bump again on main."
            exit 1
          fi
```

Notes for the executor:
- Use `"$BEFORE" HEAD` (two dots / plain two-arg diff), **not** the
  three-dot form the PR check uses: here we want exactly the difference
  between the deployed tree and this one.
- Pass `github.event.before` through `env:`, never interpolate `${{ }}`
  inside `run:` (the repo already does this for `BASE_REF`).
- `workflow_dispatch` skips the step (it redeploys the tree as it is) and
  the job succeeds, so `deploy` still runs.
- A failed `guard` means nothing deploys: the site stays on the last good
  release, and the fix is a new bump on `main`, which pushes and deploys.
- Keep `permissions` at the workflow level as they are; `guard` needs only
  `contents: read`, which it has.

In `AGENTS.md` § "The release rule", add one sentence after the paragraph
about the `cache-version` job: the deploy workflow checks the same thing
against what is live, so two PRs that made the same bump no longer both
ship — the second deploy fails and needs one more bump on `main`.

**Verify**: read the YAML back and check indentation (two spaces, `guard`
at the same level as `deploy`); run the step's script locally against the
real collision to prove it would have fired:

```bash
git diff --name-only aad71e9 b7f700e | grep -E '^(index\.html|css/.*\.css|js/.*\.js)$'
git show aad71e9:sw.js | grep -m1 'CACHE_VERSION ='
git show b7f700e:sw.js | grep -m1 'CACHE_VERSION ='
```

→ prints `js/app.js`, `js/block-editor.js`, `js/diagnostics.js`, then two
identical `const CACHE_VERSION = 'v113';` lines: the push of `b7f700e`
(PR #149) onto `aad71e9` (PR #148) would have failed the guard.
`node test/unit.js` → `0 failed`.

### Step B: No reload when the page had no controller

In `js/app.js`, in `registerServiceWorker`, change the listener so a
`controllerchange` that only means "a worker took control of a page it did
not control before" is ignored, and every later one still reloads:

```js
/* (comment: a first visit's worker claims the page on activate, which fires
   this too; reloading then threw away whatever the first-run sheet held,
   whenever the precache happened to finish. Only a swap — a page that
   already had a controller getting a new one — needs the reload.) */
let controlled = !!navigator.serviceWorker.controller;
let reloading = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (!controlled) { controlled = true; return; }
  if (reloading) return;
  reloading = true;
  flushSave();
  location.reload();
});
```

`controlled` must be read **synchronously when the listener is added**
(before any `await`/`.then`), which is where the current code adds it.

Add a smoke section to `test/smoke.js`, modelled on the sections that
open a fresh `browser.newContext()` (search `browser.newContext()`), named
`'primera visita: el trabajador toma el control sin recargar la página'`:
open a fresh context and page, `goto(BASE)` **without** the suite's
first-visit helper, set `window.__firstPage = true` via `page.evaluate`,
wait until `navigator.serviceWorker.controller` is non-null (a
`waitForFunction`, not a fixed sleep), then wait for network idle and
assert `await page.evaluate(() => window.__firstPage === true)`. Do not
add a fixed `waitForTimeout` — `test/unit.js` ratchets their count.

**Verify**: `node --check js/app.js`; `node test/unit.js` → `0 failed`;
`node test/smoke.js --only "primera visita"` → PASS; then
`node test/smoke.js --only "aviso de versión"` (the update-prompt section) →
still PASS. Mutation: set `controlled = true` initially → the new section
FAILs; revert.

Then `bash tools/bump-cache-version.sh` and commit.

### Step C: The hook's matcher matches the gate's own pattern

In `.claude/settings.json`, change the first matcher from
`"mcp__github__create_pull_request"` to `"mcp__.*__create_pull_request"`
(Claude Code treats a matcher as a regular expression; this matches the
plain and the plugin-prefixed GitHub MCP tool alike, and nothing that
does not end in `__create_pull_request`). Leave the `Bash` entry alone.

**Verify**: `node -e "const s=JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'));const m=new RegExp('^(?:'+s.hooks.PreToolUse[0].matcher+')$');console.log(['mcp__github__create_pull_request','mcp__plugin_engineering_github__create_pull_request'].map(t=>m.test(t)), m.test('mcp__github__list_pull_requests'))"`
→ `[ true, true ] false`.

## Test plan

- A: the local replay of the real 2026-09-22 collision (Step A's Verify).
- B: the new smoke section plus the existing update-prompt section; one
  mutation.
- C: the regex check.

## Done criteria

- [ ] `pages.yml` has a `guard` job; `deploy` has `needs: guard`; the
      guard's checkout uses the same pinned SHA as `deploy`'s
- [ ] Step A's replay prints three shell files and two equal `v113` lines
- [ ] `grep -n "if (!controlled)" js/app.js` → one line
- [ ] `node test/unit.js` → `0 failed`; the two smoke sections PASS
- [ ] `.claude/settings.json` parses; Step C's check prints `[ true, true ] false`
- [ ] `CACHE_VERSION` above `origin/main`'s (Step B); only in-scope files changed

## STOP conditions

- `github.event.before` is empty or all zeros in the replay you can
  construct, or the repo's Pages deploy uses a different trigger than
  `push` to `main` by the time you run this.
- Step B's new smoke section cannot be made to pass without a fixed sleep.
- Claude Code's documentation (if you can reach it) says hook matchers are
  **not** regular expressions — then use the exact plugin tool name as a
  second entry instead, and say so.

## Maintenance notes

- The guard compares with the previous tip of `main`, which is what was
  deployed only if the previous deploy succeeded. After a failed guard,
  the next push compares with the failed tip — still correct, since that
  tip's shell was never served.
- The smoke helper in `test/smoke.js` that waits out the first-visit
  reload (its comment names `registerServiceWorker`) does **not** merely
  become unnecessary after B — it hangs. `openApp()`'s wait for
  `performance.getEntriesByType('navigation')[0].workerStart > 0` was only
  ever satisfied by the reload itself: a first-ever navigation is never one
  a worker answers (no worker exists yet when it is dispatched), so without
  a second navigation `workerStart` stays 0 forever and the `waitForFunction`
  times out at 30 s. Confirmed directly (see the deviation note below) on
  both `main session` and `aviso de versión nueva` before the fix that
  replaced the wait with `navigator.serviceWorker.controller` — the thing
  `workerStart` was only ever a proxy for, and which needs no reload.
- `renderVersion()` (`js/app.js`) is called exactly once, synchronously,
  right after `register()` resolves — always before a first-time page's
  worker has had a chance to claim it, so `navigator.serviceWorker.controller`
  is still null and the footer (`#version`) stays blank. Its own comment
  already promised "it appears by itself once a worker that does answer
  takes over"; that was only ever true because the old unconditional reload
  gave `registerServiceWorker()` a second, by-then-controlled run to render
  into. B's `controllerchange` listener now calls `renderVersion()` from its
  first-claim branch (the `if (!controlled) { … }` arm) so the comment's
  promise still holds once the reload it silently depended on is gone.
- **Executor (Step B) deviation, recorded in full because it widens the
  files touched past the Scope section's literal wording**: enabling just
  the `controlled` guard (the plan's exact diff, verified correct on its
  own) left `openApp()` hanging on every section that opens a fresh
  `browser.newContext()` — `main session` included, not only the two
  sections this step's task named — and left `#version` permanently blank
  on a first visit. Both were judged fixable in place rather than
  STOP-worthy: the `openApp()` fix is inside `test/smoke.js`, the file B
  was already touching for its new section, and the `renderVersion()` call
  is inside the `controllerchange` listener itself, the one thing Scope
  names in `js/app.js`. The alternative was shipping B's listener change
  with the shared smoke helper broken for the whole suite and a real footer
  regression, which seemed worse than a documented, verified widening.
  Verified with targeted `--only` runs on port 8794, not the full suite
  (rung 3 policy — `tools/smoke-gate.sh` still runs the whole thing once,
  on `gh pr create`): `main session` (236 assertions, incl. service worker
  sub-section), `aviso de versión nueva`, `primera visita: el trabajador
  toma el control sin recargar la página`, `arranque roto: el guardián
  cambia al worker en espera`, `versión en el pie`, `profile import
  hardening`, `offline`, `published blocks stay importable offline`, `dos
  pestañas: el guardado pendiente no se adelanta al aviso`, `descanso con
  la pantalla apagada`, `arranque sin la tipografía`, `installable` — all
  pass (12 of 32 sections, chosen for being the ones that open a fresh
  context, share multiple pages/tabs, or exercise the first-run sheet).
  Mutation (plan's own, on the `controlled` guard): forcing
  `controlled = true` initially failed the new `primera visita` section as
  expected; reverted, `node test/unit.js` still `0 failed`.
