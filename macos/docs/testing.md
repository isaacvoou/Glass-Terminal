# Testing the macOS application

## PTY integration

Run from the `macos/` directory:

```sh
python3 tests/test_pty.py
```

The integration suite uses real pseudoterminals to check shell startup, terminal dimensions, environment variables, working directories, exit status, Unicode, binary input, large-output backpressure, Ctrl+C, and child-process cleanup.

## Terminal interface

The browser suite requires Python 3, Playwright, and an installed Chromium browser:

```sh
python3 tests/test_frontend.py
```

It covers Unicode split across packets, ANSI colors, alternate-screen restoration, bracketed paste, search, clipboard selection, font resizing, and OSC 52 handling. The HTTP server used by these tests is limited to loopback and is not part of the application.

## Build and window checks

On a Mac with Xcode Command Line Tools, run `sh build.sh` and open `build/Glass Terminal.app`. Verify:

1. The login shell accepts keyboard input and displays Unicode text correctly.
2. The background is transparent at zero opacity, blur follows the selected setting, and text remains opaque.
3. Rounded corners, window resizing, dragging, minimizing, and full-screen mode behave correctly.
4. Tabs run independently, and menu commands act on the selected tab.
5. `stty size` reflects window changes; Ctrl+C interrupts `sleep 30` and returns to the shell.
6. Installed applications such as vim, less, top, ssh, and tmux update and restore the screen correctly.
7. Appearance settings survive an application restart.
8. Dragged paths containing spaces or apostrophes are escaped for the shell and are not executed automatically.

Check the WebKit transparency behavior after macOS updates. Browser tests do not validate native AppKit window composition or GPU behavior.
