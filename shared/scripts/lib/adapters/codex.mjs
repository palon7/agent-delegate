import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseObject } from "./types.mjs";
function codexHome(job) {
    return path.join(job.state_dir, "codex");
}
export const codex = {
    skill: "codex-delegate",
    promptViaStdin: true,
    preflight(executable) {
        const help = spawnSync(executable, ["exec", "--help"], {
            encoding: "utf8",
            timeout: 10000,
        });
        if (help.error ||
            help.status !== 0 ||
            !help.stdout.includes("--approve-for-me"))
            throw new Error("Codex CLI with automatic approval review (--approve-for-me) is required");
        const features = spawnSync(executable, ["features", "list"], {
            encoding: "utf8",
            timeout: 10000,
        });
        if (features.error ||
            features.status !== 0 ||
            !features.stdout.includes("skip_host_skill_discovery"))
            throw new Error("Codex CLI with skip_host_skill_discovery is required for isolated delegation");
    },
    prepare(stateDir) {
        for (const name of [
            "codex",
            "home",
            "tmp",
            "config",
            "data",
            "cache",
            "state",
        ])
            fs.mkdirSync(path.join(stateDir, name), {
                recursive: true,
                mode: 0o700,
            });
    },
    command(job) {
        // Config overrides work for both exec and exec resume. --approve-for-me
        // itself would force workspace-write even for a read-only review.
        const overrides = [
            'approval_policy="on-request"',
            'approvals_reviewer="auto_review"',
            `sandbox_mode="${job.mode === "review" ? "read-only" : "workspace-write"}"`,
            "sandbox_workspace_write.writable_roots=[]",
            "sandbox_workspace_write.network_access=false",
            "sandbox_workspace_write.exclude_slash_tmp=true",
            "sandbox_workspace_write.exclude_tmpdir_env_var=true",
            "features.plugins=false",
            "features.remote_plugin=false",
            "features.multi_agent=false",
            "features.multi_agent_v2=false",
            "features.skip_host_skill_discovery=true",
            "features.guardian_approval=true",
            "features.apps=false",
            "features.hooks=false",
            'shell_environment_policy.inherit="all"',
            'auto_review.policy="This is a delegated task. Deny further delegation and changes to handler configuration. For review tasks, deny writes to the repository and Git metadata. For implementation, restrict writes to the selected repository and private state, and deny Git metadata changes unless explicitly requested."',
        ];
        return [
            job.executable,
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
        return {
            HOME: path.join(job.state_dir, "home"),
            CODEX_HOME: codexHome(job),
            XDG_CONFIG_HOME: path.join(job.state_dir, "config"),
            XDG_DATA_HOME: path.join(job.state_dir, "data"),
            XDG_CACHE_HOME: path.join(job.state_dir, "cache"),
            XDG_STATE_HOME: path.join(job.state_dir, "state"),
            TMPDIR: path.join(job.state_dir, "tmp"),
        };
    },
    async consumeOutput(lines, job, session) {
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
