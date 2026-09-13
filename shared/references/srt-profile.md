# SRT setup

Use only when `prepare.mjs` reports `sandbox: "srt"`, a start attempt reports an SRT error, or the user explicitly requests SRT setup. For `sandbox: "none"`, do not check or install SRT or its dependencies. Never change the saved sandbox preference as a setup workaround.

## First use

1. Inspect the preparation output. The supported version is **0.0.76**. Its dedicated prefix is `<handler-data>/tools/srt/0.0.76`, where handler data is `$XDG_DATA_HOME/delegate` (default `~/.local/share/delegate`) on Linux, or `~/Library/Application Support/delegate` on macOS.
2. Check the listed `required_tools` with `command -v` or an equivalent lookup; preparation does not check their availability. If installation is needed, propose the exact `install_argv` command and missing system packages. Linux requires **bubblewrap, socat, and ripgrep** (`bwrap`, `socat`, `rg` on PATH). Version 0.0.76 requires no extra packages on macOS. Ask for permission before installing. The npm command has this form, with the returned absolute prefix:

   ```bash
   npm install --prefix "$srt_prefix" --save-exact @anthropic-ai/sandbox-runtime@0.0.76
   ```

   Do not install globally or substitute an unpinned release. The runner defaults to the returned `srt.cli` Node entry point; pass that path with `--srt` if specifying it explicitly. It checks package metadata because this release's CLI version banner is unreliable.
3. During initial setup, create the returned `state_dir` with `mkdir -p -m 700` under setup authorization (escalate this setup operation if it is outside writable roots), then resolve its real path. Routine `prepare --new-job` intentionally does not create it. Prepare the concrete profile below at the returned `profile` path and request approval for its filesystem and network access. This request may be combined with installation approval. Reuse an approved profile on later runs; explain additional access before changing it.
   Include `srt.runtime_write_paths` from preparation in the approved read/write scope. These cover shared authentication, sessions, and runtime files. Use those exact read entries, with separate entries for configuration, skills, and plugin directories as needed. Do not add an enclosing home or XDG directory to `allowRead`: SRT's Linux read-only mount can cover the narrower writable paths. The launcher rejects this overlap.
   For OpenCode, allow reading the existing `srt.config_read_paths`. The runner protects these paths from writes, including in implementation mode. Additional files referenced by configuration or plugins need their own approved access. If plugin dependencies require writing a configuration directory, arrange that setup separately with approval; do not loosen the job profile.
4. Install and write only what was approved, validate without model inference, then continue the authorized task. Report a declined setup request as a blocker.

This runner supports SRT only on Linux, macOS, and WSL2. Native Windows jobs default to no SRT for both agents. Although SRT 0.0.76 has upstream Windows alpha support, this integration does not support it; do not install native SRT for a handler job. Explicit saved SRT settings fail on Windows and must not be silently changed.

See the [upstream platform requirements](https://github.com/anthropics/sandbox-runtime/tree/v0.0.76#platform-specific-dependencies); the release's dependency checker restricts ripgrep to Linux.

## Filesystem and network profile

Create the profile with an editing tool at the persistent `profile` path returned by preparation. Resolve symlinks first. This Linux/macOS-oriented template uses placeholders that must be replaced with actual absolute paths and provider hosts; do not pass placeholders literally to SRT:

```json
{
  "network": {
    "allowedDomains": ["<provider-api-host>", "models.dev"],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["/home", "/Users", "/root", "/tmp", "/private/tmp", "/var/tmp", "/run", "/mnt", "/media"],
    "allowRead": [
      "<repository-root>",
      "<git-dir>",
      "<git-common-dir>",
      "<state-directory>",
      "<required-tool-installation-directories>"
    ],
    "allowWrite": ["<repository-root>", "<state-directory>"],
    "denyWrite": ["<repository-root>/.git", "<git-dir>", "<git-common-dir>"]
  }
}
```

Resolve Git metadata with `git -C <repository> rev-parse --path-format=absolute --git-dir` and `--git-common-dir`. Do not grant another checkout's source directory just because its Git metadata is needed. Add nonstandard workspace/home locations to the denied regions as appropriate for this host, then allow only the selected paths. The template is not a claim that every host stores private files under these default roots.

Tool read access must cover resolved Node/agent/SRT installations and SRT's runtime helpers, not just executable symlinks. Tools stay read-only. Preserve default process and Unix-socket restrictions. Network allowlists should cover the configured provider, model metadata, and task-required package registries; do not inherit a provider-specific list from an unrelated setup. Explain additional required destinations before changing the approved scope.

For SRT, allow only its `tools/srt/<version>` installation, not the whole handler data directory, which also contains other repositories' credentials.

The launcher adds read/write access to the private temporary job directory and narrows other writes to handler state plus repository for implementation, handler state only for review, and explicitly approved shared agent runtime paths. Include this temporary job access in initial setup approval; it does not grant access to all of `/tmp`. Network scope is unchanged. Git metadata, OpenCode configuration, and the approved source profile stay protected. Review additionally denies writing the repository even if an ancestor was previously writable.

## Validation

The runner performs a no-model startup probe with the job profile before detaching. For a new profile, also test its filesystem boundaries using the adapter's environment and working directory. Confirm SRT can launch the installed agent's `--version` and read the selected repository. Verify that a write to a disposable file in the source is blocked in review mode, while runtime writes succeed. For implementation, verify writes only with disposable fixtures in an isolated test repository. Check host-side effects; a hidden path can be a private tmpfs rather than the original host path.

Use the runner's SRT command construction for these checks: SRT needs a short private `TMPDIR` for Unix sockets, while the wrapped agent receives `state_dir/tmp`. Do not pass a long state path as SRT's own `TMPDIR`.

Do not run a paid prompt to validate a profile without an explicit request. Record the tested OS/tools, actual profile/state paths, and any limitations outside the published skill (for example in a private installation note). Existing sessions and historical local validation records are not distribution assets.

Sources: [SRT filesystem rules](https://github.com/anthropics/sandbox-runtime), [OpenCode configuration](https://opencode.ai/docs/config/), [OpenCode permissions](https://opencode.ai/docs/permissions/).
