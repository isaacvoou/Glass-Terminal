'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const DEFAULTS = Object.freeze({ opacity: 0.22, radius: 26, fontSize: 14, blur: true });
function normalizedSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const number = (key, fallback, low, high) => Number.isFinite(value[key]) ? Math.max(low, Math.min(high, value[key])) : fallback;
  return { opacity: number('opacity', DEFAULTS.opacity, 0, 1), radius: Math.round(number('radius', DEFAULTS.radius, 8, 40)),
    fontSize: Math.round(number('fontSize', DEFAULTS.fontSize, 10, 30)), blur: typeof value.blur === 'boolean' ? value.blur : DEFAULTS.blur };
}
function validId(id) { return typeof id === 'string' && /^[a-z0-9-]{8,64}$/i.test(id); }
function validSize(cols, rows) { return Number.isInteger(cols) && cols >= 2 && cols <= 2000 && Number.isInteger(rows) && rows >= 1 && rows <= 1000; }
function safeURL(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function shellSpec(platform = process.platform) {
  if (platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    return { file: path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo'] };
  }
  let candidate;
  try { candidate = os.userInfo().shell; } catch { /* use a platform default */ }
  if (!candidate || !path.isAbsolute(candidate) || !fs.existsSync(candidate)) candidate = platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return { file: candidate, args: ['-l'] };
}
module.exports = { DEFAULTS, normalizedSettings, validId, validSize, safeURL, shellSpec };
