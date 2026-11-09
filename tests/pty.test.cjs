'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pty = require('node-pty');
const os = require('node:os');
const { shellSpec } = require('../app/policy.cjs');
const windows = process.platform === 'win32';
function run(text, options = {}) {
  return new Promise((resolve, reject) => {
    const spec = shellSpec();
    const processPTY = pty.spawn(spec.file, windows ? ['-NoLogo', '-NoProfile'] : ['-l'], {
      cols: options.cols || 80, rows: options.rows || 24, cwd: os.homedir(), name: 'xterm-256color',
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }, useConpty: windows
    });
    let output = '';
    const timeout = setTimeout(() => { try { processPTY.kill(); } catch {} reject(new Error('PTY timeout: ' + output.slice(-1200))); }, 20000);
    processPTY.onData(data => { output += data; options.onData?.(processPTY, output); });
    processPTY.onExit(event => { clearTimeout(timeout); resolve({ output, ...event }); });
    setTimeout(() => processPTY.write(text), windows ? 1000 : 80);
  });
}
test('native PTY starts a real shell and preserves its exit status', { timeout: 25000 }, async () => {
  const result = await run(windows ? 'Write-Output "GLASS_NATIVE_OK"; exit 7\r' : 'printf "GLASS_NATIVE_OK\\n"; exit 7\r');
  assert.match(result.output, /GLASS_NATIVE_OK/); assert.equal(result.exitCode, 7);
});
test('terminal output keeps Unicode characters', { timeout: 25000 }, async () => {
  const result = await run(windows ? 'Write-Output "Привет café 漢字"; exit\r' : 'printf "Привет café 漢字\\n"; exit\r');
  assert.match(result.output, /Привет café 漢字/);
});
test('PTY window size is visible inside a Unix shell', { skip: windows, timeout: 25000 }, async () => {
  const result = await run('stty size; exit\r', { cols: 119, rows: 42 });
  assert.match(result.output, /42 119/);
});
test('pause/resume keeps a large producer intact', { skip: windows, timeout: 25000 }, async () => {
  let paused = false;
  const result = await run("head -c 1048576 /dev/zero | tr '\\0' Z; printf '\\nEND_OF_STREAM\\n'; exit\r", { onData(processPTY, output) {
    if (!paused && output.includes('ZZZZ')) { paused = true; processPTY.pause(); setTimeout(() => processPTY.resume(), 150); }
  } });
  assert.equal((result.output.match(/Z/g) || []).length >= 1048576, true);
  assert.match(result.output, /END_OF_STREAM/);
});
