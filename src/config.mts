#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  configPath,
  DEFAULT_SANDBOX,
  isAgent,
  readConfig,
  setSandbox,
} from "./lib/config.mjs";
import { assertNotDelegated } from "./lib/job.mjs";

process.umask(0o077);

try {
  const { values } = parseArgs({
    options: {
      agent: { type: "string" },
      sandbox: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    console.log(
      "config.mjs [--agent opencode|codex --sandbox srt|none] (change only at the user's request)",
    );
  } else if (values.agent !== undefined || values.sandbox !== undefined) {
    assertNotDelegated();
    if (
      !isAgent(values.agent) ||
      !["srt", "none"].includes(values.sandbox ?? "")
    )
      throw new Error("Required: --agent opencode|codex --sandbox srt|none");

    setSandbox(values.agent, values.sandbox as "srt" | "none");
    console.log(JSON.stringify({ file: configPath(), config: readConfig() }));
  } else {
    console.log(
      JSON.stringify({
        file: configPath(),
        defaults: DEFAULT_SANDBOX,
        config: readConfig(),
      }),
    );
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
