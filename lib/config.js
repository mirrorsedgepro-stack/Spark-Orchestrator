// Persistent settings: machines, presets, appearance. Stored in %APPDATA%\Nexus\config.json.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  version: 1,
  appearance: {
    fontSize: 14,
    fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
    lineHeight: 1.15,
    copyOnSelect: false,
    notifyWhenDone: true,
  },
  presets: [
    { id: 'claude', name: 'Claude', color: '#E08A62', cmd: { windows: 'claude', linux: 'claude' } },
    { id: 'gemini', name: 'Gemini', color: '#7BA7FF', cmd: { windows: 'gemini', linux: 'gemini' } },
    { id: 'shell',  name: 'Shell',  color: '#73DACA', cmd: { windows: '', linux: '' } },
    { id: 'gitbash', name: 'Git Bash', color: '#E0AF68', only: 'windows', cmd: { windows: '__gitbash__' } },
  ],
  machines: [
    { id: 'local', name: 'This PC', type: 'local', os: 'windows', color: '#7AA2F7' },
    { id: 'linux', name: 'Linux box', type: 'ssh', os: 'linux', host: '', port: 22, user: '', keyPath: '', color: '#BB9AF7' },
  ],
  knownHosts: {},
};

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = merge(base[k], over[k]);
  return out;
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = merge(DEFAULTS, JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    cache = JSON.parse(JSON.stringify(DEFAULTS));
    save(cache);
  }
  return cache;
}

function save(cfg) {
  cache = cfg;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
  return cfg;
}

module.exports = { load, save, file, DEFAULTS };
