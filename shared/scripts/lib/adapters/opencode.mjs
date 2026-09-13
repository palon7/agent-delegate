import fs from "node:fs";
import path from "node:path";
import { parseObject } from "./types.mjs";
function command(job) {
    return [
        job.executable,
        "run",
        "Follow the attached request and finish with results, checks, and unresolved issues.",
        "--dir",
        job.cwd,
        "--format",
        "json",
        ...(job.model ? ["--model", job.model] : []),
        ...(job.session ? ["--session", job.session] : []),
        "--file",
        path.join(job.job_dir, "prompt.md"),
    ];
}
function environment(job) {
    const permission = {
        "*": "allow",
        task: "deny",
        question: "deny",
        ...(job.mode === "review" ? { edit: "deny" } : {}),
    };
    return {
        NODE_USE_ENV_PROXY: "1",
        GIT_OPTIONAL_LOCKS: "0",
        TMPDIR: path.join(job.state_dir, "tmp"),
        XDG_DATA_HOME: path.join(job.state_dir, "data"),
        XDG_CONFIG_HOME: path.join(job.state_dir, "config"),
        XDG_CACHE_HOME: path.join(job.state_dir, "cache"),
        XDG_STATE_HOME: path.join(job.state_dir, "state"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
            autoupdate: false,
            share: "disabled",
            permission,
        }),
    };
}
async function recordEvents(lines, _job, session) {
    let parts = [];
    let messageID;
    let finishReason;
    const errors = [];
    for await (const line of lines) {
        if (!line.trim())
            continue;
        // OpenCode events are untrusted JSON; fields are checked where used.
        const event = parseObject(line);
        if (!event) {
            errors.push("Invalid OpenCode event; the final result could not be established");
            continue;
        }
        if (typeof event.sessionID === "string")
            session(event.sessionID);
        switch (event.type) {
            case "text": {
                const part = event.part ?? {};
                if (part.messageID !== messageID) {
                    parts = [];
                    messageID = part.messageID;
                }
                const text = part.text ?? "";
                if (typeof text === "string")
                    parts.push(text);
                else
                    errors.push("Invalid text event");
                break;
            }
            case "step_start":
                parts = [];
                messageID = undefined;
                finishReason = undefined;
                break;
            case "step_finish":
                finishReason = event.part?.reason;
                break;
            case "error":
                errors.push(event.error ?? event);
                break;
        }
    }
    return { answer: parts.join("\n"), errors, finishReason };
}
export const opencode = {
    skill: "opencode",
    promptViaStdin: false,
    preflight() { },
    prepare(stateDir) {
        for (const name of [
            "tmp",
            "data/opencode",
            "config/opencode",
            "cache",
            "state",
        ])
            fs.mkdirSync(path.join(stateDir, name), {
                recursive: true,
                mode: 0o700,
            });
    },
    command,
    cwd: (job) => job.state_dir,
    finalize() { },
    environment,
    consumeOutput: recordEvents,
    validateCompletion: (code, result) => code === 0 &&
        result.answer.trim() !== "" &&
        result.errors.length === 0 &&
        result.finishReason === "stop",
};
