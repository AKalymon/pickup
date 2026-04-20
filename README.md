# pickup

A fast, clean TUI for resuming AI coding sessions. Picks up where you left off in [Claude Code](https://claude.ai/code), [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli), and [OpenAI Codex](https://platform.openai.com/docs/guides/codex).

```
pickup — select a session to resume

▶ [ ] claude  2m ago
       dir: ~/Work/myapp
       you: fix the auth middleware
       ai:  I've updated the JWT validation logic…

  [ ] codex   1h ago
       dir: ~/Work/api
       you: refactor the database layer
       ai:  Here's the updated schema with…

enter resume  space select  ↑↓/jk navigate  q quit
```

## Install

```bash
npm install -g pickup-cli
```

## Usage

```bash
pickup              # open the interactive picker
pickup --json       # print sessions as JSON (no TUI)
pickup --tool claude          # filter by tool
pickup --tool codex --limit 20
pickup --refresh    # force re-index all session files
pickup --help
```

### Keys

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `Space` | Select/deselect session |
| `Enter` | Resume focused session (or all selected) |
| `q` / `Esc` | Quit |

Selecting a single session resumes it in the current terminal window. Selecting multiple sessions opens each in a new terminal window (supports kitty, alacritty, wezterm, gnome-terminal, xterm).

## Supported tools

| Tool | Session files |
|------|--------------|
| Claude Code | `~/.claude/projects/` |
| GitHub Copilot CLI | `~/.config/github-copilot/sessions/` |
| OpenAI Codex | `~/.codex/` |

## Options

| Flag | Description |
|------|-------------|
| `--json` | Output sessions as JSON instead of TUI |
| `--tool <name>` | Filter to `claude`, `codex`, or `copilot` |
| `--limit <n>` | Max sessions to show (default: 10) |
| `--refresh` | Force re-index all session files |
| `--version` | Print version |
| `--help` | Print help |

## macOS & Gatekeeper

If you see a "blocked by macOS security" error, run:

```bash
xattr -dr com.apple.quarantine "$(npm root -g)/@pickup-cli/darwin-arm64/bin/pickup"
# or for Intel Macs:
xattr -dr com.apple.quarantine "$(npm root -g)/@pickup-cli/darwin-x64/bin/pickup"
```

This is a known limitation of unsigned binaries distributed via npm. A permanent fix requires Apple notarization, which is on the roadmap.

## License

MIT
