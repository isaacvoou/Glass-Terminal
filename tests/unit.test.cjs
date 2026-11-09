'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { generate } = require('../scripts/icons.cjs');
const { normalizedSettings, DEFAULTS, validId, validSize, safeURL, shellSpec } = require('../app/policy.cjs');
test('settings clamp invalid values and reject nonnumeric types', () => {
  assert.deepEqual(normalizedSettings(null), DEFAULTS);
  assert.deepEqual(normalizedSettings({ opacity: -2, radius: 999, fontSize: '40', blur: false }), { opacity: 0, radius: 40, fontSize: 14, blur: false });
  assert.equal(normalizedSettings({ opacity: NaN }).opacity, DEFAULTS.opacity);
});
test('session ids and terminal dimensions are bounded', () => {
  assert.equal(validId('a09d91d8-5cf0-4bfd-8138-dfb3a11f179b'), true);
  for (const id of ['', '../file', null, 5, 'a'.repeat(65)]) assert.equal(validId(id), false);
  assert.equal(validSize(80, 24), true);
  for (const [cols, rows] of [[0, 24], [80, -1], [2001, 24], [80, 1.5], ['80', 24]]) assert.equal(validSize(cols, rows), false);
});
test('terminal links cannot launch local programs or scripts', () => {
  assert.equal(safeURL('https://example.com/test'), 'https://example.com/test');
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'powershell:run', 'data:text/html,x', {}, 'x'.repeat(9000)]) assert.equal(safeURL(value), null);
});
test('Windows uses the installed system PowerShell without profile bypass', () => {
  const spec = shellSpec('win32');
  assert.match(spec.file, /WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  assert.deepEqual(spec.args, ['-NoLogo']);
});
test('Darwin PTY spawn helper is executable', { skip: process.platform !== 'darwin' }, () => {
  const base = path.dirname(require.resolve('node-pty/package.json'));
  const candidates = ['build/Release/spawn-helper', 'build/Debug/spawn-helper', `prebuilds/darwin-${process.arch}/spawn-helper`];
  const helper = candidates.map(file => path.join(base, file)).find(file => fs.existsSync(file));
  assert.ok(helper, 'node-pty spawn-helper is missing');
  assert.notEqual(fs.statSync(helper).mode & 0o111, 0, 'node-pty spawn-helper must have execution permission');
});
test('icon files contain valid ICO and ICNS records', () => {
  const folder = path.resolve(__dirname, '../build-resources');
  const ico = fs.readFileSync(path.join(folder, 'icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4); assert.ok(count >= 6);
  for (let i = 0; i < count; i++) {
    const entry = 6 + 16 * i, size = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + size <= ico.length);
    assert.equal(ico.subarray(offset + 1, offset + 4).toString(), 'PNG');
  }
  const icns = fs.readFileSync(path.join(folder, 'icon.icns'));
  assert.equal(icns.toString('ascii', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  let cursor = 8, records = 0;
  while (cursor < icns.length) { const size = icns.readUInt32BE(cursor + 4); assert.ok(size > 8); cursor += size; records++; }
  assert.equal(cursor, icns.length); assert.equal(records, 7);
});
test('custom icon survives the next regular build', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-icon-test-'));
  try {
    const source = path.join(directory, 'custom.svg');
    fs.writeFileSync(source, '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#34a8bc"/></svg>');
    await generate(source, directory);
    const first = fs.readFileSync(path.join(directory, 'assets/icon.png'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'assets/icon-source.json'))).file, 'icon-source.svg');
    await generate(undefined, directory);
    assert.deepEqual(fs.readFileSync(path.join(directory, 'assets/icon.png')), first);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
