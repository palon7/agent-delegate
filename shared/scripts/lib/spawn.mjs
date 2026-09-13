import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, } from "node:child_process";
/** Capture synchronous child I/O without Node's pipe-backed stdio. */
export function spawnSyncCaptured(program, args, options = {}) {
    const temporary = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "delegate-spawn-"));
    const stdinPath = path.join(temporary, "stdin");
    const stdoutPath = path.join(temporary, "stdout");
    const stderrPath = path.join(temporary, "stderr");
    const descriptors = [];
    try {
        let stdin = "ignore";
        if (options.input !== undefined) {
            fs.writeFileSync(stdinPath, options.input, { mode: 0o600 });
            stdin = fs.openSync(stdinPath, "r");
            descriptors.push(stdin);
        }
        const stdout = fs.openSync(stdoutPath, "w", 0o600);
        descriptors.push(stdout);
        const stderr = fs.openSync(stderrPath, "w", 0o600);
        descriptors.push(stderr);
        const { input: _input, maxBuffer = 1024 * 1024, ...spawnOptions } = options;
        const result = spawnSync(program, [...args], {
            ...spawnOptions,
            stdio: [stdin, stdout, stderr],
        });
        for (const descriptor of descriptors.splice(0))
            fs.closeSync(descriptor);
        // Bound memory before loading file-backed output; capture itself uses disk.
        if (fs.statSync(stdoutPath).size + fs.statSync(stderrPath).size > maxBuffer)
            return {
                status: result.status,
                signal: result.signal,
                error: result.error ??
                    Object.assign(new Error("Child output exceeds maxBuffer"), {
                        code: "ENOBUFS",
                    }),
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
            };
        return {
            status: result.status,
            signal: result.signal,
            error: result.error,
            stdout: fs.readFileSync(stdoutPath),
            stderr: fs.readFileSync(stderrPath),
        };
    }
    finally {
        for (const descriptor of descriptors)
            fs.closeSync(descriptor);
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
