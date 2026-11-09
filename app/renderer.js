'use strict';
(async () => {
  const api = window.glass;
  const config = await api.config();
  const sessions = new Map();
  const tabs = document.getElementById('tabs'), panels = document.getElementById('terminals');
  const searchForm = document.getElementById('search'), query = document.getElementById('query');
  const settingsPanel = document.getElementById('settings');
  let selected = null, preferences = config.settings, toastTimer, saveTimer;
  const current = () => sessions.get(selected);
  document.body.classList.add(config.platform);
  function toast(message) {
    const element = document.getElementById('status');
    element.textContent = message; element.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
  }
  function applySettings(value) {
    preferences = value;
    document.documentElement.style.setProperty('--opacity', value.opacity);
    document.documentElement.style.setProperty('--radius', value.radius + 'px');
    for (const state of sessions.values()) { state.term.options.fontSize = value.fontSize; if (state.id === selected) state.fit.fit(); }
    for (const key of ['opacity', 'radius', 'fontSize']) {
      const valueForControl = key === 'opacity' ? Math.round(value[key] * 100) : value[key];
      document.getElementById(key).value = valueForControl;
      document.getElementById(key + '-value').textContent = valueForControl + (key === 'opacity' ? '%' : '');
    }
    document.getElementById('blur').checked = value.blur;
  }
  function saveSettings(value) {
    applySettings(value); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.settings(value).catch(error => toast(error.message)), 180);
  }
  function focusTerminal() { current()?.term.focus(); }
  function select(id) {
    if (!sessions.has(id)) return;
    const old = current();
    if (old) { old.panel.hidden = true; old.tab.classList.remove('active'); old.titleButton.setAttribute('aria-selected', 'false'); }
    selected = id;
    const state = current();
    state.panel.hidden = false; state.tab.classList.add('active'); state.titleButton.setAttribute('aria-selected', 'true');
    state.fit.fit(); state.term.focus(); state.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.title = state.title + ' — Glass Terminal';
    searchForm.hidden = true;
  }
  function setTitle(state, text) {
    state.title = String(text).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120) || 'Оболочка';
    state.titleButton.textContent = state.title; state.titleButton.title = state.title;
    if (state.id === selected) document.title = state.title + ' — Glass Terminal';
  }
  async function closeTab(id = selected) {
    const state = sessions.get(id); if (!state) return;
    try {
      if (!await api.close(id)) return;
      const ids = [...sessions.keys()], index = ids.indexOf(id);
      sessions.delete(id); state.observer.disconnect(); state.term.dispose(); state.tab.remove(); state.panel.remove();
      if (selected === id) {
        selected = null;
        const remaining = [...sessions.keys()];
        if (remaining.length) select(remaining[Math.min(index, remaining.length - 1)]);
        else await newTab();
      }
    } catch (error) { toast(error.message); }
  }
  async function newTab() {
    const id = crypto.randomUUID();
    const panel = document.createElement('div'); panel.className = 'terminal-panel';
    panels.append(panel);
    const tab = document.createElement('div'); tab.className = 'tab';
    const titleButton = document.createElement('button'); titleButton.className = 'tab-title'; titleButton.setAttribute('role', 'tab');
    const closeButton = document.createElement('button'); closeButton.className = 'tab-close'; closeButton.textContent = '×'; closeButton.setAttribute('aria-label', 'Закрыть вкладку');
    tab.append(titleButton, closeButton); tabs.append(tab);
    const term = new Terminal({ allowTransparency: true, fontSize: preferences.fontSize,
      fontFamily: '"Cascadia Mono", "SFMono-Regular", Menlo, "DejaVu Sans Mono", Consolas, monospace',
      lineHeight: 1.24, cursorBlink: true, cursorStyle: 'bar', scrollback: 10000, macOptionIsMeta: false, screenReaderMode: true,
      theme: { background: '#00000000', foreground: '#edf2ff', cursor: '#b9cdff', selectionBackground: '#9bb9ff55',
        black: '#41475b', red: '#ff8694', green: '#b1dc9b', yellow: '#f5d19a', blue: '#9bbcff', magenta: '#d6b1ff', cyan: '#91dce8', white: '#e4eaff',
        brightBlack: '#79849e', brightRed: '#ffa6ad', brightGreen: '#c8ecae', brightYellow: '#ffe1b1', brightBlue: '#b7cdff', brightMagenta: '#e7ccff', brightCyan: '#b6eff5', brightWhite: '#ffffff' },
      linkHandler: { activate: (event, url) => {
        if (event.isTrusted && (event.metaKey || event.ctrlKey) && /^https?:\/\//i.test(url)) void api.link(url);
      } }
    });
    const fit = new FitAddon.FitAddon(), search = new SearchAddon.SearchAddon();
    term.loadAddon(fit); term.loadAddon(search); term.open(panel);
    const observer = new ResizeObserver(() => { if (selected === id && panel.clientWidth && panel.clientHeight) fit.fit(); });
    const state = { id, panel, tab, titleButton, term, fit, search, observer, title: 'Оболочка', exited: false, creating: true };
    sessions.set(id, state); observer.observe(panel);
    titleButton.addEventListener('click', () => select(id)); closeButton.addEventListener('click', () => closeTab(id));
    term.onData(data => { if (!state.creating && !state.exited) api.input({ id, data }); });
    term.onBinary(data => { if (!state.creating && !state.exited) api.input({ id, data, binary: true }); });
    term.onResize(({ cols, rows }) => { if (!state.creating) api.resize({ id, cols, rows }); });
    term.onTitleChange(title => setTitle(state, title));
    term.parser.registerOscHandler(52, () => true);
    term.attachCustomKeyEventHandler(event => {
      if (config.platform === 'darwin' && event.metaKey) return false;
      return true;
    });
    setTitle(state, 'Оболочка'); select(id);
    try {
      await document.fonts.ready; fit.fit();
      const result = await api.create({ id, cols: term.cols, rows: term.rows });
      state.creating = false; setTitle(state, result.title);
    } catch (error) { state.creating = false; state.exited = true; toast('Не удалось запустить оболочку: ' + error.message); }
    return id;
  }
  api.events(event => {
    if (event.type === 'settings') { applySettings(event.settings); return; }
    if (event.type === 'windowState') { document.body.classList.toggle('expanded', event.fullscreen || event.maximized); return; }
    const state = sessions.get(event.id); if (!state) return;
    if (event.type === 'data') state.term.write(event.data, () => api.ack({ id: state.id, sequence: event.sequence }));
    if (event.type === 'exit') {
      state.exited = true; state.term.options.disableStdin = true;
      setTitle(state, state.title + ' · завершён');
      if (event.id === selected) toast(`Оболочка завершена (${event.exitCode}). Откройте новую вкладку кнопкой +.`);
    }
  });
  async function command(name) {
    const state = current();
    try {
      if (name === 'newTab') { await newTab(); return; }
      if (name === 'closeTab') { await closeTab(); return; }
      if (name === 'settings') { settingsPanel.hidden = !settingsPanel.hidden; return; }
      if (!state) return;
      if (name === 'copy') await api.copy(document.activeElement === query ? query.value.substring(query.selectionStart, query.selectionEnd) : state.term.getSelection());
      if (name === 'paste') {
        const text = await api.clipboard();
        if (document.activeElement === query) { query.setRangeText(text, query.selectionStart, query.selectionEnd, 'end'); query.dispatchEvent(new Event('input')); }
        else state.term.paste(text);
      }
      if (name === 'selectAll') { if (document.activeElement === query) query.select(); else state.term.selectAll(); }
      if (name === 'clear') state.term.clear();
      if (name === 'find') { searchForm.hidden = false; query.focus(); query.select(); }
      if (['larger', 'smaller', 'resetFont'].includes(name)) saveSettings({ ...preferences, fontSize: name === 'resetFont' ? 14 : Math.max(10, Math.min(30, preferences.fontSize + (name === 'larger' ? 1 : -1))) });
    } catch (error) { toast(error.message); }
  }
  api.commands(command);
  function find(previous = false, incremental = false) {
    const state = current(); if (!state) return;
    if (!query.value) { state.search.clearDecorations(); return; }
    const found = previous ? state.search.findPrevious(query.value, { regex: false }) : state.search.findNext(query.value, { regex: false, incremental });
    query.setAttribute('aria-invalid', String(!found));
  }
  searchForm.addEventListener('submit', event => { event.preventDefault(); find(); });
  query.addEventListener('input', () => find(false, true));
  document.getElementById('previous').addEventListener('click', () => find(true));
  const hideSearch = () => { searchForm.hidden = true; current()?.search.clearDecorations(); focusTerminal(); };
  document.getElementById('dismiss-search').addEventListener('click', hideSearch);
  query.addEventListener('keydown', event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); find(true); } });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hideSearch(); settingsPanel.hidden = true; }
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault(); const ids = [...sessions.keys()], index = ids.indexOf(selected);
      if (ids.length) select(ids[(index + (event.shiftKey ? ids.length - 1 : 1)) % ids.length]);
    }
    const modifier = config.platform === 'darwin' ? event.metaKey : event.ctrlKey;
    if (modifier && /^[1-9]$/.test(event.key)) {
      const id = [...sessions.keys()][Number(event.key) - 1]; if (id) { event.preventDefault(); select(id); }
    }
  }, true);
  document.getElementById('new-tab').addEventListener('click', newTab);
  document.getElementById('show-settings').addEventListener('click', () => command('settings'));
  document.getElementById('dismiss-settings').addEventListener('click', () => { settingsPanel.hidden = true; focusTerminal(); });
  document.getElementById('window-close').addEventListener('click', () => api.window('close'));
  document.getElementById('window-minimize').addEventListener('click', () => api.window('minimize'));
  document.getElementById('window-maximize').addEventListener('click', () => api.window(config.platform === 'darwin' ? 'fullscreen' : 'maximize'));
  for (const key of ['opacity', 'radius', 'fontSize']) document.getElementById(key).addEventListener('input', event => saveSettings({ ...preferences, [key]: Number(event.target.value) / (key === 'opacity' ? 100 : 1) }));
  document.getElementById('blur').disabled = !config.blurAvailable;
  document.getElementById('blur-hint').textContent = config.blurAvailable ? 'Размытие выполняет система.' : 'Системное размытие здесь недоступно. Прозрачность зависит от оконного менеджера.';
  document.getElementById('blur').addEventListener('change', event => saveSettings({ ...preferences, blur: event.target.checked }));
  applySettings(preferences);
  // Exposes only UI operations in the sandbox; no Node.js or arbitrary IPC.
  window.GlassUI = Object.freeze({ command, newTab, select,
    snapshot: () => ({ selected, sessions: [...sessions.values()].map(state => ({ id: state.id, title: state.title, creating: state.creating, exited: state.exited })) }),
    text: id => { const term = sessions.get(id)?.term; if (!term) return ''; const lines = []; for (let i = 0; i < term.buffer.active.length; i++) lines.push(term.buffer.active.getLine(i).translateToString(true)); return lines.join('\n'); }
  });
  await newTab();
})().catch(error => { document.getElementById('status').hidden = false; document.getElementById('status').textContent = error.message; });
