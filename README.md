# Nexus

One Windows terminal for Claude Code, the Antigravity CLI (`agy`) and shells, on this PC and on your Linux machines over SSH.

## Start

```
Start-Nexus.cmd                 # or: npm start
powershell -File install-shortcut.ps1   # optional: Start menu + desktop shortcut
```

## First-time setup for the Linux box

1. **Settings** (Ctrl+,): enter the Linux box's IP/hostname and user, then Save.
2. **Set up SSH key**: opens a tab here that creates `~/.ssh/id_ed25519` (if missing) and installs it on the box. You type the Linux password once.
3. **Install tmux / Claude / Antigravity**: runs `scripts/linux-bootstrap.sh` on the box in a tab (it may ask for your sudo password to install tmux).
4. Launch Claude and Antigravity from the sidebar. Each asks you to sign in the first time.

The Linux box needs `sshd` running (`sudo apt install openssh-server`).

## How it works

| | |
|---|---|
| Local sessions | ConPTY via `node-pty` (PowerShell, Git Bash, `claude`, `agy`) |
| Remote sessions | `ssh2`: one connection per machine, one channel per session |
| Persistence | Each remote session lives in its own tmux session on a private tmux server (`tmux -L nexus`), so closing Nexus or losing Wi-Fi doesn't kill your agents. On the next start Nexus reattaches them automatically. tmux is configured to be invisible: no status bar, no mouse capture, native scrollback. |
| Agent exits | You drop into your normal shell in the same pane. |
| Config | `%APPDATA%\Nexus\config.json` (machines, presets, appearance, pinned host keys) |

## Keys

| Keys | Action |
|---|---|
| Ctrl+Shift+P | Command palette: switch, launch on any machine, reattach, layouts |
| Ctrl+1…9 · Ctrl+Tab · Ctrl+` | Jump to tab · next/prev · last used |
| Ctrl+Shift+L · Ctrl+Shift+D | Cycle layout (1 / 2 / 4 panes) · open current side by side |
| Ctrl+Alt+Arrows | Move focus between panes |
| Ctrl+Shift+Enter | Broadcast: send one prompt to several sessions (e.g. Claude *and* Antigravity) |
| Ctrl+C / Ctrl+V | Copy if text is selected (otherwise interrupt) / paste |
| Shift+Enter | Newline in Claude/Antigravity without submitting |
| Ctrl+Shift+F | Find in scrollback |
| Ctrl+Shift+W | Close (local) / detach (remote; it keeps running) |
| Ctrl+= / Ctrl+- / Ctrl+0 | Font size |

Right-click any terminal → **Send selection to …** to pipe output from one agent into another.

Spinners in tabs and the sidebar show which sessions are producing output. A glowing dot means a
background agent finished; you also get a Windows notification if the window isn't focused.

## Adding presets

Edit `presets` in the config file, e.g. a project-specific command:

```json
{ "id": "claude-proj", "name": "Claude · api", "color": "#E08A62", "cmd": { "linux": "cd ~/code/api && claude" } }
```

## Credits

Logos in `assets/icons/`, found via [dashboardicons.com](https://dashboardicons.com):

- Claude, Antigravity, Git, Windows, Linux (Tux), NVIDIA: [selfh.st/icons](https://selfh.st/icons/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- PowerShell, Terminal: [homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)

All product names and logos are trademarks of their respective owners.
