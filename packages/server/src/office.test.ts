import { describe, expect, it } from "vitest";
import type { Agent, RunnerEvent, Ticket, ServerMessage } from "@agent-office/shared";
import { Office } from "./office.js";
import type { RunningSession, SessionRunner } from "./runner.js";

/** A runner the test drives by hand. */
class ManualRunner implements SessionRunner {
  emit!: (e: RunnerEvent) => void;
  stopped = 0;
  start(_a: Agent, _t: Ticket, emit: (e: RunnerEvent) => void): RunningSession {
    this.emit = emit;
    return { sessionId: "s1", respond: () => {}, stop: () => this.stopped++ };
  }
}

function setup() {
  const runner = new ManualRunner();
  const office = new Office(runner);
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
