// Remote machines over SSH (ssh2). One connection per machine, one channel per session.
// Sessions run inside a dedicated tmux server (-L nexus) so they survive app restarts and dropped links.
const { Client, utils } = require('ssh2');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMUX = 'tmux -L nexus -f ~/.nexus/tmux.conf';

// Invisible tmux: no status bar, no mouse capture (so the app's own selection/copy works),
// and no alternate screen (so output lands in the app's scrollback).
const TMUX_CONF = `# Managed by Nexus - overwritten on connect
set -g status off
set -g mouse off
set -g escape-time 0
set -g history-limit 50000
set -g focus-events on
set -g set-clipboard on
set -g allow-passthrough on
set -g extended-keys on
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ',xterm*:smcup@:rmcup@,xterm-256color:Tc'
set -g set-titles on
set -g set-titles-string '#T'
set-environment -g COLORTERM truecolor
set -g remain-on-exit off
`;

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

// Remote command for an interactive session. The agent runs in a login+interactive bash (so nvm /
// ~/.local/bin PATH entries load); when it exits you drop into your normal shell instead of losing the pane.
function sessionCommand(tmuxName, cmd, tmux = TMUX) {
  const inner = cmd ? `${cmd}; exec "$SHELL" -l` : 'exec "$SHELL" -l';
  if (!tmuxName) return `exec bash -ilc ${shq(inner)}`;
  const run = cmd ? `bash -ilc ${shq(inner)}` : '"$SHELL" -l';
  return `if command -v tmux >/dev/null 2>&1; then exec ${tmux} new-session -A -s ${shq(tmuxName)} ${shq(run)}; `
    + `else printf '\\033[33m[nexus] tmux is not installed here - this session will not survive disconnects.\\033[0m\\r\\n'; exec bash -ilc ${shq(inner)}; fi`;
}

// ---- ~/.ssh/config support (Host / HostName / User / Port / IdentityFile / Include), first match wins ----
const SSH_DIR = path.join(os.homedir(), '.ssh');
const unquote = (s) => s.replace(/^"(.*)"$/, '$1');
const expandHome = (p) => unquote(p).replace(/^~(?=[\\/]|$)/, os.homedir());

function readSshConfig(file, depth = 0, out = []) {
  if (depth > 8 || !fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const mm = /^(\S+?)\s*(?:=\s*|\s+)(.*)$/.exec(line);
    if (!mm) continue;
    const key = mm[1].toLowerCase(), value = mm[2].trim();
    if (key === 'include') {
      for (const inc of value.match(/"[^"]+"|\S+/g) || []) {
        let p = expandHome(inc);
        if (!path.isAbsolute(p)) p = path.join(SSH_DIR, p);
        readSshConfig(p, depth + 1, out);
      }
    } else out.push({ key, value });
  }
  return out;
}

function globMatch(pattern, s) {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return re.test(s);
}

function sshConfigFor(alias) {
  const res = { identityFiles: [] };
  let active = true;
  for (const { key, value } of readSshConfig(path.join(SSH_DIR, 'config'))) {
    if (key === 'host') {
      const pats = value.match(/"[^"]+"|\S+/g).map(unquote);
      active = pats.some((p) => !p.startsWith('!') && globMatch(p, alias)) && !pats.some((p) => p.startsWith('!') && globMatch(p.slice(1), alias));
      continue;
    }
    if (key === 'match') { active = false; continue; } // not supported; skip its block
    if (!active) continue;
    if (key === 'identityfile') res.identityFiles.push(expandHome(value));
    else if (key === 'hostname' && !res.hostname) res.hostname = value;
    else if (key === 'user' && !res.user) res.user = value;
    else if (key === 'port' && !res.port) res.port = Number(value);
  }
  return res;
}

function friendly(err, m) {
  const msg = String(err && err.message || err);
  if (/authentication methods failed/i.test(msg)) return `Authentication failed for ${m.user || '?'}@${m.host} (tried ${m.triedKeys || 'no keys'}). Use "Set up SSH key" in Settings.`;
  if (err && err.code === 'ECONNREFUSED') return `${m.host}:${m.port || 22} refused the connection. Is sshd running?`;
  if (err && (err.code === 'ETIMEDOUT' || err.level === 'client-timeout')) return `Timed out reaching ${m.host}.`;
  if (err && err.code === 'ENOTFOUND') return `Host "${m.host}" not found.`;
  if (err && err.code === 'EHOSTUNREACH') return `${m.host} is unreachable.`;
  return msg;
}

class Machine extends EventEmitter {
  constructor(id, store) {
    super();
    this.id = id;
    this.store = store; // { get(): machineCfg, known(key), remember(key, fp) }
    this.status = 'offline';
    this.error = null;
    this.conn = null;
    this.connecting = null;
    this.prepared = false;
  }

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.emit('status', status, error);
  }

  authOptions(m) {
    // Blank Nexus fields fall back to ~/.ssh/config, exactly like the ssh command does.
    const sc = sshConfigFor(m.host);
    const port = Number(m.port) || sc.port || 22;
    const username = m.user || sc.user || os.userInfo().username;
    const opts = {
      host: sc.hostname || m.host,
      port,
      username,
      readyTimeout: 10000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 4,
      hostVerifier: (key) => {
        const fp = 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
        const k = `${m.host}:${port}`;
        const known = this.store.known(k);
        if (!known) { this.store.remember(k, fp); return true; }
        if (known !== fp) {
          this.hostKeyError = `Host key for ${k} changed (expected ${known}, got ${fp}). Remove it under "knownHosts" in the config if this is expected.`;
          return false;
        }
        return true;
      },
    };
    // Try every usable key in order: explicit key, ~/.ssh/config IdentityFiles, then the defaults; then ssh-agent.
    const candidates = [...new Set([
      ...(m.keyPath ? [expandHome(m.keyPath)] : []),
      ...sc.identityFiles,
      ...['id_ed25519', 'id_ecdsa', 'id_rsa'].map((f) => path.join(SSH_DIR, f)),
    ])];
    const methods = [];
    const tried = [];
    for (const f of candidates) {
      if (!fs.existsSync(f)) continue;
      const parsed = utils.parseKey(fs.readFileSync(f), m.passphrase || undefined);
      if (parsed instanceof Error) continue;
      methods.push({ type: 'publickey', username, key: Array.isArray(parsed) ? parsed[0] : parsed });
      tried.push(path.basename(f));
    }
    const agent = process.platform === 'win32' ? (fs.existsSync(AGENT_PIPE) && AGENT_PIPE) : process.env.SSH_AUTH_SOCK;
    if (agent) { methods.push({ type: 'agent', username, agent }); tried.push('ssh-agent'); }
    this.triedKeys = tried.join(', ');
    opts.authHandler = () => methods.shift() || false;
    return opts;
  }

  connect() {
    if (this.status === 'online' && this.conn) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const m = this.store.get();
    if (!m || !m.host) return Promise.reject(new Error('No host configured for this machine. Open Settings to add one.'));
    this.setStatus('connecting');
    this.hostKeyError = null;
    this.connecting = new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        this.connecting = null;
        this.setStatus('error', msg);
        reject(new Error(msg));
      };
      conn.on('ready', async () => {
        this.conn = conn;
        settled = true;
        this.connecting = null;
        try { await this.exec(`mkdir -p ~/.nexus && cat > ~/.nexus/tmux.conf && (${TMUX} source-file ~/.nexus/tmux.conf >/dev/null 2>&1 || true)`, TMUX_CONF); } catch {}
        this.setStatus('online');
        resolve();
      });
      conn.on('error', (err) => fail(this.hostKeyError || friendly(err, { ...m, triedKeys: this.triedKeys })));
      conn.on('close', () => {
        if (this.conn === conn) this.conn = null;
        if (!settled) return fail(this.hostKeyError || 'Connection closed');
        if (this.status === 'online') this.setStatus('offline');
      });
      try { conn.connect(this.authOptions(m)); } catch (err) { fail(friendly(err, m)); }
    });
    return this.connecting;
  }

  disconnect() {
    if (this.conn) this.conn.end();
  }

  // Run a command with no pty; resolves with stdout/stderr/code.
  exec(cmd, stdin, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (!this.conn) return reject(new Error('Not connected'));
      this.conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = '', errOut = '', code = null;
        const t = setTimeout(() => { stream.close(); reject(new Error('Remote command timed out')); }, timeoutMs);
        stream.on('data', (d) => { out += d; });
        stream.stderr.on('data', (d) => { errOut += d; });
        stream.on('exit', (c) => { code = c; });
        stream.on('close', () => { clearTimeout(t); resolve({ code, stdout: out, stderr: errOut }); });
        if (stdin != null) stream.end(stdin); else stream.end();
      });
    });
  }

  async probe() {
    await this.connect();
    const script = `for t in tmux claude gemini node git; do if command -v $t >/dev/null 2>&1; then echo "tool:$t=1"; else echo "tool:$t=0"; fi; done; `
      + `${TMUX} ls -F 'sess:#{session_name}|#{session_attached}|#{session_activity}' 2>/dev/null; echo "host:$(hostname)"`;
    const { stdout } = await this.exec(`bash -ilc ${shq(script)} 2>/dev/null </dev/null`);
    const tools = {}, sessions = [];
    let hostname = '';
    for (const line of stdout.split(/\r?\n/)) {
      let mm;
      if ((mm = line.match(/^tool:(\w+)=([01])/))) tools[mm[1]] = mm[2] === '1';
      else if ((mm = line.match(/^sess:([^|]+)\|(\d+)\|(\d+)/))) sessions.push({ name: mm[1], attached: Number(mm[2]), activity: Number(mm[3]) * 1000 });
      else if ((mm = line.match(/^host:(.*)/))) hostname = mm[1].trim();
    }
    return { tools, sessions, hostname };
  }

  // Interactive channel with a pty. tmuxName -> persistent session; otherwise a plain one-shot login shell.
  async open({ tmuxName, cmd, cols, rows }) {
    await this.connect();
    const full = sessionCommand(tmuxName, cmd);
    return new Promise((resolve, reject) => {
      this.conn.exec(full, { pty: { term: 'xterm-256color', cols, rows, width: 0, height: 0 } }, (err, stream) => {
        if (err) reject(err); else resolve(stream);
      });
    });
  }

  async killTmux(name) {
    if (!this.conn) return;
    await this.exec(`${TMUX} kill-session -t ${shq(name)} 2>/dev/null`).catch(() => {});
  }

  async upload(remotePath, content) {
    await this.connect();
    const dir = remotePath.replace(/\/[^/]*$/, '');
    const r = await this.exec(`mkdir -p ${dir} && cat > ${remotePath} && chmod +x ${remotePath}`, content);
    if (r.code) throw new Error(r.stderr || 'upload failed');
  }
}

module.exports = { Machine, sessionCommand, shq, sshConfigFor };
