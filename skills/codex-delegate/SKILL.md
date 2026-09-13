---
name: codex-delegate
description: Delegate implementation, review, or another explicitly requested task to a separate Codex CLI session. Use when the user invokes codex-delegate or asks for Codex delegation; not for ordinary coding or questions about Codex.
---

# Codex Delegate

Use a separate Codex CLI session while the parent Codex coordinates and assesses the result. Updating this plugin or explaining the skill does not authorize a model run.

Read the shared [workflow](../../shared/references/workflow.md) and [runtime](../../shared/references/runtime.md). Follow the implementation or review route relevant to the request. Launch the shared runner with `--agent codex`.

- Use authentication and provider/model defaults prepared in the private `state_dir/codex` directory. Add `--model` only when explicitly requested. Never copy the parent's complete config, plugin installations, or sessions. Read [Codex runtime](../../shared/references/codex.md) for private configuration paths. If Codex is missing, report that it is not installed and stop. Do not install it. Prepare missing credentials with approval as described in the shared runtime.
- Codex defaults to **no SRT**, with its native sandbox and automatic approval reviewer. Review starts read-only; implementation starts workspace-write in the selected repository. Automatic review may approve eligible escalations, so native read-only is not an unconditional external filesystem boundary.
- The runner reads the saved configuration and applies SRT automatically. Change the preference **only when the user requests it**, never to recover from a failure. Only when preparation reports SRT enabled or the runner reports an SRT error, follow [SRT installation and profile setup](../../shared/references/srt-profile.md), obtaining permission before making setup changes.
- Reuse the private state and explicit saved session ID for corrections. Do not use `--last`, the parent session, or another repository's session. The runner disables plugin discovery and agent delegation, guards nesting in code, and omits the parent ID from the child's environment.
- After `started`, report the launch and **end the turn**. Do not poll, wait, schedule checks, or read intermediate output. The worker notifies the parent once.
