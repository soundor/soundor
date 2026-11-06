#!/usr/bin/env bash
# macos-minimum.sh <version> <binary>: fails unless every architecture of a macOS
# binary names exactly this minimum macOS.
set -euo pipefail
expected=$1
binary=$2
archs=$(lipo -archs "$binary")
for arch in $archs; do
  minos=$(vtool -arch "$arch" -show-build "$binary" | awk '$1 == "minos" { print $2; exit }')
  if [ "$minos" != "$expected" ]; then
    echo "::error::$binary ($arch) needs macOS ${minos:-unknown}, not $expected"
    exit 1
  fi
  echo "$arch: macOS $minos"
done
