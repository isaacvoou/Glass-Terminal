'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-terminal-test-'));
app.setPath('userData', directory);
app.commandLine.appendSwitch('disable-gpu');
const { start, shutdownForTest, sessions } = require(process.env.GLASS_TEST_PACKAGE ?
  path.join(path.resolve(process.env.GLASS_TEST_PACKAGE), 'app/main.cjs') : '../app/main.cjs');
let timeout;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(window, expression, milliseconds = 20000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await pause(60);
  }
  throw new Error('UI timeout: ' + expression);
}
(async () => {
  timeout = setTimeout(() => { console.error('Application test timed out.'); shutdownForTest(); app.exit(1); }, 60000);
  const window = await start({ show: false });
  const errors = [];
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  await until(window, '!!window.GlassUI && GlassUI.snapshot().sessions.length === 1 && !GlassUI.snapshot().sessions[0].creating');
  const first = await window.webContents.executeJavaScript('GlassUI.snapshot().selected');
  sessions.get(first).process.write(process.platform === 'win32' ? 'Write-Output ("GLASS_" + "E2E_OK")\r' : 'printf "GLASS_%s\\n" "E2E_OK"\r');
  await until(window, `GlassUI.text(${JSON.stringify(first)}).includes('GLASS_E2E_OK')`);
  await window.webContents.executeJavaScript('GlassUI.newTab()');
  await until(window, 'GlassUI.snapshot().sessions.length === 2 && GlassUI.snapshot().sessions.every(session => !session.creating)');
  assert.equal((await window.webContents.executeJavaScript('GlassUI.snapshot().sessions.length')), 2);
  await window.webContents.executeJavaScript(`GlassUI.select(${JSON.stringify(first)}); GlassUI.command('find')`);
  assert.equal(await window.webContents.executeJavaScript('document.getElementById("search").hidden'), false);
  await window.webContents.executeJavaScript('GlassUI.command("settings")');
  assert.equal(await window.webContents.executeJavaScript('document.getElementById("settings").hidden'), false);
  await window.webContents.executeJavaScript('GlassUI.command("larger")');
  await pause(400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8')).fontSize, 15);
  const capture = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(capture, { recursive: true });
  fs.writeFileSync(path.join(capture, 'application.png'), (await window.webContents.capturePage()).toPNG());
  assert.equal(errors.filter(message => !message.includes('Content Security Policy')).length, 0, errors.join('\n'));
  // Let the shells exit before closing Electron so Windows can release its PTY handles.
  const active = [...sessions.values()].filter(session => !session.exited);
  for (const session of active) session.process.write('exit\r');
  const deadline = Date.now() + 15000;
  while (active.some(session => !session.exited) && Date.now() < deadline) await pause(60);
  assert.ok(active.every(session => session.exited), 'All test shells must exit before application shutdown.');
  console.log('Application test passed: native PTY, xterm, tabs, search, settings and shell exit.');
  clearTimeout(timeout); shutdownForTest(); window.destroy(); app.exit(0);
})().catch(error => { console.error(error); clearTimeout(timeout); shutdownForTest(); app.exit(1); });
