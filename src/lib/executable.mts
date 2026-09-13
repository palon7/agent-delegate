import fs from "node:fs";
import path from "node:path";

/** Keep arguments out of cmd.exe, including JSON settings and queue messages. */
export function executableCommand(
  file: string,
  args: string[] = [],
): [program: string, args: string[]] {
  const node =
    /\.[cm]?js$/i.test(file) ||
    (process.platform === "win32" &&
      !/\.(exe|com)$/i.test(file) &&
      isNodeScript(file));
  return node ? [process.execPath, [file, ...args]] : [file, args];
}

/** Windows cannot run shebang scripts such as extensionless npm bin entries. */
function isNodeScript(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const prefix = Buffer.alloc(256);
    const size = fs.readSync(fd, prefix);
    return /^#![^\r\n]*\bnode(?:\s|$)/.test(prefix.toString("utf8", 0, size));
  } finally {
    fs.closeSync(fd);
  }
}

export function resolveExecutable(value: string, npmPackage?: string): string {
  const windows = process.platform === "win32";
  const explicit =
    path.isAbsolute(value) ||
    value.includes("/") ||
    (windows && value.includes("\\"));
  const candidates = explicit
    ? [path.resolve(value)]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((dir) => path.resolve(dir.replace(/^"|"$/g, ""), value));
  let unresolvedWrapper: string | undefined;

  for (const candidate of candidates) {
    const files =
      windows && !path.extname(candidate)
        ? [
            candidate + ".exe",
            candidate + ".com",
            candidate + ".cmd",
            candidate + ".bat",
            candidate + ".ps1",
            candidate,
          ]
        : [candidate];
    for (const file of files) {
      if (!isFile(file)) continue;
      if (windows && /\.(cmd|bat|ps1)$/i.test(file)) {
        const entry = npmPackage && npmEntry(file, npmPackage);
        if (entry) return entry;
        unresolvedWrapper ??= file;
        continue;
      }

      if (windows) {
        // Package managers also put extensionless POSIX shell shims on PATH.
        if (!path.extname(file) && !isNodeScript(file)) {
          unresolvedWrapper ??= file;
          continue;
        }
        return file;
      }

      try {
        // SRT executes the agent directly, including Node scripts on POSIX.
        fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch {
        /* try next PATH entry */
      }
    }
  }

  if (unresolvedWrapper)
    throw new Error(
      `Cannot resolve script wrapper: ${unresolvedWrapper}. Specify the agent's .exe or Node entry point instead.`,
    );

  throw new Error(
    `Executable not found: ${value}. The required tool is not installed or not available at the specified path.`,
  );
}

/** npm global bins live beside node_modules; local bins live in .bin. */
function npmEntry(wrapper: string, packageName: string): string | undefined {
  const dir = path.dirname(wrapper);
  const modules =
    path.basename(dir) === ".bin"
      ? path.dirname(dir)
      : path.join(dir, "node_modules");
  const root = path.join(modules, packageName);
  const metadata = path.join(root, "package.json");
  if (!isFile(metadata)) return;

  // Read the selected package's bin metadata, never execute or parse a wrapper.
  const pkg = JSON.parse(fs.readFileSync(metadata, "utf8"));
  const name = path.basename(wrapper, path.extname(wrapper)).toLowerCase();
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[name];
  if (pkg.name !== packageName || typeof bin !== "string") return;

  const entry = path.resolve(root, bin);
  if (isFile(entry)) return entry;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
