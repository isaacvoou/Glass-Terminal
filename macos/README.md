# Glass Terminal for macOS

The AppKit edition of Glass Terminal is a macOS terminal emulator with a transparent background, smooth rounded corners, configurable blur, and independent shell sessions.

## Download

Requires macOS 13 or later.

| Processor | Installer | Disk image |
| --- | --- | --- |
| Apple Silicon | [Download .pkg](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-Native-0.1.1-arm64.pkg) | [Download .dmg](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-Native-0.1.1-arm64.dmg) |
| Intel | [Download .pkg](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-Native-0.1.1-x86_64.pkg) | [Download .dmg](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-Native-0.1.1-x86_64.dmg) |

The `.pkg` installer places the application in `/Applications`. The `.dmg` supports manual installation by dragging the application into Applications. The application uses an ad-hoc signature and is not notarized by Apple.

## Features

- Background opacity from 0% to 100%, with fully opaque text.
- Continuous rounded corners with an adjustable radius of 8–40 points.
- Optional background blur, a subtle border, and a window shadow.
- Multiple windows and independently running terminal tabs.
- The account's login shell, its standard configuration, and shell history.
- Unicode, ANSI colors, alternate-screen applications, mouse input, and bracketed paste.
- A 10,000-line scrollback buffer, search, selection, and clipboard integration.
- File drag-and-drop with shell-escaped paths.
- PTY resizing and Ctrl+C delivery to the foreground program.

Each tab starts in the home directory. Appearance preferences are saved automatically. The corner radius becomes zero in full-screen mode and returns to the selected value afterward.

## Appearance and shortcuts

Open the appearance panel with **Cmd+,** or the settings button in the title bar. Zero background opacity also disables blur. The text remains opaque at every background setting.

| Action | Shortcut |
| --- | --- |
| New window / tab | Cmd+N / Cmd+T |
| Close tab | Cmd+W |
| Copy / paste / select all | Cmd+C / Cmd+V / Cmd+A |
| Find | Cmd+F |
| Next / previous search match | Enter / Shift+Enter |
| Close search | Escape |
| Clear scrollback | Cmd+K |
| Increase / decrease / reset font size | Cmd+= / Cmd+- / Cmd+0 |
| Full screen | Ctrl+Cmd+F |
| Interrupt a program | Ctrl+C |

## Build from source

Install Xcode Command Line Tools, then run these commands from the repository root:

```sh
sh macos/build.sh
open "macos/build/Glass Terminal.app"
```

Create the disk image and installer with:

```sh
sh macos/scripts/package.sh
```

Build output is written to `macos/build/`; installers are written to `macos/dist/`. This edition uses system frameworks and includes its terminal-engine resources, so Node.js is not required for these commands.

To customize the icon, replace `macos/assets/icon.png` with a square 1024×1024 PNG and rebuild. See the [shared icon guide](../docs/building.md#application-icon) for icon generation across platforms.

## Compatibility

Terminal emulation is provided by xterm.js inside WebKit. Background transparency also uses the WebKit `drawsBackground` compatibility setting, which is not a public WebKit API and may change between macOS versions. System blur strength is controlled by macOS.

Closing a session hangs up its PTY and associated process groups. Detached Unix processes may continue running. Session restoration, split panes, Terminal.app profile import, and an AppleScript dictionary are not available.

See the [testing guide](docs/testing.md) for runtime checks and the [license](LICENSE) for distribution terms.
