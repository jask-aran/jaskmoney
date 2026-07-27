#!/usr/bin/env bash
set -euo pipefail

# Generate the frozen Go reference captures into the repository's docs/ tree.
# Prerequisites: go, python3, pillow.

legacy_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$legacy_root/../.." && pwd)"
cd "$legacy_root"

printf '=== Generating .ansi and .txt files ===\n'
CLICOLOR_FORCE=1 COLORTERM=truecolor TERM=xterm-256color \
  go run -tags reference_gen .

printf '\n=== Generating .png files (force re-render) ===\n'
count=0
for f in "$repo_root"/docs/reference-*.ansi; do
    [ -e "$f" ] || continue
    png="${f%.ansi}.png"
    cols=140
    rows=44
    if [[ "$f" == *narrow* ]]; then
        cols=70
    fi
    python3 "$legacy_root/scripts/ansi2png.py" "$f" "$png" "$cols" "$rows"
    count=$((count + 1))
done

printf '\nDone. Generated %s PNG files in %s/docs/.\n' "$count" "$repo_root"
