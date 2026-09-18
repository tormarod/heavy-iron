#!/usr/bin/env bash
# Runs the whole test suite the way CI used to, on the machine a pull
# request is being opened from.
#
#   tools/smoke-gate.sh
#
# The browser smoke suite (test/smoke.js) no longer runs on GitHub: it needs
# a Chromium download on every run, and the only thing it ever caught that
# CI could not was invisible from a headless unit test anyway. So it runs
# here instead — wired as a Claude Code PreToolUse hook in
# .claude/settings.json that fires when a pull request is about to be
# created, and blocks the PR if anything fails. The hook's `if` filter is
# best-effort (a Bash command Claude Code cannot parse into subcommands runs
# the hook anyway), so the gate also reads the tool call off stdin and skips
# anything that is not a PR being opened. It is also fine to run by hand
# before pushing.
#
# What it does, in order: syntax-check every script, run test/unit.js,
# install Playwright + Chromium if they are missing (pinned to the version
# CI used, so results stay comparable), serve the repo on a free local
# port, run test/smoke.js against it, and stop the server. Exit status is
# the first failure's. Exit code 2 is what a PreToolUse hook needs to block
# the tool call, so every failure path uses it.
#
# Everything both suites print is copied to a log file, and a failure prints
# the FAIL lines out of it on stderr. Running as a hook, stderr is the only
# channel that reaches whoever is opening the pull request: stdout is
# swallowed, so without this a block reads "test/smoke.js failed" and the one
# assertion that failed — with the diagnostic line the suites print after the
# arrow, which is usually the whole answer — is lost. That left running the
# full suite by hand as the only way to find out what broke, which is exactly
# what AGENTS.md tells agents not to do.
#
# A pull request that touches nothing the tests can see — a plan under
# plans/, the README, a workflow — is not worth four minutes of Chromium, so
# the gate first diffs the branch against the base and returns at once when
# none of the files below changed. The list is what the two suites actually
# load or read: the shell, the worker, the published blocks and the tests.
# It is deliberately wider than CI's cache-version rule (index.html, css/,
# js/), because the smoke suite also exercises sw.js and imports from
# blocks/. This script is not on the list: a change to how the gate decides
# is not something running the suite can check, and a syntax error in it
# fails the hook on its own. Use SMOKE_GATE_FORCE=1 to run it in full anyway.
#
# Environment:
#   SMOKE_GATE_BASE     the ref the branch is compared against; defaults to
#                       origin/main. Unknown ref → the gate runs in full.
#   SMOKE_GATE_FORCE=1  run everything even when the diff is docs-only.
#   SMOKE_GATE_SKIP=1   skip the browser half (unit tests still run) — for a
#                       machine with no Chromium and no way to fetch one.
#   PLAYWRIGHT_VERSION  defaults to 1.56.1.
#   SMOKE_GATE_LOG      where this run is logged; defaults to
#                       .smoke-gate.log in the repo root (gitignored). It is
#                       truncated per run, and holds the last full run
#                       whether it passed or failed.

set -u
# Without pipefail a failing suite piped into tee reports tee's own success,
# and the gate would wave through every red run.
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

command -v node >/dev/null 2>&1 || { echo "smoke-gate: node is not installed" >&2; exit 2; }

# As a hook, the tool call arrives as JSON on stdin. The `if` filter in
# .claude/settings.json is supposed to keep the Bash entry to `gh pr create`,
# but it has fired on an unrelated Bash command — a long heredoc editing the
# tests — and, with the unit suite mid-edit, blocked that edit with
# "test/unit.js failed". So the gate reads the call itself and returns at
# once unless a pull request is really being opened. No stdin, or stdin that
# is not hook JSON, means someone ran it by hand: run in full.
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
      console.log("a " + tool + " call");
    });')"
  if [ -n "$verdict" ]; then
    echo "smoke-gate: hook fired on $verdict — not a pull request being opened, skipping"
    exit 0
  fi
fi

PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.56.1}"
SMOKE_GATE_BASE="${SMOKE_GATE_BASE:-origin/main}"
TESTED_PATHS='^(index\.html|css/|js/|sw\.js|manifest\.webmanifest|blocks/|test/)'
SERVER_PID=""

LOG="${SMOKE_GATE_LOG:-$ROOT/.smoke-gate.log}"

# stderr, because that is the only part of a blocked hook the caller is shown.
# The filter keeps the assertion lines and the tally; if a suite died before
# printing either, the tail is the stack trace instead of nothing.
fail() {
  echo "smoke-gate: $*" >&2
  if [ -s "$LOG" ]; then
    lines="$(grep -nE '^[[:space:]]*FAIL|[0-9]+ passed, [0-9]+ failed|^[A-Za-z]*Error|Cannot find|ECONNREFUSED' "$LOG" | tail -30)"
    [ -n "$lines" ] || lines="$(tail -20 "$LOG")"
    echo "smoke-gate: ---- from $LOG ----" >&2
    printf '%s\n' "$lines" >&2
    echo "smoke-gate: ---- full log: $LOG ----" >&2
  fi
  exit 2
}
cleanup() { if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; fi; }
trap cleanup EXIT

if [ "${SMOKE_GATE_FORCE:-}" != "1" ] && git rev-parse --verify --quiet "$SMOKE_GATE_BASE^{commit}" >/dev/null; then
  # Committed changes since the branch left the base, plus anything still
  # uncommitted or untracked in the working tree — `git diff <commit>` covers
  # the first two, `ls-files --others` the third.
  changed="$( { git diff --name-only "$(git merge-base "$SMOKE_GATE_BASE" HEAD)"; git ls-files --others --exclude-standard; } | sort -u )"
  if ! printf '%s\n' "$changed" | grep -qE "$TESTED_PATHS"; then
    echo "smoke-gate: nothing the tests can see changed against $SMOKE_GATE_BASE — skipping"
    exit 0
  fi
fi

: > "$LOG" || fail "cannot write the log at $LOG"

echo "smoke-gate: syntax check" | tee -a "$LOG"
for f in js/*.js sw.js test/*.js; do
  node --check "$f" 2>&1 | tee -a "$LOG" || fail "syntax error in $f"
done

echo "smoke-gate: unit tests" | tee -a "$LOG"
node test/unit.js 2>&1 | tee -a "$LOG" || fail "test/unit.js failed"

if [ "${SMOKE_GATE_SKIP:-}" = "1" ]; then
  echo "smoke-gate: SMOKE_GATE_SKIP=1 — browser suite skipped"
  exit 0
fi

command -v python3 >/dev/null 2>&1 || fail "python3 is needed to serve the site"

# Playwright is a dev-only dependency of a repo that has no package.json on
# purpose (see AGENTS.md), so it is installed with --no-save into a
# node_modules/ that .gitignore already hides.
#
# Lifecycle scripts are off, which costs nothing and closes the one place this
# repo runs third-party code at install time: the only install script that
# matters is Playwright's browser download, and the next line does that
# explicitly anyway. Left on, every transitive package in that tree gets to
# run a postinstall on the machine a pull request is being opened from.
if ! node -e "require('playwright')" >/dev/null 2>&1; then
  echo "smoke-gate: installing playwright@$PLAYWRIGHT_VERSION"
  npm install --no-save --ignore-scripts "playwright@$PLAYWRIGHT_VERSION" >/dev/null 2>&1 || fail "npm install playwright failed"
fi
# `playwright install` is a no-op when the pinned Chromium is already there,
# and a download when it is not; --with-deps needs root, so it is left to
# the person on a fresh Linux box.
npx playwright install chromium >/dev/null 2>&1 || fail "could not install Chromium for Playwright"

# --list is the documented way to find a section name, and it is one null
# browser away from breaking: a section written as a bare `{ … }` block runs
# its body in list mode and dies on browser.newContext(). It costs a second
# here and it has been broken before. It needs playwright required, so it
# sits below the install rather than up with the unit tests.
# Into the log, not /dev/null: fail() greps the log, and with the output
# discarded the only lines left to show would be the unit suite's "0 failed"
# tally, which reads as a contradiction next to a --list failure.
node test/smoke.js --list >>"$LOG" 2>&1 || fail "test/smoke.js --list failed — a section is probably a bare block, not a section() call"

# A free port, so this does not collide with a dev server already up on 8765.
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  if node -e "fetch('http://127.0.0.1:$PORT/index.html').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

echo "smoke-gate: browser smoke tests on :$PORT" | tee -a "$LOG"
BASE="http://127.0.0.1:$PORT" node test/smoke.js 2>&1 | tee -a "$LOG" || fail "test/smoke.js failed — fix it before opening the pull request"

echo "smoke-gate: all green (log: $LOG)"
