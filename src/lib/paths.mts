import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AgentName } from "./config.mjs";

export const SRT_VERSION = "0.0.76";

export function existingCodexHome(): string {
  return path.resolve(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  );
}

export function codexRuntimeWrites(home: string): string[] {
  return ["auth.json", "sessions", "tmp"].map((name) => path.join(home, name));
}

export function opencodePaths(cwd: string) {
  const home = os.homedir();
  const xdg = (variable: string, fallback: string) => {
    const value = process.env[variable];
    return value && path.isAbsolute(value) ? value : path.join(home, fallback);
  };
  const config = path.join(xdg("XDG_CONFIG_HOME", ".config"), "opencode");
  const data = path.join(xdg("XDG_DATA_HOME", ".local/share"), "opencode");
  const cache = path.join(xdg("XDG_CACHE_HOME", ".cache"), "opencode");
  const state = path.join(xdg("XDG_STATE_HOME", ".local/state"), "opencode");
  const settings = [
    config,
    path.join(cwd, ".opencode"),
    path.join(cwd, "opencode.json"),
    path.join(cwd, "opencode.jsonc"),
  ];

  for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"])
    if (process.env[key]) settings.push(path.resolve(cwd, process.env[key]!));

  const writes = [data, cache, state];
  if (process.env.OPENCODE_DB) {
    const database = path.resolve(cwd, process.env.OPENCODE_DB);
    if (!writes.some((dir) => database.startsWith(dir + path.sep)))
      writes.push(database, database + "-wal", database + "-shm");
  }

  return {
    auth_file: path.join(data, "auth.json"),
    agent_config: config,
    config_paths: [...new Set(settings)],
    runtime_write_paths: [...new Set(writes)],
  };
}

export function dataRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string {
  const p = path.posix;
  let base: string;

  if (platform === "darwin")
    base = p.join(home, "Library", "Application Support");
  else base = env.XDG_DATA_HOME || p.join(home, ".local", "share");

  if (!p.isAbsolute(base))
    throw new Error("Handler data directory must be absolute");

  return p.join(base, "better-agent-handler");
}

export function repositoryPaths(cwd: string, agent: AgentName) {
  const repository = fs.realpathSync(cwd);
  const id = createHash("sha256").update(repository).digest("hex").slice(0, 20);
  const state = path.join(dataRoot(), "repositories", id, agent);

  return {
    repository,
    state_dir: state,
    profile: path.join(state, "srt-profile.json"),
    ...(agent === "codex"
      ? {
          codex_home: existingCodexHome(),
          auth_file: path.join(existingCodexHome(), "auth.json"),
        }
      : opencodePaths(repository)),
  };
}

export function srtPaths() {
  const prefix = path.join(dataRoot(), "tools", "srt", SRT_VERSION);

  return {
    prefix,
    cli: path.join(
      prefix,
      "node_modules",
      "@anthropic-ai",
      "sandbox-runtime",
      "dist",
      "cli.js",
    ),
  };
}
