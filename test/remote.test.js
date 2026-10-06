const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sessionCommand, shq, shPath } = require('../lib/remote');
const { migrate, DEFAULTS } = require('../lib/config');

// A POSIX bash to run generated commands (Linux CI, or Git Bash on Windows).
const BASH = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p))
  : '/bin/bash';

test('shq / shPath quoting', () => {
  assert.strictEqual(shq("it's"), `'it'\\''s'`);
  assert.strictEqual(shPath('~'), '"$HOME"');
  assert.strictEqual(shPath('~/code/my app'), `"$HOME"/'code/my app'`);
  assert.strictEqual(shPath('/srv/x'), `'/srv/x'`);
});

test('sessionCommand runs the agent in the folder via tmux, with nested quotes intact', { skip: !BASH && 'no bash available' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cmd-'));
  const work = path.join(dir, "my 'proj'");
  fs.mkdirSync(work);
  // Fake tmux: print -c, then run the session command the way tmux would (sh -c).
  const fake = path.join(dir, 'tmux');
  fs.writeFileSync(fake, '#!/bin/bash\nwhile [ $# -gt 1 ]; do [ "$1" = -c ] && echo "start-dir=$2"; shift; done\nexec sh -c "$1"\n', { mode: 0o755 });
  const posix = (p) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p);
  const cmd = sessionCommand('nx-claude-test', `pwd; echo "it's quoted"`, 'tmux', posix(work));
  const out = execFileSync(BASH, ['-c', cmd], {
    env: { ...process.env, PATH: `${posix(dir)}:${process.env.PATH}`, SHELL: '/usr/bin/true', HOME: posix(dir) },
    input: '',
    encoding: 'utf8',
  });
  assert.match(out, /start-dir=.*my 'proj'/);
  assert.match(out, /my 'proj'\n/);
  assert.match(out, /it's quoted/);
});

test('sessionCommand without tmux name is a plain login shell', () => {
  assert.match(sessionCommand(null, 'claude'), /^exec bash -ilc 'claude; exec "\$SHELL" -l'$/);
});

test('config migrate swaps the old Gemini preset for Antigravity once', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  cfg.presets = cfg.presets.filter((p) => p.id !== 'antigravity');
  cfg.presets.splice(1, 0, { id: 'gemini', name: 'Gemini', cmd: { windows: 'gemini', linux: 'gemini' } });
  assert.strictEqual(migrate(cfg), true);
  assert.strictEqual(cfg.presets[1].id, 'antigravity');
  assert.strictEqual(cfg.presets[1].cmd.linux, 'agy');
  assert.strictEqual(migrate(cfg), false);
});

test('Claude alert hooks: added once, existing settings preserved', () => {
  const { ALERTS_PY } = require('../lib/remote');
  const py = ['python3', 'python'].find((p) => { try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
  if (!py) return;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-alerts-'));
  fs.mkdirSync(path.join(home, '.claude'));
  const file = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
  const run = () => execFileSync(py, ['-'], { input: ALERTS_PY, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
  assert.match(run(), /alerts:2/);
  assert.match(run(), /alerts:0/);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(s.model, 'opus');
  assert.strictEqual(s.hooks.Stop.length, 2);
  assert.strictEqual(s.hooks.Notification.length, 1);
  assert.strictEqual(s.hooks.Stop[1].hooks[0].command, String.raw`printf '\a' > /dev/tty 2>/dev/null || true`);
});
