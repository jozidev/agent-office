import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliRunner } from "./cliRunner.js";
import { MockRunner } from "./mockRunner.js";
import type { SessionRunner } from "./runner.js";

const run = promisify(execFile);

export type RunnerKind = "mock" | "cli";

/**
 * Decides which SessionRunner to use: AGENT_OFFICE_RUNNER=mock|cli forces
 * it; otherwise CliRunner when `claude --version` succeeds, else MockRunner.
 */
export async function pickRunner(log: (msg: string) => void = () => {}): Promise<{ runner: SessionRunner; kind: RunnerKind }> {
  const forced = process.env.AGENT_OFFICE_RUNNER;
  if (forced === "mock" || forced === "cli") {
    log(`runner: ${forced} (AGENT_OFFICE_RUNNER=${forced})`);
    return { runner: forced === "cli" ? new CliRunner() : new MockRunner(), kind: forced };
  }
  try {
    await run("claude", ["--version"], { timeout: 8000 });
    log("runner: cli (claude CLI found on PATH)");
    return { runner: new CliRunner(), kind: "cli" };
  } catch {
    log("runner: mock (claude CLI not found on PATH)");
    return { runner: new MockRunner(), kind: "mock" };
  }
}
