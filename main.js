const { app, BrowserWindow, ipcMain, clipboard, shell, Notification, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { StringDecoder } = require('string_decoder');
const config = require('./lib/config');
const local = require('./lib/local');
const { Machine } = require('./lib/remote');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.nexus.terminal');

let win = null;
const sessions = new Map(); // id -> { write, resize, close, kill, machineId, tmuxName }
const machines = new Map(); // id -> Machine
let nextId = 1;

function send(ch, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
}

// ---- output batching: coalesce chunks per session into ~4ms frames ----
const pending = new Map();
let flushTimer = null;
function emitData(id, data) {
  if (!data) return;
  pending.set(id, (pending.get(id) || '') + data);
  if (!flushTimer) flushTimer = setTimeout(flush, 4);
}
function flush() {
  flushTimer = null;
  for (const [id, d] of pending) send('session:data', id, d);
  pending.clear();
}

// ---- machines ----
function machineCfg(id) {
  return config.load().machines.find((m) => m.id === id);
}
function getMachine(id) {
  if (!machines.has(id)) {
    const m = new Machine(id, {
      get: () => machineCfg(id),
      known: (k) => config.load().knownHosts[k],
      remember: (k, fp) => { const c = config.load(); c.knownHosts[k] = fp; config.save(c); },
    });
    m.on('status', (status, error) => send('machine:status', id, status, error));
    machines.set(id, m);
  }
  return machines.get(id);
}

// ---- window ----
function createWindow() {
  const cfg = config.load();
  const b = cfg.window || {};
  win = new BrowserWindow({
    width: b.width || 1480,
    height: b.height || 920,
    x: b.x,
    y: b.y,
    minWidth: 860,
    minHeight: 520,
    backgroundColor: '#090c13',
    title: 'Nexus',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#090c13', symbolColor: '#8b93a8', height: 42 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', () => {
    const c = config.load();
    c.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    config.save(c);
  });
  win.on('focus', () => send('app:focus', true));
  win.on('blur', () => send('app:focus', false));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => {
  for (const s of sessions.values()) { try { s.close(); } catch {} }
  for (const m of machines.values()) m.disconnect();
  app.quit();
});

// ---- IPC: config / app ----
ipcMain.handle('config:get', () => config.load());
// A fresh renderer (first load or reload) owns no sessions: drop any left over. Remote tmux sessions survive.
ipcMain.on('app:hello', () => {
  for (const s of sessions.values()) { try { s.close(); } catch {} }
  sessions.clear();
});
ipcMain.handle('config:save', (_e, cfg) => {
  const prev = config.load();
  config.save({ ...cfg, knownHosts: prev.knownHosts, window: prev.window });
  // Drop connections whose address changed so the next use reconnects with new settings.
  for (const [id, m] of machines) {
    const a = prev.machines.find((x) => x.id === id), b = cfg.machines.find((x) => x.id === id);
    if (!b || !a || a.host !== b.host || a.user !== b.user || String(a.port) !== String(b.port) || a.keyPath !== b.keyPath) {
      m.disconnect();
      machines.delete(id);
      send('machine:status', id, 'offline', null);
    }
  }
  return config.load();
});
ipcMain.handle('app:open-config', () => shell.openPath(config.file()));
ipcMain.on('app:devtools', () => win && win.webContents.toggleDevTools());
ipcMain.on('app:reload', () => win && win.webContents.reloadIgnoringCache());
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
ipcMain.on('app:notify', (_e, { title, body, sessionId }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') });
  n.on('click', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    send('notify:click', sessionId);
  });
  n.show();
});
ipcMain.on('app:flash', () => { if (win && !win.isFocused()) win.flashFrame(true); });

// ---- IPC: machines ----
ipcMain.handle('local:probe', () => local.probe());
ipcMain.handle('machine:connect', async (_e, id) => {
  try { await getMachine(id).connect(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('machine:disconnect', (_e, id) => { getMachine(id).disconnect(); return true; });
ipcMain.handle('machine:probe', async (_e, id) => {
  try { return { ok: true, ...(await getMachine(id).probe()) }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('machine:kill-tmux', async (_e, id, name) => { await getMachine(id).killTmux(name); return true; });
ipcMain.handle('machine:upload-bootstrap', async (_e, id) => {
  const content = fs.readFileSync(path.join(__dirname, 'scripts', 'linux-bootstrap.sh'), 'utf8').replace(/\r\n/g, '\n');
  try { await getMachine(id).upload('~/.nexus/bootstrap.sh', content); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
});

// ---- IPC: sessions ----
ipcMain.handle('session:create', async (_e, spec) => {
  const cfg = config.load();
  const m = cfg.machines.find((x) => x.id === spec.machineId);
  if (!m) return { ok: false, error: 'Unknown machine' };
  const preset = cfg.presets.find((p) => p.id === spec.presetId) || { id: 'shell', cmd: {} };
  const cmd = spec.cmd != null ? spec.cmd : ((preset.cmd || {})[m.os] || '');
  const cols = Math.max(20, spec.cols || 120), rows = Math.max(5, spec.rows || 30);
  const id = `s${nextId++}`;

  try {
    if (m.type === 'local') {
      let script = null;
      if (spec.script === 'setup-ssh-key') {
        const target = machineCfg(spec.scriptMachine);
        script = {
          file: path.join(__dirname, 'scripts', 'setup-ssh-key.ps1'),
          args: ['-HostName', target.host, '-User', target.user || '', '-Port', String(target.port || 22)],
        };
      }
      const p = local.spawn({ cmd, cols, rows, script, cwd: spec.cwd });
      sessions.set(id, {
        machineId: m.id,
        write: (d) => p.write(d),
        resize: (c, r) => { try { p.resize(c, r); } catch {} },
        close: () => { try { p.kill(); } catch {} },
      });
      p.onData((d) => emitData(id, d));
      p.onExit(({ exitCode }) => {
        flush();
        if (!sessions.has(id)) return;
        sessions.delete(id);
        send('session:exit', id, { code: exitCode });
      });
      return { ok: true, id };
    }

    const mach = getMachine(m.id);
    const tmuxName = spec.raw ? null : (spec.attach || `nx-${preset.id}-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`);
    const stream = await mach.open({ tmuxName, cmd, cols, rows });
    const dec = new StringDecoder('utf8');
    let exitCode = null;
    sessions.set(id, {
      machineId: m.id,
      tmuxName,
      write: (d) => stream.write(d),
      resize: (c, r) => { try { stream.setWindow(r, c, 0, 0); } catch {} },
      close: () => { try { stream.close(); } catch {} },
    });
    stream.on('data', (b) => emitData(id, dec.write(b)));
    stream.stderr.on('data', (b) => emitData(id, b.toString('utf8')));
    stream.on('exit', (code) => { exitCode = code; });
    stream.on('close', () => {
      flush();
      if (!sessions.has(id)) return;
      sessions.delete(id);
      send('session:exit', id, { code: exitCode, disconnected: exitCode === null });
    });
    return { ok: true, id, tmuxName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('session:write', (_e, id, data) => { const s = sessions.get(id); if (s) s.write(data); });
ipcMain.on('session:resize', (_e, id, cols, rows) => { const s = sessions.get(id); if (s) s.resize(cols, rows); });
ipcMain.handle('session:close', async (_e, id, opts = {}) => {
  const s = sessions.get(id);
  if (!s) return true;
  sessions.delete(id);
  s.close();
  if (opts.kill && s.tmuxName) await getMachine(s.machineId).killTmux(s.tmuxName);
  return true;
});
