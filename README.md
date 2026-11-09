# Glass Terminal

A transparent terminal emulator for Windows, macOS, and Linux. Glass Terminal combines rounded windows, customizable backgrounds, tabs, and search with a real system shell.

**[Download Glass Terminal](https://github.com/isaacvoou/Glass-Terminal/releases/latest)**

## Features

- Adjustable background opacity, rounded corners, and font size.
- System background blur on macOS and supported Windows 11 versions.
- Multiple windows and independent terminal tabs.
- Search, text selection, clipboard support, and bracketed paste.
- Unicode, ANSI colors, alternate-screen applications, and a 10,000-line scrollback buffer.
- Native pseudoterminal sessions with terminal resizing and Ctrl+C support.
- Saved appearance preferences and custom application icons.

On Windows, the desktop application opens Windows PowerShell. On macOS and Linux, it opens the account's login shell. New tabs start in the home directory.

## Download and install

| Platform | Requirements | Direct download |
| --- | --- | --- |
| Windows | Windows 10 22H2 or Windows 11, x64 | [Windows installer (.exe)](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-0.2.0-win-x64.exe) |
| macOS — Apple Silicon | macOS 13 or later | [Apple Silicon disk image (.dmg)](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-0.2.0-mac-arm64.dmg) |
| macOS — Intel | macOS 13 or later | [Intel disk image (.dmg)](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-0.2.0-mac-x64.dmg) |
| Linux — Debian/Ubuntu | Ubuntu 22.04+ or a compatible x64 distribution | [Debian package (.deb)](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-0.2.0-linux-amd64.deb) |
| Linux — AppImage | Compatible x64 Linux with glibc and FUSE support | [AppImage](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/Glass-Terminal-0.2.0-linux-x86_64.AppImage) |

Additional archives, the AppKit edition for macOS, and [SHA-256 checksums](https://github.com/isaacvoou/Glass-Terminal/releases/download/v0.2.0/SHA256SUMS.txt) are available on the [release page](https://github.com/isaacvoou/Glass-Terminal/releases/tag/v0.2.0).

- **Windows:** run the installer and choose the installation folder. Installation is per user.
- **macOS:** open the disk image and drag Glass Terminal into Applications. Choose Apple Silicon or Intel to match the Mac's processor.
- **Debian/Ubuntu:** open the `.deb` package in the system installer, or run `sudo apt install ./Glass-Terminal-0.2.0-linux-amd64.deb`.
- **AppImage:** allow the downloaded file to run as a program, then open it.

Node.js and a compiler are not required to use the installed application. The installers do not carry a trusted publisher certificate, and the macOS applications are not notarized by Apple; operating-system security prompts may appear.

## Appearance

Open the appearance panel using the button on the right side of the title bar. Adjust background opacity, corner radius, and font size, and enable system blur where supported. At zero background opacity, blur is disabled and the text remains fully opaque.

Transparency and blur depend on the operating system, graphics drivers, compositor, and accessibility settings. Windows 10 and Linux do not provide the same system-blur effect as macOS and supported Windows 11 versions.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| New tab | Cmd+T | Ctrl+Shift+T |
| New window | Cmd+N | Ctrl+Shift+N |
| Close tab | Cmd+W | Ctrl+Shift+W |
| Copy / paste | Cmd+C / Cmd+V | Ctrl+Shift+C / Ctrl+Shift+V |
| Find | Cmd+F | Ctrl+Shift+F |
| Select tab 1–9 | Cmd+1…9 | Ctrl+1…9 |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Increase / decrease font size | Cmd+= / Cmd+- | Ctrl+= / Ctrl+- |
| Reset font size | Cmd+0 | Ctrl+0 |
| Interrupt the running program | Ctrl+C | Ctrl+C |

## macOS AppKit edition

The [AppKit edition](macos/README.md) provides a native macOS window, a C pseudoterminal backend, and file drag-and-drop. It is available as `.dmg` and `.pkg` installers for both Apple Silicon and Intel Macs.

## Custom icons and source builds

Use a square 1024×1024 PNG or an SVG as the application icon. See the [build and icon guide](docs/building.md) for icon generation, local builds, and installer packaging.

Glass Terminal uses [xterm.js](https://xtermjs.org/) for terminal emulation. Session restoration and split panes are not available. Terminal-sequence compatibility follows the capabilities of the terminal engine.

## License

[MIT](LICENSE). Third-party components retain their respective license notices.
