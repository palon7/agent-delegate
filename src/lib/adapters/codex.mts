import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Job } from "../job.mjs";
import { type AgentAdapter, parseObject } from "./types.mjs";

function codexHome(job: Job): string {
  if (!job.codex_home)
    throw new Error("Missing saved Codex home; prepare a new job");
  return job.codex_home;
}

function handlerPluginOverrides(home: string): string[] {
  const marketplaces = new Set(["better-agent-handler"]);
  const cache = path.join(home, "plugins", "cache");

  if (fs.existsSync(cache)) {
    for (const entry of fs.readdirSync(cache, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        fs.existsSync(path.join(cache, entry.name, "better-agent-handler"))
      )
        marketplaces.add(entry.name);
    }
  }

  return [...marketplaces].map((marketplace) => {
    if (!/^[A-Za-z0-9_-]+$/.test(marketplace))
      throw new Error(
        `Cannot disable Better Agent Handler for unsupported marketplace name: ${marketplace}`,
      );

    // Codex -c splits keys on dots; it does not unquote TOML key segments.
    return `plugins.better-agent-handler@${marketplace}.enabled=false`;
  });
}

export const codex: AgentAdapter = {
  skill: "codex-delegate",
  promptViaStdin: true,
  preflight(executable) {
    const help = spawnSync(executable, ["exec", "--help"], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (
      help.error ||
      help.status !== 0 ||
      !help.stdout.includes("--approve-for-me")
    )
      throw new Error(
        "Codex CLI with automatic approval review (--approve-for-me) is required",
      );
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
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CODEX_HOME: codexHome(job),
      TMPDIR: path.join(job.state_dir, "tmp"),
    };

    delete env.CODEX_THREAD_ID;
    delete env.CODEX_SESSION_ID;

    return env;
  },
  async consumeOutput(lines, job, session) {
    const errors: unknown[] = [];
    let finishReason: string | undefined;
    for await (const line of lines) {
      if (!line.trim()) continue;
      const event = parseObject(line);
      if (!event) {
        errors.push("Invalid Codex event");
        continue;
      }
      if (
        event.type === "thread.started" &&
        typeof event.thread_id === "string"
      )
        session(event.thread_id);
      if (event.type === "turn.started") finishReason = undefined;
      if (event.type === "turn.completed") finishReason = "completed";
      if (event.type === "turn.failed" || event.type === "error")
        errors.push(event.error ?? event.message ?? event);
    }
    return { answer: "", errors, finishReason };
  },
  validateCompletion: (code, result) =>
    code === 0 &&
    result.answer.trim() !== "" &&
    result.errors.length === 0 &&
    result.finishReason === "completed",
};
