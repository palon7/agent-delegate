import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SANDBOX = {
  opencode: process.platform === "win32" ? "none" : "srt",
  codex: "none",
} as const;

export type AgentName = keyof typeof DEFAULT_SANDBOX;
export type Sandbox = "srt" | "none";

export interface Config {
  version: 1;
  agents: Partial<Record<AgentName, { sandbox: Sandbox }>>;
}

export function isAgent(value: unknown): value is AgentName {
  return typeof value === "string" && Object.hasOwn(DEFAULT_SANDBOX, value);
}

export function configPath(): string {
  const root =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  if (!path.isAbsolute(root))
    throw new Error("XDG_CONFIG_HOME must be absolute");
  return path.join(root, "delegate", "config.json");
}

/** Reading defaults never writes or changes a user's preference. */
export function readConfig(file = configPath()): Config {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, agents: {} };
    throw error;
  }

  if (
    !data ||
    data.version !== 1 ||
    !data.agents ||
    typeof data.agents !== "object" ||
    Array.isArray(data.agents)
  )
    throw new Error(
      "Invalid handler config: expected version 1 and agents object",
    );

  for (const [agent, settings] of Object.entries(data.agents)) {
    if (
      !isAgent(agent) ||
      !settings ||
      typeof settings !== "object" ||
      !("sandbox" in settings) ||
      !["srt", "none"].includes(String(settings.sandbox))
    )
      throw new Error(`Invalid sandbox configuration for ${agent}`);
  }

  return data;
}

export function sandboxFor(agent: AgentName, file = configPath()): Sandbox {
  const sandbox =
    readConfig(file).agents[agent]?.sandbox ?? DEFAULT_SANDBOX[agent];
  assertSandboxSupported(sandbox);
  return sandbox;
}

export function assertSandboxSupported(sandbox: Sandbox): void {
  if (process.platform === "win32" && sandbox === "srt")
    throw new Error(
      "SRT jobs are not supported on native Windows. Set this agent's sandbox to none, or use WSL2.",
    );
}

/** Called only by the explicit configuration command, never by job launch. */
export function setSandbox(
  agent: AgentName,
  sandbox: Sandbox,
  file = configPath(),
): void {
  assertSandboxSupported(sandbox);

  const config = readConfig(file);
  config.agents[agent] = { sandbox };

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
