# Runtime

Requires Node.js 22+, Git, the selected agent CLI, and `codex queue`. If OpenCode or Codex is missing, report that it is not installed and stop; do not install it. Use Linux, macOS, or WSL2. Native Windows jobs are not supported by this runner.

## Prepare

Resolve the repository root with `git -C <selected-path> rev-parse --show-toplevel`. `plugin_root` is two levels above the selected skill directory. Before SRT setup, check the selected agent and parent Codex executables only if their availability is not already established in this task. Leave capability and SRT startup checks to the runner.

Use ordinary sandboxed execution (`sandbox_permissions: "use_default"`) for executable lookups, version/help commands, configuration reads, and other read-only preparation. Do not request escalation merely because the later job may need it. Reuse checks from this task unless the environment changes or a failure calls their result into question.

```bash
node "$plugin_root/shared/scripts/prepare.mjs" --cwd "$repository" --agent opencode --new-job
```

Use `--agent codex` for Codex. The command creates private directories and returns `job_dir`, persistent `state_dir`, `auth_file`, the SRT `profile`, and the resolved `sandbox`. It also returns OpenCode's `agent_config` or the existing `codex_home`. Omit `--new-job` to inspect paths without creating directories. Keep the returned paths; do not invent state locations or interpret the configuration yourself.

`auth_file_present` reports file presence only. When SRT is enabled, `srt` contains its installation paths, `profile_present`, any version error and installation command, and Linux `required_tools`. That list names requirements; it does not check whether they are installed.

- If `sandbox` is `none`, skip all SRT detection, installation, dependencies, and profile setup. Codex still uses its native sandbox and automatic approval reviewer.
- If `sandbox` is `srt`, follow [SRT setup](srt-profile.md). The `srt` object gives the pinned installation path and any installation command. Obtain approval for missing dependencies and the repository profile before launch. Never disable SRT to work around a failure.
- Codex inherits existing authentication and configuration; follow [Codex runtime](codex.md). Do not request another login or scan for API keys just because `auth_file_present` is false. For OpenCode, prepare credentials and defaults using [OpenCode runtime](opencode.md), asking before copying credentials and never printing their contents.

State and profiles are reused for the same repository and agent. Check for an existing writer before another implementation. Do not launch a duplicate to discover an earlier job's outcome.

Write a self-contained `request.md` in `job_dir` with an editing tool. For implementation, save the baseline before launch and include its path in the request. Ask for changes or findings, checks and results, and any blocker in the final response. Intermediate tool output is discarded.

## Launch

Run with `exec_command` under the task authorization. Escalate only the operation that requires it: for example, creating private state outside writable roots or launching a worker where the host sandbox prevents SRT initialization or detached execution. Base escalation on an observed restriction or an established host requirement, and state that reason. Keep prerequisite checks out of the escalated command. Do not relaunch a job with an unknown outcome to test whether escalation helps.

```bash
node "$plugin_root/shared/scripts/agent_job.mjs" \
  --agent opencode \
  --cwd "$repository" \
  --job-dir "$job_dir" \
  --mode implement \
  --thread "$CODEX_THREAD_ID"
```

The runner uses the same state, profile, and SRT paths as `prepare.mjs`. For an explicitly approved alternate installation, pass `--srt <absolute-path>`; Node entry points are supported. `--state-dir` and `--profile` accept existing custom paths. `--profile` and `--srt` are ignored when SRT is disabled. Agent executables use PATH or explicit `--executable` and `--codex` paths.

Use `--mode review` for review permissions. For a follow-up, create a new job and pass `--session <saved-session-id>` with the same agent, repository, state directory, and Codex home. Never use global `--continue` or `--last`. Pass explicit model choices with `--model` and Codex configuration profiles with `--codex-profile` (distinct from SRT's `--profile`). Task-local selections are not inferred from shared configuration. OpenCode uses `--pass-env NAME` for required environment credentials; Codex inherits its environment. Values are not saved in job metadata. Parent IDs and isolation variables are reserved.

With SRT enabled, the runner checks the version and runs a small Node probe under the job profile before detaching. Dependency, initialization, and profile failures therefore return before agent launch. Fix the reported cause with approval for setup changes, then create a new job. A directory containing `job.json` cannot be reused, including after a failed preflight. A successful probe does not verify provider access or agent authentication.

On `started`, report the launch and returned `sandbox`, then **end the turn**. The worker sends one completion notification to the parent task. Do not poll, schedule checks, or inspect intermediate output.

## Saved preference

`prepare.mjs` and `agent_job.mjs` read `$XDG_CONFIG_HOME/better-agent-handler/config.json`, falling back to `~/.config/better-agent-handler/config.json`. Missing entries mean OpenCode=`srt`, Codex=`none`; reading them does not write a file. Each job records its resolved value. Follow-ups read the current saved setting; if it differs from the previous job, use it and report the change rather than rewriting it.

Only change the preference when the user requests it:

```bash
node "$plugin_root/shared/scripts/config.mjs" --agent opencode --sandbox none
```

Run without arguments for a requested settings check. Invalid settings stop execution. OpenCode without SRT has tool permissions but no OS filesystem or network isolation from this plugin.

## Review scope commands

Use `git -C "$repository"` for each command. An explicit target takes precedence over these defaults.

| Scope | Selection and material |
| --- | --- |
| Unstaged | `git diff --no-ext-diff --no-textconv` and `git ls-files --others --exclude-standard` |
| Staged | `git diff --cached --no-ext-diff --no-textconv` |
| Branch | Resolve the base, then `git diff --no-ext-diff --no-textconv <base>...HEAD` |

For scripts, use `-z` when enumerating paths. `git diff` omits untracked files: list them explicitly in the review request so the reviewer can read them. A staged review must inspect the index versions, since working files can contain separate unstaged edits. A branch review uses committed versions, not unrelated working-file edits. Include this distinction in the request. Do not silently combine scopes.

## Completion and failures

Assess only `report.md` and the relevant diff. Status metadata (`state.json`, or `job.json`/`request.md` to recover paths and intent) is operational context, not additional model evidence. Never export or read the model transcript or tool history as part of completion review. `completed` means a normal process exit, final text, an adapter-specific terminal completion event, and no error events; it does not certify the work or tests.

If the worker fails, report the status/error and any final response. Do not treat partial work as success or retry an unknown outcome. For an explicitly requested launcher/notification diagnosis, inspect only the necessary local error logs; do not rerun the model. Terminal state is saved before notification; queue acceptance is not proof that the notification was displayed, and uncertain delivery is not retried automatically.

Retain request/report/status and the session ID for follow-ups. Remove a completed job's snapshot after its diff has been reviewed and no further comparison is needed; do not automatically delete agent session state. See [snapshot.md](snapshot.md) for storage limits.

SRT network isolation can make host databases, browsers, and existing development servers unavailable. Report the specific verification blocker. Never remove isolation or run unsandboxed to work around it.
