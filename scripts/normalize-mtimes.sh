#!/usr/bin/env bash
# Sets the modification time of every tracked file in a git checkout to the
# time of its HEAD commit.
#
# Cargo calls a path dependency stale when a source file is newer than the
# cached build output. A fresh checkout gives every file the time of the
# checkout, so a restored target/ directory is rebuilt each run. With one fixed
# time per Exact commit, the restored cache stays fresh.
set -euo pipefail

dir="${1:?usage: normalize-mtimes.sh <git checkout>}"
commit_time="$(git -C "$dir" log -1 --format=%ct)"

# GNU date reads -d @seconds, BSD date reads -r seconds.
stamp="$(TZ=UTC date -d "@$commit_time" +%Y%m%d%H%M.%S 2>/dev/null || TZ=UTC date -r "$commit_time" +%Y%m%d%H%M.%S)"

cd "$dir"
git ls-files -z | TZ=UTC xargs -0 touch -h -t "$stamp"
echo "mtimes in $dir set to $stamp UTC (commit $(git rev-parse --short HEAD))"
