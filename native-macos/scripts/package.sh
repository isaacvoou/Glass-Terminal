#!/bin/sh
set -eu
umask 022
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ "$(uname -s)" != Darwin ]; then
    echo 'Упаковка нативной версии требует macOS.' >&2
    exit 1
fi
sh build.sh
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Info.plist)
architecture=$(uname -m)
mkdir -p dist
stage=$(mktemp -d "${TMPDIR:-/tmp}/GlassTerminalDMG.XXXXXX")
trap 'rm -rf "$stage"' EXIT
trap 'exit 1' HUP INT TERM
ditto 'build/Glass Terminal.app' "$stage/Glass Terminal.app"
ln -s /Applications "$stage/Applications"
hdiutil create -volname 'Glass Terminal Native' -srcfolder "$stage" -ov -format UDZO \
    "dist/Glass-Terminal-Native-${version}-${architecture}.dmg"
productbuild --component 'build/Glass Terminal.app' /Applications \
    "dist/Glass-Terminal-Native-${version}-${architecture}.pkg"
for artifact in dist/*.dmg dist/*.pkg; do shasum -a 256 "$artifact"; done > "dist/SHA256SUMS-native-${architecture}.txt"
printf 'Готово: %s/dist\n' "$PWD"
