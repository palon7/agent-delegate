#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { isAgent, sandboxFor } from "./lib/config.mjs";
import {
  repositoryPaths,
  srtPaths,
  SRT_VERSION,
  codexRuntimeWrites,
} from "./lib/paths.mjs";
import { assertNotDelegated } from "./lib/job.mjs";
import { adapterFor } from "./lib/adapters/index.mjs";
import { checkSrtVersion } from "./lib/srt.mjs";

process.umask(0o077);

try {
  const { values } = parseArgs({
    options: {
      cwd: { type: "string" },
      agent: { type: "string" },
      "new-job": { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    console.log("prepare.mjs --cwd PATH --agent opencode|codex [--new-job]");
  } else {
    assertNotDelegated();
    if (!values.cwd || !isAgent(values.agent))
      throw new Error("--cwd and --agent opencode|codex are required");
    if (process.platform === "win32")
      throw new Error(
        "Native Windows execution is not supported by this runner. Use WSL2; do not install native SRT for a handler job.",
      );

    const paths = repositoryPaths(values.cwd, values.agent);
    const sandbox = sandboxFor(values.agent);
    const result: Record<string, unknown> = {
      agent: values.agent,
      sandbox,
      ...paths,
      auth_file_present: fs.existsSync(paths.auth_file),
      authentication: "inherited",
    };

    // SRT-disabled jobs must not even inspect an SRT installation.
    if (sandbox === "srt") {
      const srt = srtPaths();
      let error: string | undefined;
      try {
        checkSrtVersion(srt.cli);
      } catch (e) {
        error = String(e);
      }

      result.srt = {
        version: SRT_VERSION,
        ...srt,
        error,
        profile_present: fs.existsSync(paths.profile),
        ...("codex_home" in paths
          ? { runtime_write_paths: codexRuntimeWrites(paths.codex_home) }
          : {
              runtime_write_paths: paths.runtime_write_paths,
              config_read_paths: paths.config_paths,
            }),
        ...(error
          ? {
              install_argv: [
                "npm",
                "install",
                "--prefix",
                srt.prefix,
                "--save-exact",
                `@anthropic-ai/sandbox-runtime@${SRT_VERSION}`,
              ],
            }
          : {}),
        ...(process.platform === "linux"
          ? { required_tools: ["bwrap", "socat", "rg"] }
          : {}),
      };
    }

    if (values["new-job"]) {
      fs.mkdirSync(paths.state_dir, { recursive: true, mode: 0o700 });
      adapterFor(values.agent).prepare(paths.state_dir);
      result.job_dir = fs.mkdtempSync(path.join(paths.state_dir, "job-"));
    }

    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
