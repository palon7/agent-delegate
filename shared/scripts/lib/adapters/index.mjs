import { codex } from "./codex.mjs";
import { opencode } from "./opencode.mjs";
const adapters = { codex, opencode };
export function adapterFor(agent) {
    if (!Object.hasOwn(adapters, agent))
        throw new Error(`Unknown agent: ${agent}`);
    return adapters[agent];
}
