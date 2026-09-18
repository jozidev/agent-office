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
