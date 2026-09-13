import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  git,
  initialize,
  difference,
} from "../shared/scripts/lib/snapshot.mjs";
import { worker, command, environment } from "../shared/scripts/lib/worker.mjs";
import {
  executionProfile,
  assertNotDelegated,
  jobEnvironment,
  start,
} from "../shared/scripts/lib/job.mjs";

import { sandboxFor, setSandbox } from "../shared/scripts/lib/config.mjs";
import { adapterFor } from "../shared/scripts/lib/adapters/index.mjs";
import {
  repositoryPaths,
  srtPaths,
  opencodePaths,
} from "../shared/scripts/lib/paths.mjs";
import { checkSrtVersion } from "../shared/scripts/lib/srt.mjs";

const events = [
  { type: "text", sessionID: "ses_test", part: { text: "final report" } },
  { type: "step_finish", part: { reason: "stop" } },
];

function mockEnv(t, key, value) {
  const before = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handler-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const repo = path.join(root, "repo with spaces");
  fs.mkdirSync(repo);
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "user.email", "test@example.invalid"]);
  fs.writeFileSync(path.join(repo, "source.txt"), "committed\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), "ignored*\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "fixture"]);
  return { root, repo, baseline: path.join(root, "baseline") };
}

function metadata(repo) {
  const root = path.join(repo, ".git");
  return fs
    .readdirSync(root, { recursive: true })
    .sort()
    .flatMap((p) => {
      const file = path.join(root, p);
      const stat = fs.statSync(file, { bigint: true });
      return stat.isFile()
        ? [[p, fs.readFileSync(file).toString("hex"), stat.mtimeNs]]
        : [];
    });
}

function executable(root, name, source) {
  const file = path.join(root, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return file;
}

function jobFixture(t, payload = events, exit = 0, queueExit = 0) {
  const fixtureData = fixture(t);
  const { root, repo } = fixtureData;
  for (const [key, name] of [
    ["XDG_DATA_HOME", "data"],
    ["XDG_CACHE_HOME", "cache"],
    ["XDG_STATE_HOME", "runtime-state"],
  ])
    mockEnv(t, key, path.join(root, name));
  const state = path.join(root, "state");
  fs.mkdirSync(state);
  const directory = path.join(state, "job");
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, "request.md"), "task");

  const stream =
    typeof payload === "string"
      ? payload
      : payload.map((e) => JSON.stringify(e)).join("\n");
  const srt = executable(
    root,
    "fake-srt",
    `if (process.argv.includes('--help')) { console.log('--auto'); process.exit(0); } if (process.argv.includes('--version')) { console.log('0.0.76'); process.exit(0); } if (process.argv.includes('-e')) { process.stdout.write('delegate-srt-ready'); process.exit(0); } require('fs').writeFileSync(${JSON.stringify(path.join(directory, "invocation.json"))}, JSON.stringify({args: process.argv.slice(2), cwd: process.cwd(), env: process.env})); process.stdout.write(${JSON.stringify(stream)}); process.exitCode=${exit};`,
  );
  const codex = executable(
    root,
    "fake-codex",
    `if (process.argv.includes('--help')) process.exit(0); require('fs').appendFileSync(${JSON.stringify(path.join(directory, "notifications"))},JSON.stringify(process.argv.slice(2))+'\\n'); process.exitCode=${queueExit};`,
  );
  const profile = path.join(root, "profile.json");
  fs.writeFileSync(
    profile,
    JSON.stringify({
      network: { allowedDomains: [] },
      filesystem: {
        allowRead: [repo, state, ...opencodePaths(repo).runtime_write_paths],
        allowWrite: opencodePaths(repo).runtime_write_paths,
      },
    }),
  );

  const job = {
    agent: "opencode",
    sandbox: "srt",
    delegation_depth: 0,
    job_dir: directory,
    state_dir: state,
    cwd: repo,
    srt_settings: profile,
    thread: "00000000-0000-4000-8000-000000000001",
    mode: "implement",
    pass_env: [],
    codex,
    srt,
    executable: srt,
  };
  return { ...fixtureData, directory, job, profile };
}

async function runJob(t, payload, exit, queueExit) {
  const f = jobFixture(t, payload, exit, queueExit);
  fs.writeFileSync(path.join(f.directory, "job.json"), JSON.stringify(f.job));
  await worker(f.directory);
  return {
    ...f,
    state: JSON.parse(fs.readFileSync(path.join(f.directory, "state.json"))),
  };
}

test("snapshot preserves staging and Git metadata, includes edits/deletions/new files", (t) => {
  const { repo, baseline } = fixture(t);
  fs.writeFileSync(path.join(repo, "source.txt"), "staged\n");
  git(repo, ["add", "source.txt"]);
  fs.writeFileSync(path.join(repo, "source.txt"), "already here\n");
  fs.writeFileSync(path.join(repo, "untracked file.txt"), "before\n");
  fs.writeFileSync(path.join(repo, "ignored-added.txt"), "staged ignored\n");
  git(repo, ["add", "-f", "ignored-added.txt"]);
  fs.writeFileSync(path.join(repo, "ignored-output"), "excluded\n");
  const before = metadata(repo);

  initialize(repo, baseline);
  fs.writeFileSync(path.join(repo, "source.txt"), "already here\nnew work\n");
  fs.unlinkSync(path.join(repo, "untracked file.txt"));
  fs.writeFileSync(path.join(repo, "ignored-added.txt"), "changed ignored\n");
  fs.writeFileSync(path.join(repo, "new.txt"), "new file\n");

  const diff = difference(baseline).toString();
  for (const text of ["+new work", "-before", "+new file", "+changed ignored"])
    assert.ok(diff.includes(text));
  assert.ok(!diff.includes("excluded"));
  assert.ok(!diff.includes("-committed"));
  assert.deepEqual(metadata(repo), before);
});

test("clean snapshot, renames, symlinks, executable and explicit ignored files", (t) => {
  const { repo, baseline } = fixture(t);
  fs.writeFileSync(path.join(repo, "ignored-input"), "before\n");
  const before = metadata(repo);

  initialize(repo, baseline, ["ignored-input"]);
  assert.equal(difference(baseline).length, 0);
  assert.deepEqual(metadata(repo), before);

  fs.renameSync(path.join(repo, "source.txt"), path.join(repo, "renamed.txt"));
  fs.symlinkSync("renamed.txt", path.join(repo, "link"));
  fs.writeFileSync(path.join(repo, "run.sh"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(repo, "ignored-input"), "after\n");

  const diff = difference(baseline).toString();
  for (const text of [
    "rename to renamed.txt",
    "new file mode 120000",
    "new file mode 100755",
    "+after",
  ])
    assert.ok(diff.includes(text));
});

test("snapshot preserves unusual filename bytes and Git clean filters", (t) => {
  const { repo, baseline } = fixture(t);
  const raw = Buffer.concat([
    Buffer.from(repo + "/odd\n"),
    Buffer.from([0xff]),
  ]);
  fs.writeFileSync(raw, "before\n");
  fs.writeFileSync(path.join(repo, ".gitattributes"), "*.txt text eol=lf\n");

  initialize(repo, baseline);
  fs.writeFileSync(raw, "after\n");
  fs.writeFileSync(path.join(repo, "source.txt"), "committed\r\n");

  const diff = difference(baseline).toString();
  assert.ok(diff.includes("+after"));
  assert.ok(!diff.includes("source.txt"));
});

test("linked worktrees and read-only profile retain network scope", (t) => {
  const { repo, root, baseline } = fixture(t);
  const linked = path.join(root, "linked");
  git(repo, ["worktree", "add", "--detach", linked]);

  initialize(linked, baseline);
  fs.writeFileSync(path.join(linked, "source.txt"), "linked change\n");
  assert.ok(difference(baseline).includes("+linked change"));

  const state = path.join(root, "state");
  fs.mkdirSync(state);
  const job = path.join(state, "job");
  fs.mkdirSync(job);
  const profile = path.join(root, "profile.json");
  const network = { allowedDomains: ["example.invalid"] };
  fs.writeFileSync(
    profile,
    JSON.stringify({
      network,
      filesystem: { allowRead: [linked], allowWrite: [root] },
    }),
  );

  const settings = JSON.parse(
    fs.readFileSync(executionProfile(profile, linked, state, job, "review")),
  );
  assert.deepEqual(settings.network, network);
  assert.deepEqual(settings.filesystem.allowWrite, [state]);
  assert.ok(settings.filesystem.denyWrite.includes(linked));
  assert.ok(settings.filesystem.denyWrite.includes(fs.realpathSync(profile)));
  assert.ok(settings.filesystem.denyWrite.includes(path.join(repo, ".git")));
});

test("worker success, bounded single notification, environment and duplicate claim", async (t) => {
  const { directory, state, job } = await runJob(t);
  assert.equal(state.status, "completed");
  assert.equal(state.notification, "accepted");
  assert.equal(state.session_id, "ses_test");
  assert.equal(
    fs.readFileSync(path.join(directory, "report.md"), "utf8"),
    "final report\n",
  );

  const calls = fs
    .readFileSync(path.join(directory, "notifications"), "utf8")
    .trim()
    .split("\n");
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes("final report"));

  const invocation = JSON.parse(
    fs.readFileSync(path.join(directory, "invocation.json")),
  );
  assert.equal(invocation.cwd, job.cwd);
  assert.match(invocation.env.TMPDIR, /^\/tmp\/bah-srt-/);
  assert.equal(fs.existsSync(invocation.env.TMPDIR), false);
  assert.ok(
    invocation.args.includes(`TMPDIR=${path.join(job.state_dir, "tmp")}`),
  );
  assert.equal(invocation.env.XDG_CACHE_HOME, process.env.XDG_CACHE_HOME);

  await assert.rejects(worker(directory), { code: "EEXIST" });
});

test("failure conditions notify once and uncertain notification is not retried", async (t) => {
  for (const [payload, exit] of [
    [events, 1],
    [[], 0],
    ["bad JSON", 0],
    [events.slice(0, 1), 0],
    [[...events, { type: "error", error: "quota" }], 0],
  ]) {
    const { directory, state } = await runJob(t, payload, exit);
    assert.equal(state.status, "failed");
    assert.equal(
      fs
        .readFileSync(path.join(directory, "notifications"), "utf8")
        .trim()
        .split("\n").length,
      1,
    );
  }

  const { state, directory } = await runJob(t, events, 0, 1);
  assert.equal(state.status, "completed");
  assert.equal(state.notification, "unconfirmed");
  assert.ok(fs.existsSync(path.join(directory, "report.md")));
});

test("only final message parts retained; tool prose cannot certify completion", async (t) => {
  const payload = [
    { type: "text", part: { messageID: "first", text: "Progress" } },
    { type: "step_finish", part: { reason: "tool-calls" } },
    { type: "step_start" },
    { type: "text", part: { messageID: "last", text: "Findings" } },
    { type: "text", part: { messageID: "last", text: "Checks" } },
    events[1],
  ];
  const { directory, state } = await runJob(t, payload);
  assert.equal(state.status, "completed");
  assert.equal(
    fs.readFileSync(path.join(directory, "report.md"), "utf8"),
    "Findings\nChecks\n",
  );

  const proseOnly = [events[0], { type: "step_start" }, events[1]];
  assert.equal((await runJob(t, proseOnly)).state.status, "failed");
});

test("detached CLI starts once, passes env without saving it, and reports completion", async (t) => {
  const { job, directory, profile } = jobFixture(t);
  const script = fileURLToPath(
    new URL("../shared/scripts/agent_job.mjs", import.meta.url),
  );
  const args = [
    script,
    "--agent",
    "opencode",
    "--job-dir",
    directory,
    "--state-dir",
    job.state_dir,
    "--cwd",
    job.cwd,
    "--profile",
    profile,
    "--thread",
    job.thread,
    "--mode",
    "implement",
    "--srt",
    job.srt,
    "--executable",
    job.executable,
    "--codex",
    job.codex,
    "--pass-env",
    "HANDLER_TEST_SECRET",
  ];
  const options = {
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_CONFIG_HOME: path.join(job.state_dir, "handler-config"),
      HANDLER_TEST_SECRET: "secret-value",
    },
  };

  // Filesystem notification is a test-only completion signal, not runtime polling.
  let watcher;
  const finished = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error("worker did not finish"));
    }, 10000);
    watcher = fs.watch(directory, (_, file) => {
      if (file !== "state.json") return;
      const state = JSON.parse(
        fs.readFileSync(path.join(directory, "state.json")),
      );
      if (state.notification === "accepted") {
        clearTimeout(timeout);
        watcher.close();
        resolve(state);
      }
    });
  });

  const result = spawnSync(process.execPath, args, {
    ...options,
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "started");
  assert.equal((await finished).status, "completed");

  assert.ok(
    !fs
      .readFileSync(path.join(directory, "job.json"), "utf8")
      .includes("secret-value"),
  );
  const invocation = JSON.parse(
    fs.readFileSync(path.join(directory, "invocation.json")),
  );
  assert.equal(invocation.env.HANDLER_TEST_SECRET, "secret-value");

  const duplicate = spawnSync(process.execPath, args, options);
  assert.notEqual(duplicate.status, 0);
  assert.equal(
    fs
      .readFileSync(path.join(directory, "notifications"), "utf8")
      .trim()
      .split("\n").length,
    1,
  );
});

test("persistent sandbox defaults are read-only and explicit changes preserve the other agent", (t) => {
  const { root } = fixture(t);
  const file = path.join(root, "config", "config.json");
  assert.equal(sandboxFor("opencode", file), "srt");
  assert.equal(sandboxFor("codex", file), "none");
  assert.equal(fs.existsSync(file), false);
  setSandbox("opencode", "none", file);
  setSandbox("codex", "srt", file);
  assert.equal(sandboxFor("opencode", file), "none");
  assert.equal(sandboxFor("codex", file), "srt");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const before = fs.readFileSync(file);
  sandboxFor("codex", file);
  assert.deepEqual(fs.readFileSync(file), before);
  fs.writeFileSync(file, '{"version":1,"agents":{"codex":{"sandbox":"typo"}}}');
  assert.throws(() => sandboxFor("codex", file), /Invalid sandbox/);
});

test("recursion and reserved parent variables are rejected before launch", async (t) => {
  mockEnv(t, "BETTER_AGENT_HANDLER_DEPTH", "1");
  assert.throws(() => assertNotDelegated(), /Recursive/);
  await assert.rejects(start({ delegationDepth: 0 }), /Recursive/);
  process.env.BETTER_AGENT_HANDLER_DEPTH = "0";
  assert.throws(() => assertNotDelegated(1), /Recursive/);
  for (const variable of [
    "CODEX_THREAD_ID",
    "CODEX_HOME",
    "HOME",
    "XDG_CONFIG_HOME",
    "BETTER_AGENT_HANDLER_DEPTH",
  ])
    assert.throws(() => jobEnvironment([variable]), /Reserved/);
});

test("Codex command preserves explicit model/session, native review policy and child isolation", (t) => {
  const { job } = jobFixture(t);
  Object.assign(job, { agent: "codex", sandbox: "none", mode: "review" });
  job.codex_home = path.join(job.state_dir, "existing-codex-home");
  fs.mkdirSync(
    path.join(job.codex_home, "plugins", "cache", "custom-market", "delegate"),
    { recursive: true },
  );
  const initial = command(job);
  assert.equal(initial[0], job.executable);
  assert.deepEqual(initial.slice(1, 2), ["exec"]);
  assert.ok(initial.includes('sandbox_mode="read-only"'));
  assert.ok(initial.includes('approvals_reviewer="auto_review"'));
  assert.ok(!initial.includes("--model"));
  assert.ok(!initial.includes("--approve-for-me"));
  assert.ok(!initial.includes("--dangerously-bypass-approvals-and-sandbox"));
  mockEnv(t, "CODEX_THREAD_ID", job.thread);
  mockEnv(t, "CODEX_SESSION_ID", "parent-session");
  mockEnv(t, "XDG_CONFIG_HOME", "/existing-tool-config");
  mockEnv(t, "CODEX_API_KEY", "fake-inherited-key");
  const env = environment(job);
  assert.equal(env.CODEX_THREAD_ID, undefined);
  assert.equal(env.CODEX_HOME, job.codex_home);
  assert.equal(env.CODEX_SESSION_ID, undefined);
  assert.equal(env.XDG_CONFIG_HOME, "/existing-tool-config");
  assert.equal(env.CODEX_API_KEY, "fake-inherited-key");
  assert.ok(!initial.includes("--ignore-user-config"));
  assert.ok(!initial.includes("--ignore-rules"));
  assert.ok(initial.includes("plugins.delegate@custom-market.enabled=false"));
  for (const removed of [
    "features.plugins=false",
    "features.apps=false",
    "features.hooks=false",
    'cli_auth_credentials_store="auto"',
    'shell_environment_policy.inherit="all"',
  ])
    assert.ok(!initial.includes(removed));
  assert.equal(env.BETTER_AGENT_HANDLER_DEPTH, "1");
  Object.assign(job, {
    session: "child-session",
    model: "chosen-model",
    mode: "implement",
  });
  const resume = command(job);
  assert.deepEqual(resume.slice(1, 4), ["exec", "resume", "child-session"]);
  assert.equal(resume[resume.indexOf("--model") + 1], "chosen-model");
  assert.ok(resume.includes('sandbox_mode="workspace-write"'));
  assert.ok(!resume.includes("--color"));
  job.codex_profile = "work";
  assert.deepEqual(command(job).slice(1, 6), [
    "--profile",
    "work",
    "exec",
    "resume",
    "child-session",
  ]);
  job.sandbox = "srt";
  assert.deepEqual(command(job).slice(0, 4), [
    job.srt,
    "--settings",
    job.srt_settings,
    "--",
  ]);

  fs.mkdirSync(
    path.join(job.codex_home, "plugins", "cache", "invalid.market", "delegate"),
    { recursive: true },
  );
  assert.throws(
    () => command(job),
    /unsupported marketplace name: invalid.market/,
  );
});

async function codexJob(
  t,
  { payload, final = "Codex final", exit = 0, session } = {},
) {
  const f = jobFixture(t);
  const stream = payload ?? [
    { type: "thread.started", thread_id: "child-session" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { type: "agent_message", text: "intermediate prose" },
    },
    { type: "turn.completed" },
  ];
  f.job.agent = "codex";
  f.job.codex_home = path.join(f.root, "existing-codex-home");
  f.job.sandbox = "none";
  f.job.mode = "review";
  f.job.session = session;
  f.job.executable = executable(
    f.root,
    "fake-agent",
    `
    const fs = require("fs");
    const args = process.argv.slice(2);
    fs.writeFileSync(${JSON.stringify(path.join(f.directory, "invocation.json"))},
      JSON.stringify({args, cwd: process.cwd(), env: process.env}));
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      fs.writeFileSync(${JSON.stringify(path.join(f.directory, "input.txt"))}, input);
      process.stdout.write(${JSON.stringify(typeof stream === "string" ? stream : stream.map((e) => JSON.stringify(e)).join("\n"))});
      process.stdout.end(() => {
        // Deliberately write the final file after stdout closes.
        setTimeout(() => {
          if (${JSON.stringify(final)} !== null)
            fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], ${JSON.stringify(final)});
          process.exitCode = ${exit};
        }, 30);
      });
    });
  `,
  );
  fs.writeFileSync(path.join(f.directory, "job.json"), JSON.stringify(f.job));
  await worker(f.directory);
  return {
    ...f,
    state: JSON.parse(fs.readFileSync(path.join(f.directory, "state.json"))),
  };
}

test("Codex final message is read after process close, shared review prompt and notification are routed correctly", async (t) => {
  const { directory, state, job } = await codexJob(t, {
    session: "saved-child",
  });
  assert.equal(state.status, "completed");
  assert.equal(state.session_id, "child-session");
  assert.equal(
    fs.readFileSync(path.join(directory, "report.md"), "utf8"),
    "Codex final\n",
  );
  const input = fs.readFileSync(path.join(directory, "input.txt"), "utf8");
  assert.ok(input.includes("data integrity"));
  assert.ok(input.includes("Do not delegate again"));
  assert.ok(!input.includes(job.thread));
  const invocation = JSON.parse(
    fs.readFileSync(path.join(directory, "invocation.json")),
  );
  assert.equal(invocation.cwd, job.cwd);
  assert.deepEqual(invocation.args.slice(0, 3), [
    "exec",
    "resume",
    "saved-child",
  ]);
  assert.equal(invocation.env.CODEX_THREAD_ID, undefined);
  const notifications = fs
    .readFileSync(path.join(directory, "notifications"), "utf8")
    .trim()
    .split("\n");
  assert.equal(notifications.length, 1);
  assert.ok(notifications[0].includes("$delegate:codex"));
});

test("Codex exit, terminal errors, malformed streams and missing final files cannot certify success", async (t) => {
  for (const options of [
    { exit: 1 },
    { final: null },
    { final: "" },
    { payload: [] },
    { payload: "not json" },
    {
      payload: [
        { type: "turn.completed" },
        { type: "error", message: "quota" },
      ],
    },
    { payload: [{ type: "turn.failed", error: { message: "rejected" } }] },
  ]) {
    const { state, directory } = await codexJob(t, options);
    assert.equal(state.status, "failed");
    assert.equal(state.notification, "accepted");
    await assert.rejects(worker(directory), { code: "EEXIST" });
  }
});

test("OpenCode runs directly only when its saved sandbox mode is none", async (t) => {
  const { directory, job } = jobFixture(t);
  job.sandbox = "none";
  job.srt = "/missing/srt";
  fs.writeFileSync(path.join(directory, "job.json"), JSON.stringify(job));
  await worker(directory);
  const invocation = JSON.parse(
    fs.readFileSync(path.join(directory, "invocation.json")),
  );
  assert.equal(invocation.args[0], "run");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(directory, "state.json"))).status,
    "completed",
  );
});

test("Codex preflight rejects older CLIs without invoking inference", (t) => {
  const { root } = fixture(t);
  const old = executable(root, "old-codex", "console.log('exec help');");
  assert.throws(() => adapterFor("codex").preflight(old), /automatic approval/);
});

test("Codex cannot resume its parent and SRT requires approved shared runtime writes", async (t) => {
  const { root, directory, job, profile } = jobFixture(t);
  mockEnv(t, "XDG_CONFIG_HOME", path.join(root, "handler-config"));

  await assert.rejects(
    start({
      agent: "codex",
      jobDir: directory,
      stateDir: job.state_dir,
      cwd: job.cwd,
      mode: "review",
      thread: job.thread,
      session: job.thread,
      codex: job.codex,
      passEnv: [],
    }),
    /Cannot resume the parent/,
  );
  assert.equal(fs.existsSync(path.join(directory, "job.json")), false);

  assert.throws(
    () =>
      executionProfile(profile, job.cwd, job.state_dir, directory, "review", [
        path.join(root, "auth.json"),
      ]),
    /must approve agent runtime write access/,
  );
});

test("Codex detached launcher needs neither SRT nor profile and snapshots the saved preference", async (t) => {
  const { root, directory, job } = jobFixture(t);
  mockEnv(t, "XDG_CONFIG_HOME", path.join(root, "handler-config"));
  const parentHome = path.join(root, "parent-codex");
  fs.mkdirSync(parentHome);
  fs.writeFileSync(
    path.join(parentHome, "auth.json"),
    '{"test_token":"initial"}',
  );
  fs.writeFileSync(
    path.join(parentHome, "config.toml"),
    'model = "user-default"\n',
  );
  mockEnv(t, "CODEX_HOME", parentHome);
  const agent = executable(
    root,
    "codex-exec",
    `
    const fs = require("fs");
    const args = process.argv.slice(2);
    if (args.includes("--help")) { console.log("--approve-for-me --ignore-user-config --ignore-rules"); process.exit(0); }
    if (args[0] === "features") { console.log("skip_host_skill_discovery"); process.exit(0); }
    const assert = require("node:assert/strict");
    assert.equal(process.env.CODEX_HOME, ${JSON.stringify(parentHome)});
    assert.equal(JSON.parse(fs.readFileSync(process.env.CODEX_HOME + '/auth.json')).test_token, 'initial');
    assert.ok(!args.includes('--ignore-user-config'));
    assert.ok(!args.includes('--ignore-rules'));
    assert.equal(args[args.indexOf('resume') + 1], 'named-child-session');
    fs.writeFileSync(process.env.CODEX_HOME + '/auth.json', '{"test_token":"refreshed"}');
    process.stdin.resume();
    process.stdin.on("end", () => {
      fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], "detached final");
      console.log(JSON.stringify({type:"turn.completed"}));
    });
  `,
  );
  let watcher;
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.close();
      reject(new Error("worker did not finish"));
    }, 10000);
    watcher = fs.watch(directory, (_, file) => {
      if (file !== "state.json") return;
      const state = JSON.parse(fs.readFileSync(path.join(directory, file)));
      if (state.notification === "accepted") {
        clearTimeout(timer);
        watcher.close();
        resolve(state);
      }
    });
  });
  const result = await start({
    agent: "codex",
    jobDir: directory,
    stateDir: job.state_dir,
    cwd: job.cwd,
    mode: "review",
    thread: job.thread,
    codex: job.codex,
    executable: agent,
    session: "named-child-session",
    srt: "/does-not-exist",
    passEnv: [],
  });
  assert.equal(result.status, "started");
  assert.equal(result.sandbox, "none");
  assert.equal((await finished).status, "completed");
  const saved = JSON.parse(fs.readFileSync(path.join(directory, "job.json")));
  assert.equal(saved.agent, "codex");
  assert.equal(saved.sandbox, "none");
  assert.equal(saved.srt, undefined);
  assert.equal(saved.codex_home, parentHome);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(parentHome, "auth.json"))).test_token,
    "refreshed",
  );
  assert.equal(
    fs.readFileSync(path.join(parentHome, "config.toml"), "utf8"),
    'model = "user-default"\n',
  );
  assert.equal(
    fs.existsSync(path.join(job.state_dir, "codex", "auth.json")),
    false,
  );
  assert.equal(fs.existsSync(path.join(directory, "srt.json")), false);
  assert.equal(fs.existsSync(path.join(root, "handler-config")), false);
});

test("saved recursive job fails without invoking the agent and still reports the failure once", async (t) => {
  const { directory, job } = jobFixture(t);
  job.delegation_depth = 1;
  fs.writeFileSync(path.join(directory, "job.json"), JSON.stringify(job));
  await worker(directory);
  const state = JSON.parse(fs.readFileSync(path.join(directory, "state.json")));
  assert.equal(state.status, "failed");
  assert.match(state.error, /Recursive/);
  assert.equal(state.notification, "accepted");
  assert.equal(fs.existsSync(path.join(directory, "invocation.json")), false);
});

test("OpenCode receives the full prompt once through its attachment and no stdin", async (t) => {
  const { directory, root, job } = jobFixture(t);
  job.sandbox = "none";
  job.executable = executable(
    root,
    "capture-opencode",
    `
    const fs = require("fs");
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const args = process.argv.slice(2);
      const attachment = fs.readFileSync(args[args.indexOf("--file") + 1], "utf8");
      fs.writeFileSync(${JSON.stringify(path.join(directory, "prompt-inputs.json"))}, JSON.stringify({input, attachment}));
      console.log(${JSON.stringify(events.map((event) => JSON.stringify(event)).join("\n"))});
    });
  `,
  );
  fs.writeFileSync(path.join(directory, "request.md"), "unique user objective");
  fs.writeFileSync(path.join(directory, "job.json"), JSON.stringify(job));
  await worker(directory);
  const inputs = JSON.parse(
    fs.readFileSync(path.join(directory, "prompt-inputs.json")),
  );
  assert.equal(inputs.input, "");
  assert.equal(inputs.attachment.split("unique user objective").length - 1, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(directory, "state.json"))).status,
    "completed",
  );
});

test("OpenCode preserves credentials and configuration, auto-approving only SRT jobs", (t) => {
  const { root, job } = jobFixture(t);
  const inherited = {
    HOME: path.join(root, "home"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    OPENCODE_CONFIG: "custom.jsonc",
    OPENCODE_CONFIG_DIR: "custom-config",
    OPENCODE_CONFIG_CONTENT:
      '{"model":"custom/model","share":"auto","plugin":["custom-auth"]}',
    OPENAI_API_KEY: "dummy-secret",
    OPENCODE_PERMISSION:
      '{"bash":{"*":"ask","git push*":"deny"},"task":"allow","*":"deny"}',
  };
  for (const [key, value] of Object.entries(inherited)) mockEnv(t, key, value);
  mockEnv(t, "CODEX_THREAD_ID", job.thread);
  mockEnv(t, "CODEX_SESSION_ID", job.thread);

  const adapter = adapterFor("opencode");
  for (const sandbox of ["srt", "none"]) {
    const delegated = {
      ...job,
      sandbox,
      mode: "review",
      session: "existing-session",
    };
    const env = environment(delegated);
    for (const [key, value] of Object.entries(inherited))
      if (key !== "OPENCODE_PERMISSION") assert.equal(env[key], value, key);

    assert.equal(env.CODEX_THREAD_ID, undefined);
    assert.equal(env.CODEX_SESSION_ID, undefined);
    assert.equal(env.BETTER_AGENT_HANDLER_DEPTH, "1");
    assert.deepEqual(JSON.parse(env.OPENCODE_PERMISSION), {
      bash: { "*": "ask", "git push*": "deny" },
      "*": "deny",
      task: "deny",
      edit: "deny",
    });
    const args = adapter.command(delegated);
    assert.equal(args.includes("--auto"), sandbox === "srt");
    assert.equal(args[args.indexOf("--session") + 1], "existing-session");
    assert.equal(args.includes("--model"), false);
  }

  mockEnv(t, "OPENCODE_PERMISSION", '"deny"');
  assert.equal(JSON.parse(environment(job).OPENCODE_PERMISSION)["*"], "deny");
  mockEnv(t, "OPENCODE_PERMISSION", '{"bash":"invalid"}');
  assert.throws(() => environment(job), /Invalid OPENCODE_PERMISSION/);
});

test("OpenCode preflight requires --auto only with SRT and never invokes a model", (t) => {
  const { root } = fixture(t);
  const cli = executable(
    root,
    "old-opencode",
    `
    require('node:assert/strict').deepEqual(process.argv.slice(2), ['run', '--help']);
    console.log('run help');
  `,
  );
  const adapter = adapterFor("opencode");
  assert.throws(() => adapter.preflight(cli, "srt"), /--auto support/);
  const supported = executable(
    root,
    "supported-opencode",
    "console.error('--auto');",
  );
  assert.doesNotThrow(() => adapter.preflight(supported, "srt"));
  assert.doesNotThrow(() => adapter.preflight("/missing-not-checked", "none"));
});

test("OpenCode paths use existing XDG locations and require approval for shared writes", (t) => {
  const { root, repo, job, profile, directory } = jobFixture(t);
  mockEnv(t, "XDG_CONFIG_HOME", path.join(root, "config"));
  mockEnv(t, "OPENCODE_CONFIG", "custom.jsonc");
  mockEnv(t, "OPENCODE_DB", path.join(root, "database", "sessions.db"));
  const paths = opencodePaths(repo);
  assert.equal(
    paths.auth_file,
    path.join(root, "data", "opencode", "auth.json"),
  );
  assert.ok(paths.config_paths.includes(path.join(repo, "custom.jsonc")));
  assert.ok(
    paths.runtime_write_paths.includes(process.env.OPENCODE_DB + "-wal"),
  );

  assert.throws(
    () =>
      executionProfile(
        profile,
        repo,
        job.state_dir,
        directory,
        "review",
        paths.runtime_write_paths,
        paths.config_paths,
      ),
    /must approve agent runtime write/,
  );
  fs.writeFileSync(path.join(repo, "custom.jsonc"), "{}");
  const protectedProfile = executionProfile(
    profile,
    repo,
    job.state_dir,
    directory,
    "implement",
    [],
    paths.config_paths,
  );
  const settings = JSON.parse(fs.readFileSync(protectedProfile));
  assert.ok(
    settings.filesystem.denyWrite.includes(path.join(repo, "custom.jsonc")),
  );
});

test("explicit API credential variables pass through while isolation variables remain reserved", (t) => {
  mockEnv(t, "CODEX_API_KEY", "test-only-credential");
  assert.equal(
    jobEnvironment(["CODEX_API_KEY"]).CODEX_API_KEY,
    "test-only-credential",
  );
  assert.equal(jobEnvironment([]).CODEX_API_KEY, undefined);
  for (const key of [
    "CODEX_THREAD_ID",
    "CODEX_HOME",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
  ])
    assert.throws(() => jobEnvironment([key]), /Reserved/);
});

test("missing agent executable reports the prerequisite without a setup reference or job launch", async (t) => {
  const { root, directory, job } = jobFixture(t);
  mockEnv(t, "XDG_CONFIG_HOME", path.join(root, "handler-config"));
  await assert.rejects(
    start({
      agent: "codex",
      jobDir: directory,
      stateDir: job.state_dir,
      cwd: job.cwd,
      mode: "review",
      thread: job.thread,
      codex: job.codex,
      executable: path.join(root, "not-installed"),
      srt: "/not-needed",
      passEnv: [],
    }),
    (error) => {
      assert.match(error.message, /Executable not found/);
      assert.match(error.message, /not installed/);
      assert.ok(!error.message.includes("setup.md"));
      return true;
    },
  );
  assert.equal(fs.existsSync(path.join(directory, "job.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "notifications")), false);
});

test("SRT-enabled launch checks executable availability before the profile", async (t) => {
  const { root, directory, job } = jobFixture(t);
  mockEnv(t, "XDG_CONFIG_HOME", path.join(root, "handler-config"));
  const args = {
    agent: "opencode",
    jobDir: directory,
    stateDir: job.state_dir,
    cwd: job.cwd,
    mode: "review",
    thread: job.thread,
    codex: job.codex,
    executable: job.executable,
    srt: job.srt,
    passEnv: [],
  };
  for (const key of ["codex", "srt", "executable"]) {
    await assert.rejects(
      start({ ...args, [key]: path.join(root, "not-installed") }),
      /Executable not found/,
    );
  }
  await assert.rejects(start(args), /SRT profile is missing/);
  assert.equal(fs.existsSync(path.join(directory, "job.json")), false);
});

test("preparation skips SRT for disabled agents and keeps repository paths stable", (t) => {
  const { root, repo } = fixture(t);
  mockEnv(t, "XDG_CONFIG_HOME", path.join(root, "config"));
  mockEnv(t, "XDG_DATA_HOME", path.join(root, "data"));
  const entry = fileURLToPath(
    new URL("../shared/scripts/prepare.mjs", import.meta.url),
  );
  const prepare = (agent, ...args) => {
    const result = spawnSync(
      process.execPath,
      [entry, "--cwd", repo, "--agent", agent, ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  const codex = prepare("codex");
  assert.equal(codex.sandbox, "none");
  assert.equal(codex.srt, undefined);
  assert.equal(fs.existsSync(codex.state_dir), false);

  const opencode = prepare("opencode");
  assert.equal(opencode.authentication, "inherited");
  assert.equal(
    opencode.auth_file,
    path.join(root, "data", "opencode", "auth.json"),
  );
  assert.equal(opencode.agent_config, path.join(root, "config", "opencode"));
  assert.ok(opencode.srt.config_read_paths.includes(opencode.agent_config));
  assert.equal(opencode.srt.version, "0.0.76");
  assert.deepEqual(opencode.srt.install_argv, [
    "npm",
    "install",
    "--prefix",
    srtPaths().prefix,
    "--save-exact",
    "@anthropic-ai/sandbox-runtime@0.0.76",
  ]);
  assert.notEqual(opencode.state_dir, codex.state_dir);
  assert.equal(fs.existsSync(path.join(root, "config")), false);
  assert.equal(fs.existsSync(path.join(root, "data")), false);

  setSandbox("opencode", "none");
  const config = fs.readFileSync(
    path.join(root, "config", "delegate", "config.json"),
  );
  const prepared = prepare("opencode", "--new-job");
  assert.equal(prepared.srt, undefined);
  assert.equal(fs.existsSync(path.join(prepared.state_dir, "data")), false);
  assert.equal(prepared.state_dir, opencode.state_dir);
  assert.equal(fs.statSync(prepared.job_dir).mode & 0o777, 0o700);
  assert.notEqual(prepare("opencode", "--new-job").job_dir, prepared.job_dir);
  assert.deepEqual(
    fs.readFileSync(path.join(root, "config", "delegate", "config.json")),
    config,
  );

  const alias = path.join(root, "repo-alias");
  fs.symlinkSync(repo, alias);
  assert.deepEqual(
    repositoryPaths(alias, "opencode"),
    repositoryPaths(repo, "opencode"),
  );
});

test("SRT package version takes precedence over its unreliable CLI banner", (t) => {
  const { root } = fixture(t);
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist);
  const cli = executable(
    dist,
    "cli.js",
    "throw new Error('CLI banner must not be used');",
  );
  const metadata = path.join(root, "package.json");
  fs.writeFileSync(
    metadata,
    JSON.stringify({
      name: "@anthropic-ai/sandbox-runtime",
      version: "0.0.76",
    }),
  );

  assert.doesNotThrow(() => checkSrtVersion(cli));
  fs.writeFileSync(
    metadata,
    JSON.stringify({
      name: "@anthropic-ai/sandbox-runtime",
      version: "0.0.75",
    }),
  );
  assert.throws(() => checkSrtVersion(cli), /found 0.0.75/);
});

test("SRT initialization failure records a failed launch without starting an agent", async (t) => {
  const { root, directory, job, profile } = jobFixture(t);
  mockEnv(t, "XDG_CONFIG_HOME", path.join(root, "config"));
  const broken = executable(
    root,
    "broken-srt",
    `
    if (process.argv.includes('--version')) { console.log('0.0.76'); process.exit(0); }
    console.error('bubblewrap is missing'); process.exit(1);
  `,
  );

  const args = {
    agent: "opencode",
    jobDir: directory,
    stateDir: job.state_dir,
    cwd: job.cwd,
    mode: "review",
    thread: job.thread,
    codex: job.codex,
    executable: job.executable,
    srt: broken,
    profile,
    passEnv: [],
  };

  await assert.rejects(
    start(args),
    /SRT preflight failed before agent launch: bubblewrap is missing/,
  );

  const state = JSON.parse(fs.readFileSync(path.join(directory, "state.json")));
  assert.equal(state.status, "launch_failed");
  assert.equal(state.notification, "not_attempted");
  await assert.rejects(start(args), /Job already exists/);

  for (const file of ["worker.log", "invocation.json", "notifications"])
    assert.equal(fs.existsSync(path.join(directory, file)), false, file);
});
