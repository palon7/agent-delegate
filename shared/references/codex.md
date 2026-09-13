# Codex runtime

Use existing Codex authentication and configuration. The runner captures `CODEX_HOME` (default `~/.codex`) at launch and reuses it in the child. It does not copy credentials, force an authentication storage method, or require another login. A missing `auth.json` alone is not a blocker: authentication may use the OS keyring or environment variables.

If Codex is missing, report that it is not installed and stop. Do not install it or offer an installation workflow as part of delegation. Report unsupported CLI capabilities as blockers.

## Configuration and environment

The child loads normal configuration, rules, skills, MCP servers, Apps, and Hooks. It inherits the host environment, including XDG paths and provider credentials, with parent task/session IDs removed. Codex's configured shell environment policy still applies to its tools. Secret values are not saved in job metadata.

Use `--model` for an explicit model choice and `--codex-profile` for an explicit Codex configuration profile. These apply to new and resumed jobs. Do not infer task-local selections from configuration files or silently replace a requested provider/model.

The adapter overrides delegation-related settings: automatic approval review, read-only for review or workspace-write for implementation, no extra writable roots, no implicit temporary-directory write grants, and recursion prevention. Existing network settings and custom reviewer policy remain in effect.

Better Agent Handler is disabled through per-plugin CLI settings, covering the standard marketplace and other copies found in the local plugin cache. Other plugins remain available. Built-in subagent delegation is disabled, and the inherited depth marker rejects calls back into the handler. This prevents accidental recursion, not deliberate bypass by a process that changes its environment or the runner.

## State and resuming

`prepare.mjs --agent codex --new-job` creates private job storage, temporary files, logs, and a SQLite directory. It reports the existing `codex_home` and `authentication: "inherited"`. Do not create or authenticate a separate Codex home.

Authentication and Codex session files remain in the existing `CODEX_HOME`. This is not full filesystem isolation from other Codex sessions. Resume only a child session recorded by this handler for the same repository and Codex home, using a fresh job and its explicit session ID. Never use `--last` or the parent session; the launcher rejects the parent task ID.

When SRT is enabled, follow [SRT setup](srt-profile.md). Preparation lists shared Codex runtime paths requiring approved writes for token refresh, sessions, and runtime files. Existing MCP servers and tools must also fit the approved scope; report blocked access rather than disabling SRT.

The runner checks CLI capabilities without inference. Inspect CLI help separately only to diagnose a reported compatibility issue, using ordinary sandboxed execution. Do not run a paid prompt to check prerequisites.

Sources: [configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic), [per-plugin settings](https://learn.chatgpt.com/docs/config-file/config-reference).
