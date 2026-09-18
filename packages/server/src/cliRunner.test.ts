import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "@agent-office/shared";
import type { Agent, Ticket } from "@agent-office/shared";
import { CliRunner, createStreamParser } from "./cliRunner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "__fixtures__", name), "utf8");

/** Feed a whole recorded NDJSON transcript through the parser and collect what it emitted. */
function run(ndjson: string): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  const parser = createStreamParser((e) => events.push(e));
  for (const line of ndjson.split("\n")) parser.handleLine(line);
  return events;
}

describe("createStreamParser", () => {
  it("parses a plain text reply (pong fixture) into started/thinking/usage/context/done", () => {
    const events = run(fixture("pong.ndjson"));
    expect(events[0]).toEqual({ kind: "started", sessionId: "fcb453db-f747-5070-809c-16a168291772" });
    expect(events.some((e) => e.kind === "thinking")).toBe(true);
    const usage = events.filter((e) => e.kind === "usage");
    expect(usage.length).toBeGreaterThan(0);
    const last = usage[usage.length - 1];
    expect(last).toMatchObject({ kind: "usage" });
    if (last?.kind === "usage") expect(last.costUsd).toBeGreaterThan(0);
    const ctx = events.find((e) => e.kind === "context");
    expect(ctx).toBeDefined();
    if (ctx?.kind === "context") {
      expect(ctx.pct).toBeGreaterThan(0);
      expect(ctx.pct).toBeLessThanOrEqual(1);
    }
    const done = events.at(-1);
    expect(done?.kind).toBe("done");
    if (done?.kind === "done") expect(done.summary).toBe("pong");
  });

  it("maps a tool_use block to a tool_use event with a short summary", () => {
    const events = run(fixture("bash-tool.ndjson"));
    const toolUse = events.find((e) => e.kind === "tool_use");
    expect(toolUse).toBeDefined();
    if (toolUse?.kind === "tool_use") {
      expect(toolUse.name).toBe("Bash");
      expect(toolUse.summary.length).toBeLessThanOrEqual(60);
      expect(toolUse.summary).toContain("ls");
    }
    expect(events.at(-1)?.kind).toBe("done");
  });

  it("maps an Agent tool_use to subagent_start, routes its nested tool_use to subagent_tool, and closes it on result", () => {
    const events = run(fixture("subagent-task.ndjson"));
    const start = events.find((e) => e.kind === "subagent_start");
    expect(start).toBeDefined();
    if (start?.kind === "subagent_start") {
      expect(start.type).toBe("general-purpose"); // no subagent_type in this build's Agent input
      expect(start.description).toBe("count files");
    }
    const subTool = events.find((e) => e.kind === "subagent_tool");
    expect(subTool).toBeDefined();
    if (subTool?.kind === "subagent_tool" && start?.kind === "subagent_start") {
      expect(subTool.id).toBe(start.id); // ids must line up so Office can find the tile
      expect(subTool.name).toBe("Bash");
    }
    // the subagent's own tool call must not also surface as a top-level tool_use
    expect(events.filter((e) => e.kind === "tool_use")).toHaveLength(0);
    const stop = events.find((e) => e.kind === "subagent_stop");
    expect(stop).toBeDefined();
    if (stop?.kind === "subagent_stop" && start?.kind === "subagent_start") expect(stop.id).toBe(start.id);
  });

  it("maps a failed result (error_max_turns) to an error event and still closes open subagents", () => {
    const events = run(fixture("error-max-turns.ndjson"));
    expect(events.at(-1)?.kind).toBe("error");
  });

  it("closing the process without a result emits an error, unless suppressed by stop()", () => {
    const events: RunnerEvent[] = [];
    const parser = createStreamParser((e) => events.push(e));
    parser.handleLine('{"type":"system","subtype":"init","session_id":"s1"}');
    parser.onProcessClose(1, "boom");
    expect(events.at(-1)).toMatchObject({ kind: "error" });

    const events2: RunnerEvent[] = [];
    const parser2 = createStreamParser((e) => events2.push(e));
    parser2.handleLine('{"type":"system","subtype":"init","session_id":"s1"}');
    parser2.onProcessClose(0, "", true);
    expect(events2.some((e) => e.kind === "error")).toBe(false);
  });

  it("closes open subagents when the process exits mid-flight", () => {
    const events: RunnerEvent[] = [];
    const parser = createStreamParser((e) => events.push(e));
    parser.handleLine(
      JSON.stringify({
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "tool_use", id: "sub1", name: "Agent", input: { description: "d" } }] },
      }),
    );
    parser.onProcessClose(0, "");
    expect(events.filter((e) => e.kind === "subagent_stop")).toEqual([{ kind: "subagent_stop", id: "sub1" }]);
  });

  it("ignores unknown/malformed lines without throwing", () => {
    const events: RunnerEvent[] = [];
    const parser = createStreamParser((e) => events.push(e));
    expect(() => {
      parser.handleLine("not json at all");
      parser.handleLine("");
      parser.handleLine('{"type":"some_future_message_type","weird":true}');
      parser.handleLine('{"type":"assistant","message":{"content":[{"type":"future_block_type"}]}}');
    }).not.toThrow();
    expect(events).toEqual([]);
  });
});

/**
 * A spawn that never gets off the ground (missing binary, missing working
 * folder) used to reach Node as an unhandled ChildProcess "error" event and
 * take the whole server down; it must fail just the one session instead.
 */
describe("CliRunner launch failures", () => {
  const agent = (cwd: string): Agent =>
    ({
      id: "a1",
      name: "Ada",
      role: "coder",
      cwd,
      model: "sonnet",
      permissionMode: "acceptEdits",
      allowedTools: ["Read"],
      systemPrompt: "",
    }) as Agent;
  const ticket = { id: "t1", title: "do a thing", description: "" } as Ticket;

  const startAndCollect = async (runner: CliRunner, a: Agent) => {
    const events: RunnerEvent[] = [];
    runner.start(a, ticket, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 300));
    return events;
  };

  it("reports a missing working folder without spawning", async () => {
    const events = await startAndCollect(new CliRunner(), agent("/definitely/not/a/folder/here"));
    expect(events).toEqual([{ kind: "error", message: "working folder does not exist: /definitely/not/a/folder/here" }]);
  });

  it("reports a missing binary once, and does not throw", async () => {
    const events = await startAndCollect(new CliRunner("agent-office-no-such-binary"), agent(here));
    const errors = events.filter((e) => e.kind === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: expect.stringContaining("is not on PATH") });
  });
});
