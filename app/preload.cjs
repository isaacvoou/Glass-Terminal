'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('glass', Object.freeze({
  config: () => ipcRenderer.invoke('glass:config'),
  create: value => ipcRenderer.invoke('glass:create', value),
  input: value => ipcRenderer.send('glass:input', value),
  resize: value => ipcRenderer.send('glass:resize', value),
  ack: value => ipcRenderer.send('glass:ack', value),
  close: id => ipcRenderer.invoke('glass:close', id),
  settings: value => ipcRenderer.invoke('glass:settings', value),
  copy: text => ipcRenderer.invoke('glass:copy', text),
  clipboard: () => ipcRenderer.invoke('glass:clipboard'),
  link: url => ipcRenderer.invoke('glass:link', url),
  window: command => ipcRenderer.send('glass:window', command),
  events: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('glass:event', listener); return () => ipcRenderer.removeListener('glass:event', listener); },
  commands: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('glass:command', listener); return () => ipcRenderer.removeListener('glass:command', listener); }
}));
