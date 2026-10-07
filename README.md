# Nexus

One Windows terminal for Claude Code, the Antigravity CLI (`agy`) and shells, on this PC and on your Linux machines (e.g. DGX Sparks) over SSH.

## Install

**Installer:** download `Nexus-Setup-x.y.z.exe` from [Releases](https://github.com/mirrorsedgepro-stack/Spark-Orchestrator/releases). Installed copies update themselves from new releases. The installer is unsigned, so Windows SmartScreen asks once ("More info → Run anyway").

**From source:**

```
npm install && node node_modules/electron/install.js
Start-Nexus.cmd                          # or: npm start
powershell -File install-shortcut.ps1    # optional: Start menu + desktop shortcut
```

## First-time setup for a Linux machine

1. **Settings** (Ctrl+,): enter the machine's IP/hostname and user, then Save. Blank fields fall back to `~/.ssh/config`, like `ssh` does.
2. **Set up SSH key**: opens a tab that creates `~/.ssh/id_ed25519` (if missing) and installs it on the machine. You type the Linux password once.
3. **Install tmux / Claude / Antigravity**: runs `scripts/linux-bootstrap.sh` on the machine (may ask for your sudo password).
4. **Enable Claude alerts** (machine ⋯ menu): adds Claude Code hooks that ring Nexus when Claude finishes or needs input.
5. Launch Claude and Antigravity from the sidebar. Each asks you to sign in the first time.

The machine needs `sshd` running (`sudo apt install openssh-server`).

## Features

| | |
|---|---|
| **Workspaces** | Save the current arrangement (agents, machines, folders, split sizes) and reopen it in one click: Ctrl+Shift+O. |
| **Session restore** | On start, Nexus reopens last time's layout: remote sessions reattach to their tmux sessions, local ones restart in the same folder. |
| **Project folders** | Shift+click or right-click a launcher (or Ctrl+Shift+N) to pick a folder: recent folders, git projects and top-level folders on that machine, or type any path. |
| **Images & files** | Ctrl+V with a screenshot on the clipboard saves it as a PNG on the session's machine and pastes the path. Drop files onto a pane to do the same. Remote copies go to `~/.nexus/uploads` and are deleted after 7 days. |
| **Agent alerts** | Bells and OSC 9/777 notifications mark a session as waiting and raise a Windows notification. With "Enable Claude alerts" Claude rings exactly when it stops or needs you; other agents fall back to output-activity detection. |
| **GPU stats** | Each machine card shows GPU load, temperature and power (`nvidia-smi`), RAM and CPU load, refreshed every 5 s. |
| **Auto-reconnect** | If a machine drops off the network, sessions show "reconnecting…" and reattach on their own (backoff up to 30 s). Nothing is lost: tmux kept them running. |
| **Resizable splits** | Drag the divider between panes; double-click it to reset. |
| **Send last reply** | Ctrl+Shift+S (or the ➤ button on an agent pane) puts the agent's latest answer into the broadcast composer, aimed at your other agents, ready to edit and send. |
| **Broadcast** | Ctrl+Shift+Enter: write one prompt, send it to several sessions. |

## How it works

| | |
|---|---|
| Local sessions | ConPTY via `node-pty` (PowerShell, Git Bash, `claude`, `agy`) |
| Remote sessions | `ssh2`: one connection per machine, one channel per session, each in its own tmux session on a private tmux server (`tmux -L nexus`) configured to be invisible: no status bar, no mouse capture, native scrollback. |
| SSH trust | Host keys are checked against `~/.ssh/known_hosts` (including hashed entries and `UserKnownHostsFile` from `~/.ssh/config`); unknown hosts are pinned on first use. Keys come from Settings, `~/.ssh/config` `IdentityFile`s, the default key files, then the Windows OpenSSH agent. Passphrase-protected keys prompt once per run. |
| Agent exits | You drop into your normal shell in the same pane. |
| Config | `%APPDATA%\Nexus\config.json` (machines, presets, workspaces, appearance, pinned host keys) |

To use password-protected keys without a prompt each run, start the Windows OpenSSH agent (admin PowerShell: `Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent`, then `ssh-add`).

## Keys

| Keys | Action |
|---|---|
| Ctrl+Shift+P | Command palette: switch, launch on any machine, reattach, layouts |
| Ctrl+Shift+N · Ctrl+Shift+O | Launch in a folder · workspaces |
| Ctrl+1…9 · Ctrl+Tab · Ctrl+` | Jump to tab · next/prev · last used |
| Ctrl+Shift+L · Ctrl+Shift+D | Cycle layout (1 / 2 / 4 panes) · open current side by side |
| Ctrl+Alt+Arrows | Move focus between panes |
| Ctrl+Shift+Enter · Ctrl+Shift+S | Broadcast a prompt · send the focused agent's last reply |
| Ctrl+C / Ctrl+V | Copy if text is selected (otherwise interrupt) / paste text or a screenshot |
| Shift+drag | Select text even when the app uses the mouse (Claude Code's full-screen UI). Selecting inside Claude itself also copies to the Windows clipboard. |
| Shift+Enter | Newline in Claude/Antigravity without submitting |
| Ctrl+Shift+F | Find in scrollback |
| Ctrl+Shift+W | Close (local) / detach (remote; it keeps running) |
| Ctrl+= / Ctrl+- / Ctrl+0 | Font size |

Right-click any terminal → **Send selection to …** to pipe output from one agent into another.

## Adding presets

Edit `presets` in the config file, e.g. a project-specific command (`icon` picks a logo: claude, antigravity, git, terminal, powershell):

```json
{ "id": "claude-proj", "name": "Claude · api", "color": "#E08A62", "icon": "claude", "cmd": { "linux": "cd ~/code/api && claude" } }
```

## Development

```
npm test        # unit tests (ssh_config, known_hosts, remote commands, alert hooks, config migration)
npm run dist    # build dist/Nexus-Setup-<version>.exe
```

CI runs the tests on every push. To publish a release, bump `version` in `package.json`, then push a matching tag (`git tag v1.1.0 && git push --tags`); the Release workflow builds the installer and attaches it to a GitHub release, and installed copies update from it.

## Credits

Logos in `assets/icons/`, found via [dashboardicons.com](https://dashboardicons.com):

- Claude, Antigravity, Git, Windows, Linux (Tux), NVIDIA: [selfh.st/icons](https://selfh.st/icons/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- PowerShell, Terminal: [homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)

All product names and logos are trademarks of their respective owners.
