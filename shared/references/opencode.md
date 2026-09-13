# OpenCode runtime

If OpenCode is missing, report that it is not installed and stop. Do not install it or offer an installation workflow as part of delegation.

OpenCode uses the existing login, XDG directories, environment credentials, and configuration, including `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, and `OPENCODE_CONFIG_CONTENT`. Preparation reports the configuration directory (`agent_config`); it creates only handler job and temporary directories. Do not copy credentials or request another login merely because an authentication file is missing. Report authentication failures without printing credentials.

Existing models, MCP servers, OpenCode plugins, sharing, and update settings are preserved. The runner adds permission denials for further delegation and, in review mode, editing tools. It does not grant blanket permission. With SRT, it uses `run --auto` to approve permission requests while preserving explicit denials; a CLI supporting that option is required. Without SRT, permission requests are rejected by non-interactive OpenCode. Report any resulting incomplete work.

SRT keeps configuration read-only and permits approved writes to shared authentication and runtime data. If plugin dependencies need installation inside a configuration directory, report the required setup rather than making that directory writable. The prompt is attached once with `--file`; stdin is ignored.

Follow [SRT setup](srt-profile.md) when `prepare.mjs` reports `sandbox: "srt"`, the runner reports an SRT error, or the user explicitly requests SRT setup.
