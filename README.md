# Agent Delegate

A Codex plugin for delegating work to OpenCode or another Codex session. Codex resumes when the work finishes instead of repeatedly checking progress and spending tokens while it waits.

## Requirements

- Linux, macOS, or WSL2
- Node.js 22+
- Git
- Codex CLI

### Optional

- OpenCode for `$delegate:opencode`
- With SRT on Linux
  - bubblewrap
  - socat
  - ripgrep

## Install

```bash
codex plugin marketplace add palon7/agent-delegate
codex plugin add delegate@agent-delegate
```

Start a new Codex task after installation.

## Usage

Use `$delegate:opencode` or `$delegate:codex` for implementation and code review:

```text
$delegate:opencode Review this branch against develop.
$delegate:codex Implement filtering in the search endpoint.
```

If you don't specify a review scope, the skill checks unstaged and untracked files first, then staged changes, then changes against the base branch. It reviews the first scope with changes.

## Sandbox

OpenCode uses SRT (Anthropic Sandbox Runtime) by default. Codex uses its own sandbox and automatic approval review.

You can enable or disable SRT for each agent. SRT must be installed when enabled; disabling it for OpenCode removes shell and network isolation.

Ask Codex to change the setting (for example, “Disable SRT for OpenCode”), or edit `~/.config/delegate/config.json`. If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/delegate/config.json` instead. Codex changes this preference only when you request it.

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

Both agents use your existing login and settings. OpenCode automatically approves permission requests inside SRT while respecting explicit denials; this requires `opencode run --auto` support.

When SRT is enabled, Codex asks permission to install any missing dependencies and configure access to files and network destinations. Runs without SRT need no SRT setup.

Job requests, baselines, reports, and status live in private directories under `/tmp`, independent of `$TMPDIR`. Keep them until the parent finishes reviewing the result, then remove them. Settings and agent session/runtime state remain persistent. Routine preparation needs only temporary writes; when host permissions require it, the launch command requests approval for agent execution, runtime writes, and completion notification together.

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
