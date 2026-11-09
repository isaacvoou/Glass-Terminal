'use strict';
(() => {
  const host = document.getElementById('terminal');
  const searchForm = document.getElementById('search');
  const query = document.getElementById('query');
  const encoder = new TextEncoder();
  const send = (type, extra = {}) => {
    const bridge = window.webkit?.messageHandlers?.terminal;
    if (bridge) bridge.postMessage({ type, ...extra });
  };
  const toBase64 = bytes => {
    let text = '';
    for (let at = 0; at < bytes.length; at += 8192)
      text += String.fromCharCode(...bytes.subarray(at, at + 8192));
    return btoa(text);
  };
  const term = new Terminal({
    allowTransparency: true,
    allowProposedApi: false,
    fontFamily: '"SFMono-Regular", Menlo, Monaco, monospace',
    fontSize: 14,
    lineHeight: 1.24,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    macOptionIsMeta: false,
    screenReaderMode: true,
    theme: {
      background: '#00000000', foreground: '#edf2ff', cursor: '#b9cdff',
      selectionBackground: '#9bb9ff55', selectionInactiveBackground: '#9bb9ff33',
      black: '#41475b', red: '#ff8694', green: '#b1dc9b', yellow: '#f5d19a',
      blue: '#9bbcff', magenta: '#d6b1ff', cyan: '#91dce8', white: '#e4eaff',
      brightBlack: '#79849e', brightRed: '#ffa6ad', brightGreen: '#c8ecae',
      brightYellow: '#ffe1b1', brightBlue: '#b7cdff', brightMagenta: '#e7ccff',
      brightCyan: '#b6eff5', brightWhite: '#ffffff'
    },
    linkHandler: {
      activate: (event, url) => {
        if (event.isTrusted && event.metaKey && /^https?:\/\//i.test(url))
          send('openLink', { url });
      }
    }
  });
  const fit = new FitAddon.FitAddon();
  const search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.open(host);
  // OSC 52 must not change the macOS clipboard on behalf of terminal output.
  term.parser.registerOscHandler(52, () => true);
  term.onData(data => send('input', { data: toBase64(encoder.encode(data)) }));
  term.onBinary(data => send('input', {
    data: toBase64(Uint8Array.from(data, ch => ch.charCodeAt(0) & 255))
  }));
  term.onResize(({ cols, rows }) => send('resize', { cols, rows }));
  term.onTitleChange(title => send('title', { title: title.slice(0, 120) }));
  term.onBell(() => send('bell'));
  // AppKit owns Command shortcuts; Ctrl+C remains a byte sent to the PTY.
  term.attachCustomKeyEventHandler(event => !event.metaKey);
  let resizeFrame;
  const refit = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    });
  };
  new ResizeObserver(refit).observe(host);
  let toastTimer;
  function toast(text) {
    const status = document.getElementById('status');
    status.textContent = text;
    status.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { status.hidden = true; }, 3500);
  }
  const find = (previous, incremental = false) => {
    if (!query.value) { search.clearDecorations(); return; }
    const options = { caseSensitive: false, regex: false, incremental };
    const found = previous ? search.findPrevious(query.value, options) : search.findNext(query.value, options);
    query.setAttribute('aria-invalid', String(!found));
  };
  searchForm.addEventListener('submit', event => { event.preventDefault(); find(false); });
  query.addEventListener('input', () => find(false, true));
  document.getElementById('previous').addEventListener('click', () => find(true));
  function closeSearch() {
    searchForm.hidden = true; search.clearDecorations(); term.focus();
  }
  document.getElementById('dismiss').addEventListener('click', closeSearch);
  query.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); find(true); }
  });
  window.Glass = Object.freeze({
    write(base64) {
      const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
      term.write(bytes, () => send('ack'));
    },
    paste(text) {
      if (document.activeElement === query) {
        query.setRangeText(text, query.selectionStart, query.selectionEnd, 'end');
        query.dispatchEvent(new Event('input'));
      } else term.paste(text);
    },
    copy: () => send('copy', { text: document.activeElement === query ?
      query.value.substring(query.selectionStart, query.selectionEnd) : term.getSelection() }),
    selectAll: () => document.activeElement === query ? query.select() : term.selectAll(),
    clear: () => term.clear(),
    find() { searchForm.hidden = false; query.focus(); query.select(); },
    focus() { refit(); term.focus(); },
    configure(fontSize) { term.options.fontSize = Math.max(10, Math.min(30, fontSize)); refit(); },
    toast,
    exited(status) {
      term.options.disableStdin = true;
      toast(`Оболочка завершена (${status}). Новая вкладка: ⌘T`);
    }
  });
  document.fonts.ready.then(() => {
    fit.fit(); term.focus(); send('ready', { cols: term.cols, rows: term.rows });
  });
})();
