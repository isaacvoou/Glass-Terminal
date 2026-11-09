'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, shell, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const pty = require('node-pty');
const { DEFAULTS, normalizedSettings, validId, validSize, safeURL, shellSpec } = require('./policy.cjs');
const pagePath = path.join(__dirname, 'index.html');
const windows = new Map();
const sessions = new Map();
let settings = DEFAULTS, settingsFile, terminating = false;
const HIGH = 256 * 1024, LOW = 64 * 1024;

function trusted(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !windows.has(event.sender.id)) throw new Error('Unknown terminal window.');
  let filename;
  try { filename = fileURLToPath(event.senderFrame.url); } catch { throw new Error('Invalid terminal document.'); }
  if (path.resolve(filename) !== path.resolve(pagePath)) throw new Error('Invalid terminal document.');
  return windows.get(event.sender.id);
}
function owned(event, id) {
  trusted(event);
  const session = sessions.get(id);
  if (!validId(id) || !session || session.owner !== event.sender.id) throw new Error('Unknown session.');
  return session;
}
function emit(session, type, fields = {}) {
  const window = windows.get(session.owner);
  if (window && !window.isDestroyed()) window.webContents.send('glass:event', { type, id: session.id, ...fields });
}
function destroySession(session) {
  sessions.delete(session.id);
  session.dataSubscription?.dispose(); session.exitSubscription?.dispose();
  if (!session.exited) { try { session.process.kill(); } catch { /* already exited */ } }
}
function ownerSessions(window) { return [...sessions.values()].filter(session => session.owner === window.webContents.id); }
function writeSettings() {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporary = settingsFile + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, settingsFile);
}
function applyMaterial(window) {
  if (process.platform === 'darwin') window.setVibrancy(settings.blur && settings.opacity > 0 ? 'under-window' : null);
  if (process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621)
    window.setBackgroundMaterial(settings.blur && settings.opacity > 0 ? 'acrylic' : 'none');
}
function action(window, name) {
  if (window && !window.isDestroyed()) window.webContents.send('glass:command', name);
}
function focused() { return BrowserWindow.getFocusedWindow() || [...windows.values()][0]; }
function createMenu() {
  const mac = process.platform === 'darwin';
  const accelerator = mac ? 'Cmd' : 'Ctrl+Shift';
  const items = [
    ...(mac ? [{ label: 'Glass Terminal', submenu: [{ role: 'about' }, { label: 'Оформление…', accelerator: 'Cmd+,', click: () => action(focused(), 'settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }] : []),
    { label: 'Файл', submenu: [
      { label: 'Новое окно', accelerator: `${accelerator}+N`, click: () => createWindow() },
      { label: 'Новая вкладка', accelerator: `${accelerator}+T`, click: () => action(focused(), 'newTab') },
      { label: 'Закрыть вкладку', accelerator: `${accelerator}+W`, click: () => action(focused(), 'closeTab') },
      ...(!mac ? [{ role: 'quit' }] : [])
    ] },
    { label: 'Правка', submenu: [
      ...[['Копировать', 'C', 'copy'], ['Вставить', 'V', 'paste'], ['Выделить всё', 'A', 'selectAll'], ['Найти…', 'F', 'find'], ['Очистить вывод', 'K', 'clear']].map(([label, key, command]) =>
        ({ label, accelerator: `${accelerator}+${key}`, click: () => action(focused(), command) }))
    ] },
    { label: 'Вид', submenu: [
      { label: 'Оформление…', click: () => action(focused(), 'settings') },
      { label: 'Увеличить шрифт', accelerator: 'CommandOrControl+=', click: () => action(focused(), 'larger') },
      { label: 'Уменьшить шрифт', accelerator: 'CommandOrControl+-', click: () => action(focused(), 'smaller') },
      { label: 'Обычный размер', accelerator: 'CommandOrControl+0', click: () => action(focused(), 'resetFont') },
      { role: 'togglefullscreen' }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
}
function createWindow(options = {}) {
  const image = nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png'));
  const window = new BrowserWindow({ width: 1040, height: 690, minWidth: 560, minHeight: 340,
    title: 'Glass Terminal', frame: false, transparent: true, backgroundColor: '#00000000',
    roundedCorners: true, hasShadow: true, resizable: true, show: false, autoHideMenuBar: true,
    icon: image, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false }
  });
  windows.set(window.webContents.id, window);
  if (process.platform !== 'darwin') window.setMenuBarVisibility(false);
  applyMaterial(window);
  const windowState = () => window.webContents.send('glass:event', { type: 'windowState', fullscreen: window.isFullScreen(), maximized: window.isMaximized() });
  for (const type of ['enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize']) window.on(type, windowState);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    try { if (path.resolve(fileURLToPath(url)) !== path.resolve(pagePath)) event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on('render-process-gone', () => { for (const session of ownerSessions(window)) destroySession(session); });
  window.on('close', event => {
    const active = ownerSessions(window).filter(session => !session.exited);
    if (!terminating && active.length) {
      const answer = dialog.showMessageBoxSync(window, { type: 'question', title: 'Glass Terminal',
        message: 'Закрыть окно?', detail: `Будут завершены сеансы оболочки: ${active.length}.`,
        buttons: ['Отмена', 'Закрыть'], defaultId: 0, cancelId: 0 });
      if (answer === 0) { event.preventDefault(); return; }
    }
    for (const session of ownerSessions(window)) destroySession(session);
  });
  const owner = window.webContents.id;
  window.on('closed', () => windows.delete(owner));
  window.once('ready-to-show', () => { if (options.show !== false) window.show(); });
  window.loadFile(pagePath);
  return window;
}
function registerIPC() {
  ipcMain.handle('glass:config', event => {
    trusted(event);
    return { platform: process.platform, settings, blurAvailable: process.platform === 'darwin' ||
      (process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621) };
  });
  ipcMain.handle('glass:create', (event, { id, cols, rows } = {}) => {
    trusted(event);
    if (!validId(id) || sessions.has(id) || !validSize(cols, rows)) throw new Error('Invalid session parameters.');
    if ([...sessions.values()].filter(value => value.owner === event.sender.id).length >= 32) throw new Error('Можно открыть до 32 вкладок в окне.');
    const spec = shellSpec();
    const environment = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'GlassTerminal', TERM_PROGRAM_VERSION: app.getVersion() };
    delete environment.ELECTRON_RUN_AS_NODE;
    const processPTY = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env: environment,
      useConpty: process.platform === 'win32', handleFlowControl: false });
    const session = { id, owner: event.sender.id, process: processPTY, exited: false, unacked: new Map(), bytes: 0, sequence: 0, paused: false };
    sessions.set(id, session);
    session.dataSubscription = processPTY.onData(data => {
      const sequence = ++session.sequence, bytes = Buffer.byteLength(data);
      session.unacked.set(sequence, bytes); session.bytes += bytes;
      if (session.bytes >= HIGH && !session.paused) { session.paused = true; processPTY.pause(); }
      emit(session, 'data', { sequence, data });
    });
    session.exitSubscription = processPTY.onExit(({ exitCode, signal }) => { session.exited = true; emit(session, 'exit', { exitCode, signal }); });
    return { id, title: path.basename(spec.file), pid: processPTY.pid };
  });
  ipcMain.on('glass:input', (event, { id, data, binary = false } = {}) => {
    try {
      const session = owned(event, id);
      if (typeof data !== 'string' || Buffer.byteLength(data) > 1024 * 1024 || session.exited) return;
      session.process.write(binary && process.platform !== 'win32' ? Buffer.from(data, 'latin1') : data);
    } catch (error) { console.warn(error.message); }
  });
  ipcMain.on('glass:resize', (event, { id, cols, rows } = {}) => {
    try { const session = owned(event, id); if (validSize(cols, rows) && !session.exited) session.process.resize(cols, rows); }
    catch (error) { console.warn(error.message); }
  });
  ipcMain.on('glass:ack', (event, { id, sequence } = {}) => {
    try {
      const session = owned(event, id), bytes = session.unacked.get(sequence);
      if (bytes === undefined) return;
      session.unacked.delete(sequence); session.bytes -= bytes;
      if (session.paused && session.bytes <= LOW && !session.exited) { session.paused = false; session.process.resume(); }
    } catch (error) { console.warn(error.message); }
  });
  ipcMain.handle('glass:close', async (event, id) => {
    const session = owned(event, id);
    if (!session.exited) {
      const result = await dialog.showMessageBox(trusted(event), { type: 'question', message: 'Закрыть вкладку?',
        detail: 'Сеанс оболочки будет завершён.', buttons: ['Отмена', 'Закрыть'], defaultId: 0, cancelId: 0 });
      if (result.response === 0) return false;
    }
    destroySession(session); return true;
  });
  ipcMain.handle('glass:settings', (event, value) => {
    trusted(event); settings = normalizedSettings(value); writeSettings();
    for (const window of windows.values()) { applyMaterial(window); window.webContents.send('glass:event', { type: 'settings', settings }); }
    return settings;
  });
  ipcMain.handle('glass:copy', (event, text) => {
    trusted(event); if (typeof text === 'string' && Buffer.byteLength(text) <= 4 * 1024 * 1024) clipboard.writeText(text);
  });
  ipcMain.handle('glass:clipboard', event => { trusted(event); const text = clipboard.readText(); return Buffer.byteLength(text) <= 1024 * 1024 ? text : ''; });
  ipcMain.handle('glass:link', (event, value) => { trusted(event); const url = safeURL(value); if (url) return shell.openExternal(url); });
  ipcMain.on('glass:window', (event, command) => {
    try {
      const window = trusted(event);
      if (command === 'minimize') window.minimize();
      else if (command === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); }
      else if (command === 'fullscreen') window.setFullScreen(!window.isFullScreen());
      else if (command === 'close') window.close();
      else if (command === 'new') createWindow();
    } catch (error) { console.warn(error.message); }
  });
}
async function start(options = {}) {
  if (process.platform === 'win32') app.setAppUserModelId('dev.glassterminal.desktop');
  await app.whenReady();
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { settings = normalizedSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch { settings = { ...DEFAULTS }; }
  registerIPC(); createMenu();
  const window = createWindow(options);
  app.on('activate', () => { if (!windows.size) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (terminating) return;
    const active = [...sessions.values()].filter(session => !session.exited);
    if (active.length && windows.size) {
      const answer = dialog.showMessageBoxSync(focused(), { type: 'question', message: 'Завершить Glass Terminal?',
        detail: `Будут завершены сеансы оболочки: ${active.length}.`, buttons: ['Отмена', 'Завершить'], defaultId: 0, cancelId: 0 });
      if (answer === 0) { event.preventDefault(); return; }
    }
    terminating = true;
    for (const session of sessions.values()) destroySession(session);
  });
  return window;
}
function shutdownForTest() { terminating = true; for (const session of [...sessions.values()]) destroySession(session); }
module.exports = { start, shutdownForTest, sessions };
if (require.main === module) start().catch(error => { console.error(error); app.exit(1); });
