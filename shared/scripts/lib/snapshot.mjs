// Compare working files without changing the repository's index or object store.
import fs from "node:fs";
import path from "node:path";
import { spawnSyncCaptured } from "./spawn.mjs";
const NULL_OID = "0".repeat(40);
export function git(cwd, args, { env = process.env, data, allowed = [0], } = {}) {
    const result = spawnSyncCaptured("git", ["-C", cwd.toString(), ...args], {
        windowsHide: true,
        env,
        input: data,
        maxBuffer: 128 * 1024 * 1024,
    });
    if (result.error)
        throw result.error;
    if (result.status === null || !allowed.includes(result.status))
        throw new Error(`git ${args[0]} failed: ${result.stderr}`);
    return result.stdout;
}
export function gitText(...args) {
    return git(...args)
        .toString()
        .trim();
}
export function isInside(child, parent) {
    const relative = path.relative(parent, child);
    return (relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative)));
}
function snapshotEnvironment(directory) {
    return {
        ...process.env,
        GIT_INDEX_FILE: path.join(directory, "index"),
        GIT_OBJECT_DIRECTORY: path.join(directory, "objects"),
        GIT_OPTIONAL_LOCKS: "0",
    };
}
function readSnapshotInfo(directory) {
    return JSON.parse(fs.readFileSync(path.join(directory, "snapshot.json"), "utf8"));
}
export function initialize(cwd, directory, include = []) {
    const repository = fs.realpathSync(gitText(cwd, ["rev-parse", "--show-toplevel"]));
    const snapshot = path.join(fs.realpathSync(path.dirname(path.resolve(directory))), path.basename(directory));
    if (isInside(snapshot, repository))
        throw new Error("snapshot directory must be outside the repository");
    if (git(repository, ["ls-files", "--unmerged", "-z"]).length)
        throw new Error("resolve merge conflicts before taking a snapshot");
    const objects = gitText(repository, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "objects",
    ]);
    fs.mkdirSync(snapshot, { mode: 0o700 });
    fs.mkdirSync(path.join(snapshot, "objects/info"), { recursive: true });
    fs.writeFileSync(path.join(snapshot, "objects/info/alternates"), `${objects}\n`);
    const info = {
        cwd: repository,
        include: process.platform === "win32"
            ? include.map((p) => p.replaceAll("\\", "/"))
            : include,
    };
    fs.writeFileSync(path.join(snapshot, "snapshot.json"), JSON.stringify(info) + "\n");
    const env = snapshotEnvironment(snapshot);
    git(repository, ["read-tree", "--empty"], { env });
    git(repository, ["update-index", "-z", "--index-info"], {
        env,
        data: git(repository, ["ls-files", "--stage", "-z"]),
    });
    capture(snapshot, "before");
}
export function capture(directory, label) {
    const snapshot = fs.realpathSync(directory);
    const { cwd, include } = readSnapshotInfo(snapshot);
    const env = snapshotEnvironment(snapshot);
    git(cwd, ["update-index", "--refresh"], { env, allowed: [0, 1] });
    const modes = new Map();
    for (const record of splitNulTerminated(git(cwd, ["ls-files", "--stage", "-z"], { env }))) {
        const tab = record.indexOf(9);
        modes.set(record.subarray(tab + 1).toString("hex"), record.subarray(0, 6).toString());
    }
    const fileMode = gitText(cwd, ["config", "--bool", "--get", "core.filemode"], {
        allowed: [0, 1],
    }) !== "false";
    const symlinks = gitText(cwd, ["config", "--bool", "--get", "core.symlinks"], {
        allowed: [0, 1],
    }) !== "false";
    const entries = candidatePaths(cwd, include, env).map((name) => indexEntry(cwd, name, include, env, modes.get(name.toString("hex")), fileMode, symlinks));
    if (entries.length)
        git(cwd, ["update-index", "-z", "--index-info"], {
            env,
            data: Buffer.concat(entries),
        });
    const tree = writeTree(cwd, snapshot, env);
    fs.writeFileSync(path.join(snapshot, label), tree + "\n");
    return tree;
}
export function difference(directory) {
    const snapshot = fs.realpathSync(directory);
    const { cwd } = readSnapshotInfo(snapshot);
    const before = fs.readFileSync(path.join(snapshot, "before"), "utf8").trim();
    const after = capture(snapshot, "after");
    return git(cwd, ["diff", "--no-ext-diff", "--no-textconv", before, after, "--"], { env: snapshotEnvironment(snapshot) });
}
function candidatePaths(cwd, include, env) {
    const changed = git(cwd, ["diff-files", "--name-only", "--no-ext-diff", "--no-textconv", "-z"], { env });
    const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { env });
    // Keep raw Git path bytes, including filenames that are not valid UTF-8.
    const paths = new Map();
    for (const name of [
        ...splitNulTerminated(changed),
        ...splitNulTerminated(untracked),
        ...include.map((p) => Buffer.from(p)),
    ])
        if (name.length)
            paths.set(name.toString("hex"), name);
    return [...paths.values()].sort(Buffer.compare);
}
function splitNulTerminated(buffer) {
    const names = [];
    let start = 0;
    for (let end = buffer.indexOf(0); end !== -1; end = buffer.indexOf(0, start)) {
        names.push(buffer.subarray(start, end));
        start = end + 1;
    }
    return names;
}
/** An `update-index --index-info` record for the path's current content. */
function indexEntry(cwd, name, include, env, trackedMode, fileMode, symlinks) {
    const text = name.toString();
    if (path.isAbsolute(text) || text.split("/").includes(".."))
        throw new Error("included paths must be relative files inside the repository");
    const absolute = Buffer.concat([Buffer.from(cwd + "/"), name]);
    const stat = lstatIfExists(absolute);
    if (!stat)
        return removalEntry(name);
    if (stat.isDirectory()) {
        if (fs.existsSync(Buffer.concat([absolute, Buffer.from("/.git")])))
            return entry("160000", gitText(absolute, ["rev-parse", "HEAD"]), name);
        if (include.includes(text))
            throw new Error("--include accepts files, not directories");
        return removalEntry(name);
    }
    if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute, { encoding: "buffer" });
        return entry("120000", storeObject(cwd, env, ["--stdin"], target), name);
    }
    if (stat.isFile()) {
        if (!symlinks && trackedMode === "120000")
            return entry("120000", storeObject(cwd, env, ["--stdin"], fs.readFileSync(absolute)), name);
        // Let Git read the file so large files need not be loaded into JS memory.
        const oid = storeObject(cwd, env, ["--stdin-paths"], quotePath(absolute));
        const executable = fileMode ? stat.mode & 0o111 : trackedMode === "100755";
        return entry(executable ? "100755" : "100644", oid, name);
    }
    throw new Error(`unsupported file type: ${text}`);
}
function entry(mode, oid, name) {
    return Buffer.concat([
        Buffer.from(`${mode} ${oid}\t`),
        name,
        Buffer.from("\0"),
    ]);
}
function removalEntry(name) {
    return entry("0", NULL_OID, name);
}
function lstatIfExists(file) {
    try {
        return fs.lstatSync(file);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
        return undefined;
    }
}
// Git's quoted path format preserves arbitrary filename bytes and newlines.
function quotePath(file) {
    const escaped = [...file]
        .map((byte) => "\\" + byte.toString(8).padStart(3, "0"))
        .join("");
    return Buffer.from(`"${escaped}"\n`);
}
function storeObject(cwd, env, hashArgs, data) {
    const oid = gitText(cwd, ["hash-object", ...hashArgs], { env, data });
    try {
        git(cwd, ["cat-file", "-e", oid], { env });
    }
    catch {
        git(cwd, ["hash-object", "-w", ...hashArgs], { env, data });
    }
    return oid;
}
// Avoid refreshing borrowed object timestamps while writing trees.
function writeTree(cwd, snapshot, env) {
    const alternates = path.join(snapshot, "objects/info/alternates");
    fs.renameSync(alternates, alternates + ".saved");
    try {
        const { GIT_ALTERNATE_OBJECT_DIRECTORIES: _, ...treeEnv } = env;
        return gitText(cwd, ["write-tree", "--missing-ok"], { env: treeEnv });
    }
    finally {
        fs.renameSync(alternates + ".saved", alternates);
    }
}
