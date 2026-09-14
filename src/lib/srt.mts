import fs from "node:fs";
import path from "node:path";
import { SRT_VERSION } from "./paths.mjs";
import { executableCommand } from "./executable.mjs";
import { spawnSyncCaptured } from "./spawn.mjs";

// Keep proxy sockets inside the short, approved job directory: a separate
// /tmp directory is hidden by the profile's /tmp read restriction on Linux.
export function createSrtTemp(jobDirectory: string): string {
  return fs.mkdtempSync(path.join(jobDirectory, "srt-"));
}

export function sandboxCommand(
  cli: string,
  settings: string,
  agentTmp: string,
  command: string[],
): string[] {
  const [program, args] = executableCommand(cli);
  return [
    program,
    ...args,
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

  const [program, args] = executableCommand(cli, ["--version"]);
  const result = spawnSyncCaptured(program, args, {
    timeout: 10000,
    killSignal: "SIGKILL",
  });
  if (
    result.error ||
    result.status !== 0 ||
    result.stdout.toString().trim() !== SRT_VERSION
  )
    throw new Error(
      `SRT ${SRT_VERSION} is required at ${cli}: ${result.error ?? (result.stderr.toString().trim() || result.stdout.toString().trim() || `exit ${result.status}`)}`,
    );
}

/** Runs no agent: verifies initialization and child execution before detaching. */
export function checkSrtExecution(
  cli: string,
  settings: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const marker = "delegate-srt-ready";
  const [program, ...args] = sandboxCommand(cli, settings, env.TMPDIR!, [
    process.execPath,
    "-e",
    `process.stdout.write(${JSON.stringify(marker)})`,
  ]);
  const temporary = createSrtTemp(path.dirname(settings));

  try {
    const result = spawnSyncCaptured(program!, args, {
      cwd,
      env: { ...env, TMPDIR: temporary },
      timeout: 20000,
      killSignal: "SIGKILL",
    });
    if (
      result.error ||
      result.status !== 0 ||
      result.stdout.toString() !== marker
    )
      throw new Error(
        `SRT preflight failed before agent launch: ${result.error ?? (result.stderr.toString().trim() || result.stdout.toString().trim() || `exit ${result.status}`)}`,
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
