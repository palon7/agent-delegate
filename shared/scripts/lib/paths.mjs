import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
export const SRT_VERSION = "0.0.76";
export function existingCodexHome() {
    return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}
export function codexRuntimeWrites(home) {
    return ["auth.json", "sessions", "tmp"].map((name) => path.join(home, name));
}
export function dataRoot(platform = process.platform, env = process.env, home = os.homedir()) {
    const p = path.posix;
    let base;
    if (platform === "darwin")
        base = p.join(home, "Library", "Application Support");
    else
        base = env.XDG_DATA_HOME || p.join(home, ".local", "share");
    if (!p.isAbsolute(base))
        throw new Error("Handler data directory must be absolute");
    return p.join(base, "better-agent-handler");
}
export function repositoryPaths(cwd, agent) {
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
            : {
                auth_file: path.join(state, "data", "opencode", "auth.json"),
                agent_config: path.join(state, "config", "opencode", "opencode.json"),
            }),
    };
}
export function srtPaths() {
    const prefix = path.join(dataRoot(), "tools", "srt", SRT_VERSION);
    return {
        prefix,
        cli: path.join(prefix, "node_modules", "@anthropic-ai", "sandbox-runtime", "dist", "cli.js"),
    };
}
