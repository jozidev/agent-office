import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Agent, Ticket } from "@agent-office/shared";
import { Office } from "./office.js";
import { MockRunner } from "./mockRunner.js";
import { SqliteStore, defaultDbPath, statusAfterRestart } from "./store.js";

let dir: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-office-store-"));
  store = new SqliteStore(join(dir, "office.db"));
});

afterEach(() => {
  store.close();
});

const agent = (over: Partial<Agent> = {}): Agent =>
  ({
    id: "a1",
    name: "Nyx",
    role: "coder",
    color: "#4aa3df",
    model: "sonnet",
    cwd: "~/code/thing",
    systemPrompt: "be brief",
    allowedTools: ["Read", "Write"],
    permissionMode: "acceptEdits",
    uiMode: "terminal",
    desk: 0,
    createdAt: "2026-09-18T10:00:00.000Z",
    ...over,
  }) as Agent;

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: "t1",
    title: "add a hello.txt",
    description: "containing hi",
    status: "backlog",
    assignedAgentId: null,
    sessionId: null,
    createdAt: "2026-09-18T10:00:00.000Z",
    updatedAt: "2026-09-18T10:00:00.000Z",
    ...over,
  }) as Ticket;

describe("SqliteStore", () => {
  it("creates the database file and its parent directory", () => {
    const nested = join(dir, "does", "not", "exist", "office.db");
    const s = new SqliteStore(nested);
    expect(existsSync(nested)).toBe(true);
    s.close();
  });

  it("round-trips an agent, arrays and all", () => {
    store.saveAgent(agent());
    expect(store.loadAgents()).toEqual([agent()]);
  });

  it("updates an agent in place rather than duplicating it", () => {
    store.saveAgent(agent());
    store.saveAgent(agent({ name: "Vex", desk: 3 }));
    const loaded = store.loadAgents();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ name: "Vex", desk: 3 });
  });

  it("orders agents by desk so they come back to the same seats", () => {
    store.saveAgent(agent({ id: "a2", name: "Vex", desk: 2 }));
    store.saveAgent(agent({ id: "a1", name: "Nyx", desk: 0 }));
    expect(store.loadAgents().map((a) => a.name)).toEqual(["Nyx", "Vex"]);
  });

  it("forgets a fired agent", () => {
    store.saveAgent(agent());
    store.deleteAgent("a1");
    expect(store.loadAgents()).toEqual([]);
  });

  it("keeps the last session id per agent, so a restored terminal can resume", () => {
    store.saveAgent(agent());
    expect(store.loadSessionIds().size).toBe(0);
    store.saveAgentSession("a1", "sess-123");
    expect(store.loadSessionIds().get("a1")).toBe("sess-123");
  });

  it("round-trips tickets and forgets deleted ones", () => {
    store.saveTicket(ticket());
    expect(store.loadTickets()).toEqual([ticket()]);
    store.deleteTicket("t1");
    expect(store.loadTickets()).toEqual([]);
  });

  it("returns mid-flight tickets to the backlog, unassigned", () => {
    store.saveTicket(ticket({ id: "t1", status: "in_progress", assignedAgentId: "a1", sessionId: "sess-1" }));
    const [loaded] = store.loadTickets();
    expect(loaded).toMatchObject({ status: "backlog", assignedAgentId: null, sessionId: null });
  });

  it("leaves finished and backlog tickets exactly as they were", () => {
    store.saveTicket(ticket({ id: "t1", status: "done", assignedAgentId: "a1", sessionId: "sess-1" }));
    expect(store.loadTickets()[0]).toMatchObject({ status: "done", assignedAgentId: "a1", sessionId: "sess-1" });
  });

  it("survives being closed and reopened", () => {
    store.saveAgent(agent());
    store.saveTicket(ticket());
    store.close();
    const reopened = new SqliteStore(join(dir, "office.db"));
    expect(reopened.loadAgents()).toHaveLength(1);
    expect(reopened.loadTickets()).toHaveLength(1);
    reopened.close();
  });
});

describe("statusAfterRestart", () => {
  it("drops the statuses that only mean something while a session is alive", () => {
    expect(statusAfterRestart("assigned")).toBe("backlog");
    expect(statusAfterRestart("in_progress")).toBe("backlog");
    expect(statusAfterRestart("waiting")).toBe("backlog");
  });

  it("keeps the stable ones", () => {
    expect(statusAfterRestart("backlog")).toBe("backlog");
    expect(statusAfterRestart("done")).toBe("done");
  });
});

describe("defaultDbPath", () => {
  it("honours AGENT_OFFICE_HOME", () => {
    expect(defaultDbPath({ AGENT_OFFICE_HOME: "/tmp/office" } as NodeJS.ProcessEnv)).toBe("/tmp/office/office.db");
  });

  it("falls back to ~/.agent-office", () => {
    expect(defaultDbPath({} as NodeJS.ProcessEnv)).toMatch(/\.agent-office\/office\.db$/);
  });
});

/** The point of all of the above: close the office, open it again, find it as you left it. */
describe("Office restore", () => {
  it("brings agents back to their desks, idle, with their last session id", () => {
    const first = new Office(new MockRunner(), { store });
    const hired = first.hire({ name: "Nyx", role: "coder", cwd: "~/code/thing" });
    store.saveAgentSession(hired.id, "sess-abc");

    const second = new Office(new MockRunner(), { store });
    expect(second.restore()).toEqual({ agents: 1, tickets: 0 });
    const snap = second.snapshot();
    expect(snap.agents[0]).toMatchObject({ id: hired.id, name: "Nyx", desk: hired.desk });
    expect(snap.states[0]).toMatchObject({ agentId: hired.id, status: "idle", sessionId: "sess-abc", ticketId: null });
  });

  it("brings the board back, with in-flight work returned to the backlog", () => {
    const first = new Office(new MockRunner(), { store });
    const a = first.hire({ name: "Nyx", role: "coder", cwd: "~/code/thing" });
    const kept = first.createTicket("still to do");
    const inFlight = first.createTicket("was running");
    first.assign(inFlight.id, a.id);

    const second = new Office(new MockRunner(), { store });
    second.restore();
    const tickets = second.snapshot().tickets;
    expect(tickets.map((t) => t.title).sort()).toEqual(["still to do", "was running"]);
    expect(tickets.find((t) => t.id === kept.id)).toMatchObject({ status: "backlog" });
    expect(tickets.find((t) => t.id === inFlight.id)).toMatchObject({ status: "backlog", assignedAgentId: null });
  });

  it("does not bring back an agent who was fired", () => {
    const first = new Office(new MockRunner(), { store });
    const a = first.hire({ name: "Nyx", role: "coder", cwd: "~/code/thing" });
    first.hire({ name: "Vex", role: "reviewer", cwd: "~/code/thing" });
    first.fire(a.id);

    const second = new Office(new MockRunner(), { store });
    second.restore();
    expect(second.snapshot().agents.map((x) => x.name)).toEqual(["Vex"]);
  });

  it("does not bring back a deleted ticket", () => {
    const first = new Office(new MockRunner(), { store });
    const t = first.createTicket("gone");
    first.deleteTicket(t.id);

    const second = new Office(new MockRunner(), { store });
    second.restore();
    expect(second.snapshot().tickets).toEqual([]);
  });
});
