import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { adapterFor } from "../shared/scripts/lib/adapters/index.mjs";

test(
  "Codex resolves handler overrides to real plugin keys and preserves other plugins",
  {
    skip:
      !process.env.CODEX_TEST_CLI &&
      "Set CODEX_TEST_CLI to test the installed CLI parser",
    timeout: 15000,
  },
  async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "bah-cli-config-"));
    fs.mkdirSync(
      path.join(home, "plugins", "cache", "custom-market", "delegate"),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(home, "config.toml"),
      `
[plugins."delegate@custom-market"]
enabled = true
[plugins."unrelated@custom-market"]
enabled = true
`,
    );

    const invocation = adapterFor("codex").command({
      codex_home: home,
      state_dir: home,
      job_dir: home,
      mode: "review",
      executable: process.env.CODEX_TEST_CLI,
    });
    const overrides = invocation.filter(
      (arg, index) =>
        invocation[index - 1] === "-c" && arg.startsWith("plugins."),
    );
    const child = spawn(
      process.env.CODEX_TEST_CLI,
      ["app-server", "--stdio", ...overrides.flatMap((value) => ["-c", value])],
      {
        cwd: home,
        env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const closed = once(child, "close");
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");

    try {
      send({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "bah-config-test", version: "1" } },
      });
      let config;

      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.id === 1) {
          assert.equal(message.error, undefined);
          send({ method: "initialized" });
          send({
            id: 2,
            method: "config/read",
            params: { includeLayers: false },
          });
        }
        if (message.id === 2) {
          assert.equal(message.error, undefined);
          config = message.result.config;
          break;
        }
      }

      assert.ok(config, "Codex must return resolved configuration");
      assert.equal(config.plugins["delegate@custom-market"].enabled, false);
      assert.equal(config.plugins["unrelated@custom-market"].enabled, true);
      assert.ok(!Object.keys(config.plugins).some((key) => key.includes('"')));
    } finally {
      clearTimeout(timer);
      lines.close();
      child.kill("SIGKILL");
      await closed;
      fs.rmSync(home, { recursive: true, force: true });
    }
  },
);
