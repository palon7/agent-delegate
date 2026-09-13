# Codex runtime

Requirements: a Codex CLI with `exec`, `exec resume`, JSONL, `--output-last-message`, automatic approval review, and `features.skip_host_skill_discovery`. The launcher checks CLI capabilities without inference. The parent CLI must support `codex queue`. Do not fall back to bypassing approvals or to polling when a capability is missing.

If Codex is missing, report that it is not installed and stop. Do not install it or offer an installation workflow as part of delegation. Report unsupported CLI capabilities as blockers.

Use the persistent state directory returned by `prepare.mjs --agent codex --new-job`. Preparation creates the child directories but does not copy host credentials or preferences. Codex uses:

- `CODEX_HOME=<state_dir>/codex`: private configuration, authentication, and sessions.
- `HOME=<state_dir>/home` and private XDG/tmp directories.
- The selected repository as its working directory.

Keep provider/model defaults in the private `config.toml`. Pass required environment credentials by name through `--pass-env`. For missing credentials, follow [runtime.md](runtime.md).

Do not copy a ChatGPT login's `auth.json` into multiple Codex homes. Codex rotates refresh tokens and handles already-used tokens as an authentication failure; independently refreshed copies can become stale. Use an independently authenticated private home or the user's chosen API credentials. If neither is available, report the missing authentication and the private `CODEX_HOME` path so the user can authenticate it. Do not silently switch billing methods, share the parent's entire home, or add token synchronization. See [Codex refresh handling](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs).

Keep the private config free of plugins, MCP servers, hooks, extra writable roots, and additional profiles. Do not copy the entire host configuration. If no model was specified, preserve the private defaults or let Codex use its default. Session/parent IDs, home/config overrides, and the recursion marker are reserved environment variables.

The adapter overrides native sandbox and reviewer settings on every run, including resume: `approval_policy="on-request"`, `approvals_reviewer="auto_review"`, and read-only (review) or workspace-write (implementation). It clears extra writable roots, disables implicit tmp writes and network access in workspace-write, and disables plugins, hooks, apps, host skill discovery, and task subagents. The automatic approval reviewer remains enabled. These settings never enable dangerous bypass flags. Review instructions and reviewer policy deny repository writes; an SRT profile, when enabled, adds an external boundary.

Project instructions remain relevant. Recursion protection rejects child calls to the launcher/config CLI through an inherited depth marker and rejects nonzero job depth in the worker. This is protection against accidental delegation, not a security boundary against a process deliberately removing its environment or modifying the runner.

The runner checks CLI capabilities without inference. Inspect CLI help separately only to diagnose a reported compatibility issue, using ordinary sandboxed execution. Do not run a paid prompt to check prerequisites.

Sources: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). Capability flags are also checked against the installed CLI; older versions may not support this adapter.
