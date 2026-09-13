#!/usr/bin/env node
import { parseArgs } from "node:util";
import { difference, initialize } from "./lib/snapshot.mjs";

process.umask(0o077);
try {
  const { values, positionals } = parseArgs({
    options: {
      cwd: { type: "string" },
      snapshot: { type: "string" },
      include: { type: "string", multiple: true, default: [] },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });

  if (values.help)
    console.log(
      "snapshot.mjs before --cwd PATH --snapshot PATH [--include FILE]\nsnapshot.mjs diff --snapshot PATH",
    );
  else if (positionals.length !== 1 || !values.snapshot)
    throw new Error("Specify before or diff and --snapshot");
  else if (positionals[0] === "before" && values.cwd)
    initialize(values.cwd, values.snapshot, values.include);
  else if (positionals[0] === "diff")
    process.stdout.write(difference(values.snapshot));
  else throw new Error("before requires --cwd; command must be before or diff");
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
