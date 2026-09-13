import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { executionProfile } from "../shared/scripts/lib/job.mjs";
import { command, environment } from "../shared/scripts/lib/worker.mjs";
import {
  checkSrtExecution,
  createSrtTemp,
} from "../shared/scripts/lib/srt.mjs";

test(
  "real SRT supports long state paths and protects the approved profile",
  {
    skip:
      !process.env.SRT_TEST_CLI &&
      "Set SRT_TEST_CLI to an installed SRT 0.0.76 entry point",
  },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bah-integration-"));
    const temporary = createSrtTemp();

    try {
      const repo = path.join(root, "repo");
      const state = path.join(root, "long-state-" + "x".repeat(120));
      const directory = path.join(state, "job");
      fs.mkdirSync(repo);
      fs.mkdirSync(directory, { recursive: true });
      fs.mkdirSync(path.join(state, "tmp"));
      const git = spawnSync("git", ["init", "-q", repo]);
      assert.equal(git.status, 0);

      const profile = path.join(state, "srt-profile.json");
      const authHome = path.join(root, "existing-codex");
      fs.mkdirSync(authHome);
      const auth = path.join(authHome, "auth.json");
      fs.writeFileSync(auth, "initial");
      const original = JSON.stringify({
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: {
          denyRead: ["/tmp", "/private/tmp"],
          allowRead: [
            repo,
            state,
            auth,
            path.resolve(process.env.SRT_TEST_CLI, "../.."),
          ],
          allowWrite: [auth],
          denyWrite: [],
        },
      });
      fs.writeFileSync(profile, original);

      for (const mode of ["review", "implement"]) {
        const job = {
          agent: "opencode",
          sandbox: "srt",
          mode,
          state_dir: state,
          job_dir: directory,
          cwd: repo,
          pass_env: [],
          delegation_depth: 0,
          srt: process.env.SRT_TEST_CLI,
          srt_settings: executionProfile(
            profile,
            repo,
            state,
            directory,
            mode,
            [auth],
          ),
          executable: process.execPath,
        };
        const env = environment(job);
        checkSrtExecution(job.srt, job.srt_settings, state, env);

        const source = path.join(repo, "probe");
        const script = `
        const fs = require('fs');
        const blocked = (operation) => {
          try { operation(); throw new Error('write unexpectedly succeeded'); }
          catch (e) { if (!['EACCES','EPERM','EROFS','EBUSY'].includes(e.code)) throw e; }
        };
        blocked(() => fs.writeFileSync(${JSON.stringify(profile)}, 'changed'));
        blocked(() => fs.unlinkSync(${JSON.stringify(profile)}));
        const replacement = ${JSON.stringify(path.join(state, "replacement"))};
        fs.writeFileSync(replacement, 'changed');
        blocked(() => fs.renameSync(replacement, ${JSON.stringify(profile)}));
        fs.writeFileSync(${JSON.stringify(path.join(state, "allowed"))}, 'yes');
        fs.writeFileSync(${JSON.stringify(auth)}, 'refreshed');
        ${mode === "review" ? "blocked(() => " : ""}fs.writeFileSync(${JSON.stringify(source)}, 'yes')${mode === "review" ? ")" : ""};
        process.stdout.write(process.env.TMPDIR);
      `;
        // Keep the worker's SRT/env prefix, replacing only the agent invocation.
        const args = command(job);
        const agentIndex = args.indexOf(job.executable, args.indexOf("--") + 1);
        args.splice(
          agentIndex,
          args.length - agentIndex,
          process.execPath,
          "-e",
          script,
        );
        const result = spawnSync(args[0], args.slice(1), {
          cwd: state,
          env: { ...env, TMPDIR: temporary },
          encoding: "utf8",
          timeout: 20000,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, path.join(state, "tmp"));
        assert.equal(fs.readFileSync(profile, "utf8"), original);
        assert.equal(fs.readFileSync(auth, "utf8"), "refreshed");
        assert.equal(fs.existsSync(source), mode === "implement");
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
