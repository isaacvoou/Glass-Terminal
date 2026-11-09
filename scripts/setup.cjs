'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function run(file, args, cwd = root) {
  const result = spawnSync(file, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Setup failed: ${path.basename(file)} (exit ${result.status}).`);
}
// node-pty 1.1 uses Node-API: its native binary is ABI-stable between Node and
// Electron. Build it for this OS/architecture, then test it in Electron too.
// No cross-OS binaries are reused, and no V8 ABI-specific module is skipped.
try {
  let nativeReady = false;
  try { require('node-pty'); nativeReady = true; } catch { /* Linux needs compilation */ }
  if (!nativeReady) {
    const directory = path.join(root, 'node_modules/node-pty');
    const prebuild = spawnSync(process.execPath, [path.join(directory, 'scripts/prebuild.js')], { cwd: directory, stdio: 'inherit' });
    if (prebuild.status !== 0) run(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild',
      '--devdir=' + path.join(root, '.cache/node-gyp'), '--jobs=2'], directory);
    run(process.execPath, [path.join(directory, 'scripts/post-install.js')], directory);
    require('node-pty');
  }
  const electronRoot = path.dirname(require.resolve('electron/package.json'));
  if (!fs.existsSync(path.join(electronRoot, 'path.txt')))
    run(process.execPath, [path.join(electronRoot, 'install.js')]);
  console.log('Native PTY and Electron are ready.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
