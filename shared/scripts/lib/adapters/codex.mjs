import fs from "node:fs";
import path from "node:path";
import { parseObject } from "./types.mjs";
import { executableCommand } from "../executable.mjs";
import { spawnSyncCaptured } from "../spawn.mjs";
function codexHome(job) {
    if (!job.codex_home)
        throw new Error("Missing saved Codex home; prepare a new job");
    return job.codex_home;
}
function handlerPluginOverrides(home) {
    const marketplaces = new Set(["agent-delegate"]);
    const cache = path.join(home, "plugins", "cache");
    if (fs.existsSync(cache)) {
        for (const entry of fs.readdirSync(cache, { withFileTypes: true })) {
            if (entry.isDirectory() &&
                fs.existsSync(path.join(cache, entry.name, "delegate")))
                marketplaces.add(entry.name);
        }
    }
    return [...marketplaces].map((marketplace) => {
        if (!/^[A-Za-z0-9_-]+$/.test(marketplace))
            throw new Error(`Cannot disable Agent Delegate for unsupported marketplace name: ${marketplace}`);
        // Codex -c splits keys on dots; it does not unquote TOML key segments.
        return `plugins.delegate@${marketplace}.enabled=false`;
    });
}
export const codex = {
    skill: "codex",
    promptViaStdin: true,
    preflight(executable) {
        const [program, args] = executableCommand(executable, ["exec", "--help"]);
        const help = spawnSyncCaptured(program, args, {
            windowsHide: true,
            timeout: 10000,
        });
        if (help.error ||
            help.status !== 0 ||
            !help.stdout.includes("--approve-for-me"))
            throw new Error("Codex CLI with automatic approval review (--approve-for-me) is required");
    },
    prepare(stateDir) {
        for (const name of ["logs", "sqlite", "tmp"])
            fs.mkdirSync(path.join(stateDir, name), {
                recursive: true,
                mode: 0o700,
            });
    },
    command(job) {
        // Config overrides work for both exec and exec resume. --approve-for-me
        // itself would force workspace-write even for a read-only review.
        const overrides = [
            `sqlite_home=${JSON.stringify(path.join(job.state_dir, "sqlite"))}`,
            `log_dir=${JSON.stringify(path.join(job.state_dir, "logs"))}`,
            'approval_policy="on-request"',
            'approvals_reviewer="auto_review"',
            `sandbox_mode="${job.mode === "review" ? "read-only" : "workspace-write"}"`,
            "sandbox_workspace_write.writable_roots=[]",
            "sandbox_workspace_write.exclude_slash_tmp=true",
            "sandbox_workspace_write.exclude_tmpdir_env_var=true",
            ...handlerPluginOverrides(codexHome(job)),
            "features.multi_agent=false",
            "features.multi_agent_v2=false",
            "features.guardian_approval=true",
        ];
        return [
            job.executable,
            ...(job.codex_profile ? ["--profile", job.codex_profile] : []),
            "exec",
            ...(job.session ? ["resume", job.session] : []),
            "--json",
            ...(!job.session ? ["--color", "never"] : []),
            ...overrides.flatMap((value) => ["-c", value]),
            ...(job.model ? ["--model", job.model] : []),
            "--output-last-message",
            path.join(job.job_dir, "final-message.md"),
            "-",
        ];
    },
    cwd: (job) => job.cwd,
    finalize(job, result) {
        const final = path.join(job.job_dir, "final-message.md");
        result.answer = fs.existsSync(final) ? fs.readFileSync(final, "utf8") : "";
    },
    environment(job) {
        const temporary = path.join(job.state_dir, "tmp");
        const env = {
            ...process.env,
            CODEX_HOME: codexHome(job),
            TMPDIR: temporary,
            ...(process.platform === "win32"
                ? {
                    TEMP: temporary,
                    TMP: temporary,
                }
                : {}),
        };
        delete env.CODEX_THREAD_ID;
        delete env.CODEX_SESSION_ID;
        return env;
    },
    async consumeOutput(lines, session) {
        const errors = [];
        let finishReason;
        for await (const line of lines) {
            if (!line.trim())
                continue;
            const event = parseObject(line);
            if (!event) {
                errors.push("Invalid Codex event");
                continue;
            }
            if (event.type === "thread.started" &&
                typeof event.thread_id === "string")
                session(event.thread_id);
            if (event.type === "turn.started")
                finishReason = undefined;
            if (event.type === "turn.completed")
                finishReason = "completed";
            if (event.type === "turn.failed" || event.type === "error")
                errors.push(event.error ?? event.message ?? event);
        }
        return { answer: "", errors, finishReason };
    },
    validateCompletion: (code, result) => code === 0 &&
        result.answer.trim() !== "" &&
        result.errors.length === 0 &&
        result.finishReason === "completed",
};
