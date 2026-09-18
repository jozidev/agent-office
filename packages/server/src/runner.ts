import type { Agent, RunnerEvent, Ticket } from "@agent-office/shared";

/**
 * A SessionRunner turns a ticket into a stream of RunnerEvents for one agent.
 * Implementations: MockRunner (M1/M2), CliRunner (headless `claude -p`, M3),
 * SdkRunner (API key, later). The UI never sees which one is in use.
 */
export interface SessionRunner {
  start(agent: Agent, ticket: Ticket, emit: (e: RunnerEvent) => void): RunningSession;
  /**
   * Continue a conversation that ended waiting on the user. Separate from
   * `respond` because a headless run has already exited by the time it is
   * waiting — there is no stdin left to write to.
   */
  resume(agent: Agent, sessionId: string, text: string, emit: (e: RunnerEvent) => void): RunningSession;
}

export interface RunningSession {
  sessionId: string;
  /** deliver user text to a session that is still alive */
  respond(text: string): void;
  stop(): void;
  /**
   * Whether the underlying process is still there to talk to. A headless
   * `claude -p` that stopped to ask the user has already exited, so answering
   * it means `resume`, not `respond` — and only the runner can tell.
   */
  isAlive(): boolean;
}
