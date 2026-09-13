---
name: codex-delegate
description: Delegate implementation, review, or another explicitly requested task to a separate Codex CLI session. Use when the user invokes codex-delegate or asks for Codex delegation; not for ordinary coding or questions about Codex.
---

# Codex Delegate

Use a separate Codex CLI session while the parent Codex coordinates and assesses the result. Updating this plugin or explaining the skill does not authorize a model run.

Read the shared [workflow](../../shared/references/workflow.md) and [runtime](../../shared/references/runtime.md). Follow the implementation or review route relevant to the request. Launch the shared runner with `--agent codex`.

- Reuse existing authentication, configuration, and environment as described in [Codex runtime](../../shared/references/codex.md). Do not create a separate login. Pass explicit model/profile choices through `--model` and `--codex-profile`. If Codex is missing, report that it is not installed and stop; do not install it.
- Codex defaults to **no SRT**, with its native sandbox and automatic approval reviewer. Review starts read-only; implementation starts workspace-write in the selected repository. Automatic review may approve eligible escalations, so native read-only is not an unconditional external filesystem boundary.
- The runner reads the saved configuration and applies SRT automatically. Change the preference **only when the user requests it**, never to recover from a failure. Only when preparation reports SRT enabled or the runner reports an SRT error, follow [SRT installation and profile setup](../../shared/references/srt-profile.md), obtaining permission before making setup changes.
- Reuse handler state and the explicit saved child session ID for corrections. Do not use `--last`, the parent session, or another repository's session. The runner disables Better Agent Handler and further subagent delegation, retains its depth checks, and removes parent task/session IDs from the child's environment. Other plugins and tools keep their normal configuration.
- After `started`, report the launch and **end the turn**. Do not poll, wait, schedule checks, or read intermediate output. The worker notifies the parent once.
