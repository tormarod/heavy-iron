#!/usr/bin/env bash
# Bumps CACHE_VERSION in sw.js by one.
#
#   tools/bump-cache-version.sh [--dry-run]
#
# The shell is served cache-first, so a new app.js beside an untouched sw.js
# leaves returning users on the old script indefinitely (see "The release
# rule" in AGENTS.md). CI knows this and fails the `cache-version` job when a
# pull request touches index.html, css/ or js/ without moving the version —
# which is the right backstop, and also a round-trip: push, wait for a red
# run, edit one character, push again. Eight commits in this history are that
# one character and nothing else (810cc8d ad946f1 7e416f1 c684268 cf85462
# bf6684c 93ebaab b59e57f, all inside two weeks). This script is the other
# half of that gate: run it before opening the pull request and the job is
# green on the first try.
#
# It is deliberately not wired into the pre-PR hook. A docs-only pull request
# must NOT bump — CI does not ask it to, and a bump costs every returning
# user a fresh download of the whole shell for nothing. Deciding that is a
# judgement call, so it stays a command you run, not a thing that happens to
# you. The warning below is the compromise: it tells you when the bump looks
# unnecessary, but it still does it, because you may know something the diff
# does not.
#
# On a merge conflict in this line, take the HIGHER version. Two branches that
# both bumped v60 to v61 have each shipped a different shell under one cache
# key; v62 is the only value that is new to every client.
#
#   --dry-run   print `vN -> vN+1` and change nothing. Exit 0.

set -u
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "bump-cache-version: unknown argument: $arg" >&2; exit 1 ;;
  esac
done

[ -f sw.js ] || { echo "bump-cache-version: no sw.js in $ROOT" >&2; exit 1; }

# One shape only. Anything else — a template literal, a computed suffix, a
# second declaration — means the release rule has changed and this script's
# idea of it is stale, so it stops rather than rewriting the wrong thing.
line="$(grep -n "^const CACHE_VERSION = 'v[0-9][0-9]*';$" sw.js)"
if [ "$(printf '%s\n' "$line" | grep -c .)" != "1" ]; then
  echo "bump-cache-version: sw.js has no single \`const CACHE_VERSION = 'vN';\` line" >&2
  echo "bump-cache-version: found: ${line:-nothing}" >&2
  exit 1
fi

lineno="${line%%:*}"
current="$(printf '%s\n' "$line" | sed "s/.*'\(v[0-9]*\)'.*/\1/")"
next="v$(( ${current#v} + 1 ))"

if [ "$DRY_RUN" = "1" ]; then
  echo "$current -> $next"
  exit 0
fi

# sed -i is not portable (BSD sed wants an argument to it), and this repo is
# edited from Windows as often as from Linux. A temp file and a mv is the
# version that behaves the same everywhere.
tmp="$(mktemp "${TMPDIR:-/tmp}/bump-cache-version.XXXXXX")" || exit 1
trap 'rm -f "$tmp"' EXIT
sed "${lineno}s/'${current}'/'${next}'/" sw.js > "$tmp" || exit 1

# Paranoia, not ceremony: a sed that matched nothing would silently leave the
# file as it was, and the caller would push believing the bump had happened.
grep -q "^const CACHE_VERSION = '${next}';$" "$tmp" || {
  echo "bump-cache-version: the rewrite did not take — sw.js left alone" >&2
  exit 1
}

cat "$tmp" > sw.js || exit 1
echo "$current -> $next"

# Advisory only, and after the write: the bump is already done, this just
# says it may not have been needed. Both halves matter — the committed diff
# against the base, and whatever is still only in the working tree.
BASE="${BUMP_BASE:-origin/main}"
changed=""
if git rev-parse -q --verify "$BASE" >/dev/null 2>&1; then
  base_point="$(git merge-base "$BASE" HEAD 2>/dev/null)" || base_point=""
  [ -n "$base_point" ] && changed="$(git diff --name-only "$base_point" 2>/dev/null)"
fi
changed="$(printf '%s\n%s\n%s\n' \
  "$changed" \
  "$(git diff HEAD --name-only 2>/dev/null)" \
  "$(git ls-files --others --exclude-standard 2>/dev/null)" | sort -u)"

# The same regex as the cache-version job in .github/workflows/test.yml,
# extension-anchored: the prefix form also matched js/vendor/README.md and
# SHA256SUMS, and this advisory then stayed silent on a vendor-notes branch
# CI would never have asked to bump (plans/043). Keep the two identical.
if ! printf '%s\n' "$changed" | grep -qE '^(index\.html|css/.*\.css|js/.*\.js)$'; then
  echo "bump-cache-version: nothing in the shell changed — a bump is not needed" >&2
  echo "bump-cache-version: (CI only asks for one when index.html or a css/*.css or js/*.js file moves — not the vendor notes)" >&2
fi
exit 0
