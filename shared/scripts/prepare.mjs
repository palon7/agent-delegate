#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { isAgent, sandboxFor } from "./lib/config.mjs";
import { repositoryPaths, srtPaths, SRT_VERSION, codexRuntimeWrites, existingCodexHome, opencodePaths, jobTempRoot, } from "./lib/paths.mjs";
import { assertNotDelegated } from "./lib/job.mjs";
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
    }
    else {
        assertNotDelegated();
        if (!values.cwd || !isAgent(values.agent))
            throw new Error("--cwd and --agent opencode|codex are required");
        const paths = repositoryPaths(values.cwd, values.agent);
        const sandbox = sandboxFor(values.agent);
        const agentPaths = values.agent === "codex"
            ? { codex_home: existingCodexHome() }
            : opencodePaths(paths.repository);
        const result = {
            agent: values.agent,
            sandbox,
            ...paths,
            profile: path.join(paths.state_dir, "srt-profile.json"),
            ...("codex_home" in agentPaths
                ? { codex_home: agentPaths.codex_home }
                : { agent_config: agentPaths.agent_config }),
        };
        // SRT-disabled jobs must not even inspect an SRT installation.
        if (sandbox === "srt") {
            const srt = srtPaths();
            let error;
            try {
                checkSrtVersion(srt.cli);
            }
            catch (e) {
                error = String(e);
            }
            result.srt = {
                version: SRT_VERSION,
                ...srt,
                error,
                ...("codex_home" in agentPaths
                    ? { runtime_write_paths: codexRuntimeWrites(agentPaths.codex_home) }
                    : {
                        runtime_write_paths: agentPaths.runtime_write_paths,
                        config_read_paths: agentPaths.config_paths,
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
            result.job_dir = fs.mkdtempSync(path.join(jobTempRoot(), "delegate-job-"));
        }
        console.log(JSON.stringify(result, null, 2));
    }
}
catch (error) {
    console.error(String(error));
    process.exitCode = 1;
}
