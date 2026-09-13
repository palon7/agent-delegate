import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSyncCaptured } from "../shared/scripts/lib/spawn.mjs";

test("file capture preserves binary input and real execution failures", () => {
  const input = Buffer.from([0, 255, 10, 128]);
  const result = spawnSyncCaptured(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    { input },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, input);
  const failed = spawnSyncCaptured(process.execPath, [
    "-e",
    "process.stderr.write('failed');process.exit(7)",
  ]);
  assert.equal(failed.status, 7);
  assert.equal(failed.stderr.toString(), "failed");
});

test("file capture rejects oversized output before loading it", () => {
  for (const stream of ["stdout", "stderr"]) {
    const result = spawnSyncCaptured(
      process.execPath,
      ["-e", `process.${stream}.write('12345')`],
      { maxBuffer: 4 },
    );
    assert.equal(result.error?.code, "ENOBUFS");
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.length, 0);
  }
  const exact = spawnSyncCaptured(
    process.execPath,
    ["-e", "process.stdout.write('1234')"],
    { maxBuffer: 4 },
  );
  assert.equal(exact.error, undefined);
  assert.equal(exact.stdout.toString(), "1234");
});
