import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type AgentName, type Sandbox, sandboxFor } from "./config.mjs";
import { adapterFor } from "./adapters/index.mjs";
import {
  repositoryPaths,
  srtPaths,
  existingCodexHome,
  codexRuntimeWrites,
  opencodePaths,
  jobTempRoot,
} from "./paths.mjs";
import { executableCommand, resolveExecutable } from "./executable.mjs";
import { checkSrtVersion, checkSrtExecution, validateProfile } from "./srt.mjs";
import { gitText, isInside } from "./snapshot.mjs";
import { spawnSyncCaptured } from "./spawn.mjs";

const INHERITED_ENV = ["PATH", "USER", "LOGNAME", "LANG", "LC_ALL"];
const WORKER_ENTRY = fileURLToPath(
  new URL("./worker_entry.mjs", import.meta.url),
);

export type Mode = "implement" | "review";

export function isMode(value: unknown): value is Mode {
  return value === "implement" || value === "review";
}

/** Saved to job.json. Only names of passed variables are saved, never values. */
export interface Job {
  job_dir: string;
  state_dir: string;
  cwd: string;
  agent: AgentName;
  sandbox: Sandbox;
  delegation_depth: number;
  srt_settings?: string;
  thread: string;
  session?: string;
  model?: string;
  mode: Mode;
  pass_env: string[];
  codex: string;
  codex_home?: string;
  codex_profile?: string;
  srt?: string;
  executable: string;
}

/** Saved to state.json. */
export interface State {
  status: "launch_failed" | "running" | "completed" | "failed";
  notification: "not_attempted" | "sending" | "accepted" | "unconfirmed";
  session_id?: string;
  exit_code?: number | null;
  errors?: unknown[];
  finish_reason?: string;
  error?: string;
  queue_exit_code?: number | null;
  notification_error?: string;
}

export interface StartArgs {
  codexProfile?: string;
  agent: AgentName;
  delegationDepth?: number;
  jobDir: string;
  stateDir?: string;
  cwd: string;
  profile?: string;
  thread: string;
  session?: string;
  model?: string;
  mode: Mode;
  passEnv: string[];
  codex: string;
  srt?: string;
  executable?: string;
}

function writeJsonAtomic(target: string, value: unknown): void {
  const temporary = target.replace(/\.[^.\/]+$/, "") + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}

export function saveState(directory: string, state: State): void {
  writeJsonAtomic(path.join(directory, "state.json"), state);
}

export async function withLogFile<T>(
  file: string,
  use: (fd: number) => T | Promise<T>,
): Promise<T> {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    return await use(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function assertNotDelegated(depth = 0): void {
  if (
    !Number.isInteger(depth) ||
    depth !== 0 ||
    (process.env.BETTER_AGENT_HANDLER_DEPTH !== undefined &&
      process.env.BETTER_AGENT_HANDLER_DEPTH !== "0")
  )
    throw new Error("Recursive delegation is disabled");
}

/** Validate explicit environment inputs before adapter-specific inheritance. */
export function jobEnvironment(passEnv: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV)
    if (process.env[key] !== undefined) env[key] = process.env[key];

  const reserved = new Set([
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "CODEX_HOME",
    "CODEX_SQLITE_HOME",
    "BETTER_AGENT_HANDLER_DEPTH",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    "TMPDIR",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
  ]);
  if (process.platform === "win32") {
    for (const key of ["TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"])
      reserved.add(key);
  }

  for (const key of passEnv) {
    if (reserved.has(process.platform === "win32" ? key.toUpperCase() : key))
      throw new Error(`Reserved child environment variable: ${key}`);
    if (process.env[key] === undefined)
      throw new Error(`Missing environment variable: ${key}`);
    env[key] = process.env[key];
  }
  return env;
}

export async function start(args: StartArgs) {
  assertNotDelegated(args.delegationDepth);
  if (args.codexProfile && args.agent !== "codex")
    throw new Error("--codex-profile requires --agent codex");

  const sandbox = sandboxFor(args.agent);
  const adapter = adapterFor(args.agent);
  const defaults = repositoryPaths(args.cwd, args.agent);
  const directory = fs.realpathSync(args.jobDir);
  const stateDir = resolveFutureDirectory(args.stateDir ?? defaults.state_dir);
  const cwd = fs.realpathSync(args.cwd);
  validateDirectories(directory, stateDir, cwd);

  const thread = parseThreadId(args.thread);
  if (!thread) throw new Error("--thread or CODEX_THREAD_ID must be a UUID");

  if (
    args.agent === "codex" &&
    args.session &&
    parseThreadId(args.session) === thread
  )
    throw new Error(
      "Cannot resume the parent Codex task as a delegated session",
    );

  const codex = resolveExecutable(args.codex, "@openai/codex");
  const executable = resolveExecutable(
    args.executable ?? args.agent,
    args.agent === "codex" ? "@openai/codex" : "opencode-ai",
  );
  const srt =
    sandbox === "srt"
      ? args.srt
        ? resolveExecutable(args.srt)
        : srtPaths().cli
      : undefined;
  if (srt) checkSrtVersion(srt);

  const profile =
    sandbox === "srt"
      ? path.resolve(args.profile ?? path.join(stateDir, "srt-profile.json"))
      : undefined;
  if (profile) {
    if (!fs.existsSync(profile))
      throw new Error(
        `SRT profile is missing: ${profile}. Prepare it with user approval.`,
      );
    validateProfile(profile);
  }

  adapter.preflight(executable, sandbox);
  assertQueueAvailable(codex);
  // Fail before launch if a passed variable is missing.
  jobEnvironment(args.passEnv);

  const job: Job = {
    agent: args.agent,
    sandbox,
    delegation_depth: 0,
    job_dir: directory,
    state_dir: stateDir,
    cwd,
    srt_settings: profile ? path.join(directory, "srt.json") : undefined,
    thread,
    session: args.session,
    model: args.model,
    mode: args.mode,
    pass_env: args.passEnv,
    codex,
    codex_home: args.agent === "codex" ? existingCodexHome() : undefined,
    codex_profile: args.codexProfile,
    srt,
    executable,
  };

  // Validate adapter overrides before claiming a job, also without SRT.
  adapter.environment(job);

  // An existing job is never reused, including failed launches.
  if (fs.existsSync(path.join(directory, "job.json")))
    throw new Error("Job already exists; use prepare.mjs --new-job");

  // Claim before writing the derived profile so concurrent launches cannot
  // overwrite the profile of a job that has already started.
  fs.writeFileSync(
    path.join(directory, "job.json"),
    JSON.stringify(job, null, 2),
    { flag: "wx", mode: 0o600 },
  );

  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    adapter.prepare(stateDir);
    if (profile) {
      const opencode =
        job.agent === "opencode" ? opencodePaths(cwd) : undefined;

      executionProfile(
        profile,
        cwd,
        stateDir,
        directory,
        args.mode,
        job.codex_home
          ? codexRuntimeWrites(job.codex_home)
          : opencode!.runtime_write_paths,
        opencode?.config_paths ?? [],
      );
      checkSrtExecution(srt!, job.srt_settings!, stateDir, {
        ...jobEnvironment(job.pass_env),
        ...adapter.environment(job),
        BETTER_AGENT_HANDLER_DEPTH: "1",
        GIT_OPTIONAL_LOCKS: "0",
      });
    }

    const pid = await withLogFile(path.join(directory, "worker.log"), (log) =>
      launchWorker(directory, stateDir, log),
    );
    return { status: "started", pid, job_dir: directory, thread, sandbox };
  } catch (error) {
    saveState(directory, {
      status: "launch_failed",
      notification: "not_attempted",
      error: String(error),
    });
    throw error;
  }
}

export function executionProfile(
  profile: string,
  cwd: string,
  stateDir: string,
  directory: string,
  mode: Mode,
  runtimeWrites: string[] = [],
  protectedSettings: string[] = [],
): string {
  const settings = JSON.parse(fs.readFileSync(profile, "utf8"));
  const filesystem = (settings.filesystem ??= {});

  for (const required of protectedSettings.filter((file) =>
    fs.existsSync(file),
  )) {
    if (
      !(filesystem.allowRead ?? []).some(
        (allowed: string) =>
          path.isAbsolute(allowed) && isInside(required, allowed),
      )
    )
      throw new Error(
        `SRT profile must approve configuration read access: ${required}`,
      );
  }

  // Shared auth/session writes require explicit approval in the source
  // profile. Never grant the entire parent home merely to reuse authentication.
  for (const required of runtimeWrites) {
    if (
      !(filesystem.allowWrite ?? []).some(
        (allowed: string) =>
          path.isAbsolute(allowed) && isInside(required, allowed),
      )
    )
      throw new Error(
        `SRT profile must approve agent runtime write access: ${required}`,
      );
  }

  filesystem.allowWrite = mode === "implement" ? [stateDir, cwd] : [stateDir];
  filesystem.allowWrite.push(directory);
  (filesystem.allowRead ??= []).push(directory);
  filesystem.allowWrite.push(...runtimeWrites);

  // A broad read-only bind can cover SRT's narrower writable binds on Linux.
  // Require separate read entries instead of silently expanding write access.
  for (const required of runtimeWrites) {
    const reads: string[] = filesystem.allowRead ?? [];
    if (
      !reads.includes(required) ||
      reads.some(
        (allowed) => allowed !== required && isInside(required, allowed),
      )
    )
      throw new Error(
        `SRT profile needs a separate allowRead entry for ${required}, without an enclosing read-only directory`,
      );
  }

  const gitDirectories = ["--git-dir", "--git-common-dir"].map((flag) =>
    gitText(cwd, ["rev-parse", "--path-format=absolute", flag]),
  );
  (filesystem.denyWrite ??= []).push(
    ...protectedSettings.map((file) =>
      fs.existsSync(file) ? fs.realpathSync(file) : file,
    ),
    ...protectedSettings,
    fs.realpathSync(profile),
    path.join(cwd, ".git"),
    ...gitDirectories,
    ...(mode === "review" ? [cwd] : []),
  );

  const target = path.join(directory, "srt.json");
  writeJsonAtomic(target, settings);
  return target;
}

// Resolve existing ancestors without creating a missing state directory.
function resolveFutureDirectory(value: string): string {
  const absolute = path.resolve(value);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(resolveFutureDirectory(parent), path.basename(absolute));
  }
}

function validateDirectories(
  directory: string,
  stateDir: string,
  cwd: string,
): void {
  const tempRoot = jobTempRoot();
  if (
    path.dirname(directory) !== tempRoot ||
    !/^delegate-job-.+$/.test(path.basename(directory))
  )
    throw new Error(
      `job-dir must be a delegate-job-* directory directly inside ${tempRoot}`,
    );
  if (isInside(stateDir, cwd) || isInside(cwd, stateDir))
    throw new Error(
      "state-dir and repository must be separate, non-nested directories",
    );
  if (
    isInside(directory, cwd) ||
    isInside(cwd, directory) ||
    isInside(stateDir, directory)
  )
    throw new Error(
      "job-dir must be separate from the repository and must not contain state-dir",
    );

  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) throw new Error("job-dir must be a directory");
  if (
    process.platform !== "win32" &&
    (stat.uid !== process.getuid?.() || stat.mode & 0o077)
  )
    throw new Error("job-dir must be owned by this user with mode 0700");
  if (!fs.statSync(path.join(directory, "request.md")).isFile())
    throw new Error("job-dir must contain request.md");
}

/** Accept common UUID spellings and return the lowercase hyphenated form. */
function parseThreadId(value: string): string | undefined {
  const hex = value
    .replace(/^urn:uuid:/i, "")
    .replace(/[{}-]/g, "")
    .toLowerCase();
  if (!/^[a-f\d]{32}$/.test(hex)) return undefined;
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

function assertQueueAvailable(codex: string): void {
  const [program, args] = executableCommand(codex, ["queue", "--help"]);
  const check = spawnSyncCaptured(program, args, {
    windowsHide: true,
    timeout: 10000,
    killSignal: "SIGKILL",
  });
  if (check.error || check.status !== 0)
    throw new Error(`codex queue unavailable: ${check.error ?? check.stderr}`);
}

async function launchWorker(
  directory: string,
  stateDir: string,
  log: number,
): Promise<number | undefined> {
  // The worker inherits the full environment because `codex queue` needs it
  // and the worker reads the --pass-env values from it.
  const child = spawn(process.execPath, [WORKER_ENTRY, directory], {
    cwd: stateDir,
    stdio: ["ignore", log, log],
    detached: true,
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return child.pid;
}
