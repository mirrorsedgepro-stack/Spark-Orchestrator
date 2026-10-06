// Local (Windows) sessions via ConPTY.
const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const GIT_BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
  .find((p) => fs.existsSync(p));

function which(cmd) {
  return new Promise((resolve) => {
    execFile('where.exe', [cmd], { windowsHide: true }, (err, out) => resolve(!err && out.trim() ? out.trim().split(/\r?\n/)[0] : null));
  });
}

async function probe() {
  const [claude, gemini, pwsh] = await Promise.all([which('claude'), which('gemini'), which('pwsh')]);
  return { claude: !!claude, gemini: !!gemini, pwsh: !!pwsh, gitbash: !!GIT_BASH, shell: true };
}

let pwshPath;
which('pwsh').then((p) => { pwshPath = p; });

// cmd: '' -> plain shell, '__gitbash__' -> Git Bash, anything else -> run in PowerShell, drop to the shell when it exits.
function spawn({ cmd, cols, rows, cwd, script }) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Nexus' };
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
