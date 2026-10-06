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

function friendly(err, m) {
  const msg = String(err && err.message || err);
  if (/authentication methods failed/i.test(msg)) return `Authentication failed for ${m.user || '?'}@${m.host}. Use "Set up SSH key" in Settings.`;
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
    const port = Number(m.port) || 22;
    const opts = {
      host: m.host,
      port,
      username: m.user || os.userInfo().username,
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
    const candidates = m.keyPath ? [m.keyPath] : ['id_ed25519', 'id_ecdsa', 'id_rsa'].map((f) => path.join(os.homedir(), '.ssh', f));
    for (const f of candidates) {
      if (!fs.existsSync(f)) continue;
      const buf = fs.readFileSync(f);
      const parsed = utils.parseKey(buf, m.passphrase || undefined);
      if (!(parsed instanceof Error)) { opts.privateKey = buf; if (m.passphrase) opts.passphrase = m.passphrase; break; }
    }
    if (process.platform === 'win32' ? fs.existsSync(AGENT_PIPE) : process.env.SSH_AUTH_SOCK) {
      opts.agent = process.platform === 'win32' ? AGENT_PIPE : process.env.SSH_AUTH_SOCK;
    }
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
      conn.on('error', (err) => fail(this.hostKeyError || friendly(err, m)));
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

module.exports = { Machine, sessionCommand, shq };
