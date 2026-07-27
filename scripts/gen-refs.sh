#!/usr/bin/env bash
set -euo pipefail

# Generate all reference captures: .ansi (raw ANSI), .txt (stripped), .png (Meslo raster).
#
# Prerequisites:
#   go, python3, pillow

cd "$(dirname "$0")/.."

echo "=== Generating .ansi and .txt files ==="
CLICOLOR_FORCE=1 COLORTERM=truecolor TERM=xterm-256color \
  go run -tags reference_gen .

echo ""
echo "=== Generating .png files (force re-render) ==="
mkdir -p docs
count=0
for f in docs/reference-*.ansi; do
    [ -e "$f" ] || continue
    png="${f%.ansi}.png"
    # Infer viewport from companion .txt line count when present
    cols=140
    rows=44
    if [[ "$f" == *narrow* ]]; then
        cols=70
    fi
    python3 scripts/ansi2png.py "$f" "$png" "$cols" "$rows"
    count=$((count + 1))
done

echo ""
echo "Done. Generated $count PNG files in docs/."
echo "File counts:"
echo "  .ansi: $(ls docs/reference-*.ansi 2>/dev/null | wc -l)"
echo "  .txt:  $(ls docs/reference-*.txt 2>/dev/null | wc -l)"
echo "  .png:  $(ls docs/reference-*.png 2>/dev/null | wc -l)"
