'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(require('electron'), ['--test', path.resolve(__dirname, '../tests/pty.test.cjs')], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
