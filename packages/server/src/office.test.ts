import { describe, expect, it } from "vitest";
import type { Agent, RunnerEvent, Ticket, ServerMessage } from "@agent-office/shared";
import { DEFAULT_MODEL, ROLE_PRESETS } from "@agent-office/shared";
import { Office } from "./office.js";
import type { RunningSession, SessionRunner } from "./runner.js";

/** A runner the test drives by hand. */
class ManualRunner implements SessionRunner {
  emit!: (e: RunnerEvent) => void;
  stopped = 0;
  resumed: { sessionId: string; text: string }[] = [];
  responded: string[] = [];
  /** Flip to false to model a headless run whose process has already exited. */
  alive = true;
  start(_a: Agent, _t: Ticket, emit: (e: RunnerEvent) => void): RunningSession {
    this.emit = emit;
    return { sessionId: "s1", respond: (t) => void this.responded.push(t), stop: () => this.stopped++, isAlive: () => this.alive };
  }
  resume(_a: Agent, sessionId: string, text: string, emit: (e: RunnerEvent) => void): RunningSession {
    this.emit = emit;
    this.resumed.push({ sessionId, text });
    return { sessionId, respond: () => {}, stop: () => this.stopped++, isAlive: () => true };
  }
}

function setup() {
  const runner = new ManualRunner();
  const office = new Office(runner, { roots: ["/"] });
  const msgs: ServerMessage[] = [];
  office.subscribe((m) => msgs.push(m));
  return { runner, office, msgs };
}

describe("Office", () => {
  it("hires agents onto free desks and reuses freed desks", () => {
    const { office } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });
    const b = office.hire({ name: "B", role: "chat", cwd: "/x" });
    expect([a.desk, b.desk]).toEqual([0, 1]);
    office.fire(a.id);
    const c = office.hire({ name: "C", role: "reviewer", cwd: "/x" });
    expect(c.desk).toBe(0);
  });

  it("runs a ticket through the state machine", () => {
    const { office, runner } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });
    const t = office.createTicket("do thing");
    expect(office.assign(t.id, a.id)).toBeUndefined();

    runner.emit({ kind: "started", sessionId: "s1" });
    let snap = office.snapshot();
    expect(snap.tickets[0]!.status).toBe("in_progress");
    expect(snap.states[0]!.status).toBe("thinking");

    runner.emit({ kind: "tool_use", name: "Edit", summary: "a.ts" });
    snap = office.snapshot();
    expect(snap.states[0]!.status).toBe("tool_use");
    expect(snap.states[0]!.metrics.lastToolName).toBe("Edit");

    runner.emit({ kind: "waiting", prompt: "ok?" });
    expect(office.snapshot().tickets[0]!.status).toBe("waiting");
    office.respond(a.id, "yes");
    expect(office.snapshot().states[0]!.status).toBe("thinking");

    runner.emit({ kind: "subagent_start", id: "sub1", type: "Explore", description: "look" });
    expect(office.snapshot().states[0]!.subagents).toHaveLength(1);
    runner.emit({ kind: "subagent_stop", id: "sub1" });
    expect(office.snapshot().states[0]!.subagents).toHaveLength(0);

    runner.emit({ kind: "done", summary: "ok" });
    snap = office.snapshot();
    expect(snap.tickets[0]!.status).toBe("done");
    expect(snap.states[0]!.status).toBe("done");
  });

  it("refuses a second ticket for a busy agent", () => {
    const { office } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });
    const t1 = office.createTicket("one");
    const t2 = office.createTicket("two");
    office.assign(t1.id, a.id);
    expect(office.assign(t2.id, a.id)).toMatch(/busy/);
  });

  it("firing an agent stops its session and returns the ticket to backlog", () => {
    const { office, runner } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });
    const t = office.createTicket("one");
    office.assign(t.id, a.id);
    office.fire(a.id);
    expect(runner.stopped).toBe(1);
    const snap = office.snapshot();
    expect(snap.agents).toHaveLength(0);
    expect(snap.tickets[0]!.status).toBe("backlog");
    expect(snap.tickets[0]!.assignedAgentId).toBeNull();
  });
});

describe("Office.ingestExternal (hook-driven, no ticket)", () => {
  it("drives status through an interactive session without ever touching ticket state", () => {
    const { office } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });

    office.ingestExternal(a.id, { kind: "started", sessionId: "term-1" });
    expect(office.snapshot().states[0]!.status).toBe("thinking");
    expect(office.snapshot().states[0]!.sessionId).toBe("term-1");

    office.ingestExternal(a.id, { kind: "tool_use", name: "Read", summary: "a.ts" });
    expect(office.snapshot().states[0]!.status).toBe("tool_use");
    expect(office.snapshot().states[0]!.metrics.lastToolName).toBe("Read");

    office.ingestExternal(a.id, { kind: "subagent_start", id: "sub1", type: "Explore", description: "look" });
    expect(office.snapshot().states[0]!.subagents).toHaveLength(1);
    office.ingestExternal(a.id, { kind: "subagent_tool", id: "sub1", name: "Grep", summary: "TODO" });
    expect(office.snapshot().states[0]!.subagents[0]!.metrics.lastToolName).toBe("Grep");
    office.ingestExternal(a.id, { kind: "subagent_stop", id: "sub1" });
    expect(office.snapshot().states[0]!.subagents).toHaveLength(0);

    // Stop hook with nothing else running: settles to idle.
    office.ingestExternal(a.id, { kind: "done", summary: "turn finished" });
    expect(office.snapshot().states[0]!.status).toBe("idle");
  });

  it("subagent_stop without an id closes the oldest open tile", () => {
    const { office } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });
    office.ingestExternal(a.id, { kind: "subagent_start", id: "sub1", type: "Explore", description: "first" });
    office.ingestExternal(a.id, { kind: "subagent_start", id: "sub2", type: "Plan", description: "second" });
    office.ingestExternal(a.id, { kind: "subagent_stop", id: "" });
    const subs = office.snapshot().states[0]!.subagents;
    expect(subs).toHaveLength(1);
    expect(subs[0]!.id).toBe("sub2");
  });

  it("ignores hook events for the office's own ticket run, so tools are not logged twice", () => {
    const { office, runner } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });
    const t = office.createTicket("do thing");
    office.assign(t.id, a.id);
    runner.emit({ kind: "started", sessionId: "s1" });

    // The runner's stream and the folder's PreToolUse hook both describe the
    // same Write: the hooks are installed in the agent's folder, so they fire
    // for headless ticket runs too, not just interactive terminal sessions.
    runner.emit({ kind: "tool_use", name: "Write", summary: "hello.txt" });
    office.ingestExternal(a.id, { kind: "tool_use", name: "Write", summary: "hello.txt" });

    const log = office.snapshot().states[0]!.log;
    expect(log.filter((l) => l.includes("Write hello.txt"))).toHaveLength(1);
  });

  it("a Stop hook does not settle to idle or touch the ticket while a ticket is actively running", () => {
    const { office, runner } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });
    const t = office.createTicket("do thing");
    office.assign(t.id, a.id);
    runner.emit({ kind: "started", sessionId: "s1" });
    runner.emit({ kind: "tool_use", name: "Edit", summary: "a.ts" }); // agent is busy

    office.ingestExternal(a.id, { kind: "done", summary: "turn finished" }); // an unrelated terminal Stop hook
    const snap = office.snapshot();
    expect(snap.states[0]!.status).toBe("tool_use"); // untouched — still owned by the running ticket
    expect(snap.tickets[0]!.status).toBe("in_progress"); // never flipped to done by the hook
  });

  it("forceIdle (SessionEnd) goes idle only when no ticket is running", () => {
    const { office, runner } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });
    office.ingestExternal(a.id, { kind: "started", sessionId: "term-1" });
    office.forceIdle(a.id);
    expect(office.snapshot().states[0]!.status).toBe("idle");

    const t = office.createTicket("do thing");
    office.assign(t.id, a.id);
    runner.emit({ kind: "started", sessionId: "s1" });
    office.forceIdle(a.id); // unrelated terminal session ending must not interrupt the ticket
    expect(office.snapshot().states[0]!.status).toBe("thinking");
  });

  it("ingestStatusline sets contextPct from used_percentage, defensively ignores garbage, and defers to an active ticket", () => {
    const { office, runner } = setup();
    const a = office.hire({ name: "A", role: "coder", cwd: "/x" });

    office.ingestStatusline(a.id, { context_window: { used_percentage: 42 } });
    expect(office.snapshot().states[0]!.metrics.contextPct).toBeCloseTo(0.42);

    office.ingestStatusline(a.id, null);
    office.ingestStatusline(a.id, { context_window: "not an object" });
    office.ingestStatusline(a.id, {});
    expect(office.snapshot().states[0]!.metrics.contextPct).toBeCloseTo(0.42); // unchanged by garbage input

    const t = office.createTicket("do thing");
    office.assign(t.id, a.id); // starting a ticket resets metrics (fresh session)
    runner.emit({ kind: "started", sessionId: "s1" });
    runner.emit({ kind: "context", pct: 0.11 }); // the ticket's own context readout
    office.ingestStatusline(a.id, { context_window: { used_percentage: 90 } });
    expect(office.snapshot().states[0]!.metrics.contextPct).toBeCloseTo(0.11); // unrelated terminal session must not override it
  });
});

describe("hire model", () => {
  it("uses the model the hire form picked", () => {
    const office = new Office(new ManualRunner(), { roots: ["/"] });
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/tmp", model: "claude-haiku-4-5" });
    expect(agent.model).toBe("claude-haiku-4-5");
  });

  it("falls back to the role preset when no model is given", () => {
    const office = new Office(new ManualRunner(), { roots: ["/"] });
    const agent = office.hire({ name: "Rex", role: "reviewer", cwd: "/tmp" });
    expect(agent.model).toBe(ROLE_PRESETS.reviewer.model);
    expect(agent.model).toBe(DEFAULT_MODEL);
  });
});

describe("answering an agent that needs you", () => {
  /** Drive an agent to `waiting` the way a real headless run gets there. */
  function waiting() {
    const { runner, office, msgs } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("do a thing", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "sess-1" });
    runner.emit({ kind: "waiting", prompt: "Postgres or SQLite?" });
    return { runner, office, msgs, agent, ticket };
  }

  it("puts the agent and its ticket into waiting", () => {
    const { office, agent, ticket } = waiting();
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.status).toBe("waiting");
    expect(office.snapshot().tickets.find((t) => t.id === ticket.id)?.status).toBe("waiting");
  });

  it("resumes the same conversation when the headless run has already exited", () => {
    const { runner, office, agent, ticket } = waiting();
    // A headless run is gone by the time it is waiting, so the office must
    // start a fresh `claude -p --resume` rather than write to a dead stdin.
    runner.alive = false;
    office.respond(agent.id, "SQLite");

    expect(runner.resumed).toEqual([{ sessionId: "sess-1", text: "SQLite" }]);
    const state = office.snapshot().states.find((s) => s.agentId === agent.id);
    expect(state?.status).toBe("thinking");
    expect(office.snapshot().tickets.find((t) => t.id === ticket.id)?.status).toBe("in_progress");
  });

  it("writes to stdin instead when the session is still alive", () => {
    const { runner, office, agent } = waiting();
    office.respond(agent.id, "SQLite");
    expect(runner.responded).toEqual(["SQLite"]);
    expect(runner.resumed).toEqual([]);
  });
});

describe("updateAgent", () => {
  it("changes the model and permission mode, persists and broadcasts", () => {
    const { office, msgs } = setup();
    const agent = office.hire({ name: "Ada", role: "reviewer", cwd: "/x" });
    msgs.length = 0;

    expect(office.updateAgent(agent.id, { model: "claude-sonnet-5", permissionMode: "acceptEdits" })).toBeUndefined();
    const updated = office.snapshot().agents.find((a) => a.id === agent.id);
    expect(updated?.model).toBe("claude-sonnet-5");
    expect(updated?.permissionMode).toBe("acceptEdits");
    expect(msgs.some((m) => m.type === "agent.upsert" && m.agent.id === agent.id)).toBe(true);
  });

  it("leaves untouched fields alone", () => {
    const { office } = setup();
    const agent = office.hire({ name: "Ada", role: "reviewer", cwd: "/x" });
    office.updateAgent(agent.id, { permissionMode: "plan" });
    expect(office.snapshot().agents.find((a) => a.id === agent.id)?.model).toBe(agent.model);
  });

  it("reports an unknown agent instead of throwing", () => {
    const { office } = setup();
    expect(office.updateAgent("nope", { permissionMode: "plan" })).toContain("nope");
  });
});

describe("hook events during an office-run session", () => {
  it("still drops duplicate tool calls, but lets a waiting through", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("do a thing", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "sess-1" });

    const before = office.snapshot().states.find((s) => s.agentId === agent.id)!.log.length;
    // PreToolUse fires for the office's own run too — this is bug 5's guard.
    office.ingestExternal(agent.id, { kind: "tool_use", name: "Write", summary: "/tmp/x" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)!.log.length).toBe(before);

    // ...but the stream never emits "waiting", so that one has to get through.
    office.ingestExternal(agent.id, { kind: "waiting", prompt: "may I?" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.status).toBe("waiting");
  });
});

/**
 * Two different things can be waiting on you, and only one of them is
 * answerable from the panel. An interactive terminal session shows Claude
 * Code's own numbered prompt and only that pty can hear the answer; replying
 * from the panel would start a second session against the same conversation.
 */
describe("where a question can be answered", () => {
  it("marks a ticket run's own ask as answerable from the panel", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("do a thing", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "sess-1" });
    runner.emit({ kind: "waiting", prompt: "Postgres or SQLite?" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.answerIn).toBe("panel");
  });

  it("marks a hook-driven ask as belonging to the terminal", () => {
    const { office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    office.ingestExternal(agent.id, { kind: "waiting", prompt: "Claude needs your permission" });
    const state = office.snapshot().states.find((s) => s.agentId === agent.id);
    expect(state?.answerIn).toBe("terminal");
    expect(state?.status).toBe("waiting");
  });

  it("refuses to answer a terminal's prompt, rather than forking a rival session", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    office.ingestExternal(agent.id, { kind: "waiting", prompt: "Claude needs your permission" });
    // A terminal session has a session id, which is exactly what would have
    // been resumed.
    office.ingestExternal(agent.id, { kind: "started", sessionId: "term-1" });

    office.respond(agent.id, "1");
    expect(runner.resumed).toEqual([]);
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.question).toBe("Claude needs your permission");
  });

  it("clears both when the agent moves on", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("do a thing", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "sess-1" });
    runner.emit({ kind: "waiting", prompt: "well?" });
    runner.emit({ kind: "tool_use", name: "Read", summary: "/x" });
    const state = office.snapshot().states.find((s) => s.agentId === agent.id);
    expect(state?.question).toBeNull();
    expect(state?.answerIn).toBeNull();
  });
});

describe("touched files", () => {
  it("records what the agent wrote, in the order it first wrote it", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("do a thing", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "s1" });
    runner.emit({ kind: "file_touched", path: "/x/b.ts" });
    runner.emit({ kind: "file_touched", path: "/x/a.ts" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.touchedFiles).toEqual(["/x/b.ts", "/x/a.ts"]);
  });

  it("records a file once however often it is written", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("do a thing", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "s1" });
    for (let i = 0; i < 3; i++) runner.emit({ kind: "file_touched", path: "/x/a.ts" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.touchedFiles).toEqual(["/x/a.ts"]);
  });

  it("counts a take-over in the terminal as the same agent's work", () => {
    const { office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    office.ingestExternal(agent.id, { kind: "file_touched", path: "/x/from-terminal.ts" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.touchedFiles).toEqual(["/x/from-terminal.ts"]);
  });

  /** A new session is new work; last session's files are not the answer to "what has this agent changed". */
  it("starts again when a new session begins", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("do a thing", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "s1" });
    runner.emit({ kind: "file_touched", path: "/x/old.ts" });
    runner.emit({ kind: "started", sessionId: "s2" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.touchedFiles).toEqual([]);
  });

  it("keeps them when the same session reports started again", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("do a thing", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "s1" });
    runner.emit({ kind: "file_touched", path: "/x/a.ts" });
    runner.emit({ kind: "started", sessionId: "s1" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.touchedFiles).toEqual(["/x/a.ts"]);
  });
});

/**
 * A take-over has no NDJSON stream, so nothing reports how long it has been
 * running or what it has spent. The header showed "– · $0.00 · –", which
 * reads as broken rather than as "not known yet".
 */
describe("metrics for a session the office did not start", () => {
  it("starts the clock when a terminal session begins", () => {
    const { office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.metrics.startedAt).toBeNull();

    office.ingestExternal(agent.id, { kind: "started", sessionId: "term-1" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.metrics.startedAt).not.toBeNull();
  });

  it("does not move a clock a ticket run already started", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("t", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "s1" });
    const first = office.snapshot().states.find((s) => s.agentId === agent.id)?.metrics.startedAt;
    office.ingestExternal(agent.id, { kind: "started", sessionId: "s1" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.metrics.startedAt).toBe(first);
  });

  it("takes cost and elapsed from the statusline, which is the only source", () => {
    const { office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    office.ingestStatusline(agent.id, {
      cost: { total_cost_usd: 0.42, total_duration_ms: 65_000 },
      context_window: { used_percentage: 12 },
    });
    const m = office.snapshot().states.find((s) => s.agentId === agent.id)?.metrics;
    expect(m?.costUsd).toBe(0.42);
    expect(m?.contextPct).toBeCloseTo(0.12, 3);
    expect(Date.now() - new Date(m!.startedAt!).getTime()).toBeGreaterThanOrEqual(64_000);
  });

  it("ignores a statusline that carries none of it", () => {
    const { office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    office.ingestStatusline(agent.id, { model: { display_name: "Opus 5" } });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.metrics.costUsd).toBe(0);
  });

  it("leaves a running ticket's own numbers alone", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("t", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "usage", input: 1, output: 2, cacheRead: 3, costUsd: 9.99 });
    office.ingestStatusline(agent.id, { cost: { total_cost_usd: 0.01 } });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.metrics.costUsd).toBe(9.99);
  });
});

/**
 * An answer typed into the terminal produces no event of its own, so the ask
 * card has to notice the agent moving on. Clearing on every hook event
 * cancelled questions just for opening a terminal to read them; clearing on
 * none left the card up forever.
 */
describe("a terminal-owned ask clears itself", () => {
  const asking = () => {
    const { office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    office.ingestExternal(agent.id, { kind: "waiting", prompt: "may I?" });
    return { office, agent };
  };

  it("clears once the agent runs a tool again", () => {
    const { office, agent } = asking();
    office.ingestExternal(agent.id, { kind: "tool_use", name: "Read", summary: "/x/a.ts" });
    const state = office.snapshot().states.find((s) => s.agentId === agent.id);
    expect(state?.question).toBeNull();
    expect(state?.answerIn).toBeNull();
    expect(state?.status).not.toBe("waiting");
  });

  it("clears when the turn finishes", () => {
    const { office, agent } = asking();
    office.ingestExternal(agent.id, { kind: "done", summary: "finished" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.question).toBeNull();
  });

  /** Opening a terminal to read the question must not dismiss it. */
  it("survives a session starting", () => {
    const { office, agent } = asking();
    office.ingestExternal(agent.id, { kind: "started", sessionId: "term-1" });
    const state = office.snapshot().states.find((s) => s.agentId === agent.id);
    expect(state?.question).toBe("may I?");
    expect(state?.status).toBe("waiting");
  });

  it("leaves a panel-owned ask alone, which is answered through the panel", () => {
    const { runner, office } = setup();
    const agent = office.hire({ name: "Ada", role: "coder", cwd: "/x" });
    const ticket = office.createTicket("t", "");
    office.assign(ticket.id, agent.id);
    runner.emit({ kind: "started", sessionId: "s1" });
    runner.emit({ kind: "waiting", prompt: "which?" });
    office.ingestExternal(agent.id, { kind: "tool_use", name: "Read", summary: "/x" });
    expect(office.snapshot().states.find((s) => s.agentId === agent.id)?.question).toBe("which?");
  });
});
