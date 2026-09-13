---
name: opencode
description: Delegate implementation, review, or another requested task to OpenCode. Use when the user invokes this skill or asks to delegate to OpenCode; not for ordinary coding or questions about OpenCode.
---

# OpenCode for Codex

Use OpenCode while the parent Codex coordinates and assesses the result. Updating this plugin or explaining the skill does not authorize a model run.

Read the shared [workflow](../../shared/references/workflow.md) and [runtime](../../shared/references/runtime.md). Follow the implementation or review route relevant to the request. Launch the shared runner with `--agent opencode`.

- Use the user's OpenCode provider/authentication and defaults in the prepared private state. Add `--model <provider/model>` only for an explicit model choice; never silently substitute a provider/model.
- Follow preparation and authentication in [OpenCode runtime](../../shared/references/opencode.md). Follow [SRT setup](../../shared/references/srt-profile.md) when `prepare.mjs` reports `sandbox: "srt"`, the runner reports an SRT error, or the user explicitly requests SRT setup. Change the preference only when the user requests it. Missing OpenCode is a blocker; do not install it.
- Without SRT, OpenCode permissions deny editing tools in review mode, but shell commands do not have filesystem/network isolation. Do not claim an OS-enforced read-only review in that configuration.
- After `started`, report the launch and **end the turn**. Do not poll, wait, schedule checks, or read intermediate output. The worker notifies the parent once.
