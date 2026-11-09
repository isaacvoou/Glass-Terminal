'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.umask(0o022);
const [target, ...extra] = process.argv.slice(2);
if (!['win', 'mac', 'linux'].includes(target) || extra.some(value => !['--x64', '--arm64'].includes(value)) || extra.length > 1)
  throw new Error('Usage: node scripts/dist.cjs win|mac|linux [--x64|--arm64]');
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(path.join(__dirname, 'copy-vendor.cjs'));
run(path.join(__dirname, 'icons.cjs'));
const architecture = extra.length ? extra : target === 'mac' ? [] : ['--x64'];
run(require.resolve('electron-builder/cli.js'), [`--${target}`, ...architecture, '--publish', 'never']);
run(path.join(__dirname, 'checksums.cjs'));
