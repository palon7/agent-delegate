import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataRoot } from "../shared/scripts/lib/paths.mjs";
import {
  resolveExecutable,
  executableCommand,
} from "../shared/scripts/lib/executable.mjs";

const windows = process.platform === "win32";

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-platform-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function setPath(t, ...directories) {
  const original = process.env.PATH;
  process.env.PATH = directories.join(path.delimiter);
  t.after(() => {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  });
}

test("Windows state paths use LocalAppData and reject relative roots", () => {
  assert.equal(
    dataRoot("win32", { LOCALAPPDATA: "D:\\User Data" }, "C:\\Users\\Alice"),
    "D:\\User Data\\delegate",
  );
  assert.equal(
    dataRoot("win32", {}, "C:\\Users\\Alice"),
    "C:\\Users\\Alice\\AppData\\Local\\delegate",
  );
  assert.throws(
    () => dataRoot("win32", { LOCALAPPDATA: "relative" }),
    /absolute/,
  );
});

for (const { name, pkg, bin, local, suffix } of [
  {
    name: "codex",
    pkg: "@openai/codex",
    bin: "codex.js",
    local: false,
    suffix: ".cmd",
  },
  {
    name: "opencode",
    pkg: "opencode-ai",
    bin: "opencode",
    local: true,
    suffix: ".ps1",
  },
]) {
  test(
    `Windows resolves ${local ? "local" : "global"} npm ${name}${suffix}`,
    { skip: !windows },
    (t) => {
      const root = temporary(t);
      const packageRoot = path.join(root, "node_modules", pkg);
      const entry = path.join(packageRoot, "bin", bin);
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: pkg, bin: { [name]: `bin/${bin}` } }),
      );
      fs.writeFileSync(entry, "#!/usr/bin/env node\n");

      const directory = local ? path.join(root, "node_modules", ".bin") : root;
      fs.mkdirSync(directory, { recursive: true });
      const wrapper = path.join(directory, name + suffix);
      fs.writeFileSync(wrapper, "This wrapper must never be executed");
      setPath(t, directory);

      assert.equal(resolveExecutable(wrapper, pkg), entry);
      assert.equal(resolveExecutable(name, pkg), entry);
      assert.deepEqual(executableCommand(entry, ["--help"]), [
        process.execPath,
        [entry, "--help"],
      ]);

      const native = path.join(directory, name + ".exe");
      fs.writeFileSync(native, "native placeholder");
      assert.equal(resolveExecutable(name, pkg), native);
    },
  );
}

test(
  "Windows PATH search skips unresolved wrappers but explicit paths fail",
  { skip: !windows },
  (t) => {
    const root = temporary(t);
    const first = path.join(root, "shim");
    const second = path.join(root, "native");
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    const wrapper = path.join(first, "codex.cmd");
    fs.writeFileSync(wrapper, "unresolved wrapper");
    fs.writeFileSync(path.join(first, "codex"), "#!/bin/sh\n");
    const native = path.join(second, "codex.exe");
    fs.writeFileSync(native, "native placeholder");
    setPath(t, first, second);

    assert.equal(resolveExecutable("codex", "@openai/codex"), native);
    assert.throws(
      () => resolveExecutable(wrapper, "@openai/codex"),
      /Cannot resolve script wrapper/,
    );

    fs.unlinkSync(native);
    assert.throws(
      () => resolveExecutable("codex", "@openai/codex"),
      /Cannot resolve script wrapper/,
    );
  },
);

test(
  "POSIX rejects Node agent scripts without execute permission",
  { skip: windows },
  (t) => {
    const root = temporary(t);
    const entry = path.join(root, "agent.js");
    fs.writeFileSync(entry, "#!/usr/bin/env node\n", { mode: 0o600 });

    assert.throws(() => resolveExecutable(entry), /Executable not found/);
    fs.chmodSync(entry, 0o700);
    assert.equal(resolveExecutable(entry), entry);
  },
);
