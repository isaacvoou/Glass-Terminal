'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function find(directory, depth = 0) {
  if (depth > 6) return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.name === 'app.asar' && entry.isFile()) return file;
    if (entry.isDirectory()) { const result = find(file, depth + 1); if (result) return result; }
  }
  return null;
}
const archive = find(path.join(root, 'dist'));
if (!archive) throw new Error('Packaged app.asar not found. Build the installer first.');
const result = spawnSync(require('electron'), [path.join(root, 'tests/electron-smoke.cjs')], {
  stdio: 'inherit', env: { ...process.env, GLASS_TEST_PACKAGE: archive }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
