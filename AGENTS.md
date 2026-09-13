# Agent Delegate

## Purpose

This Codex plugin delegates work to coding agents without repeated progress polling. The parent Codex ends its turn after launch, and a detached worker sends a single completion notification to resume the original task.

Use the `skill-creator` and `plugin-creator` skills when relevant to skill or plugin development.

## Implementation

- Avoid unnecessary overengineering. Implement what the current requirements need; do not add speculative abstractions, configuration options, dependencies, or recovery mechanisms.
- Share logic where it reduces actual duplication. Keep agent-specific behavior in the corresponding adapter.
- Write readable code. Separate logical steps with blank lines, use clear names, and split functions around cohesive responsibilities. Avoid both long, tangled functions and excessive fragmentation.
- Prefer the built-in editing tool (`apply_patch`) for file edits. Do not use shell commands, Node.js, or Python to write files, except for bulk replacements when appropriate. Build and formatting tools may regenerate their outputs.
- Keep changes focused on the requested scope. Run checks appropriate to the change, and regenerate bundled JavaScript when TypeScript sources change.

## Documentation

- Write all skill instructions, descriptions, references, prompts, metadata, and repository documentation in English.
- Keep documentation concise, accurate, and consistent with the implemented behavior.
- Keep the README focused on information useful to users and developers: purpose, requirements, installation, usage, configuration, and essential development commands.
- Do not turn the README into an inventory of internal files, functions, or implementation details. Include architectural details only when they help readers use, maintain, or extend the plugin.
