#!/bin/sh
set -eu
umask 022
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ "$(uname -s)" != Darwin ]; then
    echo 'Сборка приложения требует macOS 13+ и Apple Command Line Tools.' >&2
    exit 1
fi
if ! xcrun --find clang >/dev/null 2>&1; then
    echo 'Установите инструменты Apple: xcode-select --install' >&2
    exit 1
fi
app='build/Glass Terminal.app'
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
xcrun clang -std=c11 -O2 -Wall -Wextra -Werror -mmacosx-version-min=13.0 \
    -c src/pty.c -o build/pty.o
xcrun clang -fobjc-arc -O2 -Wall -Wextra -Werror -Wno-deprecated-declarations \
    -mmacosx-version-min=13.0 src/main.m build/pty.o \
    -framework Cocoa -framework WebKit -framework QuartzCore \
    -o "$app/Contents/MacOS/GlassTerminal"
cp Info.plist "$app/Contents/Info.plist"
cp -R resources/. "$app/Contents/Resources/"
icon_source="${GLASS_TERMINAL_ICON:-assets/icon.png}"
if [ -f "$icon_source" ]; then
    iconset='build/GlassTerminal.iconset'
    mkdir -p "$iconset"
    for size in 16 32 128 256 512; do
        sips -z "$size" "$size" "$icon_source" --out "$iconset/icon_${size}x${size}.png" >/dev/null
        double_size=$((size * 2))
        sips -z "$double_size" "$double_size" "$icon_source" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
    done
    iconutil -c icns "$iconset" -o "$app/Contents/Resources/icon.icns"
fi
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
printf 'Готово: %s/%s\n' "$PWD" "$app"
