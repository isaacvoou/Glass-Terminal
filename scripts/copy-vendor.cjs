'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'app/vendor');
fs.mkdirSync(destination, { recursive: true });
for (const [name, files] of [
  ['@xterm/xterm', ['lib/xterm.js', 'css/xterm.css']],
  ['@xterm/addon-fit', ['lib/addon-fit.js']],
  ['@xterm/addon-search', ['lib/addon-search.js']]
]) {
  for (const file of [...files, 'LICENSE']) {
    const target = file === 'LICENSE' ? name.split('/').at(-1) + '-LICENSE' : path.basename(file);
    fs.copyFileSync(path.join(root, 'node_modules', name, file), path.join(destination, target));
  }
}
console.log('Local terminal resources prepared.');
