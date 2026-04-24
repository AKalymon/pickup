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

Pressing `Enter` with no checked sessions resumes the focused session in the current terminal. Checking one or more sessions with `Space` switches to the separate-terminal flow and opens each checked session in its own terminal session. Supported multi-launch terminals: Terminal.app, iTerm, kitty, alacritty, wezterm, gnome-terminal, xterm.

## Supported tools

| Tool | Session files |
|------|--------------|
| Claude Code | `~/.claude/sessions/` (`~/.claude/history.jsonl` is also read for recent prompts) |
| GitHub Copilot CLI | `~/.copilot/session-state/` |
| OpenAI Codex | `~/.codex/sessions/` |

## Options

| Flag | Description |
|------|-------------|
| `--json` | Output sessions as JSON instead of TUI |
| `--tool <name>` | Filter to `claude`, `codex`, or `copilot` |
| `--limit <n>` | Max sessions to show (default: 10) |
| `--refresh` | Force re-index all session files |
| `--version` | Print version |
| `--help` | Print help |

## macOS

Tagged releases now ship Developer ID-signed, notarized macOS binaries so npm installs pass Gatekeeper without manual re-signing.

Checked-session launches on macOS open separate Terminal.app or iTerm windows only when you explicitly select sessions with `Space`. Pressing `Enter` without any checked sessions still resumes the highlighted session in the current terminal.

If you still see a "blocked by macOS security" error on an older install, run:

```bash
xattr -dr com.apple.quarantine "$(npm root -g)/@pickup-cli/darwin-arm64/bin/pickup"
# or for Intel Macs:
xattr -dr com.apple.quarantine "$(npm root -g)/@pickup-cli/darwin-x64/bin/pickup"
```

Maintainers: the release workflow now requires `NPM_TOKEN` plus these GitHub Actions secrets for macOS signing/notarization: `APPLE_DEVELOPER_ID_APPLICATION_CERTIFICATE_P12`, `APPLE_DEVELOPER_ID_APPLICATION_CERTIFICATE_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER_ID`, and `APPLE_NOTARY_PRIVATE_KEY`.

## License

MIT
