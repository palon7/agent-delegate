#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isAgent } from "./lib/config.mjs";
import { isMode, start } from "./lib/job.mjs";
const USAGE = "agent_job.mjs --agent opencode|codex --job-dir PATH [--state-dir PATH] --cwd PATH [--profile PATH] --mode implement|review --thread UUID [--session ID] [--model MODEL] [--pass-env NAME] [--srt PATH] [--executable PATH] [--codex PATH]";
async function main() {
    const { values } = parseArgs({
        options: {
            agent: { type: "string" },
            "delegation-depth": { type: "string", default: "0" },
            "job-dir": { type: "string" },
            "state-dir": { type: "string" },
            cwd: { type: "string" },
            profile: { type: "string" },
            thread: { type: "string", default: process.env.CODEX_THREAD_ID },
            session: { type: "string" },
            model: { type: "string" },
            mode: { type: "string" },
            srt: { type: "string" },
            executable: { type: "string" },
            codex: { type: "string", default: "codex" },
            "pass-env": { type: "string", multiple: true, default: [] },
            help: { type: "boolean" },
        },
    });
    if (values.help) {
        console.log(USAGE);
        return;
    }
    const { "job-dir": jobDir, "state-dir": stateDir, cwd, profile, thread, mode, } = values;
    if (!jobDir || !cwd || !isAgent(values.agent) || !thread || !isMode(mode))
        throw new Error("Required: --job-dir, --cwd, --agent opencode|codex, --thread (or CODEX_THREAD_ID), --mode implement|review");
    const result = await start({
        agent: values.agent,
        delegationDepth: Number(values["delegation-depth"]),
        jobDir,
        stateDir,
        cwd,
        profile,
        thread,
        mode,
        session: values.session,
        model: values.model,
        passEnv: values["pass-env"],
        codex: values.codex,
        srt: values.srt,
        executable: values.executable,
    });
    console.log(JSON.stringify(result));
}
process.umask(0o077);
try {
    await main();
}
catch (error) {
    console.error(String(error));
    process.exitCode = 1;
}
