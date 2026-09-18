import { nanoid } from "nanoid";
import type { Agent, RunnerEvent, Ticket } from "@agent-office/shared";
import type { RunningSession, SessionRunner } from "./runner.js";

const TOOLS = [
  ["Read", "src/api/orders.ts"],
  ["Grep", "TODO in src/"],
  ["Edit", "src/api/orders.ts"],
  ["Bash", "pnpm test"],
  ["Glob", "**/*.test.ts"],
  ["WebSearch", "commercetools cart api"],
] as const;

const SUBAGENT_TYPES = ["Explore", "Plan", "general-purpose"];

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/**
 * Fakes a Claude Code session: thinks, uses tools, occasionally spins up
 * subagents, sometimes asks the user something, then finishes.
 * Deterministic enough to demo every UI state.
 */
export class MockRunner implements SessionRunner {
  constructor(private opts: { speed?: number } = {}) {}

  start(agent: Agent, ticket: Ticket, emit: (e: RunnerEvent) => void): RunningSession {
    const speed = this.opts.speed ?? 1;
    const sessionId = nanoid(10);
    let stopped = false;
    let waitingResolve: ((t: string) => void) | null = null;
    const timers: NodeJS.Timeout[] = [];

    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        const t = setTimeout(res, ms / speed);
        timers.push(t);
      });

    const run = async () => {
      emit({ kind: "started", sessionId });
      let input = 2000;
      let output = 0;
      let cost = 0;
      const steps = 6 + Math.floor(Math.random() * 6);
      const wantsSubagents = agent.role === "coder" && Math.random() < 0.6;
      const asksUser = ticket.title.toLowerCase().includes("?") || Math.random() < 0.35;

      for (let i = 0; i < steps && !stopped; i++) {
        emit({ kind: "thinking" });
        await sleep(600 + Math.random() * 900);
        if (stopped) return;

        if (wantsSubagents && i === 2) {
          const ids = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => nanoid(6));
          for (const id of ids) {
            emit({ kind: "subagent_start", id, type: rand(SUBAGENT_TYPES), description: rand(["find usages of Cart", "map service boundaries", "check test coverage", "draft migration plan"]) });
            await sleep(300);
          }
          for (let k = 0; k < 4 && !stopped; k++) {
            for (const id of ids) {
              const [name, summary] = rand(TOOLS);
              emit({ kind: "subagent_tool", id, name, summary });
            }
            await sleep(900);
          }
          for (const id of ids) {
            emit({ kind: "subagent_stop", id });
            await sleep(250);
          }
        }

        if (asksUser && i === Math.floor(steps / 2)) {
          emit({ kind: "waiting", prompt: "Should I also update the OpenAPI spec?" });
          await new Promise<void>((res) => {
            waitingResolve = () => res();
          });
          waitingResolve = null;
          if (stopped) return;
        }

        const [name, summary] = rand(TOOLS);
        if (agent.role !== "chat") emit({ kind: "tool_use", name, summary });
        await sleep(500 + Math.random() * 1200);

        input += 1500 + Math.random() * 4000;
        output += 200 + Math.random() * 600;
        cost += 0.01 + Math.random() * 0.04;
        emit({ kind: "usage", input, output, cacheRead: input * 0.6, costUsd: cost });
        emit({ kind: "context", pct: Math.min(0.95, (input + output) / 200_000 + i * 0.04) });
      }
      if (stopped) return;
      if (Math.random() < 0.08) {
        emit({ kind: "error", message: "Mock: simulated failure (exit 1)" });
        return;
      }
      emit({ kind: "done", summary: `Finished: ${ticket.title}` });
    };

    void run();

    return {
      sessionId,
      // The mock keeps its session running across a `waiting`, so there is
      // always something there to answer.
      isAlive: () => !stopped,
      respond: (text) => {
        if (waitingResolve) waitingResolve(text);
      },
      stop: () => {
        stopped = true;
        timers.forEach(clearTimeout);
        if (waitingResolve) waitingResolve("");
      },
    };
  }

  /**
   * The mock keeps its session alive across a `waiting`, so `respond` already
   * unblocks it and there is nothing to resume. Present only so the demo
   * office satisfies the same interface as the real runner.
   */
  resume(agent: Agent, sessionId: string, text: string, emit: (e: RunnerEvent) => void): RunningSession {
    void text;
    emit({ kind: "started", sessionId });
    emit({ kind: "done", summary: `Resumed ${agent.name}` });
    return { sessionId, respond: () => {}, stop: () => {}, isAlive: () => false };
  }
}
