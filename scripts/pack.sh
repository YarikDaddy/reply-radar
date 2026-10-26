#!/usr/bin/env bash
# Собирает extension/ в zip для GitHub Release: скачал → распаковал → Load unpacked.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./extension/manifest.json").version')
out="dist/reply-radar-v$version.zip"
mkdir -p dist
rm -f "$out"
(cd extension && zip -qr "../$out" . -x '.*')
echo "$out"
