import fs from "node:fs";
import path from "node:path";
import type { Job } from "../job.mjs";
import { type AgentAdapter, parseObject } from "./types.mjs";
import { executableCommand } from "../executable.mjs";
import { spawnSyncCaptured } from "../spawn.mjs";

function command(job: Job): string[] {
  return [
    job.executable,
    "run",
    "Follow the attached request and finish with results, checks, and unresolved issues.",
    "--dir",
    job.cwd,
    "--format",
    "json",
    ...(job.sandbox === "srt" ? ["--auto"] : []),
    ...(job.model ? ["--model", job.model] : []),
    ...(job.session ? ["--session", job.session] : []),
    "--file",
    path.join(job.job_dir, "prompt.md"),
  ];
}

function environment(job: Job): NodeJS.ProcessEnv {
  let permission: Record<string, unknown> = {};
  if (process.env.OPENCODE_PERMISSION) {
    const input: unknown = JSON.parse(process.env.OPENCODE_PERMISSION);
    if (typeof input === "string" && ["allow", "ask", "deny"].includes(input))
      permission = { "*": input };
    else if (input && typeof input === "object" && !Array.isArray(input))
      permission = { ...input };
    else
      throw new Error(
        "OPENCODE_PERMISSION must be a permission object or action",
      );

    const action = (value: unknown) =>
      typeof value === "string" && ["allow", "ask", "deny"].includes(value);
    if (
      !Object.values(permission).every(
        (rule) =>
          action(rule) ||
          (rule &&
            typeof rule === "object" &&
            !Array.isArray(rule) &&
            Object.values(rule).every(action)),
      )
    )
      throw new Error("Invalid OPENCODE_PERMISSION rule");
  }

  // Reinsert restrictions last: OpenCode permission patterns are order-sensitive.
  for (const key of ["task", ...(job.mode === "review" ? ["edit"] : [])]) {
    delete permission[key];
    permission[key] = "deny";
  }

  const temporary = path.join(job.state_dir, "tmp");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_USE_ENV_PROXY: "1",
    GIT_OPTIONAL_LOCKS: "0",
    TMPDIR: temporary,
    ...(process.platform === "win32"
      ? {
          TEMP: temporary,
          TMP: temporary,
        }
      : {}),
    OPENCODE_PERMISSION: JSON.stringify(permission),
  };

  delete env.CODEX_THREAD_ID;
  delete env.CODEX_SESSION_ID;
  return env;
}

async function recordEvents(
  lines: AsyncIterable<string>,
  _job: Job,
  session: (id: string) => void,
) {
  let parts: string[] = [];
  let messageID: unknown;
  let finishReason: string | undefined;
  const errors: unknown[] = [];

  for await (const line of lines) {
    if (!line.trim()) continue;
    // OpenCode events are untrusted JSON; fields are checked where used.
    const event = parseObject(line);
    if (!event) {
      errors.push(
        "Invalid OpenCode event; the final result could not be established",
      );
      continue;
    }

    if (typeof event.sessionID === "string") session(event.sessionID);

    switch (event.type) {
      case "text": {
        const part = event.part ?? {};
        if (part.messageID !== messageID) {
          parts = [];
          messageID = part.messageID;
        }
        const text = part.text ?? "";
        if (typeof text === "string") parts.push(text);
        else errors.push("Invalid text event");
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

export const opencode: AgentAdapter = {
  skill: "opencode",
  promptViaStdin: false,
  preflight(executable, sandbox) {
    if (sandbox !== "srt") return;

    const [program, args] = executableCommand(executable, ["run", "--help"]);
    const help = spawnSyncCaptured(program, args, {
      windowsHide: true,
      timeout: 10000,
    });
    if (
      help.error ||
      help.status !== 0 ||
      !/--auto\b/.test(help.stdout.toString() + help.stderr.toString())
    )
      throw new Error(
        "OpenCode CLI with run --auto support is required for SRT jobs",
      );
  },
  prepare(stateDir) {
    fs.mkdirSync(path.join(stateDir, "tmp"), {
      recursive: true,
      mode: 0o700,
    });
  },
  command,
  cwd: (job) => job.cwd,
  finalize() {},
  environment,
  consumeOutput: recordEvents,
  validateCompletion: (code, result) =>
    code === 0 &&
    result.answer.trim() !== "" &&
    result.errors.length === 0 &&
    result.finishReason === "stop",
};
