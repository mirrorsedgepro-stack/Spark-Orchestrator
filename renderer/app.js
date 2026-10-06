'use strict';
(() => {
  const api = window.nexus;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();

  // ---------------------------------------------------------------- icons
  const I = {
    claude: '<svg viewBox="0 0 24 24" style="stroke-width:2.4"><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18"/></svg>',
    gemini: '<svg viewBox="0 0 24 24"><path class="fill" d="M12 2c.7 5.3 4.7 9.3 10 10-5.3.7-9.3 4.7-10 10-.7-5.3-4.7-9.3-10-10 5.3-.7 9.3-4.7 10-10z"/></svg>',
    shell: '<svg viewBox="0 0 24 24" style="stroke-width:2.2"><path d="M5 7l5 5-5 5M12.5 18H19"/></svg>',
    gitbash: '<svg viewBox="0 0 24 24"><circle cx="6.5" cy="5.5" r="2.2"/><circle cx="6.5" cy="18.5" r="2.2"/><circle cx="17.5" cy="8" r="2.2"/><path d="M6.5 7.7v8.6M17.5 10.2c0 4.3-7 3.6-10 6.3"/></svg>',
    monitor: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12.5" rx="2.5"/><path d="M8.5 20.5h7M12 16.5v4"/></svg>',
    server: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="17" height="7" rx="2.2"/><path d="M7.5 7h.01M7.5 17h.01M11 7h5M11 17h5"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/></svg>',
    plug: '<svg viewBox="0 0 24 24"><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle class="fill" cx="5" cy="12" r="1.6"/><circle class="fill" cx="12" cy="12" r="1.6"/><circle class="fill" cx="19" cy="12" r="1.6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    split: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M4 20l16-8L4 4v6l10 2-10 2z"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    key: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4"/><path d="M10.5 12.5L20 3M16 7l3 3M14 9l2 2"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/></svg>',
    layout: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 3v18M3 12h9"/></svg>',
  };

  // ---------------------------------------------------------------- state
  const S = {
    cfg: null,
    mstate: {},           // machineId -> { status, error, tools, detached, hostname }
    sessions: new Map(),  // local id -> session
    byPid: new Map(),     // main-process id -> session
    early: new Map(),     // data that arrived before we mapped the pid
    order: [],
    mru: [],
    layout: 1,
    panes: [null],
    focus: 0,
    paneEls: [],
    winFocused: true,
    targets: new Set(),
    autoReattached: {},
    draft: null,
  };
  let uid = 0;

  const presetById = (id) => S.cfg.presets.find((p) => p.id === id) || { id, name: id, color: '#9aa3ba', cmd: {} };
  const machineById = (id) => S.cfg.machines.find((m) => m.id === id) || { id, name: id, type: 'local', color: '#646d85' };
  const presetsFor = (m) => S.cfg.presets.filter((p) => !p.only || p.only === m.os);
  const ordered = () => S.order.map((id) => S.sessions.get(id)).filter(Boolean);
  const focused = () => S.sessions.get(S.panes[S.focus]);
  const isVisible = (s) => S.panes.includes(s.id);
  const glyph = (presetId, cls = '') => `<span class="glyph ${cls}" style="--c:${presetById(presetId).color}">${I[presetId] || I.shell}</span>`;
  const mIcon = (m) => (m.type === 'local' ? I.monitor : I.server);
  const presetFromTmux = (name) => { const m = /^nx-([a-z0-9]+)-/.exec(name); return m ? m[1] : 'shell'; };
  const isAgent = (s) => s.presetId === 'claude' || s.presetId === 'gemini';

  // ---------------------------------------------------------------- terminal theme
  const THEME = {
    background: '#0b0f18', foreground: '#c8d3f5',
    selectionBackground: 'rgba(122,162,247,0.32)', selectionInactiveBackground: 'rgba(122,162,247,0.16)',
    black: '#1d2233', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#4e5675', brightRed: '#ff8fa3', brightGreen: '#b9f27c', brightYellow: '#ffc777', brightBlue: '#8db0ff', brightMagenta: '#c9aaff', brightCyan: '#a4e4ff', brightWhite: '#e6ebff',
    scrollbarSliderBackground: 'rgba(148,163,214,0.14)', scrollbarSliderHoverBackground: 'rgba(148,163,214,0.28)', scrollbarSliderActiveBackground: 'rgba(148,163,214,0.36)',
  };

  function termOptions(color, machine) {
    const a = S.cfg.appearance;
    const o = {
      fontFamily: a.fontFamily, fontSize: a.fontSize, lineHeight: a.lineHeight, letterSpacing: 0,
      cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2, cursorInactiveStyle: 'outline',
      allowProposedApi: true, scrollback: 20000, smoothScrollDuration: 60, fastScrollSensitivity: 5,
      drawBoldTextInBrightColors: false, minimumContrastRatio: 1, rescaleOverlappingGlyphs: true,
      theme: { ...THEME, cursor: color, cursorAccent: '#0b0f18' },
    };
    if (machine.type === 'local') o.windowsPty = { backend: 'conpty', buildNumber: 26100 };
    return o;
  }

  // ---------------------------------------------------------------- sessions
  function makeSession(machineId, presetId, extra = {}) {
    const p = presetById(presetId);
    const id = `L${++uid}`;
    const same = ordered().filter((x) => x.machineId === machineId && x.presetId === presetId).length;
    const host = document.createElement('div');
    host.className = 'term-host';
    $('#parking').appendChild(host);
    const term = new Terminal(termOptions(p.color, machineById(machineId)));
    // MSYS bash behind ConPTY mangles bracketed-paste markers into literal "[200~".
    if (presetId === 'gitbash') term.options.ignoreBracketedPasteMode = true;
    const fit = new FitAddon.FitAddon();
    const search = new SearchAddon.SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => window.open(uri)));
    term.loadAddon(new Unicode11Addon.Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(host);
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      term.loadAddon(gl);
    } catch { /* DOM renderer fallback */ }

    const s = {
      id, machineId, presetId, color: p.color, term, fit, search, host,
      name: extra.name || (same ? `${p.name} ${same + 1}` : p.name),
      tmuxName: extra.attach || null,
      spec: { raw: extra.raw, cmd: extra.cmd, script: extra.script, scriptMachine: extra.scriptMachine },
      pid: null, status: 'starting', activity: 'idle', title: '',
      lastData: 0, lastInput: 0, burst: 0, quietUntil: 0, busySince: 0,
    };
    wireSession(s);
    S.sessions.set(id, s);
    S.order.push(id);
    return s;
  }

  function wireSession(s) {
    const { term } = s;
    term.onData((d) => {
      s.lastInput = now();
      if (s.status === 'running') api.write(s.pid, d);
      else if ((s.status === 'exited' || s.status === 'disconnected') && d === '\r') start(s);
    });
    term.onBinary((d) => { if (s.status === 'running') api.write(s.pid, d); });
    term.onResize(({ cols, rows }) => {
      s.quietUntil = now() + 1200;
      if (s.status === 'running') api.resize(s.pid, cols, rows);
      renderStatus();
    });
    term.onTitleChange((t) => { s.title = t.replace(/^[\s✳⠂⠐⠈⠁⠄⠠⡀⢀·*]+/, '').trim(); renderChrome(); });
    term.onBell(() => { if (!isVisible(s) || !S.winFocused) markDone(s, true); });
    term.onSelectionChange(() => {
      if (S.cfg.appearance.copyOnSelect && term.hasSelection()) api.writeClipboard(term.getSelection());
    });
    term.attachCustomKeyEventHandler((e) => termKey(e, s));
    term.textarea.addEventListener('focus', () => {
      const i = S.panes.indexOf(s.id);
      if (i >= 0 && i !== S.focus) { S.focus = i; touchMru(s.id); markPaneFocus(); renderChrome(); }
      clearDone(s);
    });
    s.host.addEventListener('contextmenu', (e) => { e.preventDefault(); termMenu(e, s); });
  }

  async function start(s) {
    const m = machineById(s.machineId);
    s.status = 'starting';
    renderChrome();
    if (m.type === 'ssh') s.term.write(`\x1b[2m${s.tmuxName ? 'attaching' : 'connecting'} to ${m.name}…\x1b[0m\r\n`);
    const r = await api.create({
      machineId: s.machineId, presetId: s.presetId, cols: s.term.cols, rows: s.term.rows,
      attach: s.tmuxName || undefined, ...s.spec,
    });
    if (!S.sessions.has(s.id)) { if (r.ok) api.close(r.id); return; }
    if (!r.ok) {
      s.status = 'exited';
      s.term.write(`\r\n\x1b[38;2;247;118;142m✖ ${r.error}\x1b[0m\r\n\x1b[2mEnter to retry · Ctrl+Shift+W to close\x1b[0m\r\n`);
      renderChrome();
      return;
    }
    s.pid = r.id;
    if (r.tmuxName) s.tmuxName = r.tmuxName;
    s.status = 'running';
    S.byPid.set(r.id, s);
    const early = S.early.get(r.id);
    if (early) { S.early.delete(r.id); s.term.write(early); }
    s.quietUntil = now() + 2500;
    renderChrome();
  }

  async function launch(machineId, presetId, extra = {}) {
    const m = machineById(machineId);
    if (m.type === 'ssh' && !m.host) { openSettings(); toast(`Add the address of ${m.name} first.`); return null; }
    const tools = (S.mstate[machineId] || {}).tools;
    if (tools && tools[presetId] === false && !extra.raw && !extra.script) toast(installHint(m, presetId), 'warn');
    const s = makeSession(machineId, presetId, extra);
    show(s.id);
    await frame();
    try { s.fit.fit(); } catch {}
    start(s);
    return s;
  }

  function reattach(machineId, name, { focus = true } = {}) {
    const existing = ordered().find((s) => s.machineId === machineId && s.tmuxName === name);
    if (existing) return show(existing.id);
    const s = makeSession(machineId, presetFromTmux(name), { attach: name });
    if (focus || !S.panes.some(Boolean)) show(s.id, { focus });
    else renderAll();
    frame().then(() => { try { if (isVisible(s)) s.fit.fit(); } catch {} start(s); });
  }

  async function closeSession(id, opts = {}) {
    const s = S.sessions.get(id);
    if (!s) return;
    S.sessions.delete(id);
    S.order = S.order.filter((x) => x !== id);
    S.mru = S.mru.filter((x) => x !== id);
    S.targets.delete(id);
    if (s.pid) { S.byPid.delete(s.pid); api.close(s.pid, opts); }
    else if (opts.kill && s.tmuxName) api.killTmux(s.machineId, s.tmuxName);
    s.term.dispose();
    s.host.remove();
    const i = S.panes.indexOf(id);
    if (i >= 0) S.panes[i] = S.mru.find((x) => !S.panes.includes(x)) || null;
    if (machineById(s.machineId).type === 'ssh') setTimeout(() => refreshMachine(s.machineId), 700);
    renderAll();
    const f = focused();
    if (f) f.term.focus();
  }

  function closeFocused(kill = false) {
    const s = focused();
    if (s) closeSession(s.id, { kill });
  }

  function installHint(m, presetId) {
    const p = presetById(presetId);
    if (m.type === 'ssh') return `${p.name} isn't installed on ${m.name}. Use "Install tools" from the machine's ⋯ menu.`;
    if (presetId === 'claude') return 'Claude Code isn\'t on PATH here. Install it: npm install -g @anthropic-ai/claude-code';
    if (presetId === 'gemini') return 'Gemini CLI isn\'t on PATH here. Install it: npm install -g @google/gemini-cli';
    return `${p.name} isn't available on ${m.name}.`;
  }

  // ---------------------------------------------------------------- activity tracking
  function markDone(s, notify) {
    s.activity = 'done';
    if (notify && S.cfg.appearance.notifyWhenDone) {
      const m = machineById(s.machineId);
      api.notify({ title: `${s.name} on ${m.name} is ready`, body: s.title || 'Finished - waiting for you', sessionId: s.id });
      api.flash();
    }
  }
  function clearDone(s) {
    if (s.activity === 'done') { s.activity = 'idle'; renderChrome(); }
  }
  setInterval(() => {
    const t = now();
    let dirty = false;
    for (const s of S.sessions.values()) {
      if (s.activity === 'busy' && t - s.lastData > 2500) {
        s.burst = 0;
        dirty = true;
        if (isVisible(s) && S.winFocused) s.activity = 'idle';
        else markDone(s, isAgent(s) && t - s.busySince > 5000);
      } else if (s.activity !== 'busy' && t - s.lastData > 1500) s.burst = 0;
    }
    if (dirty) renderChrome();
  }, 700);

  api.onData((pid, data) => {
    const s = S.byPid.get(pid);
    if (!s) { S.early.set(pid, (S.early.get(pid) || '') + data); return; }
    s.term.write(data);
    const t = now();
    s.lastData = t;
    if (t > s.quietUntil && t - s.lastInput > 500) {
      s.burst += data.length;
      if (s.burst > 400 && s.activity !== 'busy') { s.activity = 'busy'; s.busySince = t; renderChrome(); }
    }
  });

  api.onExit((pid, info) => {
    const s = S.byPid.get(pid);
    if (!s) return;
    S.byPid.delete(pid);
    s.pid = null;
    s.activity = 'idle';
    if (info.disconnected) {
      s.status = 'disconnected';
      s.term.write('\r\n\x1b[38;2;224;175;104m⚡ Connection lost. The session is still running in tmux on the remote. Press Enter to reattach.\x1b[0m\r\n');
    } else {
      s.status = 'exited';
      s.term.write(`\r\n\x1b[2m[exited${info.code != null ? ` (${info.code})` : ''}. Enter to restart, Ctrl+Shift+W to close]\x1b[0m\r\n`);
    }
    if (machineById(s.machineId).type === 'ssh') refreshMachine(s.machineId);
    renderChrome();
  });

  // ---------------------------------------------------------------- panes / layout
  function touchMru(id) {
    S.mru = [id, ...S.mru.filter((x) => x !== id)];
  }

  function show(id, { focus = true } = {}) {
    const s = S.sessions.get(id);
    if (!s) return;
    let i = S.panes.indexOf(id);
    if (i < 0) { i = S.focus; S.panes[i] = id; }
    S.focus = i;
    touchMru(id);
    clearDone(s);
    renderAll();
    if (focus) frame().then(() => s.term.focus());
  }

  function setLayout(n) {
    const f = S.panes[S.focus];
    const list = [...new Set([f, ...S.panes, ...S.mru].filter((x) => x && S.sessions.has(x)))].slice(0, n);
    S.layout = n;
    S.panes = Array.from({ length: n }, (_, i) => list[i] || null);
    S.focus = 0;
    renderAll();
    const s = focused();
    if (s) frame().then(() => s.term.focus());
  }
  const cycleLayout = () => setLayout(S.layout === 1 ? 2 : S.layout === 2 ? 4 : 1);

  function splitWith(s) {
    if (S.layout === 1) setLayout(2);
    const i = S.panes.indexOf(s.id);
    if (i < 0) {
      const target = S.panes.findIndex((x, j) => j !== S.focus && !x);
      S.panes[target >= 0 ? target : (S.focus + 1) % S.layout] = s.id;
    }
    show(s.id);
  }

  function moveToNextPane(s) {
    const from = S.panes.indexOf(s.id);
    const to = (Math.max(from, S.focus) + 1) % S.layout;
    if (from >= 0) S.panes[from] = S.panes[to] === s.id ? null : S.panes[to];
    S.panes[to] = s.id;
    S.focus = to;
    renderAll();
    frame().then(() => s.term.focus());
  }

  function movePaneFocus(dir) {
    if (S.layout === 1) return;
    let i = S.focus;
    if (dir === 'ArrowLeft') i = S.layout === 4 ? (i % 2 ? i - 1 : i) : 0;
    if (dir === 'ArrowRight') i = S.layout === 4 ? (i % 2 ? i : i + 1) : 1;
    if (dir === 'ArrowUp' && S.layout === 4) i = i >= 2 ? i - 2 : i;
    if (dir === 'ArrowDown' && S.layout === 4) i = i < 2 ? i + 2 : i;
    S.focus = i;
    markPaneFocus();
    const s = focused();
    if (s) { touchMru(s.id); s.term.focus(); }
    renderChrome();
  }

  function createPaneEl() {
    const el = document.createElement('div');
    el.className = 'pane';
    el.innerHTML = '<div class="pane-head"></div><div class="pane-body"></div>';
    el.addEventListener('mousedown', () => {
      const i = S.paneEls.indexOf(el);
      if (i !== S.focus) { S.focus = i; const s = focused(); if (s) touchMru(s.id); markPaneFocus(); renderChrome(); }
    });
    el.querySelector('.pane-head').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pact]');
      const s = S.sessions.get(S.panes[S.paneEls.indexOf(el)]);
      if (!b || !s) return;
      const act = b.dataset.pact;
      if (act === 'close') closeSession(s.id);
      else if (act === 'search') openSearch(s);
      else if (act === 'split') S.layout === 1 ? splitWith(s) : moveToNextPane(s);
      else if (act === 'menu') { const r = b.getBoundingClientRect(); termMenu({ clientX: r.left, clientY: r.bottom + 4 }, s); }
    });
    el.querySelector('.pane-head').addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-pact]')) return;
      const s = S.sessions.get(S.panes[S.paneEls.indexOf(el)]);
      if (s) { S.focus = S.paneEls.indexOf(el); setLayout(S.layout === 1 ? 2 : 1); }
    });
    return el;
  }

  function renderPanes() {
    const empty = S.order.length === 0;
    $('#welcome').hidden = !empty;
    $('#panes').hidden = empty;
    if (empty) { renderWelcome(); return; }

    S.panes = Array.from({ length: S.layout }, (_, i) => (S.sessions.has(S.panes[i]) ? S.panes[i] : null));
    S.panes = S.panes.map((id, i) => (id && S.panes.indexOf(id) === i ? id : null));
    if (S.focus >= S.layout) S.focus = 0;
    // never leave every pane empty while sessions exist
    S.panes.forEach((id, i) => { if (!id) S.panes[i] = S.mru.concat(S.order).find((x) => !S.panes.includes(x)) || null; });

    const wrap = $('#panes');
    wrap.className = `panes l${S.layout}`;
    while (S.paneEls.length < S.layout) { const el = createPaneEl(); S.paneEls.push(el); wrap.appendChild(el); }
    while (S.paneEls.length > S.layout) {
      const el = S.paneEls.pop();
      el.querySelectorAll('.term-host').forEach((h) => $('#parking').appendChild(h));
      el.remove();
    }
    const parking = $('#parking');
    for (const s of S.sessions.values()) if (!S.panes.includes(s.id) && s.host.parentElement !== parking) parking.appendChild(s.host);

    S.paneEls.forEach((el, i) => {
      const s = S.sessions.get(S.panes[i]);
      const body = el.querySelector('.pane-body');
      body.querySelectorAll('.term-host').forEach((h) => { if (!s || h !== s.host) parking.appendChild(h); });
      body.querySelector('.pane-empty')?.remove();
      if (s) { if (s.host.parentElement !== body) body.appendChild(s.host); }
      else body.insertAdjacentHTML('beforeend', '<div class="pane-empty">Empty pane. Pick a session in the sidebar or press Ctrl+Shift+P</div>');
    });
    markPaneFocus();
    renderPaneHeads();
    scheduleFit();
  }

  function markPaneFocus() {
    S.paneEls.forEach((el, i) => {
      const s = S.sessions.get(S.panes[i]);
      el.classList.toggle('focused', i === S.focus && S.layout > 0);
      el.style.setProperty('--c', s ? s.color : '#646d85');
    });
    renderStatus();
  }

  function renderPaneHeads() {
    S.paneEls.forEach((el, i) => {
      const s = S.sessions.get(S.panes[i]);
      const head = el.querySelector('.pane-head');
      if (!s) { head.innerHTML = '<span class="p-sub">-</span>'; return; }
      const m = machineById(s.machineId);
      const stateChip = s.status === 'disconnected' ? '<span class="chip" style="--mc:#e0af68">disconnected</span>'
        : s.status === 'exited' ? '<span class="chip ghost">exited</span>'
        : s.status === 'starting' ? '<span class="chip ghost">starting…</span>' : '';
      head.innerHTML = `${glyph(s.presetId, 'sm')}<span class="p-title">${esc(s.name)}</span>`
        + `<span class="chip" style="--mc:${m.color}">${esc(m.name)}</span>`
        + (s.tmuxName ? `<span class="chip ghost" title="tmux session - survives disconnects">${esc(s.tmuxName)}</span>` : '')
        + stateChip
        + `<span class="p-sub">${esc(s.title)}</span>`
        + `<button class="icon-btn" data-pact="search" title="Find (Ctrl+Shift+F)">${I.search}</button>`
        + `<button class="icon-btn" data-pact="split" title="${S.layout === 1 ? 'Split side by side' : 'Move to next pane'}">${I.split}</button>`
        + `<button class="icon-btn" data-pact="menu" title="More">${I.more}</button>`
        + `<button class="icon-btn" data-pact="close" title="${s.tmuxName ? 'Detach (keeps running)' : 'Close'} (Ctrl+Shift+W)">${I.x}</button>`;
    });
  }

  let fitRaf = 0;
  function scheduleFit() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      for (const id of S.panes) {
        const s = S.sessions.get(id);
        if (!s) continue;
        try { s.fit.fit(); } catch {}
      }
    });
  }
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // ---------------------------------------------------------------- chrome: tabs, sidebar, status
  function actClass(s) {
    if (s.status === 'exited' || s.status === 'disconnected') return 'exited';
    return s.activity === 'busy' ? 'busy' : s.activity === 'done' ? 'done' : '';
  }

  function renderTabs() {
    const f = focused();
    $('#tabs').innerHTML = ordered().map((s, i) => {
      const m = machineById(s.machineId);
      const a = actClass(s);
      return `<div class="tab ${f === s ? 'active' : ''}" style="--c:${s.color}" data-s="${s.id}" title="${esc(s.title || s.name)}">`
        + (a ? `<span class="act ${a}"></span>` : glyph(s.presetId, 'sm'))
        + `<span class="t-title">${esc(s.name)}</span><span class="t-mach">${esc(m.name)}</span>`
        + (i < 9 ? `<span class="t-num">^${i + 1}</span>` : '')
        + `<span class="t-close" data-close="${s.id}">${I.x}</span></div>`;
    }).join('');
    $('#tabs .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function machineCard(m) {
    const st = S.mstate[m.id] || {};
    const status = m.type === 'local' ? 'online' : (st.status || 'offline');
    const sub = m.type === 'local' ? 'local · Windows' : (m.host ? `${m.user ? m.user + '@' : ''}${m.host}` : 'not configured');
    const sessions = ordered().filter((s) => s.machineId === m.id);
    const openNames = new Set(sessions.map((s) => s.tmuxName).filter(Boolean));
    const detached = (st.detached || []).filter((d) => !openNames.has(d.name));
    const f = focused();
    const tools = st.tools || {};
    const launchers = presetsFor(m).map((p) => {
      const missing = (p.id === 'claude' || p.id === 'gemini' || p.id === 'gitbash') && tools[p.id] === false;
      return `<button class="launch ${missing ? 'missing' : ''}" style="--c:${p.color}" data-act="launch" data-m="${m.id}" data-p="${p.id}" title="${missing ? `${esc(p.name)} is not installed on ${esc(m.name)}` : `New ${esc(p.name)} on ${esc(m.name)}`}">${glyph(p.id)}<span>${esc(p.name)}</span></button>`;
    }).join('');
    const items = sessions.map((s) => {
      const i = S.order.indexOf(s.id);
      return `<div class="s-item ${f === s ? 'active' : ''}" style="--c:${s.color}" data-act="show" data-s="${s.id}">${glyph(s.presetId, 'sm')}`
        + `<span class="s-title">${esc(s.name)}${s.title ? `<span style="color:var(--text-3)"> · ${esc(s.title)}</span>` : ''}</span>`
        + `<span class="act ${actClass(s)}"></span>${i < 9 ? `<span class="s-num">^${i + 1}</span>` : ''}`
        + `<button class="s-x" data-act="close" data-s="${s.id}" title="${s.tmuxName ? 'Detach' : 'Close'}">${I.x}</button></div>`;
    }).join('');
    const det = detached.map((d) => `<div class="s-item detached" style="--c:${presetById(presetFromTmux(d.name)).color}" data-act="reattach" data-m="${m.id}" data-name="${esc(d.name)}" title="Reattach">`
      + `${glyph(presetFromTmux(d.name), 'sm')}<span class="s-title">${esc(d.name)}</span>`
      + `<button class="s-x" data-act="kill" data-m="${m.id}" data-name="${esc(d.name)}" title="Kill this tmux session">${I.x}</button></div>`).join('');

    return `<div class="machine" style="--c:${m.color}" data-machine="${m.id}">
      <div class="m-head">
        <div class="m-icon">${mIcon(m)}</div>
        <div class="m-meta"><div class="m-name">${esc(m.name)} <span class="dot ${status}" title="${status}"></span></div><div class="m-sub">${esc(sub)}</div></div>
        <div class="m-actions">
          ${m.type === 'ssh' ? `<button class="icon-btn" data-act="refresh" data-m="${m.id}" title="${status === 'online' ? 'Refresh' : 'Connect'}">${status === 'online' ? I.refresh : I.plug}</button>` : ''}
          <button class="icon-btn" data-act="mmenu" data-m="${m.id}" title="More">${I.more}</button>
        </div>
      </div>
      ${status === 'error' && st.error ? `<div class="m-error">${esc(st.error)}<br><button data-act="settings">Open settings</button></div>` : ''}
      <div class="launchers">${launchers}</div>
      ${items ? `<div class="s-list">${items}</div>` : ''}
      ${det ? `<div class="s-label">Detached · still running</div><div class="s-list">${det}</div>` : ''}
    </div>`;
  }

  function renderSidebar() {
    // Remote machines first: that's where the agents usually live.
    const ms = [...S.cfg.machines].sort((a, b) => (a.type === b.type ? 0 : a.type === 'ssh' ? -1 : 1));
    $('#machines').innerHTML = ms.map(machineCard).join('');
  }

  function renderStatus() {
    const ms = S.cfg.machines.map((m) => {
      const st = m.type === 'local' ? 'online' : ((S.mstate[m.id] || {}).status || 'offline');
      return `<span class="st"><span class="dot ${st}"></span>${esc(m.name)}</span>`;
    }).join('');
    const s = focused();
    let info = '';
    if (s) {
      const m = machineById(s.machineId);
      info = `<span class="st" style="color:var(--text-2)">${glyph(s.presetId, 'sm')} ${esc(s.name)} @ ${esc(m.name)}${s.tmuxName ? ` · tmux ${esc(s.tmuxName)}` : ''} · ${s.term.cols}×${s.term.rows}</span>`;
    }
    $('#status-left').innerHTML = ms + info;
    $('#layout-switch').querySelectorAll('button').forEach((b) => b.classList.toggle('active', Number(b.dataset.layout) === S.layout));
  }

  function renderChrome() {
    renderTabs();
    renderSidebar();
    renderPaneHeads();
    renderStatus();
    if (!$('#composer').hidden) renderTargets();
  }
  function renderAll() {
    renderPanes();
    renderChrome();
  }

  function renderWelcome() {
    const ms = [...S.cfg.machines].sort((a, b) => (a.type === b.type ? 0 : a.type === 'ssh' ? -1 : 1));
    const cards = [];
    for (const m of ms) {
      for (const p of presetsFor(m).filter((x) => x.id !== 'gitbash')) {
        const tools = (S.mstate[m.id] || {}).tools || {};
        const missing = (p.id === 'claude' || p.id === 'gemini') && tools[p.id] === false;
        cards.push(`<button class="card-launch ${missing ? 'missing' : ''}" style="--c:${p.color}" data-act="launch" data-m="${m.id}" data-p="${p.id}">
          ${glyph(p.id, 'lg')}<div><div class="cl-name">${esc(p.name)}</div><div class="cl-sub">on ${esc(m.name)}${missing ? ' · not installed' : ''}</div></div></button>`);
      }
    }
    const unconfigured = S.cfg.machines.find((m) => m.type === 'ssh' && !m.host);
    $('#welcome').innerHTML = `
      <h1>One terminal. Every agent.</h1>
      <div class="lead">Claude, Gemini and shells on every machine on your LAN, side by side.</div>
      <div class="cards">${cards.join('')}</div>
      ${unconfigured ? `<div class="setup">${I.server}<span><b>${esc(unconfigured.name)}</b> needs an address before it can be used.</span><span class="spacer"></span><button class="btn sm" data-act="settings">Set it up</button></div>` : ''}
      <div class="keys">
        <div><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>P</kbd></div><div>Command palette: launch or switch anything</div>
        <div><kbd>Ctrl</kbd> <kbd>1</kbd>…<kbd>9</kbd></div><div>Jump to session</div>
        <div><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>L</kbd></div><div>Cycle layout: single, split, grid</div>
        <div><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Enter</kbd></div><div>Broadcast one prompt to many agents</div>
        <div><kbd>Ctrl</kbd> <kbd>C</kbd> / <kbd>Ctrl</kbd> <kbd>V</kbd></div><div>Copy selection / paste (Ctrl+C still interrupts with no selection)</div>
      </div>`;
  }

  // ---------------------------------------------------------------- machines
  async function connectMachine(id) {
    S.mstate[id] = { ...(S.mstate[id] || {}), status: 'connecting', error: null };
    renderChrome();
    const r = await api.connect(id);
    if (!r.ok) { S.mstate[id] = { ...S.mstate[id], status: 'error', error: r.error }; renderChrome(); return false; }
    await refreshMachine(id);
    return true;
  }

  async function refreshMachine(id) {
    const m = machineById(id);
    if (m.type !== 'ssh' || !m.host) return;
    const r = await api.probe(id);
    const st = (S.mstate[id] = S.mstate[id] || {});
    if (!r.ok) { st.status = 'error'; st.error = r.error; renderChrome(); return; }
    st.status = 'online';
    st.error = null;
    st.tools = r.tools;
    st.hostname = r.hostname;
    st.detached = r.sessions.filter((x) => x.name.startsWith('nx-')).sort((a, b) => b.activity - a.activity);
    if (!S.autoReattached[id]) {
      S.autoReattached[id] = true;
      const resumable = st.detached.filter((x) => !x.attached).slice(0, 8);
      if (resumable.length) {
        resumable.forEach((d, i) => reattach(id, d.name, { focus: i === 0 && !focused() }));
        toast(`Resumed ${resumable.length} running session${resumable.length > 1 ? 's' : ''} on ${m.name}`, 'ok');
      }
    }
    renderAll();
  }

  api.onMachineStatus((id, status, error) => {
    const st = (S.mstate[id] = S.mstate[id] || {});
    st.status = status;
    st.error = error;
    if (status === 'offline') st.detached = st.detached || [];
    renderChrome();
  });

  setInterval(() => {
    for (const m of S.cfg.machines) if (m.type === 'ssh' && (S.mstate[m.id] || {}).status === 'online') refreshMachine(m.id);
  }, 30000);

  function machineMenu(x, y, m) {
    const st = S.mstate[m.id] || {};
    const items = [{ header: m.name }];
    for (const p of presetsFor(m)) items.push({ label: `New ${p.name}`, glyph: p.id, run: () => launch(m.id, p.id) });
    if (m.type === 'ssh') {
      items.push('sep');
      if (st.status === 'online') items.push({ label: 'Disconnect', run: () => api.disconnect(m.id) });
      else items.push({ label: 'Connect', run: () => connectMachine(m.id) });
      items.push({ label: 'Set up SSH key…', icon: I.key, run: () => setupKey(m.id) });
      items.push({ label: 'Install tools (tmux, Claude, Gemini)…', icon: I.box, run: () => bootstrap(m.id) });
    }
    items.push('sep', { label: 'Machine settings…', icon: I.gear, run: openSettings });
    showMenu(x, y, items);
  }

  async function setupKey(machineId) {
    const m = machineById(machineId);
    if (!m.host) { openSettings(); return; }
    await launch('local', 'shell', { script: 'setup-ssh-key', scriptMachine: machineId, name: `SSH key → ${m.name}` });
  }

  async function bootstrap(machineId) {
    const m = machineById(machineId);
    const r = await api.uploadBootstrap(machineId);
    if (!r.ok) { toast(`Can't reach ${m.name}: ${r.error}`, 'bad'); return; }
    await launch(machineId, 'shell', { raw: true, cmd: 'bash ~/.nexus/bootstrap.sh', name: 'Install tools' });
  }

  // ---------------------------------------------------------------- copy / paste / keys
  function copySelection(s) {
    const text = s.term.getSelection();
    if (!text) return false;
    api.writeClipboard(text);
    s.term.clearSelection();
    toast(`Copied ${text.length} chars`, 'ok', 1200);
    return true;
  }
  async function pasteInto(s) {
    const text = await api.readClipboard();
    if (text) s.term.paste(text);
  }

  function termKey(e, s) {
    if (e.type !== 'keydown') return true;
    if (handleShortcut(e)) { e.preventDefault(); e.stopPropagation(); return false; }
    const k = e.key.toLowerCase();
    if (e.ctrlKey && !e.altKey) {
      if (k === 'c' && (e.shiftKey || s.term.hasSelection())) { copySelection(s); e.preventDefault(); return false; }
      if (k === 'v') { e.preventDefault(); pasteInto(s); return false; }
    }
    if (e.shiftKey && e.key === 'Insert') { e.preventDefault(); pasteInto(s); return false; }
    // Shift+Enter = newline without submitting in Claude Code / Gemini CLI.
    if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'Enter') {
      if (s.status === 'running') api.write(s.pid, '\x1b\r');
      e.preventDefault();
      return false;
    }
    return true;
  }

  function handleShortcut(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const c = e.ctrlKey, sh = e.shiftKey, a = e.altKey;
    if (c && sh && !a && (k === 'p' || k === 'k')) { openPalette(); return true; }
    if (c && sh && k === 't') { openPalette('new '); return true; }
    if (c && sh && k === 'Enter') { toggleComposer(); return true; }
    if (c && sh && k === 'l') { cycleLayout(); return true; }
    if (c && sh && k === 'w') { closeFocused(); return true; }
    if (c && sh && k === 'f') { const s = focused(); if (s) openSearch(s); return true; }
    if (c && sh && k === 'd') { const s = focused(); if (s) splitWith(s); return true; }
    if (c && !sh && !a && /^[1-9]$/.test(k)) { const s = ordered()[Number(k) - 1]; if (s) show(s.id); return true; }
    if (c && k === 'Tab') { cycle(sh ? -1 : 1); return true; }
    if (c && !sh && k === '`') { const id = S.mru[1]; if (id) show(id); return true; }
    if (c && a && k.startsWith('Arrow')) { movePaneFocus(k); return true; }
    if (c && !sh && k === ',') { openSettings(); return true; }
    if (c && !sh && (k === '=' || k === '+')) { bumpFont(1); return true; }
    if (c && !sh && k === '-') { bumpFont(-1); return true; }
    if (c && !sh && k === '0') { bumpFont(0); return true; }
    if (e.key === 'F12') { api.devtools(); return true; }
    if (c && sh && k === 'r') { api.reload(); return true; }
    return false;
  }

  function cycle(dir) {
    const list = ordered();
    if (!list.length) return;
    const i = list.indexOf(focused());
    show(list[(i + dir + list.length) % list.length].id);
  }

  let fontSaveTimer;
  function bumpFont(d) {
    const a = S.cfg.appearance;
    a.fontSize = d === 0 ? 14 : Math.min(28, Math.max(9, a.fontSize + d));
    applyAppearance();
    clearTimeout(fontSaveTimer);
    fontSaveTimer = setTimeout(() => api.saveConfig(S.cfg), 600);
  }
  function applyAppearance() {
    const a = S.cfg.appearance;
    for (const s of S.sessions.values()) {
      s.term.options.fontSize = a.fontSize;
      s.term.options.fontFamily = a.fontFamily;
      s.term.options.lineHeight = a.lineHeight;
    }
    scheduleFit();
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('.xterm')) return; // terminal handles its own
    if (e.key === 'Escape') {
      if (!$('#ctxmenu').hidden) return hideMenu();
      if (!$('#palette').hidden) return closePalette();
      if (!$('#settings').hidden) return closeSettings();
      if (!$('#composer').hidden) return closeComposer();
    }
    if (e.target.matches?.('input, textarea, select') && !(e.ctrlKey && e.shiftKey)) return;
    if (handleShortcut(e)) e.preventDefault();
  }, true);

  // ---------------------------------------------------------------- search
  function openSearch(s) {
    const pane = S.paneEls[S.panes.indexOf(s.id)];
    if (!pane) return;
    const body = pane.querySelector('.pane-body');
    let bar = body.querySelector('.searchbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'searchbar';
      bar.style.top = '6px';
      bar.innerHTML = `<input placeholder="Find in scrollback" spellcheck="false"><button class="icon-btn" data-d="prev">${I.up}</button><button class="icon-btn" data-d="next">${I.down}</button><button class="icon-btn" data-d="close">${I.x}</button>`;
      body.appendChild(bar);
      const input = bar.querySelector('input');
      const close = () => { s.search.clearDecorations?.(); s.term.clearSelection(); bar.remove(); s.term.focus(); };
      input.addEventListener('input', () => s.search.findNext(input.value, { incremental: true }));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.shiftKey ? s.search.findPrevious(input.value) : s.search.findNext(input.value); e.preventDefault(); }
        if (e.key === 'Escape') { close(); e.stopPropagation(); }
      });
      bar.addEventListener('click', (e) => {
        const d = e.target.closest('[data-d]')?.dataset.d;
        if (d === 'next') s.search.findNext(input.value);
        if (d === 'prev') s.search.findPrevious(input.value);
        if (d === 'close') close();
      });
    }
    const sel = s.term.getSelection();
    const input = bar.querySelector('input');
    if (sel && !sel.includes('\n')) input.value = sel;
    input.focus();
    input.select();
  }

  // ---------------------------------------------------------------- context menu
  function showMenu(x, y, items) {
    const el = $('#ctxmenu');
    el.innerHTML = items.map((it, i) => {
      if (it === 'sep') return '<div class="sep"></div>';
      if (it.header) return `<div class="lbl">${esc(it.header)}</div>`;
      const ic = it.glyph ? glyph(it.glyph, 'sm') : it.icon ? `<span style="width:18px;display:grid;place-items:center;color:var(--text-2)">${it.icon}</span>` : '<span style="width:18px"></span>';
      return `<button class="ci ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${ic}<span>${esc(it.label)}</span>${it.kbd ? `<span class="k">${esc(it.kbd)}</span>` : ''}</button>`;
    }).join('');
    el.hidden = false;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    el.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || b.disabled) return;
      hideMenu();
      items[Number(b.dataset.i)].run();
    };
  }
  function hideMenu() { $('#ctxmenu').hidden = true; }
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxmenu')) hideMenu(); });
  window.addEventListener('blur', hideMenu);

  function termMenu(e, s) {
    const sel = s.term.getSelection();
    const others = ordered().filter((o) => o !== s && o.status === 'running');
    const items = [
      { label: 'Copy', kbd: 'Ctrl+C', disabled: !sel, run: () => copySelection(s) },
      { label: 'Paste', kbd: 'Ctrl+V', run: () => pasteInto(s) },
      { label: 'Select all', run: () => s.term.selectAll() },
      { label: 'Find…', kbd: 'Ctrl+Shift+F', run: () => openSearch(s) },
      { label: 'Clear scrollback', run: () => s.term.clear() },
    ];
    if (others.length) {
      items.push('sep', { header: sel ? 'Send selection to' : 'Send selection to (select text first)' });
      for (const o of others) {
        items.push({
          label: `${o.name} · ${machineById(o.machineId).name}`, glyph: o.presetId, disabled: !sel,
          run: () => { o.term.paste(sel); toast(`Sent ${sel.length} chars to ${o.name}`, 'ok'); },
        });
      }
    }
    items.push('sep');
    items.push(S.layout === 1
      ? { label: 'Open side by side', kbd: 'Ctrl+Shift+D', icon: I.split, run: () => splitWith(s) }
      : { label: 'Move to next pane', icon: I.split, run: () => moveToNextPane(s) });
    if (s.tmuxName) {
      items.push({ label: 'Detach (keeps running)', kbd: 'Ctrl+Shift+W', run: () => closeSession(s.id) });
      items.push({ label: 'Kill session', danger: true, run: () => closeSession(s.id, { kill: true }) });
    } else {
      items.push({ label: 'Close', kbd: 'Ctrl+Shift+W', danger: true, run: () => closeSession(s.id) });
    }
    showMenu(e.clientX, e.clientY, items);
  }

  // ---------------------------------------------------------------- palette
  let palItems = [], palSel = 0;

  function paletteSource() {
    const items = [];
    ordered().forEach((s, i) => {
      const m = machineById(s.machineId);
      items.push({ group: 'Sessions', glyph: s.presetId, c: s.color, label: s.name, sub: `${m.name}${s.title ? ' · ' + s.title : ''}`, kbd: i < 9 ? `Ctrl+${i + 1}` : '', run: () => show(s.id) });
    });
    const ms = [...S.cfg.machines].sort((a, b) => (a.type === b.type ? 0 : a.type === 'ssh' ? -1 : 1));
    for (const m of ms) {
      for (const p of presetsFor(m)) items.push({ group: 'Launch', glyph: p.id, c: p.color, label: `New ${p.name}`, sub: `on ${m.name}`, run: () => launch(m.id, p.id) });
    }
    for (const m of ms) {
      const open = new Set(ordered().map((s) => s.tmuxName));
      for (const d of ((S.mstate[m.id] || {}).detached || []).filter((x) => !open.has(x.name))) {
        const pid = presetFromTmux(d.name);
        items.push({ group: 'Detached', glyph: pid, c: presetById(pid).color, label: `Reattach ${d.name}`, sub: `on ${m.name}`, run: () => reattach(m.id, d.name) });
      }
    }
    const cmd = (label, run, kbd = '', icon = I.layout) => items.push({ group: 'Commands', icon, label, kbd, run });
    cmd('Layout: single', () => setLayout(1));
    cmd('Layout: side by side', () => setLayout(2));
    cmd('Layout: grid of four', () => setLayout(4));
    cmd('Broadcast prompt to sessions', openComposer, 'Ctrl+Shift+Enter', I.send);
    cmd('Settings', openSettings, 'Ctrl+,', I.gear);
    for (const m of S.cfg.machines.filter((x) => x.type === 'ssh')) {
      cmd(`Connect ${m.name}`, () => connectMachine(m.id), '', I.plug);
      cmd(`Set up SSH key for ${m.name}`, () => setupKey(m.id), '', I.key);
      cmd(`Install tools on ${m.name} (tmux, Claude, Gemini)`, () => bootstrap(m.id), '', I.box);
    }
    cmd('Reload window', () => api.reload(), 'Ctrl+Shift+R', I.refresh);
    cmd('Toggle developer tools', () => api.devtools(), 'F12', I.gear);
    return items;
  }

  function fuzzy(q, text) {
    const t = text.toLowerCase();
    let ti = 0, score = 0, last = -2;
    const hits = [];
    for (const ch of q.toLowerCase()) {
      if (ch === ' ') continue;
      const j = t.indexOf(ch, ti);
      if (j < 0) return null;
      score += j === last + 1 ? 6 : 1;
      if (j === 0 || ' -·@('.includes(t[j - 1])) score += 4;
      hits.push(j);
      last = j;
      ti = j + 1;
    }
    return { score: score - t.length * 0.02, hits: new Set(hits) };
  }
  function highlight(str, offset, hits) {
    let out = '';
    for (let i = 0; i < str.length; i++) out += hits.has(i + offset) ? `<mark>${esc(str[i])}</mark>` : esc(str[i]);
    return out;
  }

  function renderPalette() {
    const q = $('#palette-input').value.trim();
    const src = paletteSource();
    if (q) {
      palItems = src.map((it) => ({ it, f: fuzzy(q, `${it.label} ${it.sub || ''}`) })).filter((x) => x.f)
        .sort((a, b) => b.f.score - a.f.score).map((x) => ({ ...x.it, hits: x.f.hits }));
    } else palItems = src.map((it) => ({ ...it, hits: new Set() }));
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    let lastGroup = null;
    $('#palette-list').innerHTML = palItems.length ? palItems.map((it, i) => {
      const head = !q && it.group !== lastGroup ? `<div class="p-group">${esc(it.group)}</div>` : '';
      lastGroup = it.group;
      const ic = it.glyph ? glyph(it.glyph) : `<span class="glyph" style="--c:#7aa2f7">${it.icon}</span>`;
      const sub = it.sub ? `<small>${highlight(it.sub, it.label.length + 1, it.hits)}</small>` : '';
      return `${head}<div class="p-item ${i === palSel ? 'sel' : ''}" data-i="${i}" style="${it.c ? `--c:${it.c}` : ''}">${ic}`
        + `<span class="p-label"><b>${highlight(it.label, 0, it.hits)}</b>${sub}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</div>`;
    }).join('') : '<div class="p-empty">No matches</div>';
    $('#palette-list .p-item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function openPalette(prefix = '') {
    hideMenu();
    $('#palette').hidden = false;
    const input = $('#palette-input');
    input.value = prefix;
    palSel = 0;
    renderPalette();
    input.focus();
  }
  function closePalette() {
    $('#palette').hidden = true;
    focused()?.term.focus();
  }
  function runPalette(i) {
    const it = palItems[i];
    if (!it) return;
    $('#palette').hidden = true;
    it.run();
  }
  $('#palette-input').addEventListener('input', () => { palSel = 0; renderPalette(); });
  $('#palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { palSel = (palSel + 1) % Math.max(1, palItems.length); renderPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { palSel = (palSel - 1 + palItems.length) % Math.max(1, palItems.length); renderPalette(); e.preventDefault(); }
    else if (e.key === 'Enter') { runPalette(palSel); e.preventDefault(); }
    else if (e.key === 'Escape') { closePalette(); e.preventDefault(); }
  });
  $('#palette-list').addEventListener('click', (e) => { const el = e.target.closest('[data-i]'); if (el) runPalette(Number(el.dataset.i)); });
  $('#palette-list').addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-i]');
    if (el && Number(el.dataset.i) !== palSel) { palSel = Number(el.dataset.i); $('#palette-list .sel')?.classList.remove('sel'); el.classList.add('sel'); }
  });
  $('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });

  // ---------------------------------------------------------------- composer (broadcast)
  function renderTargets() {
    const live = ordered().filter((s) => s.status === 'running');
    for (const id of [...S.targets]) if (!live.some((s) => s.id === id)) S.targets.delete(id);
    const agents = live.filter(isAgent);
    $('#composer-targets').innerHTML = live.map((s) => `<button class="tchip ${S.targets.has(s.id) ? 'on' : ''}" style="--c:${s.color}" data-s="${s.id}">${glyph(s.presetId)}${esc(s.name)} <span style="color:var(--text-3)">${esc(machineById(s.machineId).name)}</span></button>`).join('')
      + (agents.length > 1 ? '<button class="tchip" data-all="agents" style="--c:#bb9af7">All agents</button>' : '')
      + (live.length ? '' : '<span class="hint">No running sessions yet</span>');
  }
  function openComposer() {
    const c = $('#composer');
    if (!S.targets.size && focused()) S.targets.add(focused().id);
    c.hidden = false;
    renderTargets();
    $('#composer-text').focus();
  }
  function closeComposer() {
    $('#composer').hidden = true;
    focused()?.term.focus();
  }
  const toggleComposer = () => ($('#composer').hidden ? openComposer() : closeComposer());
  function sendComposer() {
    const text = $('#composer-text').value;
    if (!text.trim()) return;
    const targets = [...S.targets].map((id) => S.sessions.get(id)).filter((s) => s && s.status === 'running');
    if (!targets.length) { toast('Pick at least one target session', 'warn'); return; }
    const submit = $('#composer-submit').checked;
    for (const s of targets) {
      s.term.paste(text);
      s.lastInput = now();
      if (submit) setTimeout(() => api.write(s.pid, '\r'), 150);
    }
    toast(`Sent to ${targets.map((s) => s.name).join(', ')}`, 'ok');
    $('#composer-text').value = '';
    closeComposer();
  }
  $('#composer-targets').addEventListener('click', (e) => {
    const all = e.target.closest('[data-all]');
    if (all) {
      const agents = ordered().filter((s) => s.status === 'running' && isAgent(s));
      const allOn = agents.every((s) => S.targets.has(s.id));
      agents.forEach((s) => (allOn ? S.targets.delete(s.id) : S.targets.add(s.id)));
    }
    const b = e.target.closest('[data-s]');
    if (b) S.targets.has(b.dataset.s) ? S.targets.delete(b.dataset.s) : S.targets.add(b.dataset.s);
    renderTargets();
  });
  $('#composer-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) { sendComposer(); e.preventDefault(); }
    if (e.key === 'Escape') { closeComposer(); e.preventDefault(); }
  });
  $('#composer-send').addEventListener('click', sendComposer);
  $('#composer-close').addEventListener('click', closeComposer);
  $('#btn-composer').addEventListener('click', toggleComposer);

  // ---------------------------------------------------------------- settings
  function machineForm(m, i) {
    const ssh = m.type === 'ssh';
    return `<div class="m-form" data-mi="${i}" style="--c:${m.color}">
      <div class="m-form-head"><div class="m-icon">${mIcon(m)}</div><b>${esc(m.name)}</b><span class="m-kind">${ssh ? 'ssh · linux' : 'this PC'}</span><span class="spacer"></span>
        ${ssh && S.draft.machines.filter((x) => x.type === 'ssh').length > 1 ? '<button class="btn sm ghost danger" data-sact="remove">Remove</button>' : ''}</div>
      <div class="grid">
        <div class="field ${ssh ? 'c3' : 'c4'}"><label>Name</label><input data-f="name" value="${esc(m.name)}"></div>
        <div class="field c1"><label>Accent</label><input type="color" data-f="color" value="${esc(m.color)}"></div>
        ${ssh ? `
        <div class="field c2"><label>User</label><input class="mono" data-f="user" value="${esc(m.user)}" placeholder="your linux user"></div>
        <div class="field c4"><label>Host / IP</label><input class="mono" data-f="host" value="${esc(m.host)}" placeholder="192.168.1.50 or linuxbox.local"></div>
        <div class="field c2"><label>Port</label><input class="mono" type="number" data-f="port" value="${esc(m.port || 22)}"></div>
        <div class="field c6"><label>Private key (optional; default tries ~/.ssh/id_ed25519, id_ecdsa, id_rsa, then ssh-agent)</label><input class="mono" data-f="keyPath" value="${esc(m.keyPath)}" placeholder="C:\\Users\\you\\.ssh\\id_ed25519"></div>` : ''}
      </div>
      ${ssh ? `<div class="m-form-actions">
        <button class="btn sm" data-sact="test">${I.plug} Test connection</button>
        <button class="btn sm" data-sact="key">${I.key} Set up SSH key</button>
        <button class="btn sm" data-sact="bootstrap">${I.box} Install tmux / Claude / Gemini</button>
      </div><div class="probe-out"></div>` : ''}
    </div>`;
  }

  function renderSettings() {
    const d = S.draft;
    const a = d.appearance;
    $('#settings-body').innerHTML = `
      <div class="section-title">Machines</div>
      ${d.machines.map(machineForm).join('')}
      <button class="btn sm ghost" data-sact="add">+ Add another SSH machine</button>
      <div class="section-title">Appearance &amp; behaviour</div>
      <div class="grid">
        <div class="field c1"><label>Font size</label><input type="number" min="9" max="28" data-a="fontSize" value="${a.fontSize}"></div>
        <div class="field c1"><label>Line height</label><input type="number" step="0.05" min="1" max="2" data-a="lineHeight" value="${a.lineHeight}"></div>
        <div class="field c4"><label>Font family</label><input class="mono" data-a="fontFamily" value="${esc(a.fontFamily)}"></div>
        <label class="check field c3" style="flex-direction:row"><input type="checkbox" data-a="copyOnSelect" ${a.copyOnSelect ? 'checked' : ''}><span>Copy on select</span></label>
        <label class="check field c3" style="flex-direction:row"><input type="checkbox" data-a="notifyWhenDone" ${a.notifyWhenDone ? 'checked' : ''}><span>Notify when a background agent finishes</span></label>
      </div>`;
  }

  function openSettings() {
    hideMenu();
    S.draft = JSON.parse(JSON.stringify(S.cfg));
    renderSettings();
    $('#settings').hidden = false;
  }
  function closeSettings() {
    $('#settings').hidden = true;
    focused()?.term.focus();
  }
  async function saveSettings() {
    S.cfg = await api.saveConfig(S.draft);
    S.draft = JSON.parse(JSON.stringify(S.cfg));
    applyAppearance();
    renderAll();
    for (const m of S.cfg.machines) {
      if (m.type === 'ssh' && m.host && (S.mstate[m.id] || {}).status !== 'online') connectMachine(m.id);
    }
  }

  $('#settings-body').addEventListener('input', (e) => {
    const t = e.target;
    const form = t.closest('[data-mi]');
    if (form && t.dataset.f) {
      const m = S.draft.machines[Number(form.dataset.mi)];
      m[t.dataset.f] = t.dataset.f === 'port' ? Number(t.value) || 22 : t.value.trim();
      if (t.dataset.f === 'color') form.style.setProperty('--c', t.value);
    }
    if (t.dataset.a) {
      const a = S.draft.appearance;
      a[t.dataset.a] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    }
  });
  $('#settings-body').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sact]');
    if (!b) return;
    const act = b.dataset.sact;
    if (act === 'add') {
      S.draft.machines.push({ id: `ssh-${Date.now().toString(36)}`, name: 'New machine', type: 'ssh', os: 'linux', host: '', port: 22, user: '', keyPath: '', color: '#7dcfff' });
      renderSettings();
      return;
    }
    const form = b.closest('[data-mi]');
    const idx = Number(form.dataset.mi);
    const m = S.draft.machines[idx];
    if (act === 'remove') { S.draft.machines.splice(idx, 1); renderSettings(); return; }
    if (!m.host) { toast('Enter the host / IP first', 'warn'); return; }
    await saveSettings();
    if (act === 'test') {
      const out = form.querySelector('.probe-out');
      out.innerHTML = '<span class="hint">Connecting…</span>';
      const ok = await api.connect(m.id);
      const r = ok.ok ? await api.probe(m.id) : ok;
      if (!r.ok) { out.innerHTML = `<span class="chip no">${esc(r.error)}</span>`; return; }
      out.innerHTML = `<span class="chip">connected · ${esc(r.hostname)}</span>`
        + Object.entries(r.tools).map(([k, v]) => `<span class="chip ${v ? '' : 'no'}">${v ? '✓' : '✗'} ${esc(k)}</span>`).join('');
      refreshMachine(m.id);
    } else if (act === 'key') {
      closeSettings();
      setupKey(m.id);
    } else if (act === 'bootstrap') {
      closeSettings();
      bootstrap(m.id);
    }
  });
  $('#settings-save').addEventListener('click', async () => { await saveSettings(); closeSettings(); toast('Settings saved', 'ok'); });
  $('#settings').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.id === 'settings') closeSettings(); });
  $('#settings-open-file').addEventListener('click', () => api.openConfig());
  $('#btn-settings').addEventListener('click', openSettings);

  // ---------------------------------------------------------------- toasts
  function toast(msg, kind = '', ms = 3800) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    if (kind === 'warn') el.style.setProperty('--c', '#e0af68');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
  }

  // ---------------------------------------------------------------- global wiring
  function onAppClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    e.stopPropagation();
    if (act === 'launch') launch(b.dataset.m, b.dataset.p);
    else if (act === 'show') show(b.dataset.s);
    else if (act === 'close') closeSession(b.dataset.s);
    else if (act === 'reattach') reattach(b.dataset.m, b.dataset.name);
    else if (act === 'kill') {
      if (confirm(`Kill tmux session "${b.dataset.name}"? Anything running in it will stop.`)) api.killTmux(b.dataset.m, b.dataset.name).then(() => refreshMachine(b.dataset.m));
    } else if (act === 'refresh') connectMachine(b.dataset.m);
    else if (act === 'mmenu') { const r = b.getBoundingClientRect(); machineMenu(r.left, r.bottom + 4, machineById(b.dataset.m)); }
    else if (act === 'settings') openSettings();
  }
  $('#machines').addEventListener('click', onAppClick);
  $('#welcome').addEventListener('click', onAppClick);
  $('#machines').addEventListener('contextmenu', (e) => {
    const item = e.target.closest('[data-act="show"]');
    const card = e.target.closest('[data-machine]');
    e.preventDefault();
    if (item) termMenu(e, S.sessions.get(item.dataset.s));
    else if (card) machineMenu(e.clientX, e.clientY, machineById(card.dataset.machine));
  });
  $('#tabs').addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]');
    if (x) { closeSession(x.dataset.close); return; }
    const t = e.target.closest('.tab');
    if (t) show(t.dataset.s);
  });
  $('#tabs').addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (t && e.button === 1) closeSession(t.dataset.s); });
  $('#tabs').addEventListener('contextmenu', (e) => { const t = e.target.closest('.tab'); if (t) { e.preventDefault(); termMenu(e, S.sessions.get(t.dataset.s)); } });
  $('#tabs').addEventListener('wheel', (e) => { $('#tabs').scrollLeft += e.deltaY; }, { passive: true });
  $('#layout-switch').addEventListener('click', (e) => { const b = e.target.closest('[data-layout]'); if (b) setLayout(Number(b.dataset.layout)); });
  $('#btn-palette').addEventListener('click', () => openPalette());

  api.onFocus((f) => {
    S.winFocused = f;
    if (f) { for (const id of S.panes) { const s = S.sessions.get(id); if (s) clearDone(s); } }
  });
  api.onNotifyClick((id) => show(id));
  new ResizeObserver(scheduleFit).observe($('#panes'));

  // ---------------------------------------------------------------- boot
  async function init() {
    api.hello();
    S.cfg = await api.getConfig();
    const parking = document.createElement('div');
    parking.id = 'parking';
    document.body.appendChild(parking);
    await Promise.all(['400 14px', '700 14px', 'italic 400 14px'].map((f) => document.fonts.load(`${f} "JetBrains Mono"`))).catch(() => {});

    S.mstate.local = { status: 'online' };
    api.probeLocal().then((t) => { S.mstate.local.tools = t; renderChrome(); if (!S.order.length) renderWelcome(); });
    renderAll();
    for (const m of S.cfg.machines) if (m.type === 'ssh' && m.host) connectMachine(m.id);
  }
  init();
})();
