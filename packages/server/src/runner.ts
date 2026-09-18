import type { Agent, RunnerEvent, Ticket } from "@agent-office/shared";

/**
 * A SessionRunner turns a ticket into a stream of RunnerEvents for one agent.
 * Implementations: MockRunner (M1/M2), CliRunner (headless `claude -p`, M3),
 * SdkRunner (API key, later). The UI never sees which one is in use.
 */
export interface SessionRunner {
  start(agent: Agent, ticket: Ticket, emit: (e: RunnerEvent) => void): RunningSession;
}

export interface RunningSession {
  sessionId: string;
  /** deliver user text to a waiting session */
  respond(text: string): void;
  stop(): void;
}
