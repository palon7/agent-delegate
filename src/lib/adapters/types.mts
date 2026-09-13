import type { Job } from "../job.mjs";
import type { Sandbox } from "../config.mjs";

export interface AgentResult {
  answer: string;
  errors: unknown[];
  finishReason?: string;
}

export interface AgentAdapter {
  skill: string;
  promptViaStdin: boolean;
  preflight(executable: string, sandbox?: Sandbox): void;
  prepare(stateDir: string): void;
  command(job: Job): string[];
  cwd(job: Job): string;
  finalize(job: Job, result: AgentResult): void;
  environment(job: Job): NodeJS.ProcessEnv;
  consumeOutput(
    lines: AsyncIterable<string>,
    session: (id: string) => void,
  ): Promise<AgentResult>;
  validateCompletion(code: number | null, result: AgentResult): boolean;
}

export function parseObject(line: string): Record<string, any> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, any>;
  } catch {
    /* caller records malformed output */
  }
  return undefined;
}
