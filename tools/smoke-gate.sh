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
# created, and blocks the PR if anything fails. It is also fine to run by
# hand before pushing.
#
# What it does, in order: syntax-check every script, run test/unit.js,
# install Playwright + Chromium if they are missing (pinned to the version
# CI used, so results stay comparable), serve the repo on a free local
# port, run test/smoke.js against it, and stop the server. Exit status is
# the first failure's. Exit code 2 is what a PreToolUse hook needs to block
# the tool call, so every failure path uses it.
#
# A pull request that touches nothing the tests can see — a plan under
# plans/, the README, a workflow — is not worth four minutes of Chromium, so
# the gate first diffs the branch against the base and returns at once when
# none of the files below changed. The list is what the two suites actually
# load or read: the shell, the worker, the published blocks, the tests, and
# this script. It is deliberately wider than CI's cache-version rule
# (index.html, css/, js/), because the smoke suite also exercises sw.js and
# imports from blocks/.
#
# Environment:
#   SMOKE_GATE_BASE     the ref the branch is compared against; defaults to
#                       origin/main. Unknown ref → the gate runs in full.
#   SMOKE_GATE_FORCE=1  run everything even when the diff is docs-only.
#   SMOKE_GATE_SKIP=1   skip the browser half (unit tests still run) — for a
#                       machine with no Chromium and no way to fetch one.
#   PLAYWRIGHT_VERSION  defaults to 1.56.1.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.56.1}"
SMOKE_GATE_BASE="${SMOKE_GATE_BASE:-origin/main}"
TESTED_PATHS='^(index\.html|css/|js/|sw\.js|manifest\.webmanifest|blocks/|test/|tools/smoke-gate\.sh)'
SERVER_PID=""

fail() { echo "smoke-gate: $*" >&2; exit 2; }
cleanup() { if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; fi; }
trap cleanup EXIT

command -v node >/dev/null 2>&1 || fail "node is not installed"

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

echo "smoke-gate: syntax check"
for f in js/*.js sw.js test/*.js; do
  node --check "$f" || fail "syntax error in $f"
done

echo "smoke-gate: unit tests"
node test/unit.js || fail "test/unit.js failed"

if [ "${SMOKE_GATE_SKIP:-}" = "1" ]; then
  echo "smoke-gate: SMOKE_GATE_SKIP=1 — browser suite skipped"
  exit 0
fi

command -v python3 >/dev/null 2>&1 || fail "python3 is needed to serve the site"

# Playwright is a dev-only dependency of a repo that has no package.json on
# purpose (see AGENTS.md), so it is installed with --no-save into a
# node_modules/ that .gitignore already hides.
if ! node -e "require('playwright')" >/dev/null 2>&1; then
  echo "smoke-gate: installing playwright@$PLAYWRIGHT_VERSION"
  npm install --no-save "playwright@$PLAYWRIGHT_VERSION" >/dev/null 2>&1 || fail "npm install playwright failed"
fi
# `playwright install` is a no-op when the pinned Chromium is already there,
# and a download when it is not; --with-deps needs root, so it is left to
# the person on a fresh Linux box.
npx playwright install chromium >/dev/null 2>&1 || fail "could not install Chromium for Playwright"

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

echo "smoke-gate: browser smoke tests on :$PORT"
BASE="http://127.0.0.1:$PORT" node test/smoke.js || fail "test/smoke.js failed — fix it before opening the pull request"

echo "smoke-gate: all green"
