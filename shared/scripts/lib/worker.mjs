import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { assertNotDelegated, jobEnvironment, saveState, withLogFile, } from "./job.mjs";
import { sandboxCommand, createSrtTemp } from "./srt.mjs";
import { adapterFor } from "./adapters/index.mjs";
import { fileURLToPath } from "node:url";
export function command(job) {
    const command = adapterFor(job.agent).command(job);
    if (job.sandbox === "none")
        return command;
    if (job.sandbox !== "srt" || !job.srt || !job.srt_settings)
        throw new Error("Invalid saved sandbox configuration");
    return sandboxCommand(job.srt, job.srt_settings, path.join(job.state_dir, "tmp"), command);
}
export function environment(job) {
    return {
        ...jobEnvironment(job.pass_env),
        ...adapterFor(job.agent).environment(job),
        BETTER_AGENT_HANDLER_DEPTH: String(job.delegation_depth + 1),
        GIT_OPTIONAL_LOCKS: "0",
    };
}
function prompt(job) {
    const reference = (name) => fs.readFileSync(fileURLToPath(new URL(`../../prompts/${name}.md`, import.meta.url)), "utf8");
    return (reference("task") +
        "\n" +
        (job.mode === "review" ? reference("review") + "\n" : "") +
        fs.readFileSync(path.join(job.job_dir, "request.md"), "utf8"));
}
export async function worker(directory) {
    assertNotDelegated();
    // The exclusive claim ensures a job runs, and notifies, at most once.
    fs.closeSync(fs.openSync(path.join(directory, "worker.claim"), "wx", 0o600));
    const job = JSON.parse(fs.readFileSync(path.join(directory, "job.json"), "utf8"));
    const state = { status: "running", notification: "not_attempted" };
    saveState(directory, state);
    try {
        if (job.delegation_depth !== 0)
            throw new Error("Recursive delegation is disabled");
        const temporary = job.sandbox === "srt" ? createSrtTemp() : undefined;
        try {
            await runAgent(job, directory, state, temporary);
        }
        finally {
            if (temporary)
                fs.rmSync(temporary, { recursive: true, force: true });
        }
    }
    catch (error) {
        state.status = "failed";
        state.error = String(error);
    }
    state.notification = "sending";
    saveState(directory, state);
    await notify(job, directory, state);
}
async function runAgent(job, directory, state, srtTemp) {
    const adapter = adapterFor(job.agent);
    const input = prompt(job);
    fs.writeFileSync(path.join(directory, "prompt.md"), input, {
        flag: "wx",
        mode: 0o600,
    });
    await withLogFile(path.join(directory, "stderr.log"), async (log) => {
        const [program, ...args] = command(job);
        const child = spawn(program, args, {
            cwd: adapter.cwd(job),
            env: { ...environment(job), ...(srtTemp ? { TMPDIR: srtTemp } : {}) },
            stdio: [adapter.promptViaStdin ? "pipe" : "ignore", "pipe", log],
        });
        // Register immediately: a spawn error may occur before the stream ends.
        const exit = new Promise((resolve) => {
            child.once("error", (error) => resolve({ code: null, error }));
            child.once("close", (code) => resolve({ code }));
        });
        if (adapter.promptViaStdin) {
            child.stdin.on("error", () => {
                /* process exit is authoritative */
            });
            child.stdin.end(input);
        }
        const result = await adapter.consumeOutput(createInterface({ input: child.stdout }), job, (id) => {
            if (state.session_id !== id) {
                state.session_id = id;
                saveState(directory, state);
            }
        });
        const { code, error } = await exit;
        adapter.finalize(job, result);
        const { answer, errors, finishReason } = result;
        fs.writeFileSync(path.join(directory, "report.md"), answer + "\n");
        if (error)
            throw error;
        const completed = adapter.validateCompletion(code, result);
        state.exit_code = code;
        state.status = completed ? "completed" : "failed";
        state.errors = errors;
        state.finish_reason = finishReason;
        if (!completed)
            state.error = `${job.agent} failed, reported an error, or returned no final text`;
    });
}
async function notify(job, directory, state) {
    const skill = adapterFor(job.agent).skill;
    const message = `${job.agent} worker finished: ${state.status}. Job directory: ${JSON.stringify(directory)}. ` +
        `Continue under $delegate:${skill} using report.md and, when needed, the diff against the saved baseline. ` +
        "Do not inspect the session transcript. Continue the authorized task. Do not rerun this job or load the entire log.";
    try {
        const result = await withLogFile(path.join(directory, "queue.log"), (log) => spawnSync(job.codex, ["queue", "--thread", job.thread, "--message", message], {
            cwd: job.cwd,
            stdio: ["ignore", log, log],
            timeout: 30000,
            killSignal: "SIGKILL",
        }));
        if (result.error)
            throw result.error;
        state.queue_exit_code = result.status;
        state.notification = result.status === 0 ? "accepted" : "unconfirmed";
    }
    catch (error) {
        state.notification = "unconfirmed";
        state.notification_error = String(error);
    }
    saveState(directory, state);
}
