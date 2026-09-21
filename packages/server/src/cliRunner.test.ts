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
function run(ndjson: string, opts: { proposesOnly?: boolean } = {}): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  const parser = createStreamParser((e) => events.push(e), opts);
  for (const line of ndjson.split("\n")) parser.handleLine(line);
  // The session settles on process exit, not on the first "result" line — one
  // `claude -p` run can take several turns and emit one result each.
  parser.onProcessClose(0, "");
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

/** Minimal NDJSON for a run: an assistant turn using `tools`, then a result. */
function transcript(tools: { name: string; input?: unknown }[], result: { subtype?: string; is_error?: boolean; result?: string } = {}) {
  const lines = [JSON.stringify({ type: "system", subtype: "init", session_id: "sess-ask" })];
  for (const t of tools) {
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: t.name, input: t.input ?? {} }] } }));
  }
  lines.push(JSON.stringify({ type: "result", subtype: result.subtype ?? "success", is_error: result.is_error ?? false, result: result.result ?? "all done" }));
  return lines.join("\n");
}

/**
 * A headless `claude -p` cannot prompt, so a turn that ends on ExitPlanMode or
 * AskUserQuestion reports a perfectly successful result. Calling that "done"
 * is what made an agent that needed the user look finished and idle.
 */
describe("a run that ends needing the user", () => {
  it("ends waiting, not done, when the last tool was ExitPlanMode", () => {
    const events = run(transcript([{ name: "ExitPlanMode", input: { plan: "Refactor the parser, then add tests." } }]));
    const last = events.at(-1);
    expect(last?.kind).toBe("waiting");
    if (last?.kind === "waiting") expect(last.prompt).toBe("Refactor the parser, then add tests.");
    expect(events.some((e) => e.kind === "done")).toBe(false);
  });

  it("carries the question when the last tool was AskUserQuestion", () => {
    const events = run(transcript([{ name: "AskUserQuestion", input: { questions: [{ question: "Postgres or SQLite?" }] } }]));
    const last = events.at(-1);
    expect(last?.kind).toBe("waiting");
    if (last?.kind === "waiting") expect(last.prompt).toBe("Postgres or SQLite?");
  });

  it("falls back to the result text when the ask carried no readable prompt", () => {
    const events = run(transcript([{ name: "ExitPlanMode", input: {} }]));
    const last = events.at(-1);
    if (last?.kind === "waiting") expect(last.prompt).toBe("ExitPlanMode needs your answer");
  });

  it("still ends done when a later tool shows the turn carried on", () => {
    const events = run(transcript([{ name: "ExitPlanMode", input: { plan: "do a thing" } }, { name: "Write", input: { file_path: "/tmp/x" } }]));
    expect(events.at(-1)?.kind).toBe("done");
  });

  it("leaves an ordinary run alone", () => {
    expect(run(transcript([{ name: "Read", input: { file_path: "/tmp/x" } }])).at(-1)?.kind).toBe("done");
  });

  it("reports a failure as an error even if it ended on an ask", () => {
    const events = run(transcript([{ name: "ExitPlanMode", input: { plan: "x" } }], { subtype: "error_max_turns", is_error: true }));
    expect(events.at(-1)?.kind).toBe("error");
  });

  it("ignores a subagent's own ExitPlanMode — only the main agent can block on you", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
      JSON.stringify({ type: "assistant", parent_tool_use_id: "sub1", message: { content: [{ type: "tool_use", name: "ExitPlanMode", input: { plan: "sub plan" } }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "done" }),
    ].join("\n");
    expect(run(lines).at(-1)?.kind).toBe("done");
  });
});

/**
 * Plan mode cannot act, only propose — so a plan-mode run that finishes has
 * produced something for you to decide on, even when it never got as far as
 * calling ExitPlanMode. This is the case that actually bit: a Reviewer agent
 * researched, wrote up its findings, and the office called that "done".
 */
describe("a plan-mode run", () => {
  const planRun = (ndjson: string) => run(ndjson, { proposesOnly: true });

  it("ends waiting even without an explicit ask tool", () => {
    const events = planRun(transcript([{ name: "Read", input: { file_path: "/x" } }], { result: "Here is what I would change." }));
    const last = events.at(-1);
    expect(last?.kind).toBe("waiting");
    if (last?.kind === "waiting") expect(last.prompt).toBe("Here is what I would change.");
  });

  it("still prefers the ask tool's own prompt when there was one", () => {
    const events = planRun(transcript([{ name: "ExitPlanMode", input: { plan: "Step one, step two." } }]));
    const last = events.at(-1);
    if (last?.kind === "waiting") expect(last.prompt).toBe("Step one, step two.");
  });

  it("still reports a genuine failure as an error", () => {
    const events = planRun(transcript([{ name: "Read" }], { subtype: "error_max_turns", is_error: true }));
    expect(events.at(-1)?.kind).toBe("error");
  });

  it("does not affect an agent that can act", () => {
    expect(run(transcript([{ name: "Read" }])).at(-1)?.kind).toBe("done");
  });
});

/**
 * One `claude -p` invocation can re-init and take several turns, emitting a
 * "result" for each. Settling on the first one marked the ticket done and
 * dropped the session while the agent was still working — which is how an
 * agent came to sit idle with a finished ticket and unfinished work.
 */
describe("a run that emits more than one result", () => {
  const twoTurns = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: {} }] } }),
    JSON.stringify({ type: "result", subtype: "success", result: "first turn" }),
    JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: {} }] } }),
    JSON.stringify({ type: "result", subtype: "success", result: "second turn" }),
  ].join("\n");

  it("settles exactly once, on the last result", () => {
    const events = run(twoTurns);
    const terminal = events.filter((e) => e.kind === "done" || e.kind === "error" || e.kind === "waiting");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ kind: "done", summary: "second turn" });
  });

  it("does not settle while the process is still running", () => {
    const events: RunnerEvent[] = [];
    const parser = createStreamParser((e) => events.push(e));
    for (const line of twoTurns.split("\n")) parser.handleLine(line);
    expect(events.some((e) => e.kind === "done")).toBe(false);
  });

  it("lets a later failure override an earlier success", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
      JSON.stringify({ type: "result", subtype: "success", result: "ok so far" }),
      JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "blew up" }),
    ].join("\n");
    expect(run(lines).at(-1)).toMatchObject({ kind: "error" });
  });

  it("stays silent when the run was stopped on purpose", () => {
    const events: RunnerEvent[] = [];
    const parser = createStreamParser((e) => events.push(e));
    for (const line of twoTurns.split("\n")) parser.handleLine(line);
    parser.onProcessClose(0, "", true); // stop() was called
    expect(events.some((e) => e.kind === "done" || e.kind === "error")).toBe(false);
  });
});

/**
 * The office deals in "the agent changed a file"; which tool did it is the
 * runner's business. These assert the mapping without anything above the
 * runner needing to know the names.
 */
describe("file_touched", () => {
  const withTool = (name: string, input: unknown) =>
    run(
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } }),
        JSON.stringify({ type: "result", subtype: "success", result: "done" }),
      ].join("\n"),
    ).filter((e) => e.kind === "file_touched");

  it("maps every file-writing tool to a path", () => {
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      expect(withTool(tool, { file_path: "/x/a.ts" })).toEqual([{ kind: "file_touched", path: "/x/a.ts" }]);
    }
    expect(withTool("NotebookEdit", { notebook_path: "/x/n.ipynb" })).toEqual([{ kind: "file_touched", path: "/x/n.ipynb" }]);
  });

  it("ignores tools that only read", () => {
    expect(withTool("Read", { file_path: "/x/a.ts" })).toEqual([]);
    expect(withTool("Grep", { pattern: "x" })).toEqual([]);
    expect(withTool("Bash", { command: "rm -rf /x" })).toEqual([]);
  });

  it("ignores a write tool that named no path", () => {
    expect(withTool("Write", {})).toEqual([]);
  });

  it("still reports the tool call itself, so activity is unchanged", () => {
    const events = run(
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/x/a.ts" } }] } }),
        JSON.stringify({ type: "result", subtype: "success", result: "done" }),
      ].join("\n"),
    );
    expect(events.filter((e) => e.kind === "tool_use")).toHaveLength(1);
  });

  it("does not attribute a subagent's writes to the main agent", () => {
    const events = run(
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
        JSON.stringify({ type: "assistant", parent_tool_use_id: "sub1", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/x/a.ts" } }] } }),
        JSON.stringify({ type: "result", subtype: "success", result: "done" }),
      ].join("\n"),
    );
    expect(events.filter((e) => e.kind === "file_touched")).toEqual([]);
  });
});

describe("context gauge", () => {
  const usageLine = (cacheRead: number) =>
    [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: cacheRead } } }),
      JSON.stringify({ type: "result", subtype: "success", result: "done" }),
    ].join("\n");

  const pctFrom = (ndjson: string, contextWindow: number) => {
    const events: RunnerEvent[] = [];
    const parser = createStreamParser((e) => events.push(e), { contextWindow });
    for (const line of ndjson.split("\n")) parser.handleLine(line);
    const ctx = events.filter((e) => e.kind === "context").at(-1);
    return ctx?.kind === "context" ? ctx.pct : null;
  };

  it("measures against the model's window, not a fixed 200k", () => {
    // 100k used is a tenth of a 1M model and half of a 200k one.
    expect(pctFrom(usageLine(100_000), 1_000_000)).toBeCloseTo(0.1, 3);
    expect(pctFrom(usageLine(100_000), 200_000)).toBeCloseTo(0.5, 3);
  });

  it("never reports more than full", () => {
    expect(pctFrom(usageLine(5_000_000), 1_000_000)).toBe(1);
  });
});

/**
 * A log line is skimmed, so it gets its whitespace flattened. A question is
 * read, and flattening turned a review's headings, tables and code blocks into
 * one unbroken paragraph.
 */
describe("question text keeps its shape", () => {
  const plan = "# Findings\n\n| # | Severity |\n|---|---|\n| 1 | High |\n\n```ts\nconst x = 1;\n```";

  it("preserves newlines in a plan-mode result", () => {
    const events = run(
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
        JSON.stringify({ type: "result", subtype: "success", result: plan }),
      ].join("\n"),
      { proposesOnly: true },
    );
    const last = events.at(-1);
    expect(last?.kind).toBe("waiting");
    if (last?.kind === "waiting") {
      expect(last.prompt).toBe(plan);
      expect(last.prompt.split("\n").length).toBeGreaterThan(5);
    }
  });

  it("preserves newlines in an ExitPlanMode plan", () => {
    const events = run(
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "ExitPlanMode", input: { plan } }] } }),
        JSON.stringify({ type: "result", subtype: "success", result: "done" }),
      ].join("\n"),
    );
    const last = events.at(-1);
    if (last?.kind === "waiting") expect(last.prompt).toContain("\n| 1 | High |");
  });

  it("still flattens a tool summary, which is one line by design", () => {
    const events = run(
      [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "a\nb\nc" } }] } }),
        JSON.stringify({ type: "result", subtype: "success", result: "done" }),
      ].join("\n"),
    );
    const tool = events.find((e) => e.kind === "tool_use");
    if (tool?.kind === "tool_use") expect(tool.summary).toBe("a b c");
  });
});
