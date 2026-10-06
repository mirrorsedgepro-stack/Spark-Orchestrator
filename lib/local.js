// Local (Windows) sessions via ConPTY.
const pty = require('node-pty');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const GIT_BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
  .find((p) => fs.existsSync(p));

function which(cmd) {
  return new Promise((resolve) => {
    execFile('where.exe', [cmd], { windowsHide: true }, (err, out) => resolve(!err && out.trim() ? out.trim().split(/\r?\n/)[0] : null));
  });
}

// User-level install dirs (Claude native installer, Antigravity CLI). Added to PATH for sessions so a tool
// installed after Nexus started is found without restarting the app.
const EXTRA_PATHS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin'),
];
const inExtra = (names) => EXTRA_PATHS.some((d) => names.some((n) => fs.existsSync(path.join(d, n))));

async function probe() {
  const [claude, agy, pwsh] = await Promise.all([which('claude'), which('agy'), which('pwsh')]);
  return {
    claude: !!claude || inExtra(['claude.exe']),
    agy: !!agy || inExtra(['agy.exe', 'agy.cmd']),
    pwsh: !!pwsh, gitbash: !!GIT_BASH, shell: true,
  };
}

let pwshPath;
which('pwsh').then((p) => { pwshPath = p; });

// cmd: '' -> plain shell, '__gitbash__' -> Git Bash, anything else -> run in PowerShell, drop to the shell when it exits.
function spawn({ cmd, cols, rows, cwd, script }) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Nexus' };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
  env[pathKey] = [...EXTRA_PATHS, env[pathKey]].join(';');
  const opts = { name: 'xterm-256color', cols, rows, cwd: cwd || os.homedir(), env, useConpty: true };
  const ps = pwshPath || 'powershell.exe';
  const base = ['-NoLogo', '-ExecutionPolicy', 'Bypass'];

  if (script) return pty.spawn(ps, [...base, '-NoExit', '-File', script.file, ...(script.args || [])], opts);
  if (cmd === '__gitbash__') {
    if (!GIT_BASH) throw new Error('Git Bash not found');
    return pty.spawn(GIT_BASH, ['--login', '-i'], opts);
  }
  if (!cmd) return pty.spawn(ps, base, opts);
  return pty.spawn(ps, [...base, '-NoExit', '-Command', cmd], opts);
}

module.exports = { spawn, probe };
