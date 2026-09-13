import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  type Job,
  type State,
  assertNotDelegated,
  jobEnvironment,
  saveState,
  withLogFile,
} from "./job.mjs";
import { sandboxCommand, createSrtTemp } from "./srt.mjs";
import { adapterFor } from "./adapters/index.mjs";
import { fileURLToPath } from "node:url";
import { executableCommand } from "./executable.mjs";
import { assertSandboxSupported } from "./config.mjs";

export function command(job: Job): string[] {
  const command = adapterFor(job.agent).command(job);
  if (job.sandbox === "none") return command;
  if (job.sandbox !== "srt" || !job.srt || !job.srt_settings)
    throw new Error("Invalid saved sandbox configuration");
  return sandboxCommand(
    job.srt,
    job.srt_settings,
    path.join(job.state_dir, "tmp"),
    command,
  );
}

export function environment(job: Job): NodeJS.ProcessEnv {
  return {
    ...jobEnvironment(job.pass_env),
    ...adapterFor(job.agent).environment(job),
    BETTER_AGENT_HANDLER_DEPTH: String(job.delegation_depth + 1),
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function prompt(job: Job): string {
  const reference = (name: string) =>
    fs.readFileSync(
      fileURLToPath(new URL(`../../prompts/${name}.md`, import.meta.url)),
      "utf8",
    );
  return (
    reference("task") +
    "\n" +
    (job.mode === "review" ? reference("review") + "\n" : "") +
    fs.readFileSync(path.join(job.job_dir, "request.md"), "utf8")
  );
}

export async function worker(directory: string): Promise<void> {
  assertNotDelegated();
  // The exclusive claim ensures a job runs, and notifies, at most once.
  fs.closeSync(fs.openSync(path.join(directory, "worker.claim"), "wx", 0o600));
  const job: Job = JSON.parse(
    fs.readFileSync(path.join(directory, "job.json"), "utf8"),
  );

  const state: State = { status: "running", notification: "not_attempted" };
  saveState(directory, state);
  try {
    if (job.delegation_depth !== 0)
      throw new Error("Recursive delegation is disabled");
    assertSandboxSupported(job.sandbox);

    const temporary = job.sandbox === "srt" ? createSrtTemp() : undefined;
    try {
      await runAgent(job, directory, state, temporary);
    } finally {
      if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    state.status = "failed";
    state.error = String(error);
  }

  state.notification = "sending";
  saveState(directory, state);
  await notify(job, directory, state);
}

async function runAgent(
  job: Job,
  directory: string,
  state: State,
  srtTemp?: string,
): Promise<void> {
  const adapter = adapterFor(job.agent);
  const input = prompt(job);
  const promptFile = path.join(directory, "prompt.md");
  const outputFile = path.join(directory, "events.jsonl");
  fs.writeFileSync(promptFile, input, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await withLogFile(path.join(directory, "stderr.log"), async (log) => {
      await withLogFile(outputFile, async (output) => {
        const [executable, ...agentArgs] = command(job);
        const [program, args] = executableCommand(executable!, agentArgs);
        const stdin = adapter.promptViaStdin
          ? fs.openSync(promptFile, "r")
          : "ignore";
        let child;
        try {
          child = spawn(program, args, {
            windowsHide: true,
            cwd: adapter.cwd(job),
            env: {
              ...environment(job),
              ...(srtTemp ? { TMPDIR: srtTemp } : {}),
            },
            stdio: [stdin, output, log],
          });
        } finally {
          if (typeof stdin === "number") fs.closeSync(stdin);
        }

        // Register immediately: a spawn error may occur before process close.
        let finished = false;
        const exit = new Promise<{
          code: number | null;
          error?: Error;
        }>((resolve) => {
          child.once("error", (error) => resolve({ code: null, error }));
          child.once("close", (code) => resolve({ code }));
        }).then((result) => {
          finished = true;
          return result;
        });
        const result = await adapter.consumeOutput(
          createInterface({
            input: Readable.from(followOutput(outputFile, () => finished)),
          }),
          job,
          (id) => {
            if (state.session_id !== id) {
              state.session_id = id;
              saveState(directory, state);
            }
          },
        );
        const { code, error } = await exit;
        adapter.finalize(job, result);
        const { answer, errors, finishReason } = result;
        fs.writeFileSync(path.join(directory, "report.md"), answer + "\n");
        if (error) throw error;

        const completed = adapter.validateCompletion(code, result);
        state.exit_code = code;
        state.status = completed ? "completed" : "failed";
        state.errors = errors;
        state.finish_reason = finishReason;
        if (!completed)
          state.error = `${job.agent} failed, reported an error, or returned no final text`;
      });
    });
  } finally {
    fs.rmSync(outputFile, { force: true });
  }
}

// Read appended bytes while the agent runs, including the final bytes on exit.
async function* followOutput(file: string, finished: () => boolean) {
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  try {
    for (;;) {
      const done = finished();
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (count) {
        position += count;
        yield Buffer.from(buffer.subarray(0, count));
      } else if (done) {
        return;
      } else {
        await delay(50);
      }
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

async function notify(job: Job, directory: string, state: State) {
  const skill = adapterFor(job.agent).skill;
  const message =
    `${job.agent} worker finished: ${state.status}. Job directory: ${JSON.stringify(directory)}. ` +
    `Continue under $delegate:${skill} using report.md and, when needed, the diff against the saved baseline. ` +
    "Do not inspect the session transcript. Continue the authorized task. Do not rerun this job or load the entire log.";

  try {
    const [program, args] = executableCommand(job.codex, [
      "queue",
      "--thread",
      job.thread,
      "--message",
      message,
    ]);
    const result = await withLogFile(path.join(directory, "queue.log"), (log) =>
      spawnSync(program, args, {
        windowsHide: true,
        cwd: job.cwd,
        stdio: ["ignore", log, log],
        timeout: 30000,
        killSignal: "SIGKILL",
      }),
    );
    if (result.error) throw result.error;

    state.queue_exit_code = result.status;
    state.notification = result.status === 0 ? "accepted" : "unconfirmed";
  } catch (error) {
    state.notification = "unconfirmed";
    state.notification_error = String(error);
  }

  saveState(directory, state);
}
