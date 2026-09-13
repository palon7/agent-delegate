# OpenCode runtime

If OpenCode is missing, report that it is not installed and stop. Do not install it or offer an installation workflow as part of delegation.

Use the persistent state directory returned by `prepare.mjs --agent opencode --new-job`. Preparation creates these subdirectories; place approved configuration and credentials at the returned paths:

- `config/opencode/opencode.json` or `.jsonc`: the user's provider and default model configuration.
- `data/opencode/auth.json`: authentication for credential-based providers, with mode 0600.
- `tmp/`, `cache/`, and `state/`: private runtime data.

For environment-based credentials, pass only the required named variables through `--pass-env`. Values are not saved in job metadata. Do not print credentials or copy unrelated host configuration, plugins, sessions, or credentials. For missing credentials, follow the approval step in [runtime.md](runtime.md); do not start an interactive login.

No model is forced by the runner. It disables session sharing and further delegation, and denies editing tools in review mode. The prompt is attached once with `--file`; stdin is ignored.

Follow [SRT setup](srt-profile.md) when `prepare.mjs` reports `sandbox: "srt"`, the runner reports an SRT error, or the user explicitly requests SRT setup.
