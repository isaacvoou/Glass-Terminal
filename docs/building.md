# Building Glass Terminal

## Requirements

- Node.js 24 for the desktop application.
- Python 3, make, and a C++ compiler on Linux for node-pty.
- Xcode Command Line Tools for the macOS AppKit edition.

Native modules must match the operating system and processor architecture. Windows and macOS use node-pty's platform-specific Node-API binaries; Linux compiles the binding locally.

## Desktop application

```sh
npm ci
npm run prepare:assets
npm start
```

Package an installer on its target operating system:

```sh
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Windows and Linux default to x64. macOS defaults to the host architecture; use `npm run dist:mac -- --arm64` or `npm run dist:mac -- --x64` to select it explicitly. Build output is written to `dist/`.

## Application icon

Use a square PNG of at least 512×512 pixels, preferably 1024×1024, or a square SVG:

```sh
npm run icons -- "/path/to/icon.png"
```

The generator stores the selected source in `assets/icon-source.*` and its selection in `assets/icon-source.json`. It produces:

- `assets/icon.png` for the application window.
- `build-resources/icon.ico` for Windows.
- `build-resources/icon.icns` for macOS.
- `build-resources/icons/` for Linux desktop integration.

The selection persists across subsequent builds. Commit the source image and `assets/icon-source.json` to preserve a custom icon in automated builds. Generated `build-resources/` files do not need to be committed.

To restore the default icon, remove `assets/icon-source.json` and run `npm run icons`. Rebuild the installer to update the application icon.

For the AppKit edition, replace `macos/assets/icon.png` and run `sh macos/scripts/package.sh`. Automated builds copy the shared application icon into the macOS target before packaging it.

## Tests

```sh
npm test
npm run test:pty
npm run test:app
npm run test:packaged
```

The packaged-application test requires a completed installer build. On a Linux CI host without a desktop session, use `xvfb-run -a npm run test:app` and `xvfb-run -a npm run test:packaged`.

## Installer formats

| Target | Formats |
| --- | --- |
| Windows desktop | NSIS `.exe` |
| macOS desktop | `.dmg`, `.zip` |
| Linux desktop | `.deb`, `.AppImage` |
| macOS AppKit | `.dmg`, `.pkg` |

The macOS AppKit commands are:

```sh
sh macos/build.sh
sh macos/scripts/package.sh
```

Its application bundle is written to `macos/build/` and installers to `macos/dist/`. Both macOS editions use ad-hoc signing. Trusted publisher signatures and Apple notarization require the corresponding certificates and credentials.
