import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SRT_VERSION } from "./paths.mjs";

/** Node entry points avoid npm's platform-specific shell shims. */
export function srtCommand(cli: string): string[] {
  return /\.[cm]?js$/i.test(cli) ? [process.execPath, cli] : [cli];
}

// SRT creates Unix sockets here. Do not inherit the agent's potentially long
// TMPDIR or the host's user-specific macOS temporary directory.
export function createSrtTemp(): string {
  return fs.mkdtempSync("/tmp/bah-srt-");
}

export function sandboxCommand(
  cli: string,
  settings: string,
  agentTmp: string,
  command: string[],
): string[] {
  return [
    ...srtCommand(cli),
    "--settings",
    settings,
    "--",
    "/usr/bin/env",
    `TMPDIR=${agentTmp}`,
    ...command,
  ];
}

export function checkSrtVersion(cli: string): void {
  if (!fs.existsSync(cli))
    throw new Error(
      `SRT is missing: ${cli}. Run prepare.mjs for the installation plan.`,
    );

  // 0.0.76's CLI reports npm_package_version or a hardcoded 1.0.0.
  // Read the installed package instead of trusting that banner.
  const metadata = path.resolve(
    path.dirname(fs.realpathSync(cli)),
    "..",
    "package.json",
  );
  if (fs.existsSync(metadata)) {
    const pkg = JSON.parse(fs.readFileSync(metadata, "utf8"));
    if (pkg.name === "@anthropic-ai/sandbox-runtime") {
      if (pkg.version !== SRT_VERSION)
        throw new Error(
          `SRT ${SRT_VERSION} is required at ${cli}; found ${pkg.version}`,
        );

      return;
    }
  }

  const [program, ...args] = srtCommand(cli);
  const result = spawnSync(program!, [...args, "--version"], {
    encoding: "utf8",
    timeout: 10000,
    killSignal: "SIGKILL",
  });

  if (
    result.error ||
    result.status !== 0 ||
    result.stdout.trim() !== SRT_VERSION
  )
    throw new Error(
      `SRT ${SRT_VERSION} is required at ${cli}: ${result.error ?? (result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`)}`,
    );
}

/** Runs no agent: verifies initialization and child execution before detaching. */
export function checkSrtExecution(
  cli: string,
  settings: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const marker = "better-agent-handler-srt-ready";
  const [program, ...args] = sandboxCommand(cli, settings, env.TMPDIR!, [
    process.execPath,
    "-e",
    `process.stdout.write(${JSON.stringify(marker)})`,
  ]);
  const temporary = createSrtTemp();

  try {
    const result = spawnSync(program!, args, {
      cwd,
      env: { ...env, TMPDIR: temporary },
      encoding: "utf8",
      timeout: 20000,
      killSignal: "SIGKILL",
    });

    if (result.error || result.status !== 0 || result.stdout !== marker)
      throw new Error(
        `SRT preflight failed before agent launch: ${result.error ?? (result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`)}`,
      );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function validateProfile(file: string): void {
  const profile = JSON.parse(fs.readFileSync(file, "utf8"));

  if (
    !profile ||
    typeof profile !== "object" ||
    !profile.network ||
    !Array.isArray(profile.network.allowedDomains) ||
    !profile.filesystem ||
    !Array.isArray(profile.filesystem.allowRead)
  )
    throw new Error(
      `Invalid SRT profile: ${file}; network.allowedDomains and filesystem.allowRead are required`,
    );
}
