# Better Agent Handler

A Codex plugin for delegating work to OpenCode or another Codex session. Codex resumes when the work finishes instead of repeatedly checking progress and spending tokens while it waits.

## Requirements

- Linux, macOS, or WSL2
- Node.js 22+
- Git
- Codex CLI

### Optional

- OpenCode for `$opencode`
- With SRT on Linux
  - bubblewrap
  - socat
  - ripgrep

## Install

```bash
codex plugin marketplace add palon7/better-agent-handler
codex plugin add better-agent-handler@better-agent-handler
```

Start a new Codex task after installation.

## Usage

Use `$opencode` or `$codex-delegate` for implementation and code review:

```text
$opencode Review this branch against develop.
$codex-delegate Implement filtering in the search endpoint.
```

If you don't specify a review scope, the skill checks unstaged and untracked files first, then staged changes, then changes against the base branch. It reviews the first scope with changes.

## Sandbox

OpenCode uses SRT (Anthropic Sandbox Runtime) by default. Codex uses its own sandbox and automatic approval review.

You can enable or disable SRT for each agent. SRT must be installed when enabled; disabling it for OpenCode removes shell and network isolation.

Ask Codex to change the setting (for example, “Disable SRT for OpenCode”), or edit `~/.config/better-agent-handler/config.json`. If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/better-agent-handler/config.json` instead. Codex changes this preference only when you request it.

The following configuration matches the defaults used when no file exists. Set an agent's `sandbox` to `"srt"` to enable SRT or `"none"` to disable it:

```json
{
  "version": 1,
  "agents": {
    "opencode": { "sandbox": "srt" },
    "codex": { "sandbox": "none" }
  }
}
```

When SRT is enabled, Codex asks permission to install any missing dependencies and configure access to files and network destinations. Runs without SRT need no SRT setup. Codex also asks before copying credentials needed by the delegated agent.

## Development

Install dependencies with `npm ci`.

| Command                | Purpose             |
| ---------------------- | ------------------- |
| `npm run build`        | Compile TypeScript  |
| `npm run typecheck`    | Check types         |
| `npm test`             | Build and run tests |
| `npm run format`       | Format code         |
| `npm run format:check` | Check formatting    |

Include the generated files in `shared/scripts/` when changing TypeScript sources.
