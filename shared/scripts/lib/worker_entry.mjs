// Internal entry point for the detached worker started by job.mts.
import { worker } from "./worker.mjs";
process.umask(0o077);
try {
    if (process.argv.length !== 3)
        throw new Error("worker_entry.mjs expects exactly one job directory");
    await worker(process.argv[2]);
}
catch (error) {
    console.error(String(error));
    process.exitCode = 1;
}
