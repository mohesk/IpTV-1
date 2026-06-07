#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Package the app into an (unsigned) .wgt widget archive.
#
# A Tizen .wgt is simply a ZIP of the project root with config.xml at the top
# level. For SIDELOADING / STORE submission the package must be SIGNED with
# author + distributor certificates — use the Tizen Studio CLI for that:
#
#   tizen build-web -- .                       # produces .buildResult/
#   tizen package -t wgt -s <profile> -- .buildResult
#
# This script produces a quick unsigned archive that is handy for inspection
# and for Tizen CLI's own packaging pipeline.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/build"
OUT="$OUT_DIR/IPTV.wgt"

cd "$ROOT"
mkdir -p "$OUT_DIR"
rm -f "$OUT"

zip -r -X "$OUT" \
    config.xml \
    index.html \
    icon.png \
    css \
    js \
    config \
    -x '*/.*' >/dev/null

echo "Built unsigned widget: $OUT"
echo "Contents:"
unzip -l "$OUT"
echo
echo "NOTE: sign with 'tizen package -t wgt -s <profile>' before installing on a TV."
