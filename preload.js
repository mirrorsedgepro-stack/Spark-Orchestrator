const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (fn) => {
  const h = (_e, ...a) => fn(...a);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('nexus', {
  hello: () => ipcRenderer.send('app:hello'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  openConfig: () => ipcRenderer.invoke('app:open-config'),
  devtools: () => ipcRenderer.send('app:devtools'),
  reload: () => ipcRenderer.send('app:reload'),
  notify: (n) => ipcRenderer.send('app:notify', n),
  flash: () => ipcRenderer.send('app:flash'),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (t) => ipcRenderer.send('clipboard:write', t),

  probeLocal: () => ipcRenderer.invoke('local:probe'),
  connect: (id) => ipcRenderer.invoke('machine:connect', id),
  disconnect: (id) => ipcRenderer.invoke('machine:disconnect', id),
  probe: (id) => ipcRenderer.invoke('machine:probe', id),
  killTmux: (id, name) => ipcRenderer.invoke('machine:kill-tmux', id, name),
  uploadBootstrap: (id) => ipcRenderer.invoke('machine:upload-bootstrap', id),

  create: (spec) => ipcRenderer.invoke('session:create', spec),
  write: (id, data) => ipcRenderer.send('session:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', id, cols, rows),
  close: (id, opts) => ipcRenderer.invoke('session:close', id, opts),

  onData: on('session:data'),
  onExit: on('session:exit'),
  onMachineStatus: on('machine:status'),
  onNotifyClick: on('notify:click'),
  onFocus: on('app:focus'),
});
