#!/usr/bin/env bash
# Runs a CI command; if it fails, the tail of its output is attached to the
# workflow as an error annotation so it can be read through the GitHub API
# without downloading the full log.
set -o pipefail
label="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  tail -n 60 "$log" | sed -e 's/\x1b\[[0-9;]*m//g' > "$log.tail"
  msg=$(sed -e ':a;N;$!ba;s/%/%25/g;s/\r/%0D/g;s/\n/%0A/g' "$log.tail")
  echo "::error title=${label} failed (exit ${status})::${msg}"
fi
exit "$status"
