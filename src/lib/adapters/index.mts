import type { AgentName } from "../config.mjs";
import type { AgentAdapter } from "./types.mjs";
import { codex } from "./codex.mjs";
import { opencode } from "./opencode.mjs";
const adapters: Record<AgentName, AgentAdapter> = { codex, opencode };
export function adapterFor(agent: AgentName): AgentAdapter {
  if (!Object.hasOwn(adapters, agent))
    throw new Error(`Unknown agent: ${agent}`);
  return adapters[agent];
}
